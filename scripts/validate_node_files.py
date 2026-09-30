#!/usr/bin/env python3
"""Compare DuckDB-generated node neighbourhoods against the legacy per-node CSVs.

Usage: python3 scripts/validate_node_files.py [node_id ...]
With no arguments a spread of node sizes is sampled.
"""
import collections
import csv
import os
import random
import sys

import duckdb

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "public", "data")
NODE_FILES = os.path.join(DATA, "node_files")
DB_DIR = os.path.join(DATA, "db")


def connect():
    """In-memory connection with views over the shipped Parquet shards."""
    con = duckdb.connect()
    con.execute(
        "CREATE VIEW associations AS SELECT * FROM read_parquet("
        f"'{os.path.join(DB_DIR, 'associations', '**', '*.parquet')}',"
        " hive_partitioning = true)")
    con.execute(
        "CREATE VIEW node_attributes AS SELECT * FROM read_parquet("
        f"'{os.path.join(DB_DIR, 'node_attributes.parquet')}')")
    return con

SPLIT = {"181", "167", "170", "175"}
ANC = ["meta", "eur", "afr", "amr", "eas"]

# Node 25 ("Viral warts & HPV") is stored HTML-escaped in node_attributes.csv,
# so the pipeline that built the legacy CSVs never matched its label: its own
# file is empty and it is absent from every other neighbourhood, despite having
# 9,106 real associations. The DB includes it, so exclude it here to keep this
# a like-for-like check of everything else.
QUERY = """
SELECT a.rsid, a.chrom,
       a."pval.meta", a."beta.meta", a."pval.eur", a."beta.eur",
       a."pval.afr", a."beta.afr", a."pval.amr", a."beta.amr",
       a."pval.eas", a."beta.eas",
       a.phe_id
FROM associations a
WHERE a.phe_id <> '25'
  AND a.rsid IN (SELECT rsid FROM associations WHERE phe_id = ?)
"""


def legacy_rows(node_id):
    paths = (
        [os.path.join(NODE_FILES, f"{node_id}_{i}.csv") for i in (1, 2)]
        if node_id in SPLIT
        else [os.path.join(NODE_FILES, f"{node_id}.csv")]
    )
    out = []
    for p in paths:
        with open(p, newline="") as fh:
            out.extend(csv.DictReader(fh))
    return out


def num(x):
    if x in (None, "", "NA"):
        return None
    try:
        return float(x)
    except ValueError:
        return None


def key(rsid, phe_id, row_getter):
    """Multiset key: identity plus every numeric stat, so duplicate
    (phe_id, rsid) pairs from merged phenotypes still have to line up.

    The legacy CSVs substituted (pval=1, beta=0) for absent ancestry data
    where the raw dataset has NA, so collapse that back to NULL on both
    sides before comparing.
    """
    stats = []
    for a in ANC:
        p, b = row_getter(f"pval.{a}"), row_getter(f"beta.{a}")
        if (p == 1.0 and b == 0.0) or p is None or b is None:
            p = b = None
        # the legacy CSVs carry float round-trip noise (5.912000000000002e-07
        # where the raw dataset has 5.912e-07), so compare at 10 sig figs
        stats += [sig(p), sig(b)]
    return (rsid, phe_id) + tuple(stats)


def sig(x, digits=10):
    return None if x is None else float(f"%.{digits}e" % x)


def compare(con, node_id):
    legacy = legacy_rows(node_id)
    lk = collections.Counter(
        key(r["rsid"], r["phe_id"], lambda c, r=r: num(r[c])) for r in legacy
    )

    rows = con.execute(QUERY, [node_id]).fetchall()
    cols = ["rsid", "chrom"] + [f"{k}.{a}" for a in ANC for k in ("pval", "beta")] + ["phe_id"]
    dk = collections.Counter()
    for row in rows:
        d = dict(zip(cols, row))
        dk[key(d["rsid"], d["phe_id"], lambda c, d=d: d[c])] += 1

    missing = lk - dk
    extra = dk - lk
    status = "OK " if not missing and not extra else "FAIL"
    print(
        f"{status} node {node_id:>5}: legacy={len(legacy):>7} db={len(rows):>7} "
        f"missing={sum(missing.values()):>6} extra={sum(extra.values()):>6}"
    )
    for k_ in list(missing)[:2]:
        print("      missing:", k_)
    for k_ in list(extra)[:2]:
        print("      extra  :", k_)
    return not missing and not extra


def main():
    con = connect()
    if len(sys.argv) > 1:
        targets = sys.argv[1:]
    else:
        avail = []
        for name in os.listdir(NODE_FILES):
            nid = name[:-4]
            if "_" in nid:
                continue
            avail.append((os.path.getsize(os.path.join(NODE_FILES, name)), nid))
        avail.sort()
        nonempty = [n for s, n in avail if s > 200]
        random.seed(7)
        targets = (
            nonempty[:2]
            + random.sample(nonempty[2:-3], 5)
            + nonempty[-3:]
            + ["236", "708"]  # merged-phenotype nodes
            + ["181"]         # split file
        )
    ok = all([compare(con, t) for t in targets])
    print("ALL MATCH" if ok else "MISMATCHES PRESENT")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
