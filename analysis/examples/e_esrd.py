#!/usr/bin/env python3
"""Phase 1: the ESRD (585.32) worked example.

    python3 analysis/examples/e_esrd.py

E-A  claim audit E1-E10
E-B  locus composition and the TCF7L2 question
E-C  cross-ancestry lookup of each locus lead
E-E  redundancy sensitivity carried over from the previous task

Every number comes from the association store. Page-1 edge weights are used
only at p < 1e-4, the one threshold band Phase 0 validated.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (ANCESTRIES, BETA_THRESHOLD, CLUMP_WINDOW, ESRD,
                    PRIMARY_THRESHOLD, RESULTS, SNP_POSITIONS, connect, log,
                    significant, write_csv)

GENOME_WIDE = 5e-8
TARGET = ESRD
# ESRD's cluster in the manuscript: genitourinary plus hematopoietic
CLUSTER = ("genitourinary system", "hematopoietic")
APOL1 = ("22", 36_253_071, 36_267_530)      # GRCh38, Ensembl/RefSeq
TCF7L2 = ("10", 112_950_247, 113_167_678)   # GRCh38


# ------------------------------------------------------------------ helpers

def positions(con):
    """rsid -> (chrom, pos), from the previous task's dbSNP155/GRCh38 dump."""
    if not os.path.exists(SNP_POSITIONS):
        return None
    con.execute(f"""CREATE OR REPLACE TEMP TABLE pos AS
        SELECT rsid, CAST(chrom AS VARCHAR) AS chrom, CAST(pos AS BIGINT) AS pos
        FROM read_csv('{SNP_POSITIONS}')""")
    return con.execute("SELECT count(*) FROM pos").fetchone()[0]


def clump(snps, window=CLUMP_WINDOW):
    """Greedy distance clumping: strongest unassigned SNP leads, absorbs
    everything within +/- window on its chromosome, repeat.

    `snps` is [(rsid, chrom, pos, pval)]. Same rule as the previous task.
    """
    order = sorted(snps, key=lambda r: (r[3], r[0]))
    locus_of, loci, taken = {}, [], set()
    for rsid, chrom, pos, _p in order:
        if rsid in taken:
            continue
        members = [s for s in snps
                   if s[0] not in taken and s[1] == chrom and abs(s[2] - pos) <= window]
        idx = len(loci)
        for m in members:
            taken.add(m[0])
            locus_of[m[0]] = idx
        ps = [m[2] for m in members]
        loci.append({"index": idx, "lead_rsid": rsid, "chrom": chrom, "lead_pos": pos,
                     "span_start": min(ps), "span_end": max(ps), "n_snps": len(members)})
    return locus_of, loci


def in_region(locus, region, window=CLUMP_WINDOW):
    chrom, a, b = region
    return (str(locus["chrom"]) == chrom
            and locus["span_end"] >= a - window and locus["span_start"] <= b + window)


def target_snps(con, ancestry, threshold, node=TARGET, beta_filter=False):
    return con.execute(f"""SELECT rsid, CAST(chrom AS VARCHAR), "pval.{ancestry}",
                                  "beta.{ancestry}"
        FROM assoc WHERE phe_id = ? AND {significant(ancestry, threshold,
                                                     beta_filter=beta_filter)}""",
        [node]).fetchall()


def neighbours(con, ancestry, threshold, node=TARGET, beta_filter=False):
    """Neighbour -> (shared SNPs, concordant, discordant, [rsids]).

    Concordant / discordant is the sign of beta across the two PHENOTYPES in
    one ancestry - not across ancestries.
    """
    con.execute(f"""CREATE OR REPLACE TEMP TABLE sig AS
        SELECT phe_id, rsid, sign("beta.{ancestry}") AS sgn FROM assoc
        WHERE {significant(ancestry, threshold, beta_filter=beta_filter)}""")
    rows = con.execute("""SELECT n.phe_id,
               count(*) AS shared,
               count(*) FILTER (WHERE c.sgn = n.sgn) AS concordant,
               count(*) FILTER (WHERE c.sgn <> n.sgn) AS discordant,
               list(c.rsid) AS rsids
        FROM sig c JOIN sig n USING (rsid)
        WHERE c.phe_id = ? AND n.phe_id <> ? GROUP BY n.phe_id""",
        [node, node]).fetchall()
    return {r[0]: {"shared": r[1], "concordant": r[2], "discordant": r[3],
                   "rsids": list(r[4])} for r in rows}


