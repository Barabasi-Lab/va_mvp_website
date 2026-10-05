#!/usr/bin/env python3
"""Panel f, candidate 2: ESRD's loci on a chromosome axis, built from the
store rather than from a screenshot.

Point size is the number of SNPs in the clump; shared loci are ringed;
APOL1 and TCF7L2 are labelled. The comparison screenshot (candidate 1)
shows the same fact through the display rules, which is why the authors
are offered both.

    python3 analysis/examples/fig_panel_f.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from common import (CLUMP_WINDOW, ESRD, PRIMARY_THRESHOLD, RESULTS, clump,
                    connect, in_region, log, positions, significant)

# Overridable so the final build can match this panel's shape to the
# screenshot panel beside it; see analysis/final/fig3_panel_f.py.
FIGSIZE = (11, 4.2)
DPI = 300

APOL1 = ("22", 36_253_071, 36_267_530)
TCF7L2 = ("10", 112_950_247, 113_167_678)
OUT = os.path.join(RESULTS, "figures")


def main():
    con = connect()
    positions(con)
    loci = {}
    for anc in ("afr", "eur"):
        snps = con.execute(f"""SELECT a.rsid, p.chrom, p.pos, a."pval.{anc}"
            FROM assoc a JOIN pos p USING (rsid)
            WHERE a.phe_id = ? AND {significant(anc, PRIMARY_THRESHOLD, 'a.')}""",
            [ESRD]).fetchall()
        _, L = clump(snps)
        for x in L:
            x["is_apol1"] = in_region(x, APOL1)
            x["is_tcf7l2"] = in_region(x, TCF7L2)
        loci[anc] = L

    shared = set()
    for a in loci["afr"]:
        for e in loci["eur"]:
            if a["chrom"] == e["chrom"] and abs(a["lead_pos"] - e["lead_pos"]) <= CLUMP_WINDOW:
                shared.add(("afr", a["lead_rsid"]))
                shared.add(("eur", e["lead_rsid"]))

    chroms = [str(c) for c in range(1, 23)]
    xpos = {c: i for i, c in enumerate(chroms)}
    fig, ax = plt.subplots(figsize=FIGSIZE)
    colours = {"afr": "#1f77b4", "eur": "#d62728"}
    offset = {"afr": -0.17, "eur": 0.17}

    for anc in ("afr", "eur"):
        for L in loci[anc]:
            c = str(L["chrom"])
            if c not in xpos:
                continue
            x = xpos[c] + offset[anc]
            y = L["n_snps"]
            is_shared = (anc, L["lead_rsid"]) in shared
            ax.scatter(x, y, s=18 + 5 * np.sqrt(L["n_snps"]),
                       facecolor=colours[anc], edgecolor="black" if is_shared else "none",
                       linewidth=1.6 if is_shared else 0, alpha=0.85, zorder=3 if is_shared else 2)
            if L["is_apol1"] or L["is_tcf7l2"]:
                # AFR labels to the left of their point, EUR to the right.
                # Both ancestries have a lead in each of the two labelled
                # loci and the two points sit 0.34 apart on the chromosome
                # axis, so centred labels overlapped each other.
                side = -1 if anc == "afr" else 1
                ax.annotate(
                    f"{'APOL1' if L['is_apol1'] else 'TCF7L2'}\n{L['lead_rsid']}",
                    (x, y), textcoords="offset points",
                    xytext=(7 * side, 9), ha="left" if side > 0 else "right",
                    fontsize=8, color=colours[anc], fontweight="bold",
                    annotation_clip=False)

    ax.set_yscale("symlog", linthresh=2)
    ax.set_xticks(range(len(chroms)))
    ax.set_xticklabels(chroms, fontsize=8)
    ax.set_xlabel("chromosome (GRCh38)")
    ax.set_ylabel("SNPs in locus")
    ax.set_xlim(-0.8, len(chroms) + 1.4)
    # headroom for the label above the tallest point, which otherwise sits
    # on top of the axes frame
    tallest = max((L["n_snps"] for anc in loci for L in loci[anc]), default=1)
    ax.set_ylim(0, tallest * 2.6)
    ax.grid(axis="y", alpha=0.25)
    handles = [plt.Line2D([], [], marker="o", linestyle="", color=colours["afr"], label="AFR"),
               plt.Line2D([], [], marker="o", linestyle="", color=colours["eur"], label="EUR"),
               plt.Line2D([], [], marker="o", linestyle="", markerfacecolor="white",
                          markeredgecolor="black", label="shared locus (leads within 500 kb)")]
    ax.legend(handles=handles, fontsize=8, loc="upper left", framealpha=0.9)
    ax.set_title(f"ESRD loci by ancestry, p < {PRIMARY_THRESHOLD:g}, "
                 f"{CLUMP_WINDOW // 1000} kb clumping\n"
                 f"{len(loci['afr'])} AFR loci, {len(loci['eur'])} EUR loci, "
                 f"{len(shared) // 2} shared", fontsize=10)
    fig.tight_layout()
    os.makedirs(OUT, exist_ok=True)
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(OUT, f"fig3_f2_locus_map.{ext}"), dpi=DPI)
    plt.close(fig)
    log(f"wrote fig3_f2_locus_map.png/.pdf "
        f"({len(loci['afr'])} AFR, {len(loci['eur'])} EUR, {len(shared)//2} shared)")


if __name__ == "__main__":
    main()
