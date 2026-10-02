#!/usr/bin/env python3
"""Q2-Q10: the remaining open queries, all from the store.

    python3 analysis/final/q2_q10_queries.py

Q5 reruns the whole verification table under an alternative duplicate rule
(drop both rows of a duplicated pair) and diffs it against the primary rule
(keep the smallest p), so the manuscript's robustness sentence is checked
rather than asserted.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "analysis", "examples"))

from common import (ANCESTRIES, CLUMP_WINDOW, ESRD, PRIMARY_THRESHOLD, clump,
                    connect, in_region, log, meta_for, neighbours, positions,
                    significant, target_snps, write_csv)

OUT = os.path.join(HERE, "results")
APOL1 = ("22", 36_253_071, 36_267_530)
TCF7L2 = ("10", 112_950_247, 113_167_678)
CLUSTER = ("genitourinary system", "hematopoietic")
LEADS = ("rs9622362", "rs73885319", "rs7291184")


def set_dedupe(con, rule):
    """`assoc` under one of the two duplicate rules.

    primary   one row per pair, the smallest META p
    drop_both every row of a duplicated pair removed entirely
    """
    if rule == "primary":
        con.execute("""CREATE OR REPLACE TEMP VIEW assoc AS
            SELECT * EXCLUDE (rn) FROM (
              SELECT *, row_number() OVER (PARTITION BY phe_id, rsid
                         ORDER BY coalesce("pval.meta", 2), src_row) AS rn
              FROM assoc_raw) WHERE rn = 1""")
    else:
        # Drop both rows of a TRUE duplicate - same phecode, several rows -
        # while still collapsing merged nodes the way the primary rule does.
        # Collapsing is not the thing under test: the five merged nodes
        # legitimately carry one row per phecode, and leaving them expanded
        # here changed two things at once and made EUR's edge weight rise
        # when removing rows can only lower it.
        con.execute("""CREATE OR REPLACE TEMP VIEW assoc AS
            SELECT * EXCLUDE (rn) FROM (
              SELECT *, row_number() OVER (PARTITION BY phe_id, rsid
                         ORDER BY coalesce("pval.meta", 2), src_row) AS rn
              FROM assoc_raw a
              WHERE NOT EXISTS (
                SELECT 1 FROM assoc_raw b
                WHERE b.phe_id = a.phe_id AND b.rsid = a.rsid
                  AND b.phenotype = a.phenotype AND b.src_row <> a.src_row))
            WHERE rn = 1""")


def esrd_table(con, meta):
    """Every ESRD number the verification table asks for."""
    out = {}
    for anc in ("afr", "eur"):
        nb = neighbours(con, anc, PRIMARY_THRESHOLD, ESRD)
        w = sum(v["shared"] for v in nb.values())
        cw = sum(v["concordant"] for v in nb.values())
        inc = {k: v for k, v in nb.items()
               if meta.get(k, {}).get("category") in CLUSTER}
        anyd = sum(1 for v in nb.values() if v["discordant"] > 0)
        majd = sum(1 for v in nb.values() if v["discordant"] > v["concordant"])
        out[anc.upper()] = {
            "neighbours": len(nb), "weight": w,
            "within_cluster_neighbour_share": round(len(inc) / len(nb), 4),
            "within_cluster_weight_share": round(
                sum(v["shared"] for v in inc.values()) / w, 4),
            "concordant_weight_share": round(cw / w, 4),
            "discordant_weight_share": round(1 - cw / w, 4),
            "neighbours_any_discordant": anyd,
            "neighbours_majority_discordant": majd,
            "snps": len(target_snps(con, anc, PRIMARY_THRESHOLD, ESRD))}
    shared = con.execute(f"""SELECT count(*) FROM assoc WHERE phe_id = ?
        AND {significant('afr', PRIMARY_THRESHOLD)}
        AND {significant('eur', PRIMARY_THRESHOLD)}""", [ESRD]).fetchone()[0]
    out["shared_snps"] = shared
    out["union_snps"] = out["AFR"]["snps"] + out["EUR"]["snps"] - shared
    for anc in ("afr", "eur"):
        by = {}
        for _, chrom, _, _ in target_snps(con, anc, PRIMARY_THRESHOLD, ESRD):
            by[chrom] = by.get(chrom, 0) + 1
        top = max(by.items(), key=lambda kv: kv[1])
        out[anc.upper()]["top_chrom"] = top[0]
        out[anc.upper()]["top_chrom_share"] = round(top[1] / sum(by.values()), 4)
    return out


def esrd_loci(con, meta):
    per, out = {}, {}
    for anc in ANCESTRIES:
        snps = con.execute(f"""SELECT a.rsid, p.chrom, p.pos, a."pval.{anc}"
            FROM assoc a JOIN pos p USING (rsid)
            WHERE a.phe_id = ? AND {significant(anc, PRIMARY_THRESHOLD, 'a.')}""",
            [ESRD]).fetchall()
        locus_of, loci = clump(snps)
        nb = neighbours(con, anc, PRIMARY_THRESHOLD, ESRD)
        for L in loci:
            L["is_apol1"] = in_region(L, APOL1)
            L["is_tcf7l2"] = in_region(L, TCF7L2)
            hit, pairs, uniq = set(), 0, set()
            for k, v in nb.items():
                n = 0
                for r in v["rsids"]:
                    if locus_of.get(r) == L["index"]:
                        n += 1
                        uniq.add(r)
                if n:
                    hit.add(k)
                    pairs += n
            L["neighbours"] = len(hit)
            L["snp_neighbour_pairs"] = pairs
            L["unique_snps_in_edges"] = len(uniq)
        per[anc] = {"loci": loci, "locus_of": locus_of, "nb": nb,
                    "weight": sum(v["shared"] for v in nb.values())}
        out[anc.upper()] = {"loci": len(loci)}
    shared = [l for la in per["afr"]["loci"] for l in per["eur"]["loci"]
              if la["chrom"] == l["chrom"] and abs(la["lead_pos"] - l["lead_pos"]) <= CLUMP_WINDOW]
    out["shared_afr_eur"] = len(shared)
    out["union_afr_eur"] = len(per["afr"]["loci"]) + len(per["eur"]["loci"]) - len(shared)
    return out, per


def q4_apol1(per):
    """Q4: what each APOL1 figure counts."""
    rows = []
    for anc in ("afr", "eur"):
        d = per[anc]
        tot_pairs = sum(v["shared"] for v in d["nb"].values())
        mapped_pairs = sum(L["snp_neighbour_pairs"] for L in d["loci"])
        ap = [L for L in d["loci"] if L["is_apol1"]]
        ap_pairs = sum(L["snp_neighbour_pairs"] for L in ap)
        ap_nb = len({n for L in ap for n in [None]} ) if False else (ap[0]["neighbours"] if ap else 0)
        ap_uniq = sum(L["unique_snps_in_edges"] for L in ap)
        rows.append({
            "ancestry": anc.upper(),
            "edge_weight_total_snp_neighbour_pairs": tot_pairs,
            "edge_weight_with_a_position": mapped_pairs,
            "apol1_snp_neighbour_pairs": ap_pairs,
            "apol1_share_of_all_edge_weight": round(ap_pairs / tot_pairs, 4) if tot_pairs else 0,
            "apol1_share_of_positioned_edge_weight": round(ap_pairs / mapped_pairs, 4) if mapped_pairs else 0,
            "apol1_unique_snps_in_edges": ap_uniq,
            "apol1_neighbours": ap_nb})
    return rows


def main():
    os.makedirs(OUT, exist_ok=True)
    con = connect()
    meta = meta_for(con)
    positions(con)
    answers = {}

    # ---------------------------------------------------------------- Q2
    log("Q2: ESRD EUR redundancy columns")
    sys.path.insert(0, os.path.join(REPO, "analysis", "phecode_redundancy"))
    from phecode_relations import PhecodeRelations, to_phecode
    import run_analysis as ra
    rel = PhecodeRelations(ra.ICD_MAP, ra.DEFINITIONS)
    codes = {}
    for phe, code in con.execute(
            "SELECT DISTINCT phe_id, phenotype FROM assoc_raw").fetchall():
        c = to_phecode(code)
        if c:
            codes.setdefault(phe, []).append(c)
    tgt = codes.get(ESRD, [])
    q2 = []
    for anc in ("eur", "afr"):
        nb = neighbours(con, anc, PRIMARY_THRESHOLD, ESRD)
        flags = {}
        for k in nb:
            t1 = t2 = t3 = t4 = False
            for x in tgt:
                for y in codes.get(k, []):
                    r = rel.classify(x, y)
                    t1 |= r.t1; t2 |= r.t2; t3 |= bool(r.t3); t4 |= r.t4
            flags[k] = (t1, t2, t3, t4)
        for level, drop in (("L0", lambda f: False), ("L1", lambda f: f[0]),
                            ("L2", lambda f: f[0] or f[1]), ("L3", lambda f: any(f))):
            kept = {k: v for k, v in nb.items() if not drop(flags[k])}
            w = sum(v["shared"] for v in kept.values())
            cw = sum(v["concordant"] for v in kept.values())
            inc = {k: v for k, v in kept.items()
                   if meta.get(k, {}).get("category") in CLUSTER}
            q2.append({"ancestry": anc.upper(), "level": level, "degree": len(kept),
                       "within_cluster_weight_share": round(
                           sum(v["shared"] for v in inc.values()) / w, 4) if w else None,
                       "concordant_weight_share": round(cw / w, 4) if w else None})
    write_csv(q2, os.path.join(OUT, "q2_esrd_redundancy.csv"))
    for r in q2:
        if r["ancestry"] == "EUR":
            log(f"  EUR {r['level']}: degree {r['degree']}, within-cluster "
                f"{r['within_cluster_weight_share']}, concordant {r['concordant_weight_share']}")
    answers["Q2"] = q2

    # ---------------------------------------------------------------- Q3
    log("Q3: per-allele effect comparison")
    q3 = []
    for rs in LEADS:
        r = con.execute(f"""SELECT "beta.afr","se.afr","pval.afr","beta.eur","se.eur","pval.eur"
            FROM assoc WHERE phe_id = ? AND rsid = ?""", [ESRD, rs]).fetchone()
        if not r or r[0] is None or r[3] is None:
            q3.append({"rsid": rs, "note": "one ancestry has no estimate"})
            continue
        ba, sa, pa, be, se, pe = r
        z = (ba - be) / math.sqrt(sa ** 2 + se ** 2)
        p = math.erfc(abs(z) / math.sqrt(2))
        cia = (ba - 1.96 * sa, ba + 1.96 * sa)
        cie = (be - 1.96 * se, be + 1.96 * se)
        overlap = not (cia[1] < cie[0] or cie[1] < cia[0])
        q3.append({"rsid": rs, "beta_afr": ba, "se_afr": sa, "p_afr": pa,
                   "beta_eur": be, "se_eur": se, "p_eur": pe,
                   "z_difference": round(z, 4), "p_difference": p,
                   "ci95_afr": f"[{cia[0]:.4f}, {cia[1]:.4f}]",
                   "ci95_eur": f"[{cie[0]:.4f}, {cie[1]:.4f}]",
                   "ci_overlap": overlap})
        log(f"  {rs}: beta AFR {ba:+.4f} ({sa:.4f}) EUR {be:+.4f} ({se:.4f})  "
            f"z={z:+.3f} p={p:.3g}  CIs overlap: {overlap}")
    write_csv([r for r in q3 if "z_difference" in r], os.path.join(OUT, "q3_effect_comparison.csv"))
    answers["Q3"] = q3

    # ---------------------------------------------------------------- Q4
    log("Q4: APOL1 share")
    loci_summary, per = esrd_loci(con, meta)
    q4 = q4_apol1(per)
    write_csv(q4, os.path.join(OUT, "q4_apol1_share.csv"))
    for r in q4:
        log(f"  {r['ancestry']}: APOL1 {r['apol1_snp_neighbour_pairs']} of "
            f"{r['edge_weight_total_snp_neighbour_pairs']} SNP-neighbour pairs "
            f"= {r['apol1_share_of_all_edge_weight']:.3f}; of positioned only "
            f"{r['apol1_share_of_positioned_edge_weight']:.3f}; "
            f"{r['apol1_unique_snps_in_edges']} unique SNPs")
    answers["Q4"] = q4
    answers["loci_summary"] = loci_summary

    # ---------------------------------------------------------------- Q6
    log("Q6: what the 54,790 edgelist rows are")
    e = con.execute("SELECT count(*) FROM edgelist").fetchone()[0]
    pairs = con.execute("""SELECT count(*) FROM (
        SELECT DISTINCT least(source,target) a, greatest(source,target) b FROM edgelist)""").fetchone()[0]
    cols = [c[0] for c in con.execute("DESCRIBE edgelist").fetchall()
            if c[0].endswith("_weight")]
    nonzero_any = con.execute(f"""SELECT count(*) FROM edgelist WHERE
        {' OR '.join(f'"{c}" <> 0' for c in cols)}""").fetchone()[0]
    answers["Q6"] = {"rows": e, "distinct_unordered_pairs": pairs,
                     "weight_columns": len(cols),
                     "rows_with_any_nonzero_weight": nonzero_any,
                     "self_pairs": con.execute(
                         "SELECT count(*) FROM edgelist WHERE source = target").fetchone()[0]}
    log(f"  {e:,} rows, {pairs:,} distinct unordered pairs, "
        f"{nonzero_any:,} with a non-zero weight in some column, "
        f"{len(cols)} weight columns")

    # ---------------------------------------------------------------- Q7
    log("Q7: allele columns")
    q7 = {}
    store_cols = [c[0] for c in con.execute("DESCRIBE assoc_raw").fetchall()]
    q7["store_columns"] = store_cols
    q7["store_has_allele_column"] = [c for c in store_cols
                                     if any(k in c.lower() for k in
                                            ("allele", "ref", "alt", "a1", "a2", "effect"))]
    raw = os.path.join(os.path.dirname(REPO), "full_dataset.csv")
    if os.path.exists(raw):
        with open(raw) as fh:
            header = fh.readline().strip().split(",")
        q7["source_file"] = raw
        q7["source_columns"] = header
        q7["source_has_allele_column"] = [c for c in header
                                          if any(k in c.lower() for k in
                                                 ("allele", "ref", "alt", "a1", "a2", "effect"))]
    else:
        q7["source_file"] = f"{raw} (absent)"
    log(f"  store columns: {len(store_cols)}; allele-like: {q7['store_has_allele_column'] or 'none'}")
    if "source_columns" in q7:
        log(f"  source columns: {q7['source_columns']}")
        log(f"  allele-like in source: {q7['source_has_allele_column'] or 'none'}")
    answers["Q7"] = q7

    # ---------------------------------------------------------------- Q8/Q9
    log("Q8/Q9: deployment configuration and Python version")
    q8 = {"RANK_METRIC_default_in_code": None, "railway_vars": None}
    with open(os.path.join(REPO, "server.js")) as fh:
        for line in fh:
            if "RANK_METRIC" in line and "process.env" in line:
                q8["RANK_METRIC_default_in_code"] = line.strip()
                break
    answers["Q8"] = q8
    log(f"  {q8['RANK_METRIC_default_in_code']}")
    q9 = {"python_running_this": sys.version.split()[0],
          "shebang_build_dbs": open(os.path.join(REPO, "scripts", "build_dbs.py")).readline().strip()}
    for f in ("requirements.txt", "pyproject.toml", ".python-version", "runtime.txt"):
        p = os.path.join(REPO, f)
        q9[f] = "present" if os.path.exists(p) else "absent"
    answers["Q9"] = q9
    log(f"  python {q9['python_running_this']}; shebang {q9['shebang_build_dbs']!r}; "
        f"lockfiles: {[k for k in q9 if k.endswith(('.txt','.toml','-version')) and q9[k]=='present'] or 'none'}")

    # ---------------------------------------------------------------- Q10
    log("Q10: verification table, primary duplicate rule")
    answers["Q10_primary"] = esrd_table(con, meta)
    t = answers["Q10_primary"]
    log(f"  AFR nb {t['AFR']['neighbours']} EUR nb {t['EUR']['neighbours']}; "
        f"shared SNPs {t['shared_snps']}; union {t['union_snps']}")

    # ---------------------------------------------------------------- Q5
    log("Q5: the same table under 'drop both duplicate rows'")
    set_dedupe(con, "drop_both")
    positions(con)
    alt = esrd_table(con, meta)
    alt_loci, _ = esrd_loci(con, meta)
    answers["Q5_drop_both"] = alt
    answers["Q5_drop_both_loci"] = alt_loci
    diffs = []
    def walk(a, b, path=""):
        for k in a:
            if isinstance(a[k], dict):
                walk(a[k], b[k], f"{path}{k}.")
            elif a[k] != b[k]:
                diffs.append({"field": path + k, "primary": a[k], "drop_both": b[k]})
    walk(answers["Q10_primary"], alt)
    walk(answers["loci_summary"], alt_loci, "loci.")
    write_csv(diffs or [{"field": "(none)", "primary": "", "drop_both": ""}],
              os.path.join(OUT, "q5_duplicate_robustness.csv"))
    log(f"  {len(diffs)} of the verification numbers change under the alternative rule")
    for d in diffs:
        log(f"    {d['field']}: {d['primary']} -> {d['drop_both']}")
    answers["Q5_diffs"] = diffs

    with open(os.path.join(OUT, "q2_q10_answers.json"), "w") as fh:
        json.dump(answers, fh, indent=1, default=str)
    log("wrote results/q2_q10_answers.json")


if __name__ == "__main__":
    main()
