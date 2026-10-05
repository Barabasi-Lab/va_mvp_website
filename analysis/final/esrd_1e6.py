#!/usr/bin/env python3
"""Rerun the ESRD worked example at p < 1e-6 and diff it against p < 1e-4.

Nothing is reimplemented: this imports analysis/examples/e_esrd.py, moves
its threshold and its output directory, and calls the same main(). The
redundancy table is the one extra piece, because the L0-L3 columns live in
q2_q10_queries.py rather than in the example, and it is recomputed here the
same way at both thresholds.

Outputs go to analysis/final/results/esrd_1e6/, leaving the 1e-4 run in
analysis/examples/results/ untouched, plus a side-by-side comparison at
analysis/final/results/esrd_threshold_comparison.csv.

    python3 analysis/final/esrd_1e6.py
"""
from __future__ import annotations

import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
EX = os.path.join(REPO, "analysis", "examples")
sys.path.insert(0, EX)
sys.path.insert(0, os.path.join(REPO, "analysis", "phecode_redundancy"))

import common                                                  # noqa: E402
import e_esrd                                                  # noqa: E402
from common import (CLUMP_WINDOW, ESRD, clump, connect, log, meta_for,  # noqa: E402
                    neighbours, positions, significant, target_snps)

OUT = os.path.join(HERE, "results")
NEW = os.path.join(OUT, "esrd_1e6")
OLD = os.path.join(EX, "results")
NEW_THRESHOLD = 1e-6
CLUSTER = e_esrd.CLUSTER


def redundancy(con, meta, threshold):
    """ESRD's L0-L3 redundancy columns, as q2_q10_queries.py computes them."""
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
    rows = []
    for anc in ("eur", "afr"):
        nb = neighbours(con, anc, threshold, ESRD)
        flags = {}
        for k in nb:
            t1 = t2 = t3 = t4 = False
            for x in tgt:
                for y in codes.get(k, []):
                    r = rel.classify(x, y)
                    t1 |= r.t1; t2 |= r.t2; t3 |= bool(r.t3); t4 |= r.t4
            flags[k] = (t1, t2, t3, t4)
        for level, drop in (("L0", lambda f: False), ("L1", lambda f: f[0]),
                            ("L2", lambda f: f[0] or f[1]),
                            ("L3", lambda f: any(f))):
            kept = {k: v for k, v in nb.items() if not drop(flags[k])}
            w = sum(v["shared"] for v in kept.values())
            cw = sum(v["concordant"] for v in kept.values())
            inc = {k: v for k, v in kept.items()
                   if meta.get(k, {}).get("category") in CLUSTER}
            rows.append({
                "ancestry": anc.upper(), "level": level, "degree": len(kept),
                "weight": w,
                "within_cluster_weight_share":
                    round(sum(v["shared"] for v in inc.values()) / w, 4) if w else None,
                "concordant_weight_share": round(cw / w, 4) if w else None})
    return rows


def run_example_at(threshold, outdir):
    """e_esrd.main() with its threshold and output directory moved."""
    os.makedirs(outdir, exist_ok=True)
    e_esrd.PRIMARY_THRESHOLD = threshold
    e_esrd.RESULTS = outdir
    common.PRIMARY_THRESHOLD = threshold
    e_esrd.main()


def get(d, *path, default=None):
    for p in path:
        if d is None:
            return default
        d = d.get(p) if isinstance(d, dict) else None
    return default if d is None else d


