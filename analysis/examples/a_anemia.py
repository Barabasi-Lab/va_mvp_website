#!/usr/bin/env python3
"""Phase 2: the iron deficiency anemia (280.1) worked example.

    python3 analysis/examples/a_anemia.py

A-A  claim audit A1-A7
A-B  loci and genes
A-C  cross-ancestry lookup
A-D  redundancy sensitivity L0-L3

Within-cluster here means the hematopoietic category, not ESRD's
genitourinary-plus-hematopoietic pair.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (ANCESTRIES, ANEMIA, CLUMP_WINDOW, PRIMARY_THRESHOLD,
                    RESULTS, SNP_POSITIONS, clump, connect, in_region, log,
                    meta_for, neighbours, positions, significant, target_snps,
                    write_csv)

TARGET = ANEMIA
CLUSTER = ("hematopoietic",)
# the AFR globin clusters, GRCh38
HBB = ("11", 5_225_464, 5_229_395)
HBA = ("16", 176_680, 177_522)
PREDOMINANT = 0.80           # A4's main cutoff
SENSITIVITY = (0.60, 0.90)   # reported alongside


def a_a_claims(con, meta):
    out = {}

    # A2 - each ancestry alone: SNP count and the direction mix
    a2 = {}
    for anc in ANCESTRIES:
        snps = target_snps(con, anc, PRIMARY_THRESHOLD, TARGET)
        pos = sum(1 for _, _, _, b in snps if b and b > 0)
        nb = neighbours(con, anc, PRIMARY_THRESHOLD, TARGET)
        w = sum(v["shared"] for v in nb.values())
        cw = sum(v["concordant"] for v in nb.values())
        inc = {k: v for k, v in nb.items()
               if meta.get(k, {}).get("category") in CLUSTER}
        a2[anc.upper()] = {
            "snps_p_lt_1e-4": len(snps),
            "positive_beta": pos, "negative_beta": len(snps) - pos,
            "neighbours": len(nb), "shared_snp_weight": w,
            "concordant_weight_fraction": round(cw / w, 4) if w else None,
            "hematopoietic_neighbours": len(inc),
            "hematopoietic_weight_fraction":
                round(sum(v["shared"] for v in inc.values()) / w, 4) if w else None}
    out["A2"] = a2

    # A1 - the AFR/EUR intersection
    shared = con.execute(f"""SELECT count(*) FROM assoc WHERE phe_id = ?
        AND {significant('afr', PRIMARY_THRESHOLD)}
        AND {significant('eur', PRIMARY_THRESHOLD)}""", [TARGET]).fetchone()[0]
    nb_a = neighbours(con, "afr", PRIMARY_THRESHOLD, TARGET)
    nb_e = neighbours(con, "eur", PRIMARY_THRESHOLD, TARGET)
    # a neighbour survives the intersection if it shares a SNP with 280.1
    # that is significant in both ancestries
    con.execute(f"""CREATE OR REPLACE TEMP TABLE both_sig AS
        SELECT phe_id, rsid FROM assoc
        WHERE {significant('afr', PRIMARY_THRESHOLD)}
          AND {significant('eur', PRIMARY_THRESHOLD)}""")
    inter_nb = con.execute("""SELECT DISTINCT n.phe_id FROM both_sig c
        JOIN both_sig n USING (rsid) WHERE c.phe_id = ? AND n.phe_id <> ?""",
        [TARGET, TARGET]).fetchall()
    out["A1"] = {"shared_snps_afr_eur": shared,
                 "neighbours_surviving_intersection": len(inter_nb),
                 "neighbour_ids": [r[0] for r in inter_nb],
                 "neighbour_labels": [meta.get(r[0], {}).get("label", "") for r in inter_nb],
                 "afr_neighbours": len(nb_a), "eur_neighbours": len(nb_e)}

    # A3 - how much of each ancestry survives intersecting with META
    a3 = {}
    for anc in ("afr", "eur"):
        own = con.execute(f"""SELECT count(*) FROM assoc WHERE phe_id = ?
            AND {significant(anc, PRIMARY_THRESHOLD)}""", [TARGET]).fetchone()[0]
        kept = con.execute(f"""SELECT count(*) FROM assoc WHERE phe_id = ?
            AND {significant(anc, PRIMARY_THRESHOLD)}
            AND {significant('meta', PRIMARY_THRESHOLD)}""", [TARGET]).fetchone()[0]
        nb_own = neighbours(con, anc, PRIMARY_THRESHOLD, TARGET)
        con.execute(f"""CREATE OR REPLACE TEMP TABLE bs AS
            SELECT phe_id, rsid FROM assoc
            WHERE {significant(anc, PRIMARY_THRESHOLD)}
              AND {significant('meta', PRIMARY_THRESHOLD)}""")
        nb_kept = con.execute("""SELECT count(DISTINCT n.phe_id) FROM bs c
            JOIN bs n USING (rsid) WHERE c.phe_id = ? AND n.phe_id <> ?""",
            [TARGET, TARGET]).fetchone()[0]
        a3[anc.upper()] = {"snps": own, "snps_also_meta_significant": kept,
                           "snp_fraction_kept": round(kept / own, 4) if own else None,
                           "neighbours": len(nb_own),
                           "neighbours_kept": nb_kept,
                           "neighbour_fraction_kept":
                               round(nb_kept / len(nb_own), 4) if nb_own else None}
    out["A3"] = a3
    return out


def a_a4(con, meta):
    """For each META neighbour, split the shared META-significant SNPs by
    which ancestry also calls them significant."""
    con.execute(f"""CREATE OR REPLACE TEMP TABLE ms AS
        SELECT phe_id, rsid,
               ({significant('afr', PRIMARY_THRESHOLD)}) AS afr_sig,
               ({significant('eur', PRIMARY_THRESHOLD)}) AS eur_sig
        FROM assoc WHERE {significant('meta', PRIMARY_THRESHOLD)}""")
    rows = con.execute("""SELECT n.phe_id, count(*) AS shared,
               count(*) FILTER (WHERE n.afr_sig AND NOT n.eur_sig) AS afr_only,
               count(*) FILTER (WHERE n.eur_sig AND NOT n.afr_sig) AS eur_only,
               count(*) FILTER (WHERE n.afr_sig AND n.eur_sig) AS both,
               count(*) FILTER (WHERE NOT n.afr_sig AND NOT n.eur_sig) AS neither
        FROM ms c JOIN ms n USING (rsid)
        WHERE c.phe_id = ? AND n.phe_id <> ? GROUP BY n.phe_id""",
        [TARGET, TARGET]).fetchall()
    out = []
    for phe, shared, afr_only, eur_only, both, neither in rows:
        attributable = afr_only + eur_only
        afr_share = afr_only / attributable if attributable else None
        out.append({"neighbour": phe, "label": meta.get(phe, {}).get("label", ""),
                    "category": meta.get(phe, {}).get("category", ""),
                    "shared_meta_snps": shared, "afr_only": afr_only,
                    "eur_only": eur_only, "both": both, "neither": neither,
                    "afr_share_of_single_ancestry": round(afr_share, 4)
                        if afr_share is not None else None})
    out.sort(key=lambda r: -r["shared_meta_snps"])
    summary = {}
    for cut in (PREDOMINANT,) + SENSITIVITY:
        maj_afr = sum(1 for r in out if r["afr_share_of_single_ancestry"] is not None
                      and r["afr_share_of_single_ancestry"] >= cut)
        maj_eur = sum(1 for r in out if r["afr_share_of_single_ancestry"] is not None
                      and r["afr_share_of_single_ancestry"] <= 1 - cut)
        scored = sum(1 for r in out if r["afr_share_of_single_ancestry"] is not None)
        summary[f"cutoff_{cut:.0%}"] = {
            "neighbours_scored": scored, "predominantly_AFR": maj_afr,
            "predominantly_EUR": maj_eur, "mixed": scored - maj_afr - maj_eur}
    return out, summary


def a_a5_a6(con, meta):
    """The two named neighbours, as shares rather than raw counts.

    Both captions claim "complete" agreement with META and none with the
    third ancestry. The quantity that makes those words checkable is: of
    the SNPs 280.1 shares with this neighbour in META, what fraction is
    also significant in each ancestry for BOTH phenotypes.
    """
    want = {"peripheral vascular disease": None, "other hemoglobinopathies": None}
    for phe, label in con.execute(
            "SELECT CAST(id AS VARCHAR), label FROM nodes").fetchall():
        low = (label or "").lower()
        for key in want:
            if want[key] is None and key in low:
                want[key] = (phe, label)
    out = {}
    for key, hit in want.items():
        if not hit:
            out[key] = {"status": "no node with this label"}
            continue
        phe, label = hit
        # the edge as META sees it
        shared_meta = con.execute(f"""SELECT count(*) FROM
            (SELECT rsid FROM assoc WHERE phe_id = ?
               AND {significant('meta', PRIMARY_THRESHOLD)}) t
            JOIN (SELECT rsid FROM assoc WHERE phe_id = ?
               AND {significant('meta', PRIMARY_THRESHOLD)}) u USING (rsid)""",
            [TARGET, phe]).fetchone()[0]
        row = {"phe_id": phe, "label": label,
               "shared_with_280.1_in_META": shared_meta}
        for anc in ("afr", "eur"):
            # same edge, as this ancestry sees it
            own_edge = con.execute(f"""SELECT count(*) FROM
                (SELECT rsid FROM assoc WHERE phe_id = ?
                   AND {significant(anc, PRIMARY_THRESHOLD)}) t
                JOIN (SELECT rsid FROM assoc WHERE phe_id = ?
                   AND {significant(anc, PRIMARY_THRESHOLD)}) u USING (rsid)""",
                [TARGET, phe]).fetchone()[0]
            # and how much of the META edge this ancestry also calls
            overlap = con.execute(f"""SELECT count(*) FROM
                (SELECT rsid FROM assoc WHERE phe_id = ?
                   AND {significant('meta', PRIMARY_THRESHOLD)}
                   AND {significant(anc, PRIMARY_THRESHOLD)}) t
                JOIN (SELECT rsid FROM assoc WHERE phe_id = ?
                   AND {significant('meta', PRIMARY_THRESHOLD)}
                   AND {significant(anc, PRIMARY_THRESHOLD)}) u USING (rsid)""",
                [TARGET, phe]).fetchone()[0]
            row[anc.upper()] = {
                "edge_snps_in_this_ancestry": own_edge,
                "of_the_META_edge_also_significant_here": overlap,
                "share_of_META_edge": round(overlap / shared_meta, 4) if shared_meta else None,
                "share_of_own_edge_kept_by_META":
                    round(overlap / own_edge, 4) if own_edge else None}
        out[key] = row
    return out


def a_a7_obesity(con, meta):
    """Optional: does EUR dominate META for obesity? Nothing beyond this."""
    hit = [(r[0], r[1]) for r in con.execute(
        "SELECT CAST(id AS VARCHAR), label FROM nodes").fetchall()
        if (r[1] or "").strip().lower() == "obesity"]
    if not hit:
        return {"status": "no node labelled exactly 'obesity'"}
    phe, label = hit[0]
    meta_sig = con.execute(f"""SELECT count(*) FROM assoc WHERE phe_id = ?
        AND {significant('meta', PRIMARY_THRESHOLD)}""", [phe]).fetchone()[0]
    out = {"phe_id": phe, "label": label, "meta_significant_snps": meta_sig}
    for anc in ("eur", "afr", "amr"):
        n = con.execute(f"""SELECT count(*) FROM assoc WHERE phe_id = ?
            AND {significant('meta', PRIMARY_THRESHOLD)}
            AND {significant(anc, PRIMARY_THRESHOLD)}""", [phe]).fetchone()[0]
        out[f"{anc}_share_of_meta"] = round(n / meta_sig, 4) if meta_sig else None
    return out


def a_b_loci(con, meta):
    """Clump 280.1 in each ancestry and say which loci drive the
    ancestry-specific neighbours. Names only; no biology."""
    rows, per_anc, dominant = [], {}, {}
    for anc in ANCESTRIES:
        snps = con.execute(f"""SELECT a.rsid, p.chrom, p.pos, a."pval.{anc}"
            FROM assoc a JOIN pos p USING (rsid)
            WHERE a.phe_id = ? AND {significant(anc, PRIMARY_THRESHOLD, 'a.')}""",
            [TARGET]).fetchall()
        locus_of, loci = clump(snps)
        nb = neighbours(con, anc, PRIMARY_THRESHOLD, TARGET)
        total_mapped = 0
        for L in loci:
            L["is_hbb"] = in_region(L, HBB)
            L["is_hba"] = in_region(L, HBA)
            hit, w = set(), 0
            for k, v in nb.items():
                n = sum(1 for r in v["rsids"] if locus_of.get(r) == L["index"])
                if n:
                    hit.add(k)
                    w += n
            L["neighbours_reached"], L["shared_snp_weight"] = len(hit), w
            L["_nbrs"] = hit
            total_mapped += w
        per_anc[anc] = {"loci": loci, "locus_of": locus_of, "nb": nb,
                        "mapped_weight": total_mapped,
                        "with_position": len(snps),
                        "total": len(target_snps(con, anc, PRIMARY_THRESHOLD, TARGET))}
        top = max(loci, key=lambda L: L["shared_snp_weight"]) if loci else None
        if top and total_mapped:
            dominant[anc.upper()] = {
                "lead_rsid": top["lead_rsid"], "chrom": top["chrom"],
                "lead_pos": top["lead_pos"], "n_snps": top["n_snps"],
                "neighbours_reached": top["neighbours_reached"],
                "share_of_mapped_edge_weight": round(top["shared_snp_weight"] / total_mapped, 4)}
        for L in sorted(loci, key=lambda x: -x["shared_snp_weight"]):
            rows.append({"ancestry": anc.upper(), "lead_rsid": L["lead_rsid"],
                         "chrom": L["chrom"], "lead_pos": L["lead_pos"],
                         "span_start": L["span_start"], "span_end": L["span_end"],
                         "n_snps": L["n_snps"],
                         "neighbours_reached": L["neighbours_reached"],
                         "shared_snp_weight": L["shared_snp_weight"],
                         "is_hbb": L["is_hbb"], "is_hba": L["is_hba"]})
    return rows, per_anc, dominant


def a_c_lookup(con, per_anc):
    rows = []
    for anc, other in (("afr", "eur"), ("eur", "afr")):
        for L in per_anc[anc]["loci"]:
            r = con.execute(f"""SELECT "beta.{anc}", "se.{anc}", "pval.{anc}",
                                       "beta.{other}", "se.{other}", "pval.{other}"
                FROM assoc WHERE phe_id = ? AND rsid = ?""",
                [TARGET, L["lead_rsid"]]).fetchone()
            b1, s1, p1, b2, s2, p2 = r if r else (None,) * 6
            cls = ("missing" if b2 is None or p2 is None
                   else "inconsistent direction" if (b1 or 0) * (b2 or 0) < 0
                   else "consistent and nominally significant" if p2 < 0.05
                   else "consistent but not significant")
            rows.append({"locus_ancestry": anc.upper(), "other_ancestry": other.upper(),
                         "lead_rsid": L["lead_rsid"], "chrom": L["chrom"],
                         "lead_pos": L["lead_pos"], "n_snps": L["n_snps"],
                         "is_hbb": L["is_hbb"], "is_hba": L["is_hba"],
                         "beta_own": b1, "se_own": s1, "p_own": p1,
                         "beta_other": b2, "se_other": s2, "p_other": p2,
                         "classification": cls})
    summary = {}
    for anc in ("AFR", "EUR"):
        sub = [r for r in rows if r["locus_ancestry"] == anc]
        c = {}
        for r in sub:
            c[r["classification"]] = c.get(r["classification"], 0) + 1
        summary[anc] = {"loci": len(sub), **c}
    return rows, summary


def a_d_redundancy(con, meta):
    """L0-L3 for 280.1. Within-cluster is the hematopoietic category."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "phecode_redundancy"))
    from phecode_relations import PhecodeRelations, to_phecode
    import run_analysis as ra

    rel = PhecodeRelations(ra.ICD_MAP, ra.DEFINITIONS)
    codes = {}
    for phe, code in con.execute(
            "SELECT DISTINCT phe_id, phenotype FROM assoc_raw").fetchall():
        c = to_phecode(code)
        if c:
            codes.setdefault(phe, []).append(c)
    tgt = codes.get(TARGET, [])
    rows = []
    for anc in ANCESTRIES:
        nb = neighbours(con, anc, PRIMARY_THRESHOLD, TARGET)
        flags = {}
        for k in nb:
            t1 = t2 = t3 = t4 = False
            for a in tgt:
                for b in codes.get(k, []):
                    r = rel.classify(a, b)
                    t1 |= r.t1; t2 |= r.t2; t3 |= bool(r.t3); t4 |= r.t4
            flags[k] = (t1, t2, t3, t4)
        for level, drop in (("L0", lambda f: False),
                            ("L1", lambda f: f[0]),
                            ("L2", lambda f: f[0] or f[1]),
                            ("L3", lambda f: any(f))):
            kept = {k: v for k, v in nb.items() if not drop(flags[k])}
            w = sum(v["shared"] for v in kept.values())
            cw = sum(v["concordant"] for v in kept.values())
            inc = {k: v for k, v in kept.items()
                   if meta.get(k, {}).get("category") in CLUSTER}
            rows.append({"ancestry": anc.upper(), "level": level,
                         "neighbours": len(kept), "shared_snp_weight": w,
                         "hematopoietic_neighbours": len(inc),
                         "hematopoietic_weight_fraction":
                             round(sum(v["shared"] for v in inc.values()) / w, 4) if w else None,
                         "concordant_weight_fraction": round(cw / w, 4) if w else None})
    return rows


