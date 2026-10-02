"""Shared machinery for the two worked examples (ESRD and iron deficiency anemia).

Read-only with respect to production: opens the association Parquet and the
landing-page edgelist, writes only into results/.

Definitions used throughout, per the task:
  significant    p < PRIMARY_THRESHOLD for that phenotype in that ancestry
  shared         significant in both ancestries
  concordant /   same / opposite sign of beta across two PHENOTYPES
    discordant
  consistent /   same / opposite sign of beta across two ANCESTRIES for the
    inconsistent   same phenotype-SNP pair

The last two pairs are kept distinct everywhere; the manuscript uses them
for different things.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
RESULTS = os.path.join(HERE, "results")

ASSOC_GLOB = os.path.join(REPO, "public", "data", "db", "associations",
                          "chrom=*", "*.parquet")
EDGELIST_CSV = os.path.join(REPO, "public", "data", "edgelist_updated_scaled.csv")
NODE_ATTRS = os.path.join(REPO, "public", "data", "node_attributes.csv")
LANDING_DB = os.path.join(REPO, "public", "data", "db", "landing_page.duckdb")

# the previous task's outputs, reused per P4
PHECODE_DIR = os.path.join(REPO, "analysis", "phecode_redundancy")
SNP_POSITIONS = os.path.join(PHECODE_DIR, "results", "snp_positions.csv")

ESRD = "905"            # phecode 585.32
ANEMIA = "271"          # phecode 280.1
ANCESTRIES = ("afr", "eur", "meta")
PRIMARY_THRESHOLD = 1e-4
SECONDARY_THRESHOLD = 1e-8
BETA_THRESHOLD = 0.01   # the UI's display rule, reported separately
PLEIOTROPY_MAX = 40     # the filter the Supplementary Methods describes
CLUMP_WINDOW = 500_000
SEED = 20261002


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("PRAGMA threads=4")
    con.execute(f"""CREATE VIEW assoc_raw AS SELECT * FROM read_parquet(
                    '{ASSOC_GLOB}', hive_partitioning = true)""")
    con.execute(f"CREATE VIEW edgelist AS SELECT * FROM read_csv('{EDGELIST_CSV}')")
    con.execute(f"CREATE VIEW nodes AS SELECT * FROM read_csv('{NODE_ATTRS}')")
    deduped(con)
    return con


def deduped(con, ancestry: str | None = None) -> None:
    """One row per (phe_id, rsid), as `assoc`.

    P3's rule: exact duplicates collapse to one; where duplicates disagree,
    keep the row with the smallest p-value. "Smallest p" needs an ancestry
    to be meaningful, and the pairs that disagree are rare, so the default
    orders on the META p-value and falls back to src_row - that gives one
    deterministic table the whole report can share. Steps that care about a
    particular ancestry call this again with that ancestry and compare.

    The generating notebook used `~df[['phenotype','rsid']].duplicated()`,
    which keeps whichever row came first in its input. That is not
    reproducible from the store, so it is reported as a deviation rather
    than imitated.
    """
    order = f'coalesce("pval.{ancestry}", 2)' if ancestry else 'coalesce("pval.meta", 2)'
    con.execute(f"""CREATE OR REPLACE TEMP VIEW assoc AS
        SELECT * EXCLUDE (rn) FROM (
          SELECT *, row_number() OVER (PARTITION BY phe_id, rsid
                     ORDER BY {order}, src_row) AS rn
          FROM assoc_raw)
        WHERE rn = 1""")


def significant(ancestry: str, threshold: float, alias: str = "",
                beta_filter: bool = False) -> str:
    """SQL predicate for "significant for this phenotype in this ancestry"."""
    p = f'{alias}"pval.{ancestry}"' if alias else f'"pval.{ancestry}"'
    b = f'{alias}"beta.{ancestry}"' if alias else f'"beta.{ancestry}"'
    out = f"{p} IS NOT NULL AND {p} < {threshold} AND {b} IS NOT NULL"
    if beta_filter:
        out += f" AND abs({b}) > {BETA_THRESHOLD}"
    return out


def md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def provenance() -> dict:
    import platform
    out = {"generated": __import__("datetime").datetime.now(
               __import__("datetime").timezone.utc).isoformat(timespec="seconds"),
           "seed": SEED, "python": platform.python_version(),
           "duckdb": duckdb.__version__, "files": {}}
    for name, path in (("edgelist", EDGELIST_CSV), ("node_attributes", NODE_ATTRS),
                       ("snp_positions", SNP_POSITIONS), ("landing_db", LANDING_DB)):
        out["files"][name] = ({"path": path, "md5": md5(path),
                               "bytes": os.path.getsize(path)}
                              if os.path.exists(path)
                              else {"path": path, "status": "ABSENT"})
    shards = os.path.dirname(os.path.dirname(ASSOC_GLOB))
    out["files"]["association_store"] = {
        "path": shards,
        "shards": len(os.listdir(shards)) if os.path.isdir(shards) else 0}
    return out


def log(message: str) -> None:
    import datetime
    print(f"[{datetime.datetime.now():%H:%M:%S}] {message}", flush=True)


def write_csv(rows, path, fieldnames=None):
    import csv
    if not rows:
        log(f"  (no rows for {os.path.basename(path)})")
        return
    fieldnames = fieldnames or list(rows[0].keys())
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
    log(f"  wrote {os.path.relpath(path, REPO)} ({len(rows):,} rows)")
