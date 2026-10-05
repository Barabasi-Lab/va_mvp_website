#!/usr/bin/env python3
"""The definition grid for panel c.

Three numbers in the manuscript text are \\tbd{} placeholders: 12,558 SNPs
significant in all four ancestries, 328,152 in all but EAS, 945,657
EUR-only. This evaluates each of them under every combination of

    sets      4 ancestries | 4 ancestries + META
    type      exclusive (the UpSet default) | inclusive
    unit      unique SNP | phenotype-SNP association

and, where META is a set, under both readings of "all four ancestries":
META also significant, and META not significant.

The unit now in fig1_data.json is the distinct phenotype-SNP pair with
duplicates collapsed by the minimum p in each ancestry, which is what
reproduces the published figure; "association" below means that pair.

Every cell is a sum over the 30 membership patterns fig1_extract.py already
counted, so this costs no further pass over the 3.6 GB source.

    python3 analysis/final/fig1_defgrid.py
"""
from __future__ import annotations

import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "results")
ANCS = ("EUR", "AFR", "AMR", "EAS")
DRAFTED = {"all_four": 12558, "all_but_eas": 328152, "eur_only": 945657}


def total(pats, required, forbidden):
    """Sum the patterns where every set in `required` is significant and
    every set in `forbidden` is not."""
    n = 0
    for p in pats:
        f = p["pattern"]
        if all(f[k] for k in required) and not any(f[k] for k in forbidden):
            n += p["count"]
    return n


def grid(data):
    rows = []
    for unit in ("snp", "association"):
        pats = data["membership"][unit]
        for sets in ("4 ancestries", "4 ancestries + META"):
            for kind in ("exclusive", "inclusive"):
                # with META as a set, "all four ancestries" has two readings
                metas = ((None,) if sets == "4 ancestries"
                         else ("META significant", "META not significant"))
                for meta_read in metas:
                    # what the chosen universe lets us forbid
                    others = [] if sets == "4 ancestries" else ["META"]
                    if kind == "exclusive":
                        af_forbid = list(others)
                        abe_forbid = ["EAS"] + others
                        eo_forbid = ["AFR", "AMR", "EAS"] + others
                    else:
                        af_forbid = []
                        abe_forbid = ["EAS"]
                        eo_forbid = ["AFR", "AMR", "EAS"]
                    if meta_read == "META significant":
                        af_forbid = [x for x in af_forbid if x != "META"]
                        abe_forbid = [x for x in abe_forbid if x != "META"]
                        eo_forbid = [x for x in eo_forbid if x != "META"]
                        af_req = list(ANCS) + ["META"]
                        abe_req = ["EUR", "AFR", "AMR", "META"]
                        eo_req = ["EUR", "META"]
                    else:
                        af_req, abe_req, eo_req = list(ANCS), ["EUR", "AFR", "AMR"], ["EUR"]
                    rows.append({
                        "unit": "unique SNP" if unit == "snp" else "pair",
                        "sets": sets, "type": kind,
                        "meta_reading": meta_read or "-",
                        "all_four": total(pats, af_req, af_forbid),
                        "all_but_eas": total(pats, abe_req, abe_forbid),
                        "eur_only": total(pats, eo_req, eo_forbid),
                    })
    for r in rows:
        r["matches_drafted"] = sum(
            1 for k, v in DRAFTED.items() if r[k] == v)
    return rows


def main():
    data = json.load(open(os.path.join(OUT, "fig1_data.json")))
    rows = grid(data)
    with open(os.path.join(OUT, "fig1_defgrid.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)

    hdr = (f"{'unit':<12}{'sets':<22}{'type':<11}{'META reading':<22}"
           f"{'all four':>12}{'all but EAS':>13}{'EUR-only':>12}{'hits':>6}")
    print(hdr); print("-" * len(hdr))
    for r in rows:
        print(f"{r['unit']:<12}{r['sets']:<22}{r['type']:<11}"
              f"{r['meta_reading']:<22}{r['all_four']:>12,}"
              f"{r['all_but_eas']:>13,}{r['eur_only']:>12,}"
              f"{r['matches_drafted']:>6}")
    print("-" * len(hdr))
    print(f"{'DRAFTED (\\tbd placeholders)':<67}{DRAFTED['all_four']:>12,}"
          f"{DRAFTED['all_but_eas']:>13,}{DRAFTED['eur_only']:>12,}")
    best = max(rows, key=lambda r: r["matches_drafted"])
    print(f"\nbest: {best['matches_drafted']} of 3 exact")
    print("wrote fig1_defgrid.csv")


if __name__ == "__main__":
    main()
