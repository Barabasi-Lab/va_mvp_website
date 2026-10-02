#!/usr/bin/env python3
"""Part 2 step 6: the summary panel below 1e-6, against the store.

Before the regeneration these thresholds drew edges that did not exist:
the column values were attached to the wrong phenotype pairs. This checks
what page 1 now reports against a direct recomputation.

    python3 analysis/final/check_slider.py
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "analysis", "examples"))
import duckdb
from common import log, write_csv

con = duckdb.connect()
con.execute("PRAGMA threads=4")
con.execute(f"""CREATE VIEW raw AS SELECT * FROM read_parquet(
    '{os.path.join(REPO, "public/data/db/associations/chrom=*/*.parquet")}',
    hive_partitioning=true)""")
con.execute("""CREATE OR REPLACE TEMP VIEW assoc AS SELECT * EXCLUDE (rn) FROM
    (SELECT *, row_number() OVER (PARTITION BY phe_id,rsid
       ORDER BY coalesce("pval.meta",2), src_row) rn FROM raw) WHERE rn=1""")
con.execute(f"""CREATE VIEW edges AS SELECT * FROM read_csv(
    '{os.path.join(REPO, "public/data/edgelist_updated_scaled.csv")}')""")

rows = []
for anc in ("meta", "eur", "afr"):
    for t in ("1e-08", "1e-10", "1e-12"):
        con.execute(f"""CREATE OR REPLACE TEMP TABLE sig AS
            SELECT CAST(phe_id AS BIGINT) p, rsid, sign("beta.{anc}") sgn FROM assoc
            WHERE "pval.{anc}" < {t} AND "beta.{anc}" IS NOT NULL""")
        store = con.execute("""SELECT count(*), count(DISTINCT x.p) FROM (
            SELECT x.p, y.p q FROM sig x JOIN sig y USING (rsid)
            WHERE x.p < y.p GROUP BY x.p, y.p) x""").fetchone()
        # the panel counts an edge present when either direction carries weight
        panel = con.execute(f"""SELECT count(*) FROM edges
            WHERE "{anc}_{t}_same_dir_weight" <> 0 OR "{anc}_{t}_diff_dir_weight" <> 0""").fetchone()[0]
        nodes = con.execute(f"""SELECT count(DISTINCT n) FROM (
            SELECT source n FROM edges WHERE "{anc}_{t}_same_dir_weight" <> 0
                OR "{anc}_{t}_diff_dir_weight" <> 0
            UNION SELECT target FROM edges WHERE "{anc}_{t}_same_dir_weight" <> 0
                OR "{anc}_{t}_diff_dir_weight" <> 0)""").fetchone()[0]
        store_nodes = con.execute("""SELECT count(DISTINCT n) FROM (
            SELECT x.p n FROM sig x JOIN sig y USING (rsid) WHERE x.p <> y.p
            UNION SELECT y.p FROM sig x JOIN sig y USING (rsid) WHERE x.p <> y.p)""").fetchone()[0]
        rows.append({"ancestry": anc.upper(), "threshold": t,
                     "store_edges": store[0], "edgelist_edges": panel,
                     "edges_match": store[0] == panel,
                     "store_nodes_with_an_edge": store_nodes,
                     "edgelist_nodes_with_an_edge": nodes,
                     "nodes_match": store_nodes == nodes})
        log(f"  {anc.upper()} {t}: store {store[0]:,} edges / {store_nodes} nodes; "
            f"edgelist {panel:,} / {nodes}  "
            f"{'OK' if store[0] == panel and store_nodes == nodes else 'MISMATCH'}")
write_csv(rows, os.path.join(HERE, "results", "slider_below_1e6.csv"))
print("all match" if all(r["edges_match"] and r["nodes_match"] for r in rows) else "MISMATCHES")
