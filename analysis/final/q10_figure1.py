#!/usr/bin/env python3
"""The Figure 1 text numbers, from the source download rather than the store.

The store holds only the filtered subset the site serves - 3.06 M rows - so
the Figure 1 counts cannot be checked against it. This reads
/home/student/Desktop/full_dataset.csv, which is what build_dbs.py was given.

Every count is produced at three significance thresholds and under both
duplicate conventions, so the report can say which combination reproduces
each drafted number instead of guessing one.

    python3 analysis/final/q10_figure1.py
"""
from __future__ import annotations

import json
import os
import sys

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "results")
SRC = "/home/student/Desktop/full_dataset.csv"
WORK = os.path.join(os.environ.get("SCRATCH", "/tmp"), "fig1_full.duckdb")
ANCS = ("META", "EUR", "AFR", "AMR", "EAS")
THRESHOLDS = {"5e-08": 5e-8, "1e-04": 1e-4, "any row": None}


def build(con):
    """One narrow table of the columns the counts need, so the 3.6 GB CSV is
    scanned once instead of once per query."""
    cols = ", ".join(f'"pval.{a}"' for a in ANCS)
    con.execute(f"""CREATE TABLE IF NOT EXISTS raw AS
        SELECT phenotype, rsid, {cols},
               row_number() OVER () AS src_row
        FROM read_csv('{SRC}', header = true, sample_size = -1)""")
    # the dedupe the store uses: smallest META p wins, ties by source order
    con.execute("""CREATE OR REPLACE VIEW dedup AS
        SELECT * EXCLUDE (rn) FROM (
          SELECT *, row_number() OVER (PARTITION BY phenotype, rsid
                     ORDER BY coalesce("pval.META", 2), src_row) AS rn
          FROM raw)
        WHERE rn = 1""")


def where(anc, thr):
    return "TRUE" if thr is None else f'"pval.{anc}" < {thr}'


def counts(con, tbl, thr):
    d = {}
    for a in ANCS:
        d[f"{a}_associations"] = con.execute(
            f"SELECT count(*) FROM {tbl} WHERE {where(a, thr)}").fetchone()[0]
        d[f"{a}_phenotypes_with_any"] = con.execute(
            f"SELECT count(DISTINCT phenotype) FROM {tbl} WHERE {where(a, thr)}").fetchone()[0]
    if thr is not None:
        four = " AND ".join(where(a, thr) for a in ("EUR", "AFR", "AMR", "EAS"))
        d["snps_significant_in_all_four"] = con.execute(
            f"SELECT count(DISTINCT rsid) FROM {tbl} WHERE {four}").fetchone()[0]
        three = " AND ".join(where(a, thr) for a in ("EUR", "AFR", "AMR"))
        d["snps_all_but_eas"] = con.execute(f"""
            SELECT count(DISTINCT rsid) FROM {tbl} WHERE {three}
              AND rsid NOT IN (SELECT rsid FROM {tbl} WHERE {where('EAS', thr)})
            """).fetchone()[0]
        others = " OR ".join(where(a, thr) for a in ("AFR", "AMR", "EAS"))
        d["snps_eur_only"] = con.execute(f"""
            SELECT count(DISTINCT rsid) FROM {tbl} WHERE {where('EUR', thr)}
              AND rsid NOT IN (SELECT rsid FROM {tbl} WHERE {others})
            """).fetchone()[0]
        for a in ("META", "EUR", "EAS", "AMR"):
            for k in (10, 50):
                d[f"{a}_pleiotropy_ge{k}_pct"] = con.execute(f"""
                    SELECT round(100.0 * count(*) FILTER (WHERE n >= {k})
                                 / nullif(count(*), 0), 3)
                    FROM (SELECT rsid, count(DISTINCT phenotype) AS n FROM {tbl}
                          WHERE {where(a, thr)} GROUP BY rsid)""").fetchone()[0]
    return d


def main():
    os.makedirs(OUT, exist_ok=True)
    con = duckdb.connect(WORK)
    con.execute("PRAGMA threads=4")
    con.execute("PRAGMA memory_limit='12GB'")
    build(con)
    total = con.execute("SELECT count(*) FROM raw").fetchone()[0]
    print(f"source rows: {total:,}", flush=True)

    result = {"source": SRC, "source_rows": total, "by_threshold": {}}
    for tname, thr in THRESHOLDS.items():
        for rule, tbl in (("every row as stored", "raw"),
                          ("one row per (phenotype, rsid)", "dedup")):
            key = f"{tname} | {rule}"
            result["by_threshold"][key] = counts(con, tbl, thr)
            d = result["by_threshold"][key]
            print(f"{key:44} EUR {d['EUR_associations']:>12,} "
                  f"({d['EUR_phenotypes_with_any']} phe)  "
                  f"EAS {d['EAS_associations']:>9,} ({d['EAS_phenotypes_with_any']})  "
                  f"META {d['META_associations']:>12,} "
                  f"({d['META_phenotypes_with_any']})", flush=True)

    with open(os.path.join(OUT, "q10_figure1.json"), "w") as fh:
        json.dump(result, fh, indent=1)
    print("wrote q10_figure1.json")


if __name__ == "__main__":
    main()
