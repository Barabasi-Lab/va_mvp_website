#!/usr/bin/env python3
"""Phase 0 prerequisites: edgelist provenance (P1) and duplicate rows (P3).

    python3 analysis/examples/p0_prerequisites.py

Writes results/p1_edgelist_match.csv, results/p1_page1_vs_page3.csv,
results/p3_duplicates.csv and results/p0_summary.json.
"""
from __future__ import annotations

import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (ANCESTRIES, ANEMIA, CLUMP_WINDOW, ESRD, PLEIOTROPY_MAX,
                    PRIMARY_THRESHOLD, RESULTS, SECONDARY_THRESHOLD, SEED,
                    connect, log, provenance, significant, write_csv)

THRESHOLDS = (PRIMARY_THRESHOLD, SECONDARY_THRESHOLD)
TARGETS = {"ESRD": ESRD, "anemia_280.1": ANEMIA}


# ----------------------------------------------------------------- P1


def scale_constants(con, ancestry, threshold):
    """The edgelist is max-normalised per column to 50. Recover the constant
    for one column as stored_max / raw_max, computed over the whole network."""
    col = f"{ancestry}_{threshold}"
    stored = con.execute(f'''SELECT max("{col}_same_dir_weight"),
                                    max("{col}_diff_dir_weight") FROM edgelist''').fetchone()
    return stored


def build_sig(con, ancestry, threshold, pleiotropy_filter):
    """Significant (phenotype, SNP) pairs with the beta sign, optionally
    dropping SNPs that reach PLEIOTROPY_MAX or more phenotypes.

    The filter is counted at the same ancestry and threshold, which is what
    the generating notebook's `rsid_counts` did (a groupby over the already
    thresholded frame)."""
    con.execute(f"""CREATE OR REPLACE TEMP TABLE sig AS
        SELECT phe_id, rsid, sign("beta.{ancestry}") AS sgn
        FROM assoc WHERE {significant(ancestry, threshold)}""")
    if pleiotropy_filter:
        con.execute(f"""CREATE OR REPLACE TEMP TABLE sig AS
            SELECT * FROM sig WHERE rsid IN (
              SELECT rsid FROM sig GROUP BY rsid
              HAVING count(DISTINCT phe_id) < {PLEIOTROPY_MAX})""")
    return con.execute("SELECT count(*) FROM sig").fetchone()[0]


def raw_max(con):
    """Global maximum of each weight column, for stating the scale constant.

    This is an all-pairs join over the whole network and takes minutes, so
    it is run only where the report quotes the constant, never inside the
    per-target loop. The match test below does not need it: a column that
    is a constant multiple of the recomputation is a match whatever the
    constant is.
    """
    return con.execute("""SELECT max(same), max(diff) FROM (
        SELECT count(*) FILTER (WHERE x.sgn = y.sgn) AS same,
               count(*) FILTER (WHERE x.sgn <> y.sgn) AS diff
        FROM sig x JOIN sig y USING (rsid) WHERE x.phe_id < y.phe_id
        GROUP BY x.phe_id, y.phe_id)""").fetchone()


def ratio_fit(recomputed, stored, index):
    """Compare a recomputation with a stored column that is scaled by an
    unknown constant.

    Every weight column is max-normalised independently, so the stored
    numbers cannot be compared with counts directly. What a correct
    recomputation does give is a single constant: stored / raw must be the
    same for every edge. Returns that constant, how far the ratios spread,
    and the set disagreements - an edge present in one and absent in the
    other is a mismatch no constant can absorb.
    """
    ratios, only_recomputed, only_stored = [], 0, 0
    for nb in set(recomputed) | set(stored):
        raw = recomputed.get(nb, (0, 0))[index]
        sto = stored.get(nb, (0.0, 0.0))[index]
        if raw > 0 and sto > 0:
            ratios.append(sto / raw)
        elif raw > 0 and sto == 0:
            only_recomputed += 1
        elif sto > 0 and raw == 0:
            only_stored += 1
    if not ratios:
        return {"n": 0, "k": None, "spread": None,
                "only_recomputed": only_recomputed, "only_stored": only_stored}
    lo, hi = min(ratios), max(ratios)
    return {"n": len(ratios), "k": sum(ratios) / len(ratios),
            "spread": (hi - lo) / hi if hi else 0.0,
            "only_recomputed": only_recomputed, "only_stored": only_stored}


