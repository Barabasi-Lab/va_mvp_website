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

ANCS = ["EUR", "AFR", "AMR", "EAS", "META"]
COLOUR = {"EUR": "#0072B2", "AFR": "#D55E00", "AMR": "#009E73",
          "EAS": "#56B4E9", "META": "#CC79A7"}

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
        # light smoothing so the 0.25-wide exact bins read as a KDE would.
        # Reflect at the ends - zero padding pulled the first bins down and
        # put a false dip at the left edge of the EUR curve.
        if len(y) > 11:
            k = np.ones(5) / 5.0
            pad = np.r_[y[4:0:-1], y, y[-2:-6:-1]]
            y = np.convolve(pad, k, mode="same")[4:-4]
        ax.plot(x, y, color=COLOUR[a], linewidth=1.3, label=a,
                solid_capstyle="round")
    # Every ancestry except META steps at p = 1e-6, by 140x in EUR. It is a
    # property of the source data, not of this plot, so it is marked rather
    # than smoothed away. See FIG1_REPORT.md.
    ax.axvline(6, color=MUTED, linewidth=0.5, zorder=0)
    ax.annotate(r"$p=10^{-6}$", xy=(6, 1.0), xycoords=("data", "axes fraction"),
                xytext=(3, -8), textcoords="offset points", fontsize=5.5,
                color=MUTED, ha="left", va="top")
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


def panel_d(fig, gs, data):
    ax = fig.add_subplot(gs)
    styles = {"1e-04": ("-", 1.3), "5e-08": ((0, (3, 1.5)), 1.0)}
    for tname, (ls, lw) in styles.items():
        for a in ANCS:
            d = data["panel_d"][f"{a}|{tname}"]
            n = np.array(d["n"], dtype=float)
            s = np.array(d["snps"], dtype=float)
            tot = s.sum()
            if not tot:
                continue
            # reverse cumulative: share of SNPs with at least n phenotypes
            rev = np.cumsum(s[::-1])[::-1] / tot * 100
            ax.plot(n, rev, linestyle=ls, color=COLOUR[a], linewidth=lw)
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("phenotypes per SNP (at least X)")
    ax.set_ylabel("% of significant SNPs")
    ax.set_xlim(1, 260)
    ax.xaxis.set_major_formatter(FMT)
    ax.yaxis.set_major_formatter(FMT)
    tidy(ax, grid_axis="both")
    anc_keys = [Line2D([], [], color=COLOUR[a], lw=1.3, label=a) for a in ANCS]
    thr_keys = [Line2D([], [], color=MUTED, lw=1.3, ls="-", label=r"$p<10^{-4}$"),
                Line2D([], [], color=MUTED, lw=1.0, ls=(0, (3, 1.5)),
                       label=r"$p<5\times10^{-8}$")]
    first = ax.legend(handles=anc_keys, fontsize=6, loc="upper right",
                      handlelength=1.4, labelcolor=INK)
    ax.add_artist(first)
    ax.legend(handles=thr_keys, fontsize=6, loc="lower left",
              handlelength=1.8, labelcolor=INK)
    ax.text(-0.16, 1.1, "d", transform=ax.transAxes, fontsize=12,
            fontweight="bold", va="top")
    ax.set_title("pleiotropy", fontsize=7, pad=4)
    return ax


def panel_c(fig, gs, data, unit="association", top=13, highlight=()):
    """UpSet over the four ancestries and META.

    Exclusive intersections, the UpSet default: each bar counts the records
    significant in exactly that set of groups and in no other.
    """
    pats = data["membership"][unit]
    rows = []
    for p in pats:
        mem = [a for a in ANCS if p["pattern"][a]]
        if mem:
            rows.append((p["count"], mem))
    rows.sort(key=lambda r: -r[0])
    rows = rows[:top]

    sub = gs.subgridspec(2, 1, height_ratios=[2.5, 1.5], hspace=0.06)
    bar = fig.add_subplot(sub[0])
    mat = fig.add_subplot(sub[1], sharex=bar)

    x = np.arange(len(rows))
    counts = [r[0] for r in rows]
    cols = [BAR_HIGHLIGHT if tuple(r[1]) in highlight else BAR_BASE
            for r in rows]
    bar.bar(x, counts, width=0.68, color=cols, linewidth=0.8,
            edgecolor="white")
    bar.set_yscale("log")
    bar.yaxis.set_major_formatter(FMT)
    bar.set_ylabel(f"{unit}s in the intersection" if unit == "snp"
                   else "associations in the intersection")
    bar.yaxis.set_major_locator(matplotlib.ticker.LogLocator(numticks=6))
    tidy(bar)
    bar.tick_params(labelbottom=False)
    # direct-label only the three the manuscript text names
    for xi, (c, mem) in zip(x, rows):
        if tuple(mem) in highlight:
            bar.annotate(compact_sci(c), (xi, c), textcoords="offset points",
                         xytext=(0, 3), ha="center", fontsize=6,
                         color=INK, fontweight="bold")
    bar.text(-0.075, 1.1, "c", transform=bar.transAxes, fontsize=12,
             fontweight="bold", va="top")
    bar.set_title("intersections of significant associations across ancestries",
                  fontsize=7, pad=4)

    # the membership matrix
    for yi, a in enumerate(ANCS):
        mat.axhline(len(ANCS) - 1 - yi, color="#f2f2f2", linewidth=6, zorder=0)
    for xi, (c, mem) in zip(x, rows):
        on = [len(ANCS) - 1 - ANCS.index(a) for a in mem]
        mat.plot([xi] * len(ANCS), range(len(ANCS)), "o", ms=3.4,
                 color="#d9d9d9", zorder=1)
        col = BAR_HIGHLIGHT if tuple(mem) in highlight else "#4a4a4a"
        mat.plot([xi] * len(on), on, "o", ms=3.4, color=col, zorder=2)
        if len(on) > 1:
            mat.plot([xi, xi], [min(on), max(on)], "-", color=col,
                     linewidth=1.1, zorder=2)
    mat.set_yticks(range(len(ANCS)))
    mat.set_yticklabels(ANCS[::-1], fontsize=6)
    mat.set_ylim(-0.6, len(ANCS) - 0.4)
    mat.set_xlim(-0.7, len(rows) - 0.3)
    mat.set_xticks([])
    for side in ("top", "right", "bottom", "left"):
        mat.spines[side].set_visible(False)
    mat.tick_params(length=0)
    return bar, mat


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

    fig = plt.figure(figsize=(7.2, 7.6))
    gs = GridSpec(3, 2, figure=fig, height_ratios=[1.0, 1.15, 1.5],
                  hspace=0.62, wspace=0.26,
                  left=0.085, right=0.985, top=0.955, bottom=0.055)

    panel_a(fig, gs[0, :], data)
    panel_b(fig, gs[1, 0], data)
    panel_d(fig, gs[1, 1], data)
    panel_c(fig, gs[2, :], data, unit="association",
            highlight={("EUR", "AFR", "AMR", "EAS", "META"),
                       ("EUR", "AFR", "AMR", "META"),
                       ("EUR", "META")})

    verify(fig)

    png = os.path.join(OUT, "fig1_data_stats.png")
    fig.savefig(png, dpi=DPI)
    fig.savefig(os.path.join(OUT, "fig1_data_stats.pdf"))
    plt.close(fig)
    print(f"wrote fig1_data_stats.png at {DPI} dpi and fig1_data_stats.pdf")


if __name__ == "__main__":
    main()
