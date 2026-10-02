#!/usr/bin/env python3
"""Regenerate every column of the page-1 edgelist from the store.

Phase 0 established that the shipped file is correct at 1e-04, 1e-05 and
1e-06 and wrong from 1e-07 down: the counts and the weight distributions
are right but the values sit on the wrong phenotype pairs, so 18 of the 27
concordant columns agree with a recomputation on 1-7% of their edges.

This rebuilds all of it on the definition Phase 0 validated:
  - no promiscuous-SNP filter (the generating notebook had frequent_snp
    False, and the file it produced is named ..._False.csv)
  - survey-category phenotypes excluded
  - one row per (phenotype, SNP), smallest META p-value
  - concordant and discordant by the sign of beta across the two
    phenotypes within one ancestry
  - each column max-normalised to 50 independently, which is what the
    shipped file does

    python3 scripts/rebuild_edgelist.py [--out public/data/edgelist_rebuilt.csv]
"""
from __future__ import annotations

import argparse
import os
import sys

import duckdb

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSOC = os.path.join(REPO, "public", "data", "db", "associations",
                     "chrom=*", "*.parquet")
CURRENT = os.path.join(REPO, "public", "data", "edgelist_updated_scaled.csv")
NODE_ATTRS = os.path.join(REPO, "public", "data", "node_attributes.csv")
ANCESTRIES = ("eur", "amr", "eas", "afr", "meta")
THRESHOLDS = [f"1e-{t:02d}" for t in range(4, 13)]
SCALE_MAX = 50.0


def log(m):
    import datetime
    print(f"[{datetime.datetime.now():%H:%M:%S}] {m}", flush=True)


def connect():
    con = duckdb.connect()
    con.execute("PRAGMA threads=4")
    con.execute(f"""CREATE VIEW raw AS SELECT * FROM read_parquet(
                    '{ASSOC}', hive_partitioning = true)""")
    con.execute(f"CREATE VIEW nodes AS SELECT * FROM read_csv('{NODE_ATTRS}')")
    con.execute(f"CREATE VIEW current AS SELECT * FROM read_csv('{CURRENT}')")
    # one row per (phenotype, SNP), smallest META p
    con.execute("""CREATE OR REPLACE TEMP VIEW assoc AS
        SELECT * EXCLUDE (rn) FROM (
          SELECT *, row_number() OVER (PARTITION BY phe_id, rsid
                     ORDER BY coalesce("pval.meta", 2), src_row) AS rn
          FROM raw) WHERE rn = 1""")
    return con


def build(con):
    """One row per unordered phenotype pair, every ancestry x threshold."""
    log("collecting the pair universe")
    # the pair set is the union over every ancestry at the loosest
    # threshold: a stricter one can only remove pairs
    con.execute(f"""CREATE OR REPLACE TEMP TABLE pairs AS
        SELECT DISTINCT least(x.phe_id, y.phe_id) AS a,
                        greatest(x.phe_id, y.phe_id) AS b
        FROM (SELECT phe_id, rsid FROM assoc
              WHERE {' OR '.join(f'"pval.{a}" < 1e-4' for a in ANCESTRIES)}) x
        JOIN (SELECT phe_id, rsid FROM assoc
              WHERE {' OR '.join(f'"pval.{a}" < 1e-4' for a in ANCESTRIES)}) y
          USING (rsid)
        WHERE x.phe_id <> y.phe_id""")
    n = con.execute("SELECT count(*) FROM pairs").fetchone()[0]
    log(f"  {n:,} unordered phenotype pairs")

    counts = {}
    for anc in ANCESTRIES:
        for t in THRESHOLDS:
            col = f"{anc}_{t}"
            con.execute(f"""CREATE OR REPLACE TEMP TABLE sig AS
                SELECT phe_id, rsid, sign("beta.{anc}") AS sgn FROM assoc
                WHERE "pval.{anc}" IS NOT NULL AND "pval.{anc}" < {t}
                  AND "beta.{anc}" IS NOT NULL""")
            con.execute(f"""CREATE OR REPLACE TEMP TABLE w_{anc}_{t.replace('-', '_')} AS
                SELECT least(x.phe_id, y.phe_id) AS a,
                       greatest(x.phe_id, y.phe_id) AS b,
                       count(*) FILTER (WHERE x.sgn = y.sgn) AS same,
                       count(*) FILTER (WHERE x.sgn <> y.sgn) AS diff
                FROM sig x JOIN sig y USING (rsid)
                WHERE x.phe_id < y.phe_id
                GROUP BY 1, 2""")
            r = con.execute(f"""SELECT count(*), max(same), max(diff)
                FROM w_{anc}_{t.replace('-', '_')}""").fetchone()
            counts[col] = {"edges": r[0], "raw_max_same": r[1] or 0,
                           "raw_max_diff": r[2] or 0}
            log(f"  {col}: {r[0]:,} edges, raw max same {r[1]}, diff {r[2]}")
    return counts


