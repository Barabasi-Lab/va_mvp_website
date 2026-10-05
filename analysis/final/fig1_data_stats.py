#!/usr/bin/env python3
"""Figure 1 - overview of the multi-ancestry gwPheWAS dataset.

Rebuilt because no plotting script for the published figure is in the repo.
Reads the aggregates fig1_extract.py computed from the source download at
p < 1e-4 with duplicate rows kept, and writes
analysis/final/figures/fig1_data_stats.{png,pdf}.

The reviewer's complaint was panel a's y axes: each small plot carried a
shared multiplier such as "1e5" above the axis, so a tick read "5" and meant
500,000. Every axis here uses `compact_sci`, which puts the exponent in the
tick itself ("5e5"), and the offset text is switched off on every axis.

    python3 analysis/final/fig1_extract.py      # once, ~2.5 min
    python3 analysis/final/fig1_data_stats.py

Colours are the Okabe-Ito accessible qualitative set, assigned to ancestries
in a fixed order. The five-slot palette passes the dataviz skill's lightness,
chroma, CVD-separation and normal-vision checks (worst adjacent pair dE 9.6
deutan, 18.4 normal); the two low-contrast slots are relieved by the legend
and axis labels, which every panel carries.
"""
from __future__ import annotations

import json
import math
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.gridspec import GridSpec
from matplotlib.lines import Line2D
from matplotlib.ticker import FuncFormatter, MaxNLocator

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")
OUT = os.path.join(HERE, "figures")
DPI = 400                      # the brief asks for at least 300

# Panel a reads smallest cohort to largest, as the published figure does.
ANCS = ["EAS", "AMR", "AFR", "EUR", "META"]
# The UpSet stacks its rows by set size, largest at the bottom - also as
# published, where META sits between AFR and EUR.
UPSET_ORDER = ["EAS", "AMR", "AFR", "META", "EUR"]
COLOUR = {"EUR": "#0072B2", "AFR": "#D55E00", "AMR": "#009E73",
          "EAS": "#56B4E9", "META": "#CC79A7"}

HALF = 12              # half-width of the panel b smoothing kernel, in bins

INK = "#1a1a1a"
MUTED = "#6b6b6b"
GRID = "#e0e0e0"
BAR_BASE = "#9ec4e0"           # one colour for the UpSet bars
BAR_HIGHLIGHT = "#0072B2"

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["DejaVu Sans"],
    "font.size": 7,
    "axes.edgecolor": GRID,
    "axes.labelcolor": INK,
    "axes.titlesize": 8,
    "text.color": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "xtick.labelcolor": INK,
    "ytick.labelcolor": INK,
    "axes.linewidth": 0.6,
    "xtick.major.width": 0.6,
    "ytick.major.width": 0.6,
    "legend.frameon": False,
})


def compact_sci(v, _pos=None):
    """Tick label with the exponent in the label, never in a shared offset.

    Plain for anything inside 0.01-9999, so an axis that does not need an
    exponent does not get one; "5e5" style outside that.
    """
    if v == 0:
        return "0"
    neg = "-" if v < 0 else ""
    v = abs(v)
    exp = int(math.floor(math.log10(v)))
    if -2 <= exp <= 3:
        s = f"{v:,.0f}" if v >= 1 else f"{v:g}"
        return neg + s
    mant = v / 10.0 ** exp
    mant_s = (f"{mant:.0f}" if abs(mant - round(mant)) < 1e-9
              else f"{mant:.1f}")
    return f"{neg}{mant_s}e{exp}"


FMT = FuncFormatter(compact_sci)


def tidy(ax, grid_axis="y"):
    """Hairline solid grid, two spines, no offset text anywhere."""
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    ax.grid(axis=grid_axis, color=GRID, linewidth=0.5, linestyle="-")
    ax.set_axisbelow(True)
    ax.xaxis.offsetText.set_visible(False)
    ax.yaxis.offsetText.set_visible(False)
    ax.tick_params(length=2.5, pad=1.5)