def meta_for(con):
    return {r[0]: {"label": r[1], "category": r[2]} for r in con.execute(
        "SELECT CAST(id AS VARCHAR), label, phenotype_category FROM nodes").fetchall()}


# ------------------------------------------------------------ E-A: claims

def e_a_claims(con, meta):
    """Recompute the numbers each claim rests on. Verdicts are assigned in
    the report, not here; this produces the evidence."""
    out = {}

    # E1 - genome-wide significant SNPs and loci per ancestry
    e1 = {}
    for anc in ANCESTRIES:
        snps = target_snps(con, anc, GENOME_WIDE)
        e1[anc.upper()] = {"snps_p_lt_5e-8": len(snps)}
    out["E1"] = e1

    # E5 - >100 SNPs at p < 1e-4 in both; E6 - chromosome spread
    e5, e6 = {}, {}
    for anc in ANCESTRIES:
        snps = target_snps(con, anc, PRIMARY_THRESHOLD)
        e5[anc.upper()] = len(snps)
        by_chrom = {}
        for _, chrom, _, _ in snps:
            by_chrom[chrom] = by_chrom.get(chrom, 0) + 1
        e6[anc.upper()] = dict(sorted(by_chrom.items(), key=lambda kv: -kv[1]))
    out["E5_snps_p_lt_1e-4"] = e5
    out["E6_chromosome_distribution"] = e6

    # E7 - shared SNPs between AFR and EUR
    shared = con.execute(f"""SELECT count(*) FROM assoc WHERE phe_id = ?
        AND {significant('afr', PRIMARY_THRESHOLD)}
        AND {significant('eur', PRIMARY_THRESHOLD)}""", [TARGET]).fetchone()[0]
    both_beta = con.execute(f"""SELECT count(*) FROM assoc WHERE phe_id = ?
        AND {significant('afr', PRIMARY_THRESHOLD, beta_filter=True)}
        AND {significant('eur', PRIMARY_THRESHOLD, beta_filter=True)}""",
        [TARGET]).fetchone()[0]
    union = e5["AFR"] + e5["EUR"] - shared
    out["E7_shared_afr_eur"] = {
        "shared": shared, "shared_with_ui_beta_rule": both_beta,
        "afr_only": e5["AFR"] - shared, "eur_only": e5["EUR"] - shared,
        "union": union, "jaccard_pct": round(100 * shared / union, 3)}

    # E2/E3/E4 - the network level, per ancestry
    net = {}
    for anc in ANCESTRIES:
        nb = neighbours(con, anc, PRIMARY_THRESHOLD)
        total_w = sum(v["shared"] for v in nb.values())
        conc_w = sum(v["concordant"] for v in nb.values())
        in_cluster = {k: v for k, v in nb.items()
                      if meta.get(k, {}).get("category") in CLUSTER}
        cluster_w = sum(v["shared"] for v in in_cluster.values())
        # E4's three readings of "discordant"
        any_disc = sum(1 for v in nb.values() if v["discordant"] > 0)
        majority_disc = sum(1 for v in nb.values() if v["discordant"] > v["concordant"])
        net[anc.upper()] = {
            "neighbours": len(nb),
            "shared_snp_weight": total_w,
            "concordant_weight_fraction": round(conc_w / total_w, 4) if total_w else None,
            "discordant_weight_fraction": round(1 - conc_w / total_w, 4) if total_w else None,
            "within_cluster_neighbours": len(in_cluster),
            "within_cluster_neighbour_fraction": round(len(in_cluster) / len(nb), 4) if nb else None,
            "within_cluster_weight_fraction": round(cluster_w / total_w, 4) if total_w else None,
            "neighbours_with_any_discordant_snp": any_disc,
            "fraction_neighbours_with_any_discordant": round(any_disc / len(nb), 4) if nb else None,
            "neighbours_majority_discordant": majority_disc,
            "fraction_neighbours_majority_discordant": round(majority_disc / len(nb), 4) if nb else None,
        }
        # and the same under the UI's display rule, for reconciling screenshots
        nb_ui = neighbours(con, anc, PRIMARY_THRESHOLD, beta_filter=True)
        tw = sum(v["shared"] for v in nb_ui.values())
        cw = sum(v["concordant"] for v in nb_ui.values())
        net[anc.upper()]["ui_rule_neighbours"] = len(nb_ui)
        net[anc.upper()]["ui_rule_concordant_weight_fraction"] = (
            round(cw / tw, 4) if tw else None)
    out["E2_E3_E4_network"] = net

    # E2 - what categories ESRD's neighbours actually fall in
    cats = {}
    for anc in ANCESTRIES:
        nb = neighbours(con, anc, PRIMARY_THRESHOLD)
        c = {}
        for k, v in nb.items():
            cat = meta.get(k, {}).get("category", "?")
            e = c.setdefault(cat, {"neighbours": 0, "weight": 0})
            e["neighbours"] += 1
            e["weight"] += v["shared"]
        cats[anc.upper()] = dict(sorted(c.items(), key=lambda kv: -kv[1]["weight"]))
    out["E2_neighbour_categories"] = cats
    return out


