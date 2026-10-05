#!/usr/bin/env python3
"""Every aggregate Figure 1 needs, in one pass over the source download.

The store is the filtered subset the site serves, so none of Figure 1 can be
built from it; this reads /home/student/Desktop/full_dataset.csv (24,026,422
rows) at p < 1e-4.

The unit is the **distinct phenotype-SNP pair**, with duplicate rows
collapsed by taking the minimum p in each ancestry independently. That is
not a guess: it reproduces every printed number of the published
figs/data_stats_v6.png exactly - all five set totals and all 29 printed
UpSet bars. Raw-row counts are computed alongside it, because the
manuscript *text* used those instead (EAS 37,388 in the text against 37,359
in the figure), and the report needs both.

Writes analysis/final/results/fig1_data.json. Plotting is a separate script
so the figure can be restyled without re-reading 3.6 GB.

    python3 analysis/final/fig1_extract.py
"""
from __future__ import annotations

import json
import os
import time

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "results")
SRC = "/home/student/Desktop/full_dataset.csv"
WORK = os.environ.get("FIG1_DB", "/tmp/fig1_full.duckdb")

ANCS = ("EUR", "AFR", "AMR", "EAS", "META")
PRIMARY = 1e-4
THRESHOLDS = {"1e-04": 1e-4, "5e-08": 5e-8}

t0 = time.time()


def log(msg):
    print(f"[{time.time() - t0:7.1f}s] {msg}", flush=True)


def build(con):
    """Scan the CSV once into a narrow cast table.

    The p-value columns arrive as VARCHAR because the download writes "NA"
    for an ancestry a variant was not tested in; TRY_CAST turns those into
    NULL, which every comparison below already treats as not significant.
    """
    have = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    if "raw" in have:
        log("reusing the cached scan")
        return
    cols = ", ".join(f'"pval.{a}"' for a in ANCS)
    log("scanning the CSV (this is the slow part)")
    con.execute(f"""CREATE TABLE raw_text AS
        SELECT phenotype, rsid, {cols}
        FROM read_csv('{SRC}', header = true, sample_size = -1)""")
    cast = ", ".join(f'TRY_CAST("pval.{a}" AS DOUBLE) AS "pval.{a}"' for a in ANCS)
    con.execute(f"CREATE TABLE raw AS SELECT phenotype, rsid, {cast} FROM raw_text")
    con.execute("DROP TABLE raw_text")
    log("scan done")


def pairs(con):
    """Collapse duplicate (phenotype, rsid) rows by the minimum p in each
    ancestry. This is the unit the published figure counts."""
    have = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    if "pairmin" in have:
        log("reusing the cached pair table")
        return
    agg = ", ".join(f'min("pval.{a}") AS "pval.{a}"' for a in ANCS)
    log("collapsing duplicates to one row per phenotype-SNP pair")
    con.execute(f"""CREATE TABLE pairmin AS
        SELECT phenotype, rsid, {agg} FROM raw GROUP BY phenotype, rsid""")


def panel_a(con, tbl):
    """Per ancestry: unique significant SNPs, significant associations, and
    phenotypes with at least one significant association, at p < 1e-4."""
    out = {}
    for a in ANCS:
        r = con.execute(f"""SELECT count(*), count(DISTINCT rsid),
                                   count(DISTINCT phenotype)
                            FROM {tbl} WHERE "pval.{a}" < {PRIMARY}""").fetchone()
        out[a] = {"associations": r[0], "significant_snps": r[1],
                  "phenotypes": r[2]}
        log(f"  panel a [{tbl}] {a}: {r[0]:,} assoc, {r[1]:,} SNPs, "
            f"{r[2]} phenotypes")
    return out


def panel_b(con, tbl="pairmin", bins=240):
    """Histogram of log10(p) for the significant associations of each
    ancestry, fine enough to draw as a density curve. Exact, where a KDE
    over 21 M points per ancestry would have to be sampled."""
    out = {}
    for a in ANCS:
        rows = con.execute(f"""
            SELECT floor(log10("pval.{a}") * 4) / 4 AS b, count(*)
            FROM {tbl} WHERE "pval.{a}" < {PRIMARY} AND "pval.{a}" > 0
            GROUP BY b ORDER BY b""").fetchall()
        out[a] = {"log10p": [r[0] for r in rows], "count": [r[1] for r in rows]}
        log(f"  panel b {a}: {len(rows)} bins")
    return out