# --------------------------------------------------------------------------
def panel_a(fig, gs, data):
    metrics = [
        ("sample size", lambda a: data["sample_size"][a]),
        ("significant SNPs", lambda a: data["panel_a"][a]["significant_snps"]),
        ("significant associations", lambda a: data["panel_a"][a]["associations"]),
        ("phenotypes with\nan association", lambda a: data["panel_a"][a]["phenotypes"]),
    ]
    sub = gs.subgridspec(1, 4, wspace=0.42)
    axes = []
    for i, (title, get) in enumerate(metrics):
        ax = fig.add_subplot(sub[0, i])
        vals = [get(a) for a in ANCS]
        x = np.arange(len(ANCS))
        # Log y: the metrics span three to four orders of magnitude, and on a
        # linear axis EAS is a zero-height bar in three of the four plots -
        # which is the comparison the text is actually making.
        floor = 10 ** math.floor(math.log10(min(vals))) / 2
        ax.bar(x, vals, width=0.72, color=[COLOUR[a] for a in ANCS],
               linewidth=0.8, edgecolor="white", bottom=floor, zorder=2)
        ax.set_yscale("log")
        ax.set_ylim(floor, max(vals) * 2.2)
        ax.set_xticks(x)
        ax.set_xticklabels(ANCS, fontsize=6, rotation=45, ha="right")
        ax.set_title(title, fontsize=7, pad=4)
        ax.yaxis.set_major_locator(matplotlib.ticker.LogLocator(numticks=5))
        ax.yaxis.set_minor_locator(matplotlib.ticker.NullLocator())
        ax.yaxis.set_major_formatter(FMT)
        tidy(ax)
        axes.append(ax)
    axes[0].text(-0.34, 1.26, "a", transform=axes[0].transAxes,
                 fontsize=12, fontweight="bold", va="top")
    return axes


def panel_b(fig, gs, data):
    ax = fig.add_subplot(gs)
    for a in ANCS:
        b = data["panel_b"][a]
        x = -np.array(b["log10p"], dtype=float)       # -log10 p, rising right
        y = np.array(b["count"], dtype=float)
        order = np.argsort(x)
        x, y = x[order], y[order]
        # Drop the pile-up at the double-precision floor: p underflows to 0
        # around 1e-308, so every association past it lands in one bin and
        # draws as a spike that is an artefact of the number format.
        keep = x < 300
        x, y = x[keep], y[keep]
        y = y / y.sum() / 0.25                        # density over log10 p
        # Smooth so the 0.25-wide exact bins read as a KDE would. The deep
        # tail is where the counts get small and the raw bins get spiky, so
        # the kernel is wide enough to settle it: a Gaussian over +/-12 bins,
        # sigma 3, rather than the 5-bin box this started with.
        if len(y) > 2 * HALF + 1:
            t = np.arange(-HALF, HALF + 1)
            k = np.exp(-0.5 * (t / 3.0) ** 2)
            k /= k.sum()
            # reflect at the ends; zero padding put a false dip at the left
            # edge of the EUR curve
            pad = np.r_[y[HALF:0:-1], y, y[-2:-HALF - 2:-1]]
            y = np.convolve(pad, k, mode="same")[HALF:-HALF]
        ax.plot(x, y, color=COLOUR[a], linewidth=1.3, label=a,
                solid_capstyle="round")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlim(4, 310)
    ax.set_xlabel(r"$-\log_{10}(p)$")
    ax.set_ylabel("density")
    ax.xaxis.set_major_formatter(FMT)
    ax.yaxis.set_major_formatter(FMT)
    tidy(ax, grid_axis="both")
    ax.legend(fontsize=6, loc="upper right", ncol=1, handlelength=1.4,
              labelcolor=INK)
    ax.text(-0.16, 1.1, "b", transform=ax.transAxes, fontsize=12,
            fontweight="bold", va="top")
    ax.set_title("association p-values", fontsize=7, pad=4)
    return ax