# ------------------------------------- E-B: loci, and the TCF7L2 question

def e_b_loci(con, meta):
    loci_rows, neighbour_rows, out = [], [], {}
    per_anc = {}
    for anc in ANCESTRIES:
        snps = con.execute(f"""SELECT a.rsid, p.chrom, p.pos, a."pval.{anc}"
            FROM assoc a JOIN pos p USING (rsid)
            WHERE a.phe_id = ? AND {significant(anc, PRIMARY_THRESHOLD, 'a.')}""",
            [TARGET]).fetchall()
        locus_of, loci = clump(snps)
        nb = neighbours(con, anc, PRIMARY_THRESHOLD)
        # how many neighbours and how much weight each locus reaches
        for L in loci:
            L["is_apol1"] = in_region(L, APOL1)
            L["is_tcf7l2"] = in_region(L, TCF7L2)
            hit_nb, weight = set(), 0
            for k, v in nb.items():
                n_here = sum(1 for r in v["rsids"] if locus_of.get(r) == L["index"])
                if n_here:
                    hit_nb.add(k)
                    weight += n_here
            L["neighbours_reached"] = len(hit_nb)
            L["shared_snp_weight"] = weight
            L["_nbrs"] = hit_nb
        mapped = sum(1 for r in snps)
        total = len(target_snps(con, anc, PRIMARY_THRESHOLD))
        per_anc[anc] = {"loci": loci, "locus_of": locus_of, "nb": nb,
                        "mapped": mapped, "total": total}
        for L in sorted(loci, key=lambda x: -x["shared_snp_weight"]):
            loci_rows.append({"ancestry": anc.upper(), "lead_rsid": L["lead_rsid"],
                              "chrom": L["chrom"], "lead_pos": L["lead_pos"],
                              "span_start": L["span_start"], "span_end": L["span_end"],
                              "n_snps": L["n_snps"],
                              "neighbours_reached": L["neighbours_reached"],
                              "shared_snp_weight": L["shared_snp_weight"],
                              "is_apol1": L["is_apol1"], "is_tcf7l2": L["is_tcf7l2"]})

    # which loci are shared between AFR and EUR (leads within +/- window)
    shared_loci = []
    for La in per_anc["afr"]["loci"]:
        for Le in per_anc["eur"]["loci"]:
            if La["chrom"] == Le["chrom"] and abs(La["lead_pos"] - Le["lead_pos"]) <= CLUMP_WINDOW:
                shared_loci.append({
                    "afr_lead": La["lead_rsid"], "eur_lead": Le["lead_rsid"],
                    "chrom": La["chrom"], "afr_pos": La["lead_pos"], "eur_pos": Le["lead_pos"],
                    "afr_snps": La["n_snps"], "eur_snps": Le["n_snps"],
                    "afr_neighbours": La["neighbours_reached"],
                    "eur_neighbours": Le["neighbours_reached"],
                    "is_apol1": La["is_apol1"] or Le["is_apol1"],
                    "is_tcf7l2": La["is_tcf7l2"] or Le["is_tcf7l2"]})
    out["shared_loci_afr_eur"] = shared_loci
    out["locus_counts"] = {a.upper(): len(per_anc[a]["loci"]) for a in ANCESTRIES}
    out["position_coverage"] = {a.upper(): {"with_position": per_anc[a]["mapped"],
                                            "total": per_anc[a]["total"]}
                                for a in ANCESTRIES}

    # E-B.3: neighbours by locus group and phecode category
    for anc in ANCESTRIES:
        d = per_anc[anc]
        groups = {"APOL1": set(), "TCF7L2": set(), "other": set()}
        gw = {"APOL1": 0, "TCF7L2": 0, "other": 0}
        for L in d["loci"]:
            g = "APOL1" if L["is_apol1"] else "TCF7L2" if L["is_tcf7l2"] else "other"
            groups[g] |= L["_nbrs"]
            gw[g] += L["shared_snp_weight"]
        for g, nbset in groups.items():
            bycat = {}
            for k in nbset:
                cat = meta.get(k, {}).get("category", "?")
                bycat[cat] = bycat.get(cat, 0) + 1
            for cat, n in sorted(bycat.items(), key=lambda kv: -kv[1]):
                neighbour_rows.append({"ancestry": anc.upper(), "locus_group": g,
                                       "category": cat, "neighbours": n,
                                       "group_total_neighbours": len(nbset),
                                       "group_shared_snp_weight": gw[g]})

    # E-B.4: which loci carry EUR's discordant edges, and to what
    disc_rows = []
    d = per_anc["eur"]
    for k, v in d["nb"].items():
        if v["discordant"] == 0:
            continue
        by_locus = {}
        for r in v["rsids"]:
            i = d["locus_of"].get(r)
            if i is not None:
                by_locus[i] = by_locus.get(i, 0) + 1
        top = max(by_locus, key=by_locus.get) if by_locus else None
        L = d["loci"][top] if top is not None else None
        disc_rows.append({"neighbour": k, "label": meta.get(k, {}).get("label", ""),
                          "category": meta.get(k, {}).get("category", ""),
                          "shared": v["shared"], "concordant": v["concordant"],
                          "discordant": v["discordant"],
                          "majority_discordant": v["discordant"] > v["concordant"],
                          "dominant_locus_lead": L["lead_rsid"] if L else "",
                          "dominant_locus_chrom": L["chrom"] if L else "",
                          "dominant_is_apol1": L["is_apol1"] if L else "",
                          "dominant_is_tcf7l2": L["is_tcf7l2"] if L else ""})
    disc_rows.sort(key=lambda r: -r["discordant"])
    return out, loci_rows, neighbour_rows, disc_rows, per_anc


