#!/usr/bin/env python3
"""Check the landing-page endpoint against edgelist_updated_scaled.csv.

For every ancestry x p-value combination the served weights and the
server-computed degrees are compared with the original wide CSV.

Usage: python3 scripts/validate_landing.py [baseUrl]
"""
import csv
import os
import sys
import urllib.request
import json

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGELIST = os.path.join(REPO, "public", "data", "edgelist_updated_scaled.csv")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"

ANCESTRIES = ["meta", "eur", "afr", "amr", "eas"]
PVALUES = [f"1e-{n:02d}" for n in range(4, 13)]


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}") as fh:
        return json.load(fh)


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def main():
    with open(EDGELIST, newline="") as fh:
        rows = list(csv.DictReader(fh))
    print(f"edgelist: {len(rows)} rows")

    ok = True
    for ancestry in ANCESTRIES:
        for pvalue in PVALUES:
            same_col = f"{ancestry}_{pvalue}_same_dir_weight"
            diff_col = f"{ancestry}_{pvalue}_diff_dir_weight"

            expected = {}
            degrees = {}
            for r in rows:
                s, d = num(r[same_col]), num(r[diff_col])
                expected[(r["source"], r["target"])] = (s, d)
                degrees.setdefault(r["source"], 0)
                degrees.setdefault(r["target"], 0)
                if s != 0 or d != 0:
                    degrees[r["source"]] += 1
                    degrees[r["target"]] += 1

            payload = get(f"/api/landing/edges?ancestry={ancestry}&pvalue={pvalue}")
            served = {(e["source"], e["target"]): (e["same"], e["diff"]) for e in payload["edges"]}

            bad_w = [k for k, v in expected.items() if served.get(k) != v]
            bad_d = [k for k, v in degrees.items() if payload["degrees"].get(k) != v]
            status = "OK  " if not bad_w and not bad_d and len(served) == len(expected) else "FAIL"
            if status == "FAIL":
                ok = False
                print(f"{status} {ancestry} {pvalue}: edges {len(served)}/{len(expected)} "
                      f"weight mismatches={len(bad_w)} degree mismatches={len(bad_d)}")
                for k in bad_w[:3]:
                    print(f"      {k}: csv={expected[k]} api={served.get(k)}")
                for k in bad_d[:3]:
                    print(f"      degree {k}: csv={degrees[k]} api={payload['degrees'].get(k)}")
            else:
                print(f"{status} {ancestry} {pvalue}: {len(served)} edges, "
                      f"{sum(1 for v in degrees.values() if v)} nodes with edges")

    # node attributes
    served_nodes = {n["id"]: n for n in get("/api/landing/nodes")["nodes"]}
    with open(os.path.join(REPO, "public", "data", "node_attributes.csv"), newline="") as fh:
        attrs = list(csv.DictReader(fh))
    bad = [a["id"] for a in attrs
           if a["id"] not in served_nodes
           or served_nodes[a["id"]]["label"] != a["label"]
           or float(served_nodes[a["id"]]["x"]) != float(a["x"])
           or int(served_nodes[a["id"]]["degree"]) != int(a["degree"])]
    if bad or len(served_nodes) != len(attrs):
        ok = False
        print(f"FAIL nodes: {len(served_nodes)}/{len(attrs)} mismatches={len(bad)} {bad[:5]}")
    else:
        print(f"OK   nodes: {len(served_nodes)} match node_attributes.csv")

    print("ALL MATCH" if ok else "MISMATCHES PRESENT")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
