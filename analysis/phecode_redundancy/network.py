"""Network construction, matching what the site shows.

Edges are recomputed from the association store rather than read off
`edgelist_updated_scaled.csv`, because those weights are scaled (ESRD's 86 AFR
edges sum to 39.58) and A3 needs raw shared-SNP counts. Edge *presence* was
checked against the served edgelist and agrees exactly: ESRD has 86 AFR and
142 EUR neighbours either way.

No promiscuous-SNP filter is applied. The shipped pipeline has none - 4,552
SNPs appear in >40 phenotypes - and the manuscript text is being revised to
drop the claim, so the site as deployed is the reference.
"""
from __future__ import annotations

import duckdb

ANCESTRIES = ("meta", "eur", "afr", "amr", "eas")


def connect(db_dir: str) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute(
        "CREATE VIEW assoc AS SELECT * FROM read_parquet("
        f"'{db_dir}/associations/chrom=*/*.parquet', hive_partitioning = true)")
    return con


def best_rows(con: duckdb.DuckDBPyConnection, ancestry: str, pmax: float) -> str:
    """One row per (phenotype, SNP) for this ancestry, keeping the strongest
    association. Merged phenotypes carry two source codes and so two rows per
    SNP; collapsing here stops them being double counted."""
    name = f"best_{ancestry}"
    con.execute(f"DROP TABLE IF EXISTS {name}")
    con.execute(f"""
        CREATE TEMP TABLE {name} AS
        SELECT phe_id, rsid, any_value(chrom) AS chrom,
               min("pval.{ancestry}") AS pval,
               arg_min("beta.{ancestry}", "pval.{ancestry}") AS beta
        FROM assoc
        WHERE "pval.{ancestry}" IS NOT NULL AND "pval.{ancestry}" < {pmax}
          AND "beta.{ancestry}" IS NOT NULL AND abs("beta.{ancestry}") > 0.01
        GROUP BY phe_id, rsid
    """)
    return name


def ego_edges(con, table: str, node: str):
    """Neighbours of `node`: shared SNPs, split by direction of effect.

    Synergistic = the two betas share a sign, antagonistic = they differ,
    which is the same rule the site uses to colour links.
    """
    return con.execute(f"""
        SELECT n.phe_id AS neighbor,
               count(*) AS weight,
               count(*) FILTER (WHERE sign(c.beta) = sign(n.beta)) AS synergistic,
               count(*) FILTER (WHERE sign(c.beta) <> sign(n.beta)) AS antagonistic,
               list(c.rsid) AS rsids
        FROM {table} c
        JOIN {table} n USING (rsid)
        WHERE c.phe_id = ? AND n.phe_id <> ?
        GROUP BY n.phe_id
        ORDER BY weight DESC
    """, [node, node]).fetchall()


def all_edges(con, table: str):
    """Every phenotype pair sharing at least one SNP, with direction counts."""
    return con.execute(f"""
        SELECT a.phe_id AS p1, b.phe_id AS p2,
               count(*) AS weight,
               count(*) FILTER (WHERE sign(a.beta) = sign(b.beta)) AS synergistic,
               count(*) FILTER (WHERE sign(a.beta) <> sign(b.beta)) AS antagonistic
        FROM {table} a
        JOIN {table} b USING (rsid)
        WHERE a.phe_id < b.phe_id
        GROUP BY a.phe_id, b.phe_id
    """).fetchall()
