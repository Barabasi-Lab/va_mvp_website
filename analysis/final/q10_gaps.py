#!/usr/bin/env python3
"""The Q10 verification numbers not already covered by a saved output.

Everything else in the table comes from esrd_claims.json, q2_q10_answers.json,
q5_duplicate_robustness.csv and esrd_l2_locus_split.csv. This fills in:

  * the chr16 discordant locus (how many kidney-stone phenotypes, how many
    discordant shared associations) and the chr10 one beside it, counted
    both over the phenotypes the draft names and over every neighbour whose
    dominant discordant locus is that lead;
  * what the store's gene annotation calls those two lead SNPs, since the
    draft names them BICC1 and UMOD;
  * Q6 rechecked on the regenerated edgelist, including the claim that the
    union over thresholds cannot grow;
Figure 1 is not here: its numbers are over the whole download, and the
store holds only the filtered subset, so q10_figure1.py reads the source
CSV instead.

    python3 analysis/final/q10_gaps.py
"""
from __future__ import annotations

import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "analysis", "examples"))

from common import ESRD, PRIMARY_THRESHOLD, connect, log  # noqa: E402

OUT = os.path.join(HERE, "results")
EDGELIST_NEW = os.path.join(REPO, "public", "data", "edgelist_rebuilt.csv")
ANCS = ("meta", "eur", "afr", "amr", "eas")


def write_csv(rows, path):
    if not rows:
        return
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def discordant_loci(con):
    """EUR neighbours of ESRD grouped by the chromosome of their dominant
    discordant locus, which is how the draft's two examples are phrased.

    The draft counts only the phenotypes it names - eye phenotypes at chr10,
    kidney-stone phenotypes at chr16 - so both that figure and the figure
    over every neighbour at the locus are reported; they are not the same
    number and only the first is what the sentence claims.
    """
    src = os.path.join(REPO, "analysis", "examples", "results",
                       "esrd_eur_discordant_edges.csv")
    rows = list(csv.DictReader(open(src)))
    out = []
    # chr16 needs the phenotypes named rather than the category: three of
    # the eight genitourinary neighbours at UMOD (urinary tract infection,
    # hematuria, gross hematuria) are not kidney-stone phenotypes.
    STONES = {"926", "927", "928", "929", "930"}
    for chrom, lead, cat, pick in (
            ("10", "rs4948524", "eye phenotypes (sense organs)",
             lambda r: r["category"] == "sense organs"),
            ("16", "rs12922822", "kidney-stone phenotypes",
             lambda r: r["neighbour"] in STONES)):
        grp = [r for r in rows if r["dominant_locus_chrom"] == chrom
               and r["dominant_locus_lead"] == lead]
        named = [r for r in grp if pick(r)]
        out.append({
            "chrom": chrom, "lead": lead, "drafted_group": cat,
            "neighbours_in_group": len(named),
            "discordant_in_group": sum(int(r["discordant"]) for r in named),
            "phenotypes_in_group": "; ".join(r["label"] for r in named),
            "neighbours_at_locus": len(grp),
            "discordant_at_locus": sum(int(r["discordant"]) for r in grp),
            "others_at_locus": "; ".join(r["label"] for r in grp
                                         if r not in named),
        })
    return out


def gene_of(con, rsids):
    q = ",".join("?" for _ in rsids)
    rows = con.execute(f"""SELECT DISTINCT rsid, nearest_gene, gene_distance_bp,
                                  overlapping_noncoding, chrom, grch38_pos
                           FROM assoc WHERE rsid IN ({q})""", list(rsids)).fetchall()
    return [{"rsid": r[0], "nearest_gene": r[1], "gene_distance_bp": r[2],
             "overlapping_noncoding": r[3], "chrom": r[4], "grch38_pos": r[5]}
            for r in rows]


def q6_recheck(con):
    con.execute(f"CREATE OR REPLACE VIEW el AS SELECT * FROM read_csv('{EDGELIST_NEW}')")
    cols = [c[0] for c in con.execute("DESCRIBE el").fetchall()]
    wcols = [c for c in cols if c not in ("source", "target", "Source", "Target")]
    rows = con.execute("SELECT count(*) FROM el").fetchone()[0]
    pairs = con.execute("""SELECT count(*) FROM (
        SELECT DISTINCT least(source, target), greatest(source, target) FROM el)""").fetchone()[0]
    selfp = con.execute("SELECT count(*) FROM el WHERE source = target").fetchone()[0]
    anyw = con.execute("SELECT count(*) FROM el WHERE " +
                       " OR ".join(f'coalesce("{c}", 0) <> 0' for c in wcols)).fetchone()[0]

    # the union over thresholds, per ancestry and direction, must shrink
    # monotonically as the threshold tightens
    mono = []
    for anc in ANCS:
        for direction in ("same_dir_weight", "diff_dir_weight"):
            prev = None
            for e in range(4, 13):
                c = f"{anc}_1e-{e:02d}_{direction}"
                if c not in wcols:
                    continue
                n = con.execute(f'SELECT count(*) FROM el WHERE coalesce("{c}", 0) <> 0').fetchone()[0]
                if prev is not None and n > prev:
                    mono.append({"column": c, "edges": n, "looser_column_edges": prev,
                                 "monotone": False})
                prev = n
    return {"rows": rows, "distinct_unordered_pairs": pairs, "self_pairs": selfp,
            "weight_columns": len(wcols), "rows_with_any_nonzero_weight": anyw,
            "non_monotone_columns": mono}


def main():
    os.makedirs(OUT, exist_ok=True)
    con = connect()

    loci = discordant_loci(con)
    write_csv(loci, os.path.join(OUT, "q10_discordant_loci.csv"))
    for r in loci:
        log(f"  chr{r['chrom']} {r['lead']}: {r['neighbours_in_group']} "
            f"{r['drafted_group']}, {r['discordant_in_group']} discordant shared "
            f"associations ({r['neighbours_at_locus']} / {r['discordant_at_locus']} "
            f"over every neighbour at the locus)")

    genes = gene_of(con, ["rs4948524", "rs12922822", "rs73885319", "rs7903146",
                          "rs9622362", "rs7291184"])
    write_csv(genes, os.path.join(OUT, "q10_lead_genes.csv"))
    for g in genes:
        log(f"  {g['rsid']:12} {g['nearest_gene']} at {g['gene_distance_bp']} bp "
            f"(chr{g['chrom']}:{g['grch38_pos']}) nc={g['overlapping_noncoding']}")

    q6 = q6_recheck(con)
    log(f"  Q6 on the regenerated edgelist: {q6['rows']} rows, "
        f"{q6['distinct_unordered_pairs']} pairs, {q6['weight_columns']} weight columns, "
        f"{len(q6['non_monotone_columns'])} non-monotone columns")

    payload = {"q6_regenerated": q6, "discordant_loci": loci,
               "lead_genes": genes}
    with open(os.path.join(OUT, "q10_gaps.json"), "w") as fh:
        json.dump(payload, fh, indent=1)
    log("wrote q10_discordant_loci.csv, q10_lead_genes.csv, q10_gaps.json")


if __name__ == "__main__":
    main()