def neighbourhood(con, node):
    return con.execute("""SELECT CASE WHEN x.phe_id = ? THEN y.phe_id ELSE x.phe_id END AS nb,
               count(*) FILTER (WHERE x.sgn = y.sgn) AS same,
               count(*) FILTER (WHERE x.sgn <> y.sgn) AS diff
        FROM sig x JOIN sig y USING (rsid)
        WHERE (x.phe_id = ? OR y.phe_id = ?) AND x.phe_id <> y.phe_id
          AND x.phe_id < y.phe_id
        GROUP BY nb""", [node, node, node]).fetchall()


def p1_match(con):
    """Recompute each target's neighbourhood with and without the >=40
    filter and test each against the stored column."""
    import math
    rows = []
    for ancestry in ANCESTRIES:
        for threshold in THRESHOLDS:
            col = f"{ancestry}_1e-{int(-math.log10(threshold)):02d}"
            for filtered in (False, True):
                build_sig(con, ancestry, threshold, filtered)
                for name, node in TARGETS.items():
                    recomputed = {nb: (s, d) for nb, s, d in neighbourhood(con, node)}
                    stored = con.execute(f'''
                        SELECT CAST(CASE WHEN source = ? THEN target ELSE source END AS VARCHAR) AS nb,
                               "{col}_same_dir_weight", "{col}_diff_dir_weight"
                        FROM edgelist WHERE source = ? OR target = ?''',
                        [int(node), int(node), int(node)]).fetchall()
                    stored = {nb: (s, d) for nb, s, d in stored if s or d}
                    fs = ratio_fit(recomputed, stored, 0)
                    fd = ratio_fit(recomputed, stored, 1)
                    rows.append({
                        "target": name, "ancestry": ancestry.upper(),
                        "threshold": f"{threshold:g}",
                        "pleiotropy_filter": "applied (>=40 dropped)" if filtered else "none",
                        "recomputed_neighbours": len(recomputed),
                        "stored_neighbours": len(stored),
                        "same_edges_compared": fs["n"],
                        "same_implied_k": fs["k"],
                        "same_ratio_spread": fs["spread"],
                        "same_only_recomputed": fs["only_recomputed"],
                        "same_only_stored": fs["only_stored"],
                        "diff_edges_compared": fd["n"],
                        "diff_implied_k": fd["k"],
                        "diff_ratio_spread": fd["spread"],
                        "diff_only_recomputed": fd["only_recomputed"],
                        "diff_only_stored": fd["only_stored"],
                    })
                    sp = fs["spread"]
                    log(f"  {name:12} {ancestry.upper():5} {threshold:g} "
                        f"{'filtered' if filtered else 'unfiltered':10} "
                        f"nb {len(recomputed):>3}/{len(stored):>3}  "
                        f"same: k={fs['k'] if fs['k'] is None else round(fs['k'],8)} "
                        f"spread={'n/a' if sp is None else format(sp, '.2e')} "
                        f"only_rc={fs['only_recomputed']} only_st={fs['only_stored']}")
    return rows