def main():
    os.makedirs(RESULTS, exist_ok=True)
    con = connect()
    meta = meta_for(con)
    if positions(con) is None:
        raise SystemExit("results/snp_positions.csv missing")

    log("A-A: claim audit")
    claims = a_a_claims(con, meta)
    for a, v in claims["A2"].items():
        log(f"  {a}: {v['snps_p_lt_1e-4']} SNPs ({v['positive_beta']}+/"
            f"{v['negative_beta']}-), {v['neighbours']} neighbours, "
            f"hematopoietic weight {v['hematopoietic_weight_fraction']}")
    log(f"  A1 AFR/EUR intersection: {claims['A1']['shared_snps_afr_eur']} shared SNPs, "
        f"{claims['A1']['neighbours_surviving_intersection']} neighbour(s) "
        f"{claims['A1']['neighbour_labels']}")
    for a, v in claims["A3"].items():
        log(f"  A3 {a}->META: SNPs kept {v['snp_fraction_kept']}, "
            f"neighbours kept {v['neighbour_fraction_kept']}")

    log("A4: per-neighbour ancestry split")
    a4_rows, a4_summary = a_a4(con, meta)
    write_csv(a4_rows, os.path.join(RESULTS, "anemia_a4_neighbour_split.csv"))
    for cut, v in a4_summary.items():
        log(f"  {cut}: AFR-predominant {v['predominantly_AFR']}, "
            f"EUR-predominant {v['predominantly_EUR']}, mixed {v['mixed']} "
            f"of {v['neighbours_scored']}")
    claims["A4"] = a4_summary

    log("A5/A6: the two named neighbours")
    claims["A5_A6"] = a_a5_a6(con, meta)
    for k, v in claims["A5_A6"].items():
        log(f"  {k}: {v}")

    log("A7: obesity (optional)")
    claims["A7"] = a_a7_obesity(con, meta)
    log(f"  {claims['A7']}")

    log("A-B: loci")
    loci_rows, per_anc, dominant = a_b_loci(con, meta)
    write_csv(loci_rows, os.path.join(RESULTS, "anemia_loci.csv"))
    claims["A_B_dominant_locus"] = dominant
    for a, v in dominant.items():
        log(f"  {a} dominant locus {v['lead_rsid']} chr{v['chrom']}:{v['lead_pos']} "
            f"-> {v['share_of_mapped_edge_weight']:.1%} of mapped edge weight")

    log("A-C: cross-ancestry lookup")
    lk_rows, lk_summary = a_c_lookup(con, per_anc)
    write_csv(lk_rows, os.path.join(RESULTS, "anemia_cross_ancestry_leads.csv"))
    claims["A_C"] = lk_summary
    for a, s in lk_summary.items():
        log(f"  {a}: " + ", ".join(f"{k}={v}" for k, v in s.items()))

    log("A-D: redundancy L0-L3")
    rd = a_d_redundancy(con, meta)
    write_csv(rd, os.path.join(RESULTS, "anemia_redundancy.csv"))
    for r in rd:
        if r["ancestry"] in ("AFR", "EUR"):
            log(f"  {r['ancestry']} {r['level']}: nb {r['neighbours']}, weight "
                f"{r['shared_snp_weight']}, hematopoietic weight "
                f"{r['hematopoietic_weight_fraction']}, concordant "
                f"{r['concordant_weight_fraction']}")

    with open(os.path.join(RESULTS, "anemia_claims.json"), "w") as fh:
        json.dump(claims, fh, indent=1, default=str)
    log("wrote results/anemia_claims.json")


if __name__ == "__main__":
    main()