# -------------------------------------------- E-C: cross-ancestry lookup

def e_c_lookup(con, per_anc):
    """For each locus lead, what the OTHER ancestry says about that SNP.

    This is the test that separates "not detected for want of power" from
    "a different architecture". Consistent/inconsistent here is the sign of
    beta across ANCESTRIES for the same phenotype-SNP pair.

    Restricted by construction: the store holds a row only where some
    ancestry or META reached p < 1e-4, so a lead that is genuinely absent
    from the other ancestry's data is indistinguishable from one that was
    never tested. Reported as `missing` either way.
    """
    rows = []
    for anc, other in (("afr", "eur"), ("eur", "afr")):
        for L in per_anc[anc]["loci"]:
            r = con.execute(f"""SELECT "beta.{anc}", "se.{anc}", "pval.{anc}",
                                       "beta.{other}", "se.{other}", "pval.{other}"
                FROM assoc WHERE phe_id = ? AND rsid = ?""",
                [TARGET, L["lead_rsid"]]).fetchone()
            b1, s1, p1, b2, s2, p2 = r if r else (None,) * 6
            if b2 is None or p2 is None:
                cls = "missing"
            elif (b1 or 0) * (b2 or 0) < 0:
                cls = "inconsistent direction"
            elif p2 < 0.05:
                cls = "consistent and nominally significant"
            else:
                cls = "consistent but not significant"
            rows.append({
                "locus_ancestry": anc.upper(), "other_ancestry": other.upper(),
                "lead_rsid": L["lead_rsid"], "chrom": L["chrom"],
                "lead_pos": L["lead_pos"], "n_snps": L["n_snps"],
                "is_apol1": L["is_apol1"], "is_tcf7l2": L["is_tcf7l2"],
                "beta_own": b1, "se_own": s1, "p_own": p1,
                "beta_other": b2, "se_other": s2, "p_other": p2,
                "classification": cls})
    summary = {}
    for anc in ("AFR", "EUR"):
        sub = [r for r in rows if r["locus_ancestry"] == anc]
        counts = {}
        for r in sub:
            counts[r["classification"]] = counts.get(r["classification"], 0) + 1
        summary[anc] = {"loci": len(sub), **counts}
        ap = [r for r in sub if r["is_apol1"]]
        if ap:
            summary[anc]["apol1_leads"] = [
                {"rsid": r["lead_rsid"], "beta_other": r["beta_other"],
                 "p_other": r["p_other"], "classification": r["classification"]}
                for r in ap]
    return rows, summary


# ---------------------------------------- E-E: redundancy cross-tab at L2