def write(con, counts, out_path):
    """Assemble the wide table, scaling each column to a maximum of 50."""
    sel = ["CAST(p.a AS BIGINT) AS source", "CAST(p.b AS BIGINT) AS target"]
    joins = []
    for anc in ANCESTRIES:
        for t in THRESHOLDS:
            tbl = f"w_{anc}_{t.replace('-', '_')}"
            c = counts[f"{anc}_{t}"]
            ks = SCALE_MAX / c["raw_max_same"] if c["raw_max_same"] else 0
            kd = SCALE_MAX / c["raw_max_diff"] if c["raw_max_diff"] else 0
            sel.append(f'coalesce({tbl}.same, 0) * {ks!r} AS "{anc}_{t}_same_dir_weight"')
            sel.append(f'coalesce({tbl}.diff, 0) * {kd!r} AS "{anc}_{t}_diff_dir_weight"')
            joins.append(f"LEFT JOIN {tbl} ON {tbl}.a = p.a AND {tbl}.b = p.b")
    con.execute(f"""CREATE OR REPLACE TEMP TABLE rebuilt AS
        SELECT {', '.join(sel)} FROM pairs p {' '.join(joins)}""")
    con.execute(f"""COPY (SELECT * FROM rebuilt ORDER BY source, target)
                    TO '{out_path}' (FORMAT CSV, HEADER)""")

    # the same table in raw counts, for the consistency checks. The shipped
    # columns are each max-normalised independently, so concordant+discordant
    # is not a total in scaled space and a stricter threshold's scaled value
    # can exceed a looser one's; both only hold on counts.
    sel_raw = ["CAST(p.a AS BIGINT) AS source", "CAST(p.b AS BIGINT) AS target"]
    joins_raw = []
    for anc in ANCESTRIES:
        for t in THRESHOLDS:
            tbl = f"w_{anc}_{t.replace('-', '_')}"
            sel_raw.append(f'coalesce({tbl}.same, 0) AS "{anc}_{t}_same"')
            sel_raw.append(f'coalesce({tbl}.diff, 0) AS "{anc}_{t}_diff"')
            joins_raw.append(f"LEFT JOIN {tbl} ON {tbl}.a = p.a AND {tbl}.b = p.b")
    raw_path = out_path.replace(".csv", "_raw.csv")
    con.execute(f"""COPY (SELECT {', '.join(sel_raw)} FROM pairs p {' '.join(joins_raw)}
                    ORDER BY source, target) TO '{raw_path}' (FORMAT CSV, HEADER)""")
    log(f"wrote {raw_path}")
    n = con.execute("SELECT count(*) FROM rebuilt").fetchone()[0]
    log(f"wrote {out_path} ({n:,} rows)")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "public", "data",
                                                  "edgelist_rebuilt.csv"))
    args = ap.parse_args()
    con = connect()
    counts = build(con)
    write(con, counts, args.out)
    import json
    with open(os.path.join(REPO, "analysis", "final", "results",
                           "edgelist_rebuild_counts.json"), "w") as fh:
        json.dump(counts, fh, indent=1)
    log("wrote results/edgelist_rebuild_counts.json")


if __name__ == "__main__":
    main()
