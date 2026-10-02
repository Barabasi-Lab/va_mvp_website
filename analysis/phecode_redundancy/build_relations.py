#!/usr/bin/env python3
"""Build the relation data the hierarchy-mask toggle needs (Part B).

Two implementation candidates need two different shapes of data:

  Option 1, precomputed attribute
    edge_relations.parquet   one row per landing-page edge, with a tier
                             bitmask; the server attaches it to
                             /api/landing/edges and the client filters on it.
    pair_relations.parquet   every *related* node pair, sparse. Page 2's
                             outer ring is not drawn from the landing
                             edgelist, so the per-edge file cannot cover it.

  Option 2, client-side rule
    node_phecodes.json       node id -> phecode strings, so the browser can
                             apply the truncation rule itself. T1/T2 only.
    pair_relations_t34.json  the separate lookup Option 2 needs for T3/T4 -
                             neither is derivable from the code strings -
                             kept apart so its size can be measured alone.

Bit positions match public/js/phecode-relations.js:
    T1 = 1, T2 = 2, T3 = 4, T4 = 8, UNCLASSIFIABLE = 16

The tier list written into each file says which tiers it can answer, so a
client without the definitions file reports T3 as unanswered rather than as
"not related".

Writes only into public/data/db/ as new files. The precomputed network files
themselves (landing_page.duckdb, node_attributes.parquet, the association
shards) are opened read-only and never modified.

Usage: python3 analysis/phecode_redundancy/build_relations.py
"""
from __future__ import annotations

import json
import os
import sys

import duckdb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import network
from phecode_relations import PhecodeRelations
from run_analysis import DB_DIR, ICD_MAP, DEFINITIONS, load_meta, log

T1, T2, T3, T4, UNCLASSIFIABLE = 1, 2, 4, 8, 16
OUT_DIR = DB_DIR
LANDING = os.path.join(DB_DIR, "landing_page.duckdb")


def pair_mask(rel, m1, m2) -> int:
    """Bitmask over every combination of the two nodes' source codes.

    A merged node carries more than one phecode and the pair counts as
    related if any combination is.
    """
    if not m1["phecodes"] or not m2["phecodes"]:
        return UNCLASSIFIABLE
    mask = 0
    for a in m1["phecodes"]:
        for b in m2["phecodes"]:
            r = rel.classify(a, b)
            if r.t1:
                mask |= T1
            if r.t2:
                mask |= T2
            if r.t3:
                mask |= T3
            if r.t4:
                mask |= T4
    return mask