def membership(con, tbl="pairmin"):
    """The count of every one of the 32 ancestry-membership patterns, at the
    SNP level and at the association level.

    Every exclusive and inclusive intersection the definition grid asks for
    is a sum over this one table, so the grid costs no further scans.
    """
    flags = ", ".join(
        f'max(CASE WHEN "pval.{a}" < {PRIMARY} THEN 1 ELSE 0 END) AS {a.lower()}'
        for a in ANCS)
    con.execute(f"CREATE OR REPLACE TEMP VIEW snp_flags AS "
                f"SELECT rsid, {flags} FROM {tbl} GROUP BY rsid")
    key = ", ".join(a.lower() for a in ANCS)
    snp = con.execute(f"SELECT {key}, count(*) FROM snp_flags "
                      f"GROUP BY {key}").fetchall()
    log(f"  membership, SNP level: {len(snp)} patterns")

    rowf = ", ".join(
        f'CASE WHEN "pval.{a}" < {PRIMARY} THEN 1 ELSE 0 END AS {a.lower()}'
        for a in ANCS)
    assoc = con.execute(f"""SELECT {key}, count(*) FROM
        (SELECT {rowf} FROM {tbl}) GROUP BY {key}""").fetchall()
    log(f"  membership, association level: {len(assoc)} patterns")

    def pack(rows):
        return [{"pattern": {a: int(r[i]) for i, a in enumerate(ANCS)},
                 "count": r[len(ANCS)]} for r in rows]
    return {"snp": pack(snp), "association": pack(assoc)}


def panel_d(con, tbl="pairmin"):
    """Reverse cumulative pleiotropy: for each ancestry and threshold, how
    many SNPs are significant for exactly n phenotypes."""
    out = {}
    for tname, thr in THRESHOLDS.items():
        for a in ANCS:
            rows = con.execute(f"""
                SELECT n, count(*) FROM (
                  SELECT rsid, count(DISTINCT phenotype) AS n FROM {tbl}
                  WHERE "pval.{a}" < {thr} GROUP BY rsid)
                GROUP BY n ORDER BY n""").fetchall()
            out[f"{a}|{tname}"] = {"n": [r[0] for r in rows],
                                   "snps": [r[1] for r in rows]}
            tot = sum(r[1] for r in rows)
            ge10 = sum(r[1] for r in rows if r[0] >= 10)
            ge50 = sum(r[1] for r in rows if r[0] >= 50)
            log(f"  panel d {a} {tname}: {tot:,} SNPs, "
                f">=10 {100*ge10/tot if tot else 0:.3f}%, "
                f">=50 {100*ge50/tot if tot else 0:.3f}%")
        out.setdefault("_thresholds", {})[tname] = thr
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    con = duckdb.connect(WORK)
    con.execute("PRAGMA threads=4")
    con.execute("PRAGMA memory_limit='12GB'")
    build(con)

    total = con.execute("SELECT count(*) FROM raw").fetchone()[0]
    log(f"source rows: {total:,}")

    pairs(con)
    n_pairs = con.execute("SELECT count(*) FROM pairmin").fetchone()[0]
    log(f"distinct phenotype-SNP pairs: {n_pairs:,}")

    data = {"source": SRC, "source_rows": total, "pair_rows": n_pairs,
            "threshold": PRIMARY,
            "unit": "distinct phenotype-SNP pair, duplicates collapsed by "
                    "min p per ancestry (reproduces data_stats_v6.png)",
            "sample_size": {"EAS": 6702, "AMR": 59048, "AFR": 121177,
                            "EUR": 449042, "META": 635969}}
    log("panel a")
    data["panel_a"] = panel_a(con, "pairmin")
    data["panel_a_raw_rows"] = panel_a(con, "raw")
    log("panel b")
    data["panel_b"] = panel_b(con)
    log("membership patterns")
    data["membership"] = membership(con)
    log("panel d")
    data["panel_d"] = panel_d(con)

    with open(os.path.join(OUT, "fig1_data.json"), "w") as fh:
        json.dump(data, fh, indent=1)
    log("wrote fig1_data.json")


if __name__ == "__main__":
    main()