def e_e_l2_crosstab(con, per_anc, meta):
    """At L2 (drop T1 + T2 neighbours), how much of the remaining edge
    weight each locus group carries. Tier classification is reused from the
    previous task."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "phecode_redundancy"))
    from phecode_relations import PhecodeRelations, to_phecode
    import run_analysis as ra

    rel = PhecodeRelations(ra.ICD_MAP, ra.DEFINITIONS)
    codes = {r[0]: [c for c in (to_phecode(r[1]),) if c] for r in con.execute(
        "SELECT DISTINCT phe_id, phenotype FROM assoc_raw").fetchall()}
    tgt = codes.get(TARGET, [])
    rows = []
    for anc in ANCESTRIES:
        d = per_anc[anc]
        kept = {}
        for k, v in d["nb"].items():
            drop = False
            for a in tgt:
                for b in codes.get(k, []):
                    r = rel.classify(a, b)
                    if r.t1 or r.t2:
                        drop = True
            if not drop:
                kept[k] = v
        groups = {"APOL1": 0, "TCF7L2": 0, "other": 0}
        for L in d["loci"]:
            g = "APOL1" if L["is_apol1"] else "TCF7L2" if L["is_tcf7l2"] else "other"
            for k, v in kept.items():
                groups[g] += sum(1 for r in v["rsids"] if d["locus_of"].get(r) == L["index"])
        total = sum(groups.values())
        for g, w in groups.items():
            rows.append({"ancestry": anc.upper(), "level": "L2 (T1+T2 dropped)",
                         "locus_group": g, "shared_snp_weight": w,
                         "fraction_of_mapped_weight": round(w / total, 4) if total else None,
                         "neighbours_remaining": len(kept)})
    return rows


def main():
    os.makedirs(RESULTS, exist_ok=True)
    con = connect()
    meta = meta_for(con)
    n = positions(con)
    if n is None:
        raise SystemExit("results/snp_positions.csv missing; run snp_positions.R first")
    log(f"positions loaded for {n:,} rsids")

    log("E-A: claim audit")
    claims = e_a_claims(con, meta)
    for anc in ("AFR", "EUR"):
        c = claims["E2_E3_E4_network"][anc]
        log(f"  {anc}: {c['neighbours']} neighbours, concordant weight "
            f"{c['concordant_weight_fraction']}, within-cluster weight "
            f"{c['within_cluster_weight_fraction']}, majority-discordant neighbours "
            f"{c['fraction_neighbours_majority_discordant']}")
    log(f"  E7 shared AFR/EUR SNPs: {claims['E7_shared_afr_eur']['shared']}")

    log("E-B: loci")
    eb, loci_rows, nb_rows, disc_rows, per_anc = e_b_loci(con, meta)
    log(f"  loci: {eb['locus_counts']}; shared AFR/EUR: {len(eb['shared_loci_afr_eur'])}")
    for s in eb["shared_loci_afr_eur"]:
        log(f"    chr{s['chrom']} AFR {s['afr_lead']} / EUR {s['eur_lead']}"
            f"{'  [APOL1]' if s['is_apol1'] else ''}{'  [TCF7L2]' if s['is_tcf7l2'] else ''}")
    write_csv(loci_rows, os.path.join(RESULTS, "esrd_loci.csv"))
    write_csv(nb_rows, os.path.join(RESULTS, "esrd_neighbours_by_locus_group.csv"))
    write_csv(disc_rows, os.path.join(RESULTS, "esrd_eur_discordant_edges.csv"))

    log("E-C: cross-ancestry lookup")
    lookup_rows, lookup_summary = e_c_lookup(con, per_anc)
    write_csv(lookup_rows, os.path.join(RESULTS, "esrd_cross_ancestry_leads.csv"))
    for anc, s in lookup_summary.items():
        log(f"  {anc} leads: " + ", ".join(f"{k}={v}" for k, v in s.items()
                                           if k != "apol1_leads"))

    log("E-E: locus split of the L2 remainder")
    l2 = e_e_l2_crosstab(con, per_anc, meta)
    write_csv(l2, os.path.join(RESULTS, "esrd_l2_locus_split.csv"))

    claims["E_B_loci"] = eb
    claims["E_C_cross_ancestry"] = lookup_summary
    with open(os.path.join(RESULTS, "esrd_claims.json"), "w") as fh:
        json.dump(claims, fh, indent=1, default=str)
    log("wrote results/esrd_claims.json")


if __name__ == "__main__":
    main()