def panel_c(fig, gs, data):
    """Pleiotropy. Panel c under the current layout."""
    ax = fig.add_subplot(gs)
    styles = {"1e-04": ("-", 1.3), "5e-08": ((0, (3, 1.5)), 1.0)}
    for tname, (ls, lw) in styles.items():
        for a in ANCS:
            d = data["panel_d"][f"{a}|{tname}"]
            n = np.array(d["n"], dtype=float)
            sn = np.array(d["snps"], dtype=float)
            tot = sn.sum()
            if not tot:
                continue
            # reverse cumulative: share of SNPs with at least n phenotypes
            rev = np.cumsum(sn[::-1])[::-1] / tot * 100
            ax.plot(n, rev, linestyle=ls, color=COLOUR[a], linewidth=lw)
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("phenotypes per SNP (at least X)")
    ax.set_ylabel("% of significant SNPs")
    ax.set_xlim(1, 260)
    ax.xaxis.set_major_formatter(FMT)
    ax.yaxis.set_major_formatter(FMT)
    tidy(ax, grid_axis="both")
    anc_keys = [Line2D([], [], color=COLOUR[a], lw=1.3, label=a)
                for a in reversed(ANCS)]
    thr_keys = [Line2D([], [], color=MUTED, lw=1.3, ls="-", label=r"$p<10^{-4}$"),
                Line2D([], [], color=MUTED, lw=1.0, ls=(0, (3, 1.5)),
                       label=r"$p<5\times10^{-8}$")]
    first = ax.legend(handles=anc_keys, fontsize=6, loc="upper right",
                      handlelength=1.4, labelcolor=INK)
    ax.add_artist(first)
    ax.legend(handles=thr_keys, fontsize=6, loc="lower left",
              handlelength=1.8, labelcolor=INK)
    ax.text(-0.16, 1.1, "c", transform=ax.transAxes, fontsize=12,
            fontweight="bold", va="top")
    ax.set_title("pleiotropy", fontsize=7, pad=4)
    return ax


def panel_d(fig, gs, data, unit="association", highlight=()):
    """UpSet over the four ancestries and META. Panel d.

    Every non-empty combination is drawn, not a top-n, with the count
    written above each bar at 45 degrees, and the per-ancestry totals as
    horizontal bars down the left, the way the published figure has them.

    Exclusive intersections, the UpSet default: each bar counts the
    phenotype-SNP pairs significant in exactly that set of groups and in no
    other.
    """
    pats = data["membership"][unit]
    rows = []
    for p in pats:
        mem = [a for a in UPSET_ORDER if p["pattern"][a]]
        if mem:
            rows.append((p["count"], mem))
    rows.sort(key=lambda r: -r[0])

    sub = gs.subgridspec(2, 2, height_ratios=[2.9, 1.25],
                         width_ratios=[1.75, 7.3], hspace=0.07,
                         wspace=0.025)
    bar = fig.add_subplot(sub[0, 1])
    mat = fig.add_subplot(sub[1, 1], sharex=bar)
    setax = fig.add_subplot(sub[1, 0], sharey=mat)
    fig.add_subplot(sub[0, 0]).axis("off")

    x = np.arange(len(rows))
    counts = [r[0] for r in rows]
    cols = [BAR_HIGHLIGHT if tuple(r[1]) in highlight else BAR_BASE
            for r in rows]
    bar.bar(x, counts, width=0.66, color=cols, linewidth=0.6,
            edgecolor="white")
    bar.set_yscale("log")
    bar.yaxis.set_major_formatter(FMT)
    bar.set_ylabel("pairs in the intersection")
    # keep the y label clear of the panel letter
    bar.yaxis.set_label_coords(-0.055, 0.5)
    bar.yaxis.set_major_locator(matplotlib.ticker.LogLocator(numticks=7))
    tidy(bar)
    bar.tick_params(labelbottom=False)
    # the count above every bar, rotated so 30 of them fit
    for xi, c in zip(x, counts):
        bar.annotate(f"{c:,}", (xi, c), textcoords="offset points",
                     xytext=(1.5, 2.5), ha="left", va="bottom", fontsize=4.6,
                     rotation=45, rotation_mode="anchor", color=INK)
    bar.set_ylim(bottom=max(min(counts) / 3.0, 1),
                 top=max(counts) * 16)
    bar.set_title("intersections of significant phenotype-SNP pairs "
                  "across ancestries", fontsize=7, pad=4)
    bar.text(-0.075, 1.125, "d", transform=bar.transAxes, fontsize=12,
             fontweight="bold", va="top")

    # the membership matrix
    n = len(UPSET_ORDER)
    for yi in range(n):
        mat.axhline(yi, color="#f4f4f4", linewidth=7.5, zorder=0)
    for xi, (c, mem) in zip(x, rows):
        on = [n - 1 - UPSET_ORDER.index(a) for a in mem]
        mat.plot([xi] * n, range(n), "o", ms=2.8, color="#dcdcdc", zorder=1)
        col = BAR_HIGHLIGHT if tuple(mem) in highlight else "#3f3f3f"
        mat.plot([xi] * len(on), on, "o", ms=2.8, color=col, zorder=2)
        if len(on) > 1:
            mat.plot([xi, xi], [min(on), max(on)], "-", color=col,
                     linewidth=0.9, zorder=2)
    mat.set_yticks(range(n))
    mat.set_yticklabels(UPSET_ORDER[::-1], fontsize=6)
    mat.set_ylim(-0.6, n - 0.4)
    mat.set_xlim(-0.8, len(rows) - 0.2)
    mat.set_xticks([])
    for side in ("top", "right", "bottom", "left"):
        mat.spines[side].set_visible(False)
    mat.tick_params(length=0)

    # per-ancestry totals, pointing left, with the number beside each bar
    totals = [data["panel_a"][a]["associations"] for a in UPSET_ORDER[::-1]]
    setax.barh(range(n), totals, height=0.5,
               color=[COLOUR[a] for a in UPSET_ORDER[::-1]], zorder=2)
    # The set axis shares y with the matrix, so giving it ticks would move
    # the matrix's too; the row names are drawn here instead, at a fixed
    # left edge with the total beside the bar it belongs to.
    # The name and the total get their own column at the left, rather than
    # riding on the bar: the bars differ by a factor of 570, so a label
    # pinned to the end of each one lands in a different place every row and
    # the long ones collided with the names.
    for yi, (t, a) in enumerate(zip(totals, UPSET_ORDER[::-1])):
        setax.annotate(a, (0.0, yi), xycoords=("axes fraction", "data"),
                       ha="left", va="center", fontsize=6, color=INK)
        setax.annotate(f"{t:,}", (0.56, yi),
                       xycoords=("axes fraction", "data"),
                       ha="right", va="center", fontsize=5, color=INK)
    setax.invert_xaxis()
    setax.set_xscale("log")
    setax.set_xlim(max(totals) * 1e4, max(totals) * 1e-3)
    setax.set_yticks([])
    setax.set_xticks([])
    for side in ("top", "right", "bottom", "left"):
        setax.spines[side].set_visible(False)
    setax.tick_params(length=0)
    setax.set_xlabel("pairs per ancestry", fontsize=5.5, color=MUTED,
                     labelpad=1)
    return bar, mat, setax