def main():
    rel = PhecodeRelations(ICD_MAP, DEFINITIONS)
    tiers = ["T1", "T2", "T4"] + (["T3"] if rel.t3_available else [])
    meta = load_meta()
    ids = sorted(meta)
    log(f"{len(ids)} nodes; tiers answerable: {','.join(sorted(tiers))}")

    # --- sparse pair table: every related pair among all nodes --------------
    # Only pairs that share an integer root can be T1 or T2, so those come
    # from a group-by rather than the full 870k-pair sweep. T4 can link any
    # two roots, so it needs the sweep, but only over phecodes that share at
    # least one ICD code.
    by_root = {}
    for nid in ids:
        for pc in meta[nid]["phecodes"]:
            by_root.setdefault(pc.split(".")[0], set()).add(nid)

    nodes_of_phecode_early = {}
    for nid in ids:
        for pc in meta[nid]["phecodes"]:
            nodes_of_phecode_early.setdefault(pc, set()).add(nid)

    candidates = set()
    for members in by_root.values():
        ms = sorted(members)
        for i, a in enumerate(ms):
            for b in ms[i + 1:]:
                candidates.add((a, b))
    log(f"  {len(candidates):,} same-root candidate pairs")

    # T3 links codes across integer roots - 585.32 and 587 are both inside
    # 580-590.99 - so neither the same-root sweep above nor the shared-ICD
    # sweep below would find those pairs. Enumerate them from the ranges.
    if rel.t3_available:
        values = {}
        for nid in ids:
            for pc in meta[nid]["phecodes"]:
                try:
                    values[pc] = float(pc)
                except ValueError:
                    pass
        t3_candidates = set()
        for pc, spec in ((p, rel.exclude_ranges.get(p, "")) for p in values):
            if not spec:
                continue
            bounds = []
            for part in spec.split(","):
                lo, _, hi = part.strip().partition("-")
                try:
                    bounds.append((float(lo), float(hi or lo)))
                except ValueError:
                    continue
            for other, v in values.items():
                if other == pc or not any(lo <= v <= hi for lo, hi in bounds):
                    continue
                for a in nodes_of_phecode_early.get(pc, ()):
                    for b in nodes_of_phecode_early.get(other, ()):
                        if a != b:
                            t3_candidates.add((a, b) if a < b else (b, a))
        log(f"  {len(t3_candidates):,} exclusion-range candidate pairs")
        candidates |= t3_candidates

    icd_owner = {}
    for pc, icds in rel.phecode_to_icds.items():
        for key in icds:
            icd_owner.setdefault(key, set()).add(pc)
    nodes_of_phecode = nodes_of_phecode_early
    t4_candidates = set()
    for owners in icd_owner.values():
        if len(owners) < 2:
            continue
        ns = sorted({n for pc in owners for n in nodes_of_phecode.get(pc, ())})
        for i, a in enumerate(ns):
            for b in ns[i + 1:]:
                t4_candidates.add((a, b))
    log(f"  {len(t4_candidates):,} shared-ICD candidate pairs")
    candidates |= t4_candidates

    pairs = {}
    for a, b in candidates:
        m = pair_mask(rel, meta[a], meta[b])
        if m and m != UNCLASSIFIABLE:
            pairs[(a, b)] = m
    log(f"  {len(pairs):,} related pairs "
        f"(T1 {sum(1 for m in pairs.values() if m & T1):,}, "
        f"T2 {sum(1 for m in pairs.values() if m & T2):,}, "
        f"T3 {sum(1 for m in pairs.values() if m & T3):,}, "
        f"T4 {sum(1 for m in pairs.values() if m & T4):,})")

    con = duckdb.connect()
    rows = [(a, b, m) for (a, b), m in sorted(pairs.items())]
    con.execute("CREATE TABLE pair_relations(source VARCHAR, target VARCHAR, "
                "rel INTEGER)")
    con.executemany("INSERT INTO pair_relations VALUES (?, ?, ?)", rows)
    out = os.path.join(OUT_DIR, "pair_relations.parquet")
    con.execute(f"COPY pair_relations TO '{out}' (FORMAT PARQUET)")
    log(f"  wrote {out} ({os.path.getsize(out):,} bytes)")

    # --- Option 1: one row per landing-page edge ---------------------------
    land = duckdb.connect(LANDING, read_only=True)
    edges = land.execute("SELECT CAST(source AS VARCHAR), "
                         "CAST(target AS VARCHAR) FROM edges").fetchall()
    land.close()
    erows = []
    for s, t in edges:
        key = (s, t) if s < t else (t, s)
        if s not in meta or t not in meta:
            erows.append((s, t, UNCLASSIFIABLE))
        else:
            erows.append((s, t, pairs.get(key, 0)))
    con.execute("CREATE TABLE edge_relations(source VARCHAR, target VARCHAR, "
                "rel INTEGER)")
    con.executemany("INSERT INTO edge_relations VALUES (?, ?, ?)", erows)
    out = os.path.join(OUT_DIR, "edge_relations.parquet")
    con.execute(f"COPY edge_relations TO '{out}' (FORMAT PARQUET)")
    nz = sum(1 for r in erows if r[2] and r[2] != UNCLASSIFIABLE)
    log(f"  wrote {out} ({os.path.getsize(out):,} bytes); "
        f"{nz:,}/{len(erows):,} landing edges carry a relation")

    # --- Option 2: the client-side rule's lookup ---------------------------
    node_phecodes = {nid: meta[nid]["phecodes"] for nid in ids
                     if meta[nid]["phecodes"]}
    out = os.path.join(OUT_DIR, "node_phecodes.json")
    with open(out, "w") as fh:
        json.dump({"tiers": ["T1", "T2"], "phecodes": node_phecodes}, fh,
                  separators=(",", ":"))
    log(f"  wrote {out} ({os.path.getsize(out):,} bytes) - "
        f"T1/T2 need nothing else")

    # T3/T4 cannot be derived from the code strings, so Option 2 has to ship
    # them. Kept in their own file so B3 can price them separately.
    t34 = {f"{a}|{b}": m & (T3 | T4) for (a, b), m in pairs.items()
           if m & (T3 | T4)}
    out = os.path.join(OUT_DIR, "pair_relations_t34.json")
    with open(out, "w") as fh:
        json.dump({"tiers": [t for t in ("T3", "T4") if t in tiers],
                   "pairs": t34}, fh, separators=(",", ":"))
    log(f"  wrote {out} ({os.path.getsize(out):,} bytes) - "
        f"{len(t34):,} pairs, the extra Option 2 pays for T3 and T4")
    con.close()


if __name__ == "__main__":
    main()