def main():
    os.makedirs(NEW, exist_ok=True)
    log(f"rerunning the ESRD example at p < {NEW_THRESHOLD:g}")
    run_example_at(NEW_THRESHOLD, NEW)

    con = connect()
    meta = meta_for(con)
    positions(con)
    log("redundancy table at both thresholds")
    red_new = redundancy(con, meta, NEW_THRESHOLD)
    red_old = redundancy(con, meta, 1e-4)
    with open(os.path.join(NEW, "esrd_redundancy_1e6.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(red_new[0].keys()))
        w.writeheader(); w.writerows(red_new)

    old = json.load(open(os.path.join(OLD, "esrd_claims.json")))
    new = json.load(open(os.path.join(NEW, "esrd_claims.json")))

    rows = []

    def add(item, o, n):
        rows.append({"item": item, "p<1e-4": o, "p<1e-6": n,
                     "holds": "yes" if o == n else "no"})

    for anc in ("AFR", "EUR"):
        o = old["E2_E3_E4_network"][anc]
        n = new["E2_E3_E4_network"][anc]
        for key, label in (
                ("neighbours", "neighbours"),
                ("shared_snp_weight", "edge weight (SNP-neighbour pairs)"),
                ("within_cluster_neighbours", "within-cluster neighbours"),
                ("within_cluster_neighbour_fraction", "within-cluster neighbour share"),
                ("within_cluster_weight_fraction", "within-cluster weight share"),
                ("concordant_weight_fraction", "concordant weight share"),
                ("discordant_weight_fraction", "discordant weight share"),
                ("neighbours_with_any_discordant_snp", "neighbours with any discordant SNP"),
                ("fraction_neighbours_majority_discordant", "majority-discordant share")):
            add(f"{anc} {label}", o[key], n[key])
        add(f"{anc} significant SNPs", old["E5_snps_p_lt_1e-4"][anc],
            new["E5_snps_p_lt_1e-4"][anc])
        oc = old["E6_chromosome_distribution"][anc]
        nc = new["E6_chromosome_distribution"][anc]
        otop = max(oc.items(), key=lambda kv: kv[1])
        ntop = max(nc.items(), key=lambda kv: kv[1])
        add(f"{anc} top chromosome",
            f"chr{otop[0]} {otop[1]}/{sum(oc.values())} "
            f"({otop[1]/sum(oc.values()):.1%})",
            f"chr{ntop[0]} {ntop[1]}/{sum(nc.values())} "
            f"({ntop[1]/sum(nc.values()):.1%})")

    for key, label in (("shared", "AFR-EUR shared SNPs"),
                       ("union", "AFR-EUR union SNPs"),
                       ("jaccard_pct", "AFR-EUR Jaccard %")):
        add(label, old["E7_shared_afr_eur"][key], new["E7_shared_afr_eur"][key])

    ol, nl = old["E_B_loci"], new["E_B_loci"]
    add("loci per ancestry", json.dumps(ol["locus_counts"]),
        json.dumps(nl["locus_counts"]))
    add("shared AFR-EUR loci", len(ol["shared_loci_afr_eur"]),
        len(nl["shared_loci_afr_eur"]))
    add("shared loci identities",
        "; ".join(sorted(f"chr{s['chrom']}"
                         + ("/APOL1" if s["is_apol1"] else "")
                         + ("/TCF7L2" if s["is_tcf7l2"] else "")
                         for s in ol["shared_loci_afr_eur"])),
        "; ".join(sorted(f"chr{s['chrom']}"
                         + ("/APOL1" if s["is_apol1"] else "")
                         + ("/TCF7L2" if s["is_tcf7l2"] else "")
                         for s in nl["shared_loci_afr_eur"])))

    for o, n in zip(red_old, red_new):
        tag = f"{o['ancestry']} {o['level']}"
        add(f"{tag} degree", o["degree"], n["degree"])
        add(f"{tag} within-cluster weight share",
            o["within_cluster_weight_share"], n["within_cluster_weight_share"])
        add(f"{tag} concordant weight share",
            o["concordant_weight_share"], n["concordant_weight_share"])

    with open(os.path.join(OUT, "esrd_threshold_comparison.csv"), "w",
              newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["item", "p<1e-4", "p<1e-6", "holds"])
        w.writeheader(); w.writerows(rows)

    print()
    print(f"{'item':<46}{'p<1e-4':>22}{'p<1e-6':>22}  holds")
    print("-" * 96)
    for r in rows:
        print(f"{r['item']:<46}{str(r['p<1e-4']):>22}{str(r['p<1e-6']):>22}"
              f"  {r['holds']}")
    same = sum(1 for r in rows if r["holds"] == "yes")
    print("-" * 96)
    print(f"{same} of {len(rows)} identical")
    print("wrote results/esrd_threshold_comparison.csv and results/esrd_1e6/")


if __name__ == "__main__":
    main()