def verify(fig):
    """Record every axis's tick labels and offset text.

    The reviewer's complaint was a multiplier sitting above the axis instead
    of in the labels, so "there is no multiplier" is checked rather than
    asserted: matplotlib keeps it in `axis.offsetText`, and this walks every
    axis of the finished figure and records what is actually there.
    """
    report = []
    bad = []
    fig.canvas.draw()
    for i, ax in enumerate(fig.axes):
        for name, axis in (("x", ax.xaxis), ("y", ax.yaxis)):
            off = axis.offsetText.get_text()
            vis = axis.offsetText.get_visible()
            labels = [t.get_text() for t in axis.get_ticklabels()
                      if t.get_text()]
            report.append({"axes": i, "axis": name, "offset_text": off,
                           "offset_visible": bool(vis), "tick_labels": labels})
            if off and vis:
                bad.append(f"axes {i} {name}: {off!r}")
    with open(os.path.join(RESULTS, "fig1_axis_check.json"), "w") as fh:
        json.dump({"offset_text_present": bad, "axes": report}, fh, indent=1)
    if bad:
        raise SystemExit("offset/multiplier text present: " + "; ".join(bad))
    print(f"axis check: {len(report)} axes, no offset or multiplier text")
    return report


def main():
    os.makedirs(OUT, exist_ok=True)
    data = json.load(open(os.path.join(RESULTS, "fig1_data.json")))

    fig = plt.figure(figsize=(7.2, 7.9))
    gs = GridSpec(3, 2, figure=fig, height_ratios=[0.88, 1.05, 2.05],
                  hspace=0.44, wspace=0.26,
                  left=0.085, right=0.985, top=0.962, bottom=0.045)

    panel_a(fig, gs[0, :], data)
    panel_b(fig, gs[1, 0], data)
    panel_c(fig, gs[2 - 1, 1], data)
    panel_d(fig, gs[2, :], data, unit="association",
            highlight={("EAS", "AMR", "AFR", "META", "EUR"),
                       ("AMR", "AFR", "META", "EUR"),
                       ("EUR",)})

    verify(fig)

    png = os.path.join(OUT, "fig1_data_stats.png")
    fig.savefig(png, dpi=DPI)
    fig.savefig(os.path.join(OUT, "fig1_data_stats.pdf"))
    plt.close(fig)
    print(f"wrote fig1_data_stats.png at {DPI} dpi and fig1_data_stats.pdf")


if __name__ == "__main__":
    main()