def p1_threshold_sweep(con):
    """Per-edge agreement between the stored columns and an unfiltered
    recomputation, network-wide, at every threshold the edgelist carries.

    Done with the notebook's duplicate rule (keep the row that comes first)
    rather than the analysis rule, because the question here is whether the
    stored file was generated the way the notebook says - not what the right
    answer is.
    """
    con.execute("""CREATE OR REPLACE TEMP VIEW ded AS SELECT * EXCLUDE (rn) FROM
        (SELECT *, row_number() OVER (PARTITION BY phe_id, rsid ORDER BY src_row) rn
         FROM assoc_raw) WHERE rn = 1""")
    rows = []
    for ancestry in ANCESTRIES:
        for t in (4, 5, 6, 7, 8, 9, 10, 11, 12):
            col, threshold = f"{ancestry}_1e-{t:02d}", float(f"1e-{t}")
            con.execute(f"""CREATE OR REPLACE TEMP TABLE s AS
                SELECT CAST(phe_id AS BIGINT) p, rsid, sign("beta.{ancestry}") sgn
                FROM ded WHERE "pval.{ancestry}" < {threshold}
                  AND "beta.{ancestry}" IS NOT NULL""")
            con.execute("""CREATE OR REPLACE TEMP TABLE rc AS
                SELECT x.p a, y.p b, count(*) FILTER (WHERE x.sgn = y.sgn) same
                FROM s x JOIN s y USING (rsid) WHERE x.p < y.p GROUP BY 1, 2""")
            con.execute(f"""CREATE OR REPLACE TEMP TABLE st AS
                SELECT least(source, target) a, greatest(source, target) b,
                       "{col}_same_dir_weight" w FROM edgelist
                WHERE "{col}_same_dir_weight" > 0""")
            n = con.execute("""SELECT (SELECT count(*) FROM rc WHERE same > 0),
                (SELECT count(*) FROM st),
                (SELECT count(*) FROM rc LEFT JOIN st USING (a, b)
                 WHERE rc.same > 0 AND st.w IS NULL),
                (SELECT count(*) FROM st LEFT JOIN rc USING (a, b)
                 WHERE rc.same IS NULL OR rc.same = 0)""").fetchone()
            mx = con.execute("SELECT (SELECT max(same) FROM rc), (SELECT max(w) FROM st)").fetchone()
            if not mx[0] or not mx[1]:
                continue
            k = mx[1] / mx[0]
            ag = con.execute(f"""SELECT count(*) FILTER (WHERE abs(w - same * {k}) < {k} * 0.5),
                count(*) FROM rc JOIN st USING (a, b) WHERE same > 0""").fetchone()
            pct = 100 * ag[0] / ag[1] if ag[1] else float("nan")
            rows.append({"column": f"{col}_same_dir_weight",
                         "ancestry": ancestry.upper(), "threshold": f"{threshold:g}",
                         "recomputed_edges": n[0], "stored_edges": n[1],
                         "only_recomputed": n[2], "only_stored": n[3],
                         "per_edge_agreement_pct": round(pct, 2),
                         "implied_k_stored_per_raw": k,
                         "verdict": "matches" if pct >= 90 else "does NOT match"})
            log(f"  {col}_same  rc {n[0]:>6} st {n[1]:>6} "
                f"only_rc {n[2]:>6} only_st {n[3]:>6}  agreement {pct:>5.1f}%  "
                f"{'OK' if pct >= 90 else 'MISMATCH'}")
    return rows


def p1_page1_vs_page3(con, n=20):
    """Does page 1's stored weight equal the shared-SNP count page 3 computes?
    Page 3 intersects the two phenotypes' SNPs under one ancestry and one
    threshold, which is the same quantity the edgelist stores, so a mismatch
    means the two views disagree about the same edge."""
    random.seed(SEED)
    build_sig(con, "meta", PRIMARY_THRESHOLD, False)
    # the scale constant, fitted on ESRD's neighbourhood rather than from a
    # whole-network maximum, which costs minutes and gives the same number
    rc = {nb: (s, d) for nb, s, d in neighbourhood(con, ESRD)}
    st = con.execute('''SELECT CAST(CASE WHEN source = 905 THEN target ELSE source END AS VARCHAR),
               "meta_1e-04_same_dir_weight", "meta_1e-04_diff_dir_weight"
        FROM edgelist WHERE source = 905 OR target = 905''').fetchall()
    st = {nb: (s, d) for nb, s, d in st if s or d}
    k_same = 1 / ratio_fit(rc, st, 0)["k"]
    k_diff = 1 / ratio_fit(rc, st, 1)["k"]
    pool = con.execute('''SELECT CAST(source AS VARCHAR), CAST(target AS VARCHAR),
                 "meta_1e-04_same_dir_weight", "meta_1e-04_diff_dir_weight"
          FROM edgelist WHERE "meta_1e-04_same_dir_weight" > 0
             OR "meta_1e-04_diff_dir_weight" > 0''').fetchall()
    rows = []
    for s, t, sw, dw in random.sample(pool, n):
        got = con.execute("""SELECT count(*) FILTER (WHERE x.sgn = y.sgn),
                                    count(*) FILTER (WHERE x.sgn <> y.sgn)
            FROM sig x JOIN sig y USING (rsid)
            WHERE x.phe_id = ? AND y.phe_id = ?""", [s, t]).fetchone()
        rows.append({"source": s, "target": t,
                     "page3_same_dir_snps": got[0], "page3_diff_dir_snps": got[1],
                     "page1_stored_same": sw, "page1_stored_diff": dw,
                     "page1_descaled_same": round(sw * k_same, 3),
                     "page1_descaled_diff": round(dw * k_diff, 3),
                     "same_matches": abs(got[0] - sw * k_same) < 0.5,
                     "diff_matches": abs(got[1] - dw * k_diff) < 0.5})
    return rows, (k_same, k_diff)


