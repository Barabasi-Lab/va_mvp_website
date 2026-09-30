#!/usr/bin/env python3
"""Effectiveness evaluation for the hierarchy-mask toggle (Part B, B4).

Coverage, over-masking and spot-check samples for each candidate tier set,
computed from the same classifier the toggle uses. Writes into results/ and
prints the tables that go into TOGGLE_EVALUATION.md.

{T1,T2,T3,T4} is not among the candidates: T3 needs phecode_definitions1.2.csv
and no input file we have carries the exclusion ranges (A0_RECON.md). The
largest set that can be evaluated on this data is {T1,T2,T4}.

Usage: python3 analysis/phecode_redundancy/evaluate_toggle.py
"""
from __future__ import annotations

import csv
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import network
from phecode_relations import PhecodeRelations
from run_analysis import (DB_DIR, ICD_MAP, DEFINITIONS, RESULTS, ANCESTRIES,
                          PRIMARY_THRESHOLD, SEED, load_meta, log)
from build_relations import pair_mask, T1, T2, T3, T4, UNCLASSIFIABLE

TIER_SETS = {
    "T1": T1,
    "T1+T2": T1 | T2,
    "T1+T2+T4": T1 | T2 | T4,
}
SAMPLE_N = 30


def tier_names(mask: int) -> str:
    if mask == UNCLASSIFIABLE:
        return "unclassifiable"
    names = [n for n, b in (("T1", T1), ("T2", T2), ("T3", T3), ("T4", T4))
             if mask & b]
    return "+".join(names) if names else "unrelated"


def main():
    random.seed(SEED)
    rel = PhecodeRelations(ICD_MAP, DEFINITIONS)
    meta = load_meta()
    con = network.connect(DB_DIR)

    coverage, samples, over = [], [], []
    for anc in ANCESTRIES:
        tbl = network.best_rows(con, anc, PRIMARY_THRESHOLD)
        edges = network.all_edges(con, tbl)
        masks = {}
        for p1, p2, w, syn, anti in edges:
            masks[(p1, p2)] = pair_mask(rel, meta[p1], meta[p2])

        nodes = {p for e in edges for p in e[:2]}
        total_w = sum(e[2] for e in edges)

        for name, want in TIER_SETS.items():
            hidden = [e for e in edges if masks[(e[0], e[1])] & want]
            kept = [e for e in edges if not (masks[(e[0], e[1])] & want)]
            kept_nodes = {p for e in kept for p in e[:2]}
            isolated = nodes - kept_nodes
            coverage.append({
                "ancestry": anc.upper(), "tier_set": name,
                "edges_total": len(edges), "edges_masked": len(hidden),
                "frac_edges_masked": len(hidden) / len(edges) if edges else "",
                "weight_total": total_w,
                "weight_masked": sum(e[2] for e in hidden),
                "frac_weight_masked":
                    sum(e[2] for e in hidden) / total_w if total_w else "",
                "nodes_total": len(nodes),
                "nodes_isolated": len(isolated),
                "frac_nodes_isolated": len(isolated) / len(nodes) if nodes else "",
            })

            # the 20 heaviest edges this set would hide, for the over-masking
            # check: these are the ones a reader would most notice missing
            for e in sorted(hidden, key=lambda e: -e[2])[:20]:
                p1, p2 = e[0], e[1]
                over.append({
                    "ancestry": anc.upper(), "tier_set": name,
                    "phecode_a": ",".join(meta[p1]["phecodes"]),
                    "phecode_b": ",".join(meta[p2]["phecodes"]),
                    "label_a": meta[p1]["label"], "label_b": meta[p2]["label"],
                    "category_a": meta[p1]["category"],
                    "category_b": meta[p2]["category"],
                    "tier": tier_names(masks[(p1, p2)]),
                    "shared_snps": e[2], "synergistic": e[3],
                    "antagonistic": e[4],
                })

        # spot-check samples, from the recommended set, on the ancestries the
        # manuscript discusses
        if anc in ("afr", "eur"):
            want = TIER_SETS["T1+T2"]
            hidden = [e for e in edges if masks[(e[0], e[1])] & want]
            shown = [e for e in edges if not (masks[(e[0], e[1])] & want)]
            for group, pool in (("masked", hidden), ("unmasked", shown)):
                for e in random.sample(pool, min(SAMPLE_N, len(pool))):
                    p1, p2 = e[0], e[1]
                    samples.append({
                        "ancestry": anc.upper(), "group": group,
                        "phecode_a": ",".join(meta[p1]["phecodes"]),
                        "phecode_b": ",".join(meta[p2]["phecodes"]),
                        "label_a": meta[p1]["label"],
                        "label_b": meta[p2]["label"],
                        "category_a": meta[p1]["category"],
                        "category_b": meta[p2]["category"],
                        "tier": tier_names(masks[(p1, p2)]),
                        "shared_snps": e[2],
                    })
    con.close()

    for rows, fname in ((coverage, "toggle_coverage.csv"),
                        (over, "toggle_overmasking.csv"),
                        (samples, "toggle_samples.csv")):
        path = os.path.join(RESULTS, fname)
        with open(path, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        log(f"wrote {path} ({len(rows)} rows)")

    log("")
    log(f"{'anc':6}{'tier set':12}{'edges masked':>22}{'weight masked':>20}"
        f"{'nodes isolated':>20}")
    for r in coverage:
        log(f"{r['ancestry']:6}{r['tier_set']:12}"
            f"{r['edges_masked']:>8,} ({r['frac_edges_masked']*100:5.2f}%)"
            f"{r['weight_masked']:>10,} ({r['frac_weight_masked']*100:5.2f}%)"
            f"{r['nodes_isolated']:>9,} ({r['frac_nodes_isolated']*100:5.2f}%)")


if __name__ == "__main__":
    main()
