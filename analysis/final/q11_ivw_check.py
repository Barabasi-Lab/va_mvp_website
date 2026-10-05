#!/usr/bin/env python3
"""Does the stored META beta equal the inverse-variance-weighted combination
of the ancestry betas?

The manuscript says META is "a meta-analysis across all ancestries using
inverse-variance weighted fixed-effects models". That is a closed-form
prediction, so it can be checked rather than taken on trust:

    w_i      = 1 / se_i^2
    beta_IVW = sum(w_i * beta_i) / sum(w_i)
    se_IVW   = sqrt(1 / sum(w_i))

computed over the four ancestry groups (EUR, AFR, AMR, EAS) wherever both
beta and se are present. Rows are taken from the store, which carries beta
and se for every ancestry and for META.

Agreement is reported as the relative difference
|beta_IVW - beta_META| / |beta_META|, so it does not depend on effect size,
alongside the absolute difference in standard-error units.

    python3 analysis/final/q11_ivw_check.py
"""
from __future__ import annotations

import csv
import json
import os

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "results")
GLOB = os.path.join(REPO, "public", "data", "db", "associations",
                    "chrom=*", "*.parquet")
ANCS = ("eur", "afr", "amr", "eas")


def main():
    os.makedirs(OUT, exist_ok=True)
    con = duckdb.connect()
    con.execute("PRAGMA threads=4")
    con.execute(f"""CREATE VIEW a AS SELECT * FROM read_parquet(
                    '{GLOB}', hive_partitioning = true)""")

    # one weight term per ancestry, contributing only where both beta and se
    # are present and the se is usable
    def term(x, anc):
        return (f'CASE WHEN "beta.{anc}" IS NOT NULL AND "se.{anc}" IS NOT NULL '
                f'AND "se.{anc}" > 0 THEN {x} ELSE 0 END')
    wsum = " + ".join(term(f'1.0 / ("se.{a}" * "se.{a}")', a) for a in ANCS)
    bsum = " + ".join(term(f'"beta.{a}" / ("se.{a}" * "se.{a}")', a) for a in ANCS)
    ancs_present = " + ".join(term("1", a) for a in ANCS)

    con.execute(f"""CREATE OR REPLACE VIEW ivw AS
        SELECT phe_id, rsid, "beta.meta" AS beta_meta, "se.meta" AS se_meta,
               ({ancs_present}) AS n_anc,
               ({bsum}) / nullif(({wsum}), 0) AS beta_ivw,
               sqrt(1.0 / nullif(({wsum}), 0))  AS se_ivw
        FROM a
        WHERE "beta.meta" IS NOT NULL AND "se.meta" IS NOT NULL""")

    overall = con.execute("""
        SELECT count(*),
               count(*) FILTER (WHERE beta_ivw IS NOT NULL),
               corr(beta_ivw, beta_meta),
               median(abs(beta_ivw - beta_meta) / nullif(abs(beta_meta), 0)),
               quantile_cont(abs(beta_ivw - beta_meta) / nullif(abs(beta_meta), 0), 0.95),
               median(abs(beta_ivw - beta_meta) / se_meta),
               count(*) FILTER (WHERE abs(beta_ivw - beta_meta)
                                      <= 0.01 * abs(beta_meta)),
               count(*) FILTER (WHERE abs(beta_ivw - beta_meta)
                                      <= 0.001 * abs(beta_meta)),
               corr(se_ivw, se_meta),
               median(se_ivw / nullif(se_meta, 0))
        FROM ivw WHERE beta_ivw IS NOT NULL""").fetchone()

    rows = []
    rows.append({
        "subset": "all rows with a META beta",
        "rows": overall[0], "rows_with_an_ivw": overall[1],
        "corr_beta": round(overall[2], 6),
        "median_rel_diff": round(overall[3], 6),
        "p95_rel_diff": round(overall[4], 6),
        "median_diff_in_se_units": round(overall[5], 6),
        "within_1pct": overall[6], "within_0.1pct": overall[7],
        "within_1pct_share": round(overall[6] / overall[1], 4),
        "median_beta_ratio": None,
        "corr_se": round(overall[8], 6),
        "median_se_ratio": round(overall[9], 6),
    })

    # Agreement against effect size. The relative difference is dominated by
    # rows whose META beta is near zero, where a tiny absolute difference is
    # a huge relative one, so the strata matter more than the overall figure.
    con.execute('CREATE OR REPLACE VIEW ivw2 AS SELECT *, '
                'abs(beta_meta / nullif(se_meta, 0)) AS z_meta FROM ivw')
    for name, cond in (("|z_meta| >= 2", "z_meta >= 2"),
                       ("|z_meta| >= 5", "z_meta >= 5"),
                       ("|z_meta| >= 10", "z_meta >= 10"),
                       ("|beta_meta| >= 0.05", "abs(beta_meta) >= 0.05"),
                       ("|beta_meta| >= 0.2", "abs(beta_meta) >= 0.2")):
        r = con.execute(f"""
            SELECT count(*), corr(beta_ivw, beta_meta),
                   median(abs(beta_ivw - beta_meta) / nullif(abs(beta_meta), 0)),
                   median(beta_ivw / nullif(beta_meta, 0)),
                   median(abs(beta_ivw - beta_meta) / se_meta),
                   count(*) FILTER (WHERE abs(beta_ivw - beta_meta)
                                          <= 0.01 * abs(beta_meta)),
                   median(se_ivw / nullif(se_meta, 0))
            FROM ivw2 WHERE beta_ivw IS NOT NULL AND {cond}""").fetchone()
        if not r[0]:
            continue
        rows.append({
            "subset": name, "rows": r[0], "rows_with_an_ivw": r[0],
            "corr_beta": round(r[1], 6), "median_rel_diff": round(r[2], 6),
            "p95_rel_diff": None,
            "median_beta_ratio": round(r[3], 6),
            "median_diff_in_se_units": round(r[4], 6),
            "within_1pct": r[5], "within_0.1pct": None,
            "within_1pct_share": round(r[5] / r[0], 4),
            "corr_se": None, "median_se_ratio": round(r[6], 6),
        })

    # split by how many ancestries actually contributed: a single-ancestry
    # "meta" is a pass-through and should agree exactly, so it separates a
    # formula mismatch from a genuinely different model
    for n in range(1, 5):
        r = con.execute(f"""
            SELECT count(*), corr(beta_ivw, beta_meta),
                   median(abs(beta_ivw - beta_meta) / nullif(abs(beta_meta), 0)),
                   median(abs(beta_ivw - beta_meta) / se_meta),
                   count(*) FILTER (WHERE abs(beta_ivw - beta_meta)
                                          <= 0.01 * abs(beta_meta)),
                   median(se_ivw / nullif(se_meta, 0))
            FROM ivw WHERE beta_ivw IS NOT NULL AND n_anc = {n}""").fetchone()
        if not r[0]:
            continue
        rows.append({
            "subset": f"{n} ancestry group{'s' if n > 1 else ''} contributing",
            "rows": r[0], "rows_with_an_ivw": r[0],
            "corr_beta": round(r[1], 6) if r[1] is not None else None,
            "median_rel_diff": round(r[2], 6) if r[2] is not None else None,
            "p95_rel_diff": None,
            "median_diff_in_se_units": round(r[3], 6) if r[3] is not None else None,
            "within_1pct": r[4], "within_0.1pct": None,
            "within_1pct_share": round(r[4] / r[0], 4),
            "median_beta_ratio": None, "corr_se": None,
            "median_se_ratio": round(r[5], 6) if r[5] is not None else None,
        })

    keys = sorted({k for r in rows for k in r},
                  key=lambda k: list(rows[0]).index(k) if k in rows[0] else 99)
    rows = [{k: r.get(k) for k in keys} for r in rows]
    with open(os.path.join(OUT, "q11_ivw_check.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader(); w.writerows(rows)

    # the worst disagreements, to characterise them rather than just count
    worst = con.execute("""
        SELECT phe_id, rsid, n_anc, beta_meta, se_meta, beta_ivw, se_ivw,
               abs(beta_ivw - beta_meta) / nullif(abs(beta_meta), 0) AS rel
        FROM ivw WHERE beta_ivw IS NOT NULL AND abs(beta_meta) > 0.01
        ORDER BY rel DESC LIMIT 15""").df()
    worst.to_csv(os.path.join(OUT, "q11_ivw_worst.csv"), index=False)

    for r in rows:
        print(f"{r['subset']:<34} n={r['rows']:>9,}  corr={r['corr_beta']}  "
              f"median rel diff={r['median_rel_diff']}  "
              f"within 1%={r['within_1pct_share']:.1%}  "
              f"b ratio={r.get('median_beta_ratio')}  "
              f"se ratio={r['median_se_ratio']}")
    print()
    print(worst.to_string(index=False))
    with open(os.path.join(OUT, "q11_ivw_check.json"), "w") as fh:
        json.dump(rows, fh, indent=1)
    print("\nwrote q11_ivw_check.csv/.json and q11_ivw_worst.csv")


if __name__ == "__main__":
    main()