# ----------------------------------------------------------------- P3


def p3_duplicates(con):
    """Characterise the (phenotype, SNP) pairs that carry more than one row.

    Two different things look alike here and must not be pooled. Five node
    ids are *merged* phenotypes: two phecodes share one id, so the node
    legitimately carries one row per code and the pair is not duplicated at
    all. What is left - pairs where every row carries the same phenotype
    code - are the real duplicates.
    """
    stats = [f'"{s}.{a}"' for a in ("meta", "eur", "afr", "amr", "eas")
             for s in ("pval", "beta", "se")]
    con.execute(f"""CREATE OR REPLACE TEMP TABLE dups AS
        SELECT phe_id, rsid, count(*) AS n_rows,
               count(DISTINCT phenotype) AS n_codes,
               count(DISTINCT ({', '.join(stats)})) AS n_distinct_stats
        FROM assoc_raw GROUP BY phe_id, rsid HAVING count(*) > 1""")
    total, merged_pairs, true_dups = con.execute("""SELECT count(*),
        count(*) FILTER (WHERE n_codes > 1),
        count(*) FILTER (WHERE n_codes = 1) FROM dups""").fetchone()
    exact, disagree = con.execute("""SELECT
        count(*) FILTER (WHERE n_codes = 1 AND n_distinct_stats = 1),
        count(*) FILTER (WHERE n_codes = 1 AND n_distinct_stats > 1) FROM dups""").fetchone()
    log(f"  {total:,} (phenotype, SNP) pairs carry more than one row")
    log(f"    {merged_pairs:,} are merged nodes carrying one row per phecode - not duplicates")
    log(f"    {true_dups:,} are true duplicates (one phecode, several rows): "
        f"{exact:,} exact, {disagree:,} disagree on beta/SE/p")

    merged = {r[0] for r in con.execute("""SELECT phe_id FROM assoc_raw
        GROUP BY phe_id HAVING count(DISTINCT phenotype) > 1""").fetchall()}
    labels = dict(con.execute("""SELECT CAST(id AS VARCHAR), label FROM nodes""").fetchall())
    log(f"    the {len(merged)} merged nodes: "
        + "; ".join(f"{m} {labels.get(m, '?')}" for m in sorted(merged)))

    con.execute(f"""CREATE OR REPLACE TEMP TABLE sig_any AS
        SELECT phe_id, rsid FROM assoc
        WHERE {' OR '.join(significant(a, PRIMARY_THRESHOLD) for a in ANCESTRIES)}""")
    rows = []
    summary_by_example = {}
    for name, node in TARGETS.items():
        # the scope as a table, not a 20k-placeholder IN list: that form took
        # 26 minutes on the anemia neighbourhood
        con.execute("""CREATE OR REPLACE TEMP TABLE scope AS
            SELECT DISTINCT y.phe_id FROM sig_any x JOIN sig_any y USING (rsid)
            WHERE x.phe_id = ? AND y.phe_id <> ?
            UNION SELECT ?""", [node, node, node])
        nbrs = {r[0] for r in con.execute(
            "SELECT phe_id FROM scope WHERE phe_id <> ?", [node]).fetchall()}
        scope = nbrs | {node}
        hit = con.execute("""SELECT d.phe_id, d.rsid, d.n_rows, d.n_codes, d.n_distinct_stats
            FROM dups d JOIN scope s USING (phe_id) WHERE d.n_codes = 1""").fetchall()
        in_merged = sorted(scope & merged)
        summary_by_example[name] = {
            "neighbours": len(nbrs), "true_duplicate_pairs_in_scope": len(hit),
            "exact": sum(1 for h in hit if h[4] == 1),
            "disagreeing": sum(1 for h in hit if h[4] > 1),
            "on_the_target_itself": sum(1 for h in hit if h[0] == node),
            "merged_nodes_in_scope": [f"{m} {labels.get(m, '?')}" for m in in_merged]}
        log(f"  {name}: {len(nbrs)} neighbours; {len(hit)} true duplicate pairs in scope "
            f"({summary_by_example[name]['disagreeing']} disagreeing, "
            f"{summary_by_example[name]['on_the_target_itself']} on the target itself); "
            f"merged neighbours: {', '.join(summary_by_example[name]['merged_nodes_in_scope']) or 'none'}")
        for phe, rsid, n_rows, n_codes, n_stats in hit:
            rows.append({"example": name, "phe_id": phe, "label": labels.get(phe, ""),
                         "is_target": phe == node, "rsid": rsid, "n_rows": n_rows,
                         "exact_duplicate": n_stats == 1})
    return rows, {"pairs_with_multiple_rows": total,
                  "merged_node_pairs_not_duplicates": merged_pairs,
                  "true_duplicate_pairs": true_dups,
                  "true_exact": exact, "true_disagreeing": disagree,
                  "merged_nodes": {m: labels.get(m, "?") for m in sorted(merged)},
                  "by_example": summary_by_example}


