#!/usr/bin/env python3
"""Q1: rerun the anemia example for phecode 280, beside the 280.1 results.

The examples analysis used node 271 (phecode 280.1, "Iron deficiency
anemias, unspecified or not due to blood loss"). The manuscript example is
phecode 280 ("Iron deficiency anemias"), node 270. Everything in Phase 2
is recomputed for 280 and reported next to the 280.1 value.

    python3 analysis/final/q1_anemia_280.py
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "analysis", "examples"))

import a_anemia
from common import (ANCESTRIES, PRIMARY_THRESHOLD, connect, log, meta_for,
                    neighbours, positions, significant, target_snps, write_csv)

OUT = os.path.join(HERE, "results")
PHE280, PHE280_1 = "270", "271"


def run_for(con, meta, node):
    """Everything Phase 2 computed, for one node."""
    a_anemia.TARGET = node
    out = {"node": node}
    out["claims"] = a_anemia.a_a_claims(con, meta)
    a4_rows, a4_summary = a_anemia.a_a4(con, meta)
    out["a4_summary"] = a4_summary
    out["a4_rows"] = a4_rows
    out["a5_a6"] = a_anemia.a_a5_a6(con, meta)
    loci_rows, per_anc, dominant = a_anemia.a_b_loci(con, meta)
    out["loci_rows"] = loci_rows
    out["dominant_locus"] = dominant
    lk_rows, lk_summary = a_anemia.a_c_lookup(con, per_anc)
    out["cross_ancestry"] = lk_summary
    out["redundancy"] = a_anemia.a_d_redundancy(con, meta)
    out["per_anc"] = per_anc
    return out


def locus_overlap(per_anc, a, b, window=500_000):
    """Shared loci between two ancestries, leads within +/- window."""
    n = 0
    for la in per_anc[a]["loci"]:
        for lb in per_anc[b]["loci"]:
            if la["chrom"] == lb["chrom"] and abs(la["lead_pos"] - lb["lead_pos"]) <= window:
                n += 1
                break
    return n


def removed_tier_neighbours(con, meta, node):
    """Which neighbours L1 and L2 remove, by name."""
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
    tgt = codes.get(node, [])
    out = {}
    for anc in ANCESTRIES:
        nb = neighbours(con, anc, PRIMARY_THRESHOLD, node)
        rows = []
        for k, v in nb.items():
            t1 = t2 = False
            for x in tgt:
                for y in codes.get(k, []):
                    r = rel.classify(x, y)
                    t1 |= r.t1
                    t2 |= r.t2
            if t1 or t2:
                rows.append({"ancestry": anc.upper(), "neighbour": k,
                             "phecode": ",".join(codes.get(k, [])),
                             "label": meta.get(k, {}).get("label", ""),
                             "tier": "T1" if t1 else "T2",
                             "removed_at": "L1" if t1 else "L2",
                             "shared_snps": v["shared"]})
        rows.sort(key=lambda r: -r["shared_snps"])
        out[anc.upper()] = rows
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    con = connect()
    meta = meta_for(con)
    positions(con)

    log("Q1: phecode 280 (node 270) vs phecode 280.1 (node 271)")
    new = run_for(con, meta, PHE280)
    old = run_for(con, meta, PHE280_1)

    # --- a: SNP counts
    rows = []
    for label, d in (("280 (node 270)", new), ("280.1 (node 271)", old)):
        c = d["claims"]
        rows.append({"phecode": label,
                     "afr_snps": c["A2"]["AFR"]["snps_p_lt_1e-4"],
                     "eur_snps": c["A2"]["EUR"]["snps_p_lt_1e-4"],
                     "meta_snps": c["A2"]["META"]["snps_p_lt_1e-4"],
                     "afr_eur_shared": c["A1"]["shared_snps_afr_eur"],
                     "afr_neighbours": c["A2"]["AFR"]["neighbours"],
                     "eur_neighbours": c["A2"]["EUR"]["neighbours"],
                     "intersection_neighbours": c["A1"]["neighbours_surviving_intersection"],
                     "intersection_neighbour_labels": "; ".join(c["A1"]["neighbour_labels"])})
    write_csv(rows, os.path.join(OUT, "q1a_snp_counts.csv"))
    for r in rows:
        log(f"  {r['phecode']:18} AFR {r['afr_snps']:>5} EUR {r['eur_snps']:>5} "
            f"shared {r['afr_eur_shared']:>3}  nb {r['afr_neighbours']}/{r['eur_neighbours']} "
            f"-> intersection {r['intersection_neighbours']} ({r['intersection_neighbour_labels']})")

    # --- b: share kept by META, SNP and locus level
    rows = []
    for label, d in (("280", new), ("280.1", old)):
        for anc in ("AFR", "EUR"):
            a3 = d["claims"]["A3"][anc]
            lo = d["per_anc"][anc.lower()]["loci"]
            mt = d["per_anc"]["meta"]["loci"]
            shared = 0
            for la in lo:
                if any(la["chrom"] == lb["chrom"]
                       and abs(la["lead_pos"] - lb["lead_pos"]) <= 500_000 for lb in mt):
                    shared += 1
            rows.append({"phecode": label, "ancestry": anc,
                         "snps": a3["snps"], "snps_also_meta": a3["snps_also_meta_significant"],
                         "snp_share_kept": a3["snp_fraction_kept"],
                         "loci": len(lo), "loci_shared_with_meta": shared,
                         "locus_share_kept": round(shared / len(lo), 4) if lo else None,
                         "neighbours": a3["neighbours"],
                         "neighbour_share_kept": a3["neighbour_fraction_kept"]})
    write_csv(rows, os.path.join(OUT, "q1b_meta_overlap.csv"))
    for r in rows:
        log(f"  {r['phecode']:6} {r['ancestry']}->META snps {r['snp_share_kept']} "
            f"loci {r['loci_shared_with_meta']}/{r['loci']} ({r['locus_share_kept']})")

    # --- c: the META-neighbour ancestry split
    for label, d in (("280", new), ("280.1", old)):
        s = d["a4_summary"]
        log(f"  {label} A4: " + "; ".join(
            f"{k} AFR {v['predominantly_AFR']} EUR {v['predominantly_EUR']} "
            f"mixed {v['mixed']} of {v['neighbours_scored']}" for k, v in s.items()))
    write_csv(new["a4_rows"], os.path.join(OUT, "q1c_280_neighbour_split.csv"))
    others = [r for r in new["a4_rows"]
              if r["afr_share_of_single_ancestry"] is not None
              and r["afr_share_of_single_ancestry"] > 0.2]
    write_csv(others, os.path.join(OUT, "q1c_280_non_eur_predominant.csv"))

    # --- d: the two named neighbours
    for label, d in (("280", new), ("280.1", old)):
        for key, v in d["a5_a6"].items():
            if "AFR" in v:
                log(f"  {label} {key}: node {v['phe_id']} {v['label']!r} "
                    f"META edge {v['shared_with_280.1_in_META']}; "
                    f"AFR {v['AFR']['of_the_META_edge_also_significant_here']}, "
                    f"EUR {v['EUR']['of_the_META_edge_also_significant_here']}")
    with open(os.path.join(OUT, "q1d_named_neighbours.json"), "w") as fh:
        json.dump({"280": new["a5_a6"], "280.1": old["a5_a6"]}, fh, indent=1, default=str)

    # --- e: redundancy, and which neighbours go
    write_csv(new["redundancy"], os.path.join(OUT, "q1e_280_redundancy.csv"))
    removed = removed_tier_neighbours(con, meta, PHE280)
    flat = [r for anc in removed.values() for r in anc]
    write_csv(flat, os.path.join(OUT, "q1e_280_removed_neighbours.csv"))
    for anc, rows_ in removed.items():
        names = ", ".join(f"{r['phecode']} {r['label'][:28]} [{r['removed_at']}]"
                          for r in rows_[:6])
        log(f"  {anc} removes {len(rows_)}: {names or 'none'}")

    with open(os.path.join(OUT, "q1_full.json"), "w") as fh:
        json.dump({"280": {k: v for k, v in new.items() if k != "per_anc"},
                   "280.1": {k: v for k, v in old.items() if k != "per_anc"}},
                  fh, indent=1, default=str)
    log("wrote results/q1_full.json")


if __name__ == "__main__":
    main()
