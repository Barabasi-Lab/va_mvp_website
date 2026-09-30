#!/usr/bin/env python3
"""Phecode-redundancy sensitivity analysis - entry point.

    python3 analysis/phecode_redundancy/run_analysis.py [--steps a2,a3,a5,a6]

Read-only with respect to production: reads the association store and the
phecode map, writes only into results/.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import pickle
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import network
from phecode_relations import PhecodeRelations, to_phecode

# ----------------------------------------------------------------- parameters
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
RESULTS = os.path.join(HERE, "results")

DB_DIR = os.path.join(REPO, "public", "data", "db")
NODE_ATTRS = os.path.join(REPO, "public", "data", "node_attributes.csv")
ICD_MAP = os.path.expanduser("~/Downloads/Phecode_map_v1_2_icd9_icd10cm.csv")
DEFINITIONS = None          # phecode_definitions1.2.csv - absent; T3 unavailable
LABELS_PKL = os.path.expanduser("~/Desktop/phenotype_labels.pkl")

ANCESTRIES = ("afr", "eur", "meta")      # AFR/EUR primary, META reference
THRESHOLDS = (1e-4, 1e-8)                # 1e-4 primary (matches the figures)
PRIMARY_THRESHOLD = 1e-4

TARGETS = {
    "ESRD": "Phe_585_32",                # 585.32
    "iron_deficiency_anemia": "Phe_280_1",   # 280.1
}
# obesity dropped from A6 at the authors' instruction

SEED = 20260930

# ------------------------------------------------------------------ utilities


def md5(path: str, limit_mb: int | None = None) -> str:
    h = hashlib.md5()
    read = 0
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
            read += len(chunk)
            if limit_mb and read >= limit_mb << 20:
                return h.hexdigest() + f" (first {limit_mb}MB)"
    return h.hexdigest()


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def provenance() -> dict:
    files = {}
    for name, path in [("association_store", os.path.join(DB_DIR, "associations")),
                       ("node_attributes", NODE_ATTRS),
                       ("icd_map", ICD_MAP),
                       ("labels", LABELS_PKL)]:
        if os.path.isdir(path):
            shards = sorted(f for f in os.listdir(path))
            files[name] = {"path": path, "shards": len(shards)}
        elif os.path.exists(path):
            files[name] = {"path": path, "md5": md5(path), "bytes": os.path.getsize(path)}
        else:
            files[name] = {"path": path, "status": "ABSENT"}
    files["phecode_definitions"] = {"path": "(not supplied)", "status": "ABSENT",
                                    "consequence": "T3 not computable"}
    return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "seed": SEED, "ancestries": list(ANCESTRIES),
            "thresholds": list(THRESHOLDS), "files": files}


def load_meta():
    """phe_id -> {code, phecode, label, category}"""
    labels = pickle.load(open(LABELS_PKL, "rb"))
    attrs = {r["id"]: r for r in csv.DictReader(open(NODE_ATTRS))}
    con = network.connect(DB_DIR)
    meta = {}
    for phe_id, code in con.execute(
            "SELECT DISTINCT phe_id, phenotype FROM assoc").fetchall():
        entry = meta.setdefault(phe_id, {"codes": [], "phecodes": []})
        entry["codes"].append(code)
        pc = to_phecode(code)
        if pc:
            entry["phecodes"].append(pc)
    for phe_id, entry in meta.items():
        a = attrs.get(phe_id, {})
        entry["label"] = a.get("label", "")
        entry["category"] = a.get("phenotype_category", "")
        entry["codes"].sort()
        entry["phecodes"].sort()
    con.close()
    return meta


# ------------------------------------------------------------------- step A2

def step_a2(meta):
    """Classify every phenotype pair with an edge in any ancestry network."""
    rel = PhecodeRelations(ICD_MAP, DEFINITIONS)
    con = network.connect(DB_DIR)

    pairs = set()
    per_network = {}
    for anc in ANCESTRIES:
        tbl = network.best_rows(con, anc, PRIMARY_THRESHOLD)
        edges = network.all_edges(con, tbl)
        per_network[anc] = {(p1, p2): (w, s, a) for p1, p2, w, s, a in edges}
        pairs.update(per_network[anc])
        log(f"  {anc.upper()}: {len(edges):,} edges at p<{PRIMARY_THRESHOLD:g}")
    con.close()
    log(f"  union across ancestries: {len(pairs):,} distinct pairs")

    out = os.path.join(RESULTS, "phecode_pair_relations.csv")
    counts = defaultdict(int)
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["phe_id_a", "phe_id_b", "phecode_a", "phecode_b",
                    "label_a", "label_b", "category_a", "category_b",
                    "t1", "t2", "t3", "t4", "shared_icd_count",
                    "any_structural_computable", "classifiable",
                    "weight_afr", "weight_eur", "weight_meta"])
        for p1, p2 in sorted(pairs):
            m1, m2 = meta[p1], meta[p2]
            # a merged node carries two source codes; a pair counts as related
            # if any code combination is related
            best = None
            for ca in (m1["phecodes"] or [None]):
                for cb in (m2["phecodes"] or [None]):
                    if ca is None or cb is None:
                        continue
                    r = rel.classify(ca, cb)
                    if best is None or (r.t1, r.t2, r.t4) > (best.t1, best.t2, best.t4):
                        best = r
            classifiable = best is not None
            if classifiable:
                key = ("T1" if best.t1 else "T2" if best.t2 else
                       "T4" if best.t4 else "unrelated")
                counts[key] += 1
            else:
                counts["unclassifiable"] += 1
            w.writerow([
                p1, p2,
                ",".join(m1["phecodes"]) or ",".join(m1["codes"]),
                ",".join(m2["phecodes"]) or ",".join(m2["codes"]),
                m1["label"], m2["label"], m1["category"], m2["category"],
                best.t1 if classifiable else "", best.t2 if classifiable else "",
                "", best.t4 if classifiable else "",
                best.shared_icd_count if classifiable else "",
                best.any_structural if classifiable else "", classifiable,
                per_network["afr"].get((p1, p2), ("", ))[0],
                per_network["eur"].get((p1, p2), ("", ))[0],
                per_network["meta"].get((p1, p2), ("", ))[0],
            ])
    log(f"  wrote {out}")
    for k in ("T1", "T2", "T4", "unrelated", "unclassifiable"):
        if counts[k]:
            log(f"    {k:15} {counts[k]:>7,}")
    return out, dict(counts)



# ------------------------------------------------------------------- step A3

# T3 is not computable, so the level the task calls L3 (T1+T2+T3+T4) is
# reported as L3_partial (T1+T2+T4) and must not be read as full L3.
LEVELS = [
    ("L0", "baseline, no exclusions"),
    ("L1", "drop T1 (ancestor-descendant)"),
    ("L2", "drop T1 + T2"),
    ("L3_partial", "drop T1 + T2 + T4  (T3 unavailable)"),
    ("L4", "L3_partial + drop all neighbours in the target's category"),
]


def tier_flags(rel, target_phecodes, neighbor_phecodes):
    """Strongest relation over any pair of source codes (merged nodes carry
    two). Returns (t1, t2, t4, classifiable)."""
    if not target_phecodes or not neighbor_phecodes:
        return False, False, False, False
    t1 = t2 = t4 = False
    for a in target_phecodes:
        for b in neighbor_phecodes:
            r = rel.classify(a, b)
            t1 |= r.t1
            t2 |= r.t2
            t4 |= r.t4
    return t1, t2, t4, True


def excluded_at(level, flags, same_category):
    t1, t2, t4, classifiable = flags
    if level == "L0":
        return False
    if level == "L1":
        return t1
    if level == "L2":
        return t1 or t2
    if level == "L3_partial":
        return t1 or t2 or t4
    if level == "L4":
        return t1 or t2 or t4 or same_category
    raise ValueError(level)


def step_a3(meta, targets, tag, include_l4=True):
    """Ego-network sensitivity for each target x ancestry x threshold x level."""
    rel = PhecodeRelations(ICD_MAP, DEFINITIONS)
    con = network.connect(DB_DIR)

    CLUSTER = {"genitourinary system", "hematopoietic"}
    long_rows = []
    top_rows = []

    for name, code in targets.items():
        tid = next(k for k, v in meta.items() if code in v["codes"])
        tcat = meta[tid]["category"]
        tphe = meta[tid]["phecodes"]
        log(f"  {name} = {code} = node {tid} ({tcat})")

        for anc in ANCESTRIES:
            for thr in THRESHOLDS:
                tbl = network.best_rows(con, anc, thr)
                edges = network.ego_edges(con, tbl, tid)
                enriched = []
                for nb, weight, syn, anti, _rsids in edges:
                    m = meta.get(nb, {})
                    flags = tier_flags(rel, tphe, m.get("phecodes", []))
                    enriched.append({
                        "id": nb, "label": m.get("label", ""),
                        "category": m.get("category", ""),
                        "weight": weight, "syn": syn, "anti": anti,
                        "flags": flags,
                        "same_category": m.get("category", "") == tcat,
                    })

                for level, _desc in LEVELS:
                    if level == "L4" and not include_l4:
                        continue
                    kept = [e for e in enriched
                            if not excluded_at(level, e["flags"], e["same_category"])]
                    deg = len(kept)
                    wsum = sum(e["weight"] for e in kept)
                    syn = sum(e["syn"] for e in kept)
                    in_cluster = [e for e in kept if e["category"] in CLUSTER]
                    in_gu = [e for e in kept if e["category"] == "genitourinary system"]
                    syn_major = sum(1 for e in kept if e["syn"] > e["anti"])

                    def emit(metric, value):
                        long_rows.append({
                            "target": name, "phecode": ",".join(tphe),
                            "ancestry": anc.upper(), "threshold": f"{thr:g}",
                            "level": level, "metric": metric, "value": value})

                    emit("degree", deg)
                    emit("weighted_degree", wsum)
                    emit("within_cluster_frac_by_count",
                         len(in_cluster) / deg if deg else "")
                    emit("within_cluster_frac_by_weight",
                         sum(e["weight"] for e in in_cluster) / wsum if wsum else "")
                    emit("genitourinary_frac_by_count",
                         len(in_gu) / deg if deg else "")
                    emit("genitourinary_frac_by_weight",
                         sum(e["weight"] for e in in_gu) / wsum if wsum else "")
                    emit("synergistic_frac_by_weight", syn / wsum if wsum else "")
                    emit("synergistic_frac_by_edge", syn_major / deg if deg else "")
                    emit("shared_loci", "")   # A4, pending SNP positions

                    if thr == PRIMARY_THRESHOLD:
                        for e in sorted(kept, key=lambda x: -x["weight"])[:10]:
                            t1, t2, t4, ok = e["flags"]
                            top_rows.append({
                                "target": name, "ancestry": anc.upper(),
                                "level": level, "neighbor_id": e["id"],
                                "phecode": ",".join(meta[e["id"]]["phecodes"]),
                                "label": e["label"], "category": e["category"],
                                "weight": e["weight"], "synergistic": e["syn"],
                                "antagonistic": e["anti"],
                                "t1": t1, "t2": t2, "t4": t4,
                                "classifiable": ok})
    con.close()

    out = os.path.join(RESULTS, f"{tag}_sensitivity.csv")
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(long_rows[0].keys()))
        w.writeheader()
        w.writerows(long_rows)
    log(f"  wrote {out} ({len(long_rows):,} rows)")

    out2 = os.path.join(RESULTS, f"{tag}_top_neighbors.csv")
    with open(out2, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(top_rows[0].keys()))
        w.writeheader()
        w.writerows(top_rows)
    log(f"  wrote {out2}")
    return long_rows


def plot_sensitivity(long_rows, tag, include_l4=True):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    metrics = ["degree", "weighted_degree", "within_cluster_frac_by_weight",
               "genitourinary_frac_by_weight", "synergistic_frac_by_weight",
               "synergistic_frac_by_edge"]
    levels = [l for l, _ in LEVELS if include_l4 or l != "L4"]
    ancs = sorted({r["ancestry"] for r in long_rows})
    thr = f"{PRIMARY_THRESHOLD:g}"

    fig, axes = plt.subplots(2, 3, figsize=(15, 8), sharex=True)
    for ax, metric in zip(axes.flat, metrics):
        for anc in ancs:
            ys = []
            for lv in levels:
                v = [r["value"] for r in long_rows
                     if r["ancestry"] == anc and r["threshold"] == thr
                     and r["level"] == lv and r["metric"] == metric]
                ys.append(v[0] if v and v[0] != "" else float("nan"))
            ax.plot(levels, ys, marker="o", label=anc)
        ax.set_title(metric.replace("_", " "), fontsize=10)
        ax.grid(alpha=0.3)
        if metric.endswith("frac_by_weight") or metric.endswith("frac_by_edge"):
            ax.set_ylim(0, 1)
    axes.flat[0].legend(title="ancestry", fontsize=9)
    fig.suptitle(f"{tag.upper()} ego-network sensitivity to phecode-relatedness "
                 f"exclusion (p < {thr})\nL3_partial omits T3: exclusion ranges "
                 f"unavailable. L4 is a stress test.", fontsize=11)
    fig.tight_layout()
    path = os.path.join(RESULTS, f"{tag}_sensitivity.png")
    fig.savefig(path, dpi=140)
    plt.close(fig)
    log(f"  wrote {path}")



# ------------------------------------------------------------------- step A5

TIER_ORDER = ["T1", "T2", "T4", "unrelated"]


def primary_tier(rel, m1, m2):
    """Mutually exclusive tier for a pair, strongest relation first.
    Returns None when either node has no phecode (the 5 non-phecode nodes)."""
    best = None
    for ca in m1["phecodes"]:
        for cb in m2["phecodes"]:
            r = rel.classify(ca, cb)
            if best is None or (r.t1, r.t2, r.t4) > (best.t1, best.t2, best.t4):
                best = r
    if best is None:
        return None
    return "T1" if best.t1 else "T2" if best.t2 else "T4" if best.t4 else "unrelated"


def quartiles(xs):
    """median and IQR by the same linear-interpolation rule numpy uses."""
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return ("", "", "")
    def q(p):
        h = (n - 1) * p
        lo = int(h)
        hi = min(lo + 1, n - 1)
        return xs[lo] + (h - lo) * (xs[hi] - xs[lo])
    return (q(0.5), q(0.25), q(0.75))


def step_a5(meta):
    """Tier composition of the whole network, per ancestry, at the primary
    threshold."""
    from scipy.stats import mannwhitneyu

    rel = PhecodeRelations(ICD_MAP, DEFINITIONS)
    con = network.connect(DB_DIR)
    rows = []
    per_anc_weights = {}

    for anc in ANCESTRIES:
        tbl = network.best_rows(con, anc, PRIMARY_THRESHOLD)
        edges = network.all_edges(con, tbl)

        by_tier = defaultdict(lambda: {"n": 0, "w": 0, "syn": 0, "anti": 0,
                                       "syn_major": 0, "ws": []})
        unclass = {"n": 0, "w": 0}
        for p1, p2, w, syn, anti in edges:
            tier = primary_tier(rel, meta[p1], meta[p2])
            if tier is None:
                unclass["n"] += 1
                unclass["w"] += w
                continue
            d = by_tier[tier]
            d["n"] += 1
            d["w"] += w
            d["syn"] += syn
            d["anti"] += anti
            d["syn_major"] += 1 if syn > anti else 0
            d["ws"].append(w)

        n_tot = sum(d["n"] for d in by_tier.values())
        w_tot = sum(d["w"] for d in by_tier.values())
        anti_tot = sum(d["anti"] for d in by_tier.values())
        ref = by_tier["unrelated"]["ws"]
        per_anc_weights[anc] = {t: by_tier[t]["ws"] for t in TIER_ORDER}

        for tier in TIER_ORDER:
            d = by_tier[tier]
            med, q1, q3 = quartiles(d["ws"])
            if tier != "unrelated" and d["ws"] and ref:
                u, p = mannwhitneyu(d["ws"], ref, alternative="two-sided")
                # rank-biserial: P(tier > unrelated) - P(tier < unrelated)
                rbc = 2 * u / (len(d["ws"]) * len(ref)) - 1
            else:
                u = p = rbc = ""
            rows.append({
                "ancestry": anc.upper(), "threshold": f"{PRIMARY_THRESHOLD:g}",
                "tier": tier,
                "n_edges": d["n"],
                "frac_edges": d["n"] / n_tot if n_tot else "",
                "total_weight": d["w"],
                "frac_weight": d["w"] / w_tot if w_tot else "",
                "weight_median": med, "weight_q1": q1, "weight_q3": q3,
                "mwu_U_vs_unrelated": u, "mwu_p_vs_unrelated": p,
                "rank_biserial_vs_unrelated": rbc,
                "synergistic_frac_by_weight": d["syn"] / d["w"] if d["w"] else "",
                "synergistic_frac_by_edge":
                    d["syn_major"] / d["n"] if d["n"] else "",
                "antagonistic_weight": d["anti"],
                "share_of_all_antagonistic_weight":
                    d["anti"] / anti_tot if anti_tot else "",
            })
        rows.append({
            "ancestry": anc.upper(), "threshold": f"{PRIMARY_THRESHOLD:g}",
            "tier": "unclassifiable", "n_edges": unclass["n"],
            "frac_edges": "", "total_weight": unclass["w"], "frac_weight": "",
            "weight_median": "", "weight_q1": "", "weight_q3": "",
            "mwu_U_vs_unrelated": "", "mwu_p_vs_unrelated": "",
            "rank_biserial_vs_unrelated": "",
            "synergistic_frac_by_weight": "", "synergistic_frac_by_edge": "",
            "antagonistic_weight": "", "share_of_all_antagonistic_weight": "",
        })
        log(f"  {anc.upper()}: {n_tot:,} classifiable edges, "
            f"{unclass['n']} unclassifiable")
    con.close()

    out = os.path.join(RESULTS, "network_wide_tiers.csv")
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    log(f"  wrote {out}")
    plot_tiers(rows, per_anc_weights)
    return rows


def plot_tiers(rows, per_anc_weights):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ancs = [a.upper() for a in ANCESTRIES]
    get = lambda a, t, k: next(
        (r[k] for r in rows if r["ancestry"] == a and r["tier"] == t), "")

    fig, axes = plt.subplots(1, 4, figsize=(18, 4.6))
    x = range(len(TIER_ORDER))
    width = 0.26

    for i, anc in enumerate(ancs):
        off = (i - 1) * width
        axes[0].bar([v + off for v in x],
                    [get(anc, t, "frac_edges") or 0 for t in TIER_ORDER],
                    width, label=anc)
        axes[1].bar([v + off for v in x],
                    [get(anc, t, "frac_weight") or 0 for t in TIER_ORDER],
                    width, label=anc)
        axes[3].bar([v + off for v in x],
                    [get(anc, t, "synergistic_frac_by_weight") or 0
                     for t in TIER_ORDER], width, label=anc)
    for ax, title in ((axes[0], "fraction of edges"),
                      (axes[1], "fraction of total weight"),
                      (axes[3], "synergistic fraction (by weight)")):
        ax.set_xticks(list(x))
        ax.set_xticklabels(TIER_ORDER)
        ax.set_title(title, fontsize=10)
        ax.grid(alpha=0.3, axis="y")
    axes[0].legend(fontsize=8)
    axes[0].set_yscale("log")
    axes[1].set_yscale("log")
    axes[3].set_ylim(0, 1)

    # weight distributions, EUR (the densest network)
    data = [per_anc_weights["eur"][t] or [0] for t in TIER_ORDER]
    axes[2].boxplot(data, tick_labels=TIER_ORDER, showfliers=False)
    axes[2].set_yscale("log")
    axes[2].set_title("EUR edge weight by tier (shared SNPs)", fontsize=10)
    axes[2].grid(alpha=0.3, axis="y")

    fig.suptitle(f"Network-wide phecode-relatedness tiers, p < "
                 f"{PRIMARY_THRESHOLD:g}.  T3 (exclusion ranges) unavailable; "
                 f"'unrelated' therefore includes any T3-only pairs.",
                 fontsize=11)
    fig.tight_layout()
    path = os.path.join(RESULTS, "network_wide_tiers.png")
    fig.savefig(path, dpi=140)
    plt.close(fig)
    log(f"  wrote {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", default="a2")
    args = ap.parse_args()
    steps = {s.strip().lower() for s in args.steps.split(",")}

    os.makedirs(RESULTS, exist_ok=True)
    prov = provenance()
    with open(os.path.join(RESULTS, "provenance.json"), "w") as fh:
        json.dump(prov, fh, indent=2)
    log("provenance written; T3 unavailable (no definitions file)")

    meta = load_meta()
    log(f"loaded metadata for {len(meta)} network phenotypes")

    if "a2" in steps:
        log("A2: classifying phenotype pairs")
        step_a2(meta)

    if "a3" in steps:
        log("A3: ESRD ego-network sensitivity")
        rows = step_a3(meta, {"ESRD": TARGETS["ESRD"]}, "esrd", include_l4=True)
        plot_sensitivity(rows, "esrd", include_l4=True)

    if "a5" in steps:
        log("A5: network-wide tier characterization")
        step_a5(meta)

    if "a6" in steps:
        log("A6: secondary example (iron deficiency anemia; obesity dropped)")
        rows = step_a3(meta, {"iron_deficiency_anemia":
                              TARGETS["iron_deficiency_anemia"]},
                       "anemia", include_l4=False)
        plot_sensitivity(rows, "anemia", include_l4=False)

    log("done")


if __name__ == "__main__":
    main()