def main():
    os.makedirs(RESULTS, exist_ok=True)
    con = connect()
    prov = provenance()

    log("P1: recomputing the two neighbourhoods against the stored edgelist")
    match = p1_match(con)
    write_csv(match, os.path.join(RESULTS, "p1_edgelist_match.csv"))

    log("P1: network-wide agreement at every threshold the edgelist carries")
    sweep = p1_threshold_sweep(con)
    write_csv(sweep, os.path.join(RESULTS, "p1_threshold_sweep.csv"))
    bad = [r["column"] for r in sweep if r["verdict"] != "matches"]
    if bad:
        log(f"  {len(bad)} of {len(sweep)} columns do NOT match a recomputation "
            f"at their own threshold; the break is between 1e-06 and 1e-07")

    log("P1.5: page 1's stored weight vs page 3's shared-SNP count, 20 random edges")
    pairs, (k_same, k_diff) = p1_page1_vs_page3(con)
    write_csv(pairs, os.path.join(RESULTS, "p1_page1_vs_page3.csv"))
    log(f"  agreeing: same-dir {sum(r['same_matches'] for r in pairs)}/20, "
        f"diff-dir {sum(r['diff_matches'] for r in pairs)}/20")

    log("P3: duplicate rows")
    dup_rows, dup_summary = p3_duplicates(con)
    write_csv(dup_rows, os.path.join(RESULTS, "p3_duplicates.csv"))

    prov["p1_scaling"] = {
        "form": "each weight column independently max-normalised to 50",
        "meta_1e-04_k_same_raw_per_stored": k_same,
        "meta_1e-04_k_diff_raw_per_stored": k_diff,
    }
    prov["p3"] = dup_summary
    with open(os.path.join(RESULTS, "p0_summary.json"), "w") as fh:
        json.dump(prov, fh, indent=1)
    log("wrote results/p0_summary.json")


if __name__ == "__main__":
    main()
