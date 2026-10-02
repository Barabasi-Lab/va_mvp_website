#!/usr/bin/env python3
"""Check that the endpoints pick the SNPs the ranking rule says they should.

validate_pages.js compares the served rows against the legacy CSVs, but it can
no longer check *which* SNPs get picked: ranking is by |beta/se| and the legacy
per-node CSVs have no se column. This recomputes the expected selection from
the Parquet in pandas-free Python, independently of the server's SQL, and
diffs it against what the endpoint returns.

Usage: python3 scripts/validate_ranking.py [baseUrl]
"""
import json
import os
import sys
import urllib.parse
import urllib.request

import duckdb

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(REPO, "public", "data", "db")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"

TOP_SNPS = 150        # page 2, must match server.js
PAGE3_LIMIT = 250     # page 3 default


def connect():
    con = duckdb.connect()
    con.execute(
        "CREATE VIEW associations AS SELECT * FROM read_parquet("
        f"'{os.path.join(DB_DIR, 'associations', 'chrom=*', '*.parquet')}',"
        " hive_partitioning = true)")
    return con


def get(route, params):
    url = f"{BASE}{route}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url) as fh:
        return json.load(fh)


# Which statistic the server ranks by. Mirrors RANK_METRIC in server.js,
# including its default, so this checks the selection the site actually
# makes rather than one particular setting.
RANK_METRIC = os.environ.get("RANK_METRIC", "pval").lower()


def strength_sql(a):
    if RANK_METRIC == "pval":
        # -log10(p), with p = 0 the strongest, as server.js does
        return (f'CASE WHEN "pval.{a}" IS NULL THEN -1 '
                f'WHEN "pval.{a}" <= 0 THEN 1e308 '
                f'ELSE -log10("pval.{a}") END')
    return f'coalesce(abs("beta.{a}" / "se.{a}"), -1)'


def rows_for(con, phe_id, ancestries):
    """(rsid, src_row, [strength per ancestry]) for one phenotype, rows with
    a usable beta in every requested ancestry."""
    zs = ", ".join(strength_sql(a) for a in ancestries)
    where = " AND ".join(f'"beta.{a}" IS NOT NULL' for a in ancestries)
    return con.execute(
        f"SELECT rsid, src_row, {zs} FROM associations "
        f"WHERE phe_id = ? AND {where}", [phe_id]).fetchall()


def expected_page2(con, node, a1, a2=None):
    ancestries = [a1] + ([a2] if a2 else [])
    rows = rows_for(con, node, ancestries)
    # strength = the weakest supporting ancestry; ties broken by source order
    ranked = sorted(
        rows,
        key=lambda r: (-min(z if z is not None else -1 for z in r[2:]), r[1]))
    # the cap counts distinct SNPs, not rows: merged phenotypes carry two rows
    # per SNP and used to lose slots to their own duplicates
    out, seen = [], set()
    for r in ranked:
        if r[0] not in seen:
            seen.add(r[0])
            out.append(r[0])
            if len(out) == TOP_SNPS:
                break
    return set(out)


def expected_page3(con, left, right, a1, a2=None):
    ancestries = [a1] + ([a2] if a2 else [])
    per = {}
    for phe in (left, right):
        for rsid, _src, *zs in rows_for(con, phe, ancestries):
            vals = [z if z is not None else -1.0 for z in zs]
            cur = per.setdefault(rsid, {})
            # min over this phenotype's rows, per ancestry
            cur[phe] = [min(v, w) for v, w in zip(cur.get(phe, vals), vals)]
    shared = {r for r, d in per.items() if len(d) == 2}
    # weakest across both phenotypes and both ancestries
    def key(r):
        both = per[r]
        return -min(min(both[left]), min(both[right])), r
    return set(sorted(shared, key=key)[:PAGE3_LIMIT])


def main():
    con = connect()
    ok = True

    cases2 = [('739', 'eur', None), ('264', 'meta', None), ('708', 'meta', None),
              ('230', 'eur', None), ('87', 'meta', None), ('181', 'meta', None),
              ('264', 'meta', 'eur'), ('739', 'eur', 'meta'), ('230', 'eur', 'afr')]
    for node, a1, a2 in cases2:
        params = {'node': node, 'ancestry': a1}
        if a2:
            params['ancestry2'] = a2
        got = {r['rsid'] for r in get('/api/page2/rows', params)['rows']}
        want = expected_page2(con, node, a1, a2)
        miss, extra = want - got, got - want
        good = not miss and not extra
        ok &= good
        label = f"page2 {node} {a1}" + (f"+{a2}" if a2 else "")
        print(f"{'OK  ' if good else 'FAIL'} {label:26} expected {len(want):>4} "
              f"got {len(got):>4}" + ("" if good else f"  -{len(miss)}/+{len(extra)}"))

    cases3 = [('739', '741', 'eur', None), ('230', '229', 'meta', None),
              ('708', '236', 'meta', None), ('739', '741', 'eur', 'meta')]
    for left, right, a1, a2 in cases3:
        params = {'left': left, 'right': right, 'ancestry': a1}
        if a2:
            params['ancestry2'] = a2
        got = {r['rsid'] for r in get('/api/page3/rows', params)['rows']}
        want = expected_page3(con, left, right, a1, a2)
        miss, extra = want - got, got - want
        good = not miss and not extra
        ok &= good
        label = f"page3 {left}-{right} {a1}" + (f"+{a2}" if a2 else "")
        print(f"{'OK  ' if good else 'FAIL'} {label:26} expected {len(want):>4} "
              f"got {len(got):>4}" + ("" if good else f"  -{len(miss)}/+{len(extra)}"))

    print("ALL MATCH" if ok else "MISMATCHES PRESENT")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
