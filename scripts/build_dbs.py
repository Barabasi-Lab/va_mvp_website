#!/usr/bin/env python3
"""One-time build of the DuckDB files that back the three pages.

Outputs (into public/data/db/):
  landing_page.duckdb      edges + node_attributes for page 1
  full_associations.duckdb phenotype-SNP associations for pages 2/3

Run:  python3 scripts/build_dbs.py [--full-dataset PATH]
"""
import argparse
import html
import os
import pickle
import shutil
import sys
import time

import duckdb

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "public", "data")
DB_DIR = os.path.join(DATA, "db")
DESKTOP = os.path.dirname(REPO)

EDGELIST_CSV = os.path.join(DATA, "edgelist_updated_scaled.csv")
NODE_ATTRS_CSV = os.path.join(DATA, "node_attributes.csv")
LABELS_PKL = os.path.join(DESKTOP, "phenotype_labels.pkl")

ANCESTRIES = ["META", "EUR", "AFR", "AMR", "EAS"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def build_phenotype_map():
    """node_attributes.id  ->  the phenotype code(s) in the raw dataset.

    The join goes through the display label. Five nodes are the union of two
    source phenotype codes (verified: their rsid sets match the union exactly),
    so this is deliberately one-to-many.
    """
    with open(LABELS_PKL, "rb") as fh:
        code_to_label = pickle.load(fh)

    label_to_codes = {}
    for code, label in code_to_label.items():
        if not isinstance(label, str):
            continue
        label_to_codes.setdefault(label.strip(), []).append(code)

    con = duckdb.connect()
    rows = con.sql(f"SELECT id, label FROM read_csv_auto('{NODE_ATTRS_CSV}')").fetchall()
    con.close()

    pairs, unmapped = [], []
    for node_id, label in rows:
        # node_attributes stores a couple of labels HTML-escaped ("&#38;")
        key = html.unescape(label or "").strip()
        codes = label_to_codes.get(key)
        if not codes:
            unmapped.append((node_id, label))
            continue
        for code in codes:
            pairs.append((str(node_id), code))
    return pairs, unmapped


def build_landing_page():
    out = os.path.join(DB_DIR, "landing_page.duckdb")
    if os.path.exists(out):
        os.remove(out)
    con = duckdb.connect(out)
    log("landing_page: loading edgelist")
    con.execute(
        f"CREATE TABLE edges AS SELECT * FROM read_csv_auto('{EDGELIST_CSV}', header=true)"
    )
    con.execute("ALTER TABLE edges ALTER source TYPE VARCHAR")
    con.execute("ALTER TABLE edges ALTER target TYPE VARCHAR")
    # Several eas_* columns are empty for every edge, so the sniffer types them
    # as VARCHAR. Force every weight column to DOUBLE.
    weight_cols = [
        r[0] for r in con.sql(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'edges' AND column_name LIKE '%_weight'"
        ).fetchall()
    ]
    for col in weight_cols:
        con.execute(f'ALTER TABLE edges ALTER "{col}" TYPE DOUBLE')
    log("landing_page: loading node_attributes")
    con.execute(
        f"CREATE TABLE node_attributes AS SELECT * FROM read_csv_auto('{NODE_ATTRS_CSV}', header=true)"
    )
    con.execute("ALTER TABLE node_attributes ALTER id TYPE VARCHAR")
    con.execute("CREATE INDEX idx_edges_source ON edges(source)")
    con.execute("CREATE INDEX idx_edges_target ON edges(target)")
    con.execute("CREATE UNIQUE INDEX idx_node_id ON node_attributes(id)")
    n_e = con.sql("SELECT count(*) FROM edges").fetchone()[0]
    n_n = con.sql("SELECT count(*) FROM node_attributes").fetchone()[0]
    con.close()
    log(f"landing_page: {n_e} edges, {n_n} nodes -> {out}")


def build_full_associations(full_dataset):
    # Built in a scratch DuckDB file, then exported to Parquet. A single
    # .duckdb (358 MB) or single Parquet (140 MB) both exceed GitHub's 100 MB
    # per-file limit; partitioning by chromosome keeps the largest shard at
    # ~34 MB so the data can ship as ordinary repo files, with no Git LFS and
    # no Railway volume. DuckDB queries the partitioned set directly and the
    # cost over an indexed table is ~30 ms.
    scratch = os.path.join(DB_DIR, "_build.duckdb")
    for stale in (scratch, scratch + ".wal"):
        if os.path.exists(stale):
            os.remove(stale)
    con = duckdb.connect(scratch)
    con.execute("PRAGMA memory_limit='6GB'")
    con.execute(f"PRAGMA temp_directory='{DB_DIR}/tmp'")

    pairs, unmapped = build_phenotype_map()
    log(f"phenotype map: {len(pairs)} (node_id, code) pairs; {len(unmapped)} nodes unmapped")
    for node_id, label in unmapped:
        log(f"  UNMAPPED node {node_id}: {label!r}")

    con.execute("CREATE TABLE phenotype_map (phe_id VARCHAR, phenotype VARCHAR)")
    con.executemany("INSERT INTO phenotype_map VALUES (?, ?)", pairs)

    # node metadata is duplicated here so pages 2/3 need only one DB attached
    log("full_associations: loading node_attributes")
    con.execute(
        f"""CREATE TABLE node_attributes AS
            SELECT CAST(id AS VARCHAR) AS id, label, phenotype_category, hex, degree, size
            FROM read_csv_auto('{NODE_ATTRS_CSV}', header=true)"""
    )

    cols = ", ".join(
        f"TRY_CAST(\"pval.{a}\" AS DOUBLE) AS \"pval.{a.lower()}\", "
        f"TRY_CAST(\"beta.{a}\" AS DOUBLE) AS \"beta.{a.lower()}\", "
        f"TRY_CAST(\"se.{a}\" AS DOUBLE) AS \"se.{a.lower()}\""
        for a in ANCESTRIES
    )
    # src_row preserves the raw file's row order. Page 2 ranks a phenotype's
    # SNPs by p-value and keeps the top 150; ties at that boundary are common,
    # and the legacy CSVs broke them by row order. Ordering by
    # (pval, phenotype, src_row) reproduces that exactly - the legacy per-node
    # files are each code's rows in file order, codes concatenated
    # alphabetically.
    log("full_associations: loading raw dataset (this takes a few minutes)")
    con.execute("SET preserve_insertion_order=true")
    con.execute(
        f"""CREATE TABLE associations AS
            SELECT m.phe_id,
                   r.phenotype,
                   r.rsid,
                   CAST(r.chrom AS INTEGER) AS chrom,
                   r.src_row,
                   {cols}
            FROM (SELECT row_number() OVER () AS src_row, *
                  FROM read_csv_auto('{full_dataset}', header=true,
                                     all_varchar=true, nullstr='NA')) r
            JOIN phenotype_map m ON m.phenotype = r.phenotype"""
    )
    n = con.sql("SELECT count(*) FROM associations").fetchone()[0]
    log(f"full_associations: {n} rows loaded")

    assoc_dir = os.path.join(DB_DIR, "associations")
    shutil.rmtree(assoc_dir, ignore_errors=True)
    log("full_associations: writing partitioned parquet")
    # clustering by phe_id keeps a node's rows in few row groups
    con.execute(
        f"""COPY (SELECT * FROM associations ORDER BY phe_id, rsid)
            TO '{assoc_dir}'
            (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 9,
             PARTITION_BY (chrom), OVERWRITE_OR_IGNORE)"""
    )
    con.execute(
        f"""COPY (SELECT * FROM node_attributes)
            TO '{os.path.join(DB_DIR, 'node_attributes.parquet')}'
            (FORMAT parquet, COMPRESSION zstd)"""
    )
    con.close()
    os.remove(scratch)
    if os.path.exists(scratch + ".wal"):
        os.remove(scratch + ".wal")

    shards = [
        os.path.join(root, f)
        for root, _, files in os.walk(assoc_dir) for f in files if f.endswith(".parquet")
    ]
    log(f"full_associations -> {assoc_dir}: {len(shards)} shards, "
        f"{sum(os.path.getsize(s) for s in shards) / 1e6:.1f} MB total, "
        f"largest {max(os.path.getsize(s) for s in shards) / 1e6:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full-dataset", default=os.path.join(DESKTOP, "full_dataset.csv"))
    ap.add_argument("--skip-landing", action="store_true")
    ap.add_argument("--skip-full", action="store_true")
    args = ap.parse_args()

    os.makedirs(DB_DIR, exist_ok=True)
    if not args.skip_landing:
        build_landing_page()
    if not args.skip_full:
        if not os.path.exists(args.full_dataset):
            sys.exit(f"missing raw dataset: {args.full_dataset}")
        build_full_associations(args.full_dataset)
        shutil.rmtree(os.path.join(DB_DIR, "tmp"), ignore_errors=True)

    total = 0
    for root, _, files in os.walk(DB_DIR):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    log(f"public/data/db total: {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
