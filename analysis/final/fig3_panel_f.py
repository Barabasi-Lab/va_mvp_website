#!/usr/bin/env python3
"""Figure 3, panel f, for the final build.

The drawing is analysis/examples/fig_panel_f.py - same clumping, same
shared-locus rule, same APOL1/TCF7L2 labelling - re-run against the
regenerated store and written into analysis/final/figures/ under the
panel's final name.

Two things are overridden. The shape: at its native 11x4.2 this panel is
2.6:1 against panel e's 1.6:1, so in the composite it sat as a letterbox
beside a much taller screenshot. It is drawn at 1.6:1 to match, which also
gives the locus labels room they did not have. And the resolution: 400 dpi,
so the panel is not the limiting factor in a composite that has to clear
300.

    python3 analysis/final/fig3_panel_f.py
"""
from __future__ import annotations

import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "va_mvp_website", "analysis", "examples")
                if os.path.basename(ROOT) != "va_mvp_website"
                else os.path.join(ROOT, "analysis", "examples"))

import fig_panel_f

OUT = os.path.join(HERE, "figures")
# panel e is captured at 2000x1250, so 1.6:1
ASPECT = 2000 / 1250
WIDTH_IN = 11.0
DPI = 400


def main():
    os.makedirs(OUT, exist_ok=True)
    fig_panel_f.OUT = OUT
    fig_panel_f.FIGSIZE = (WIDTH_IN, WIDTH_IN / ASPECT)
    fig_panel_f.DPI = DPI
    fig_panel_f.main()
    for ext in ("png", "pdf"):
        src = os.path.join(OUT, f"fig3_f2_locus_map.{ext}")
        dst = os.path.join(OUT, f"fig3_f_locus_map.{ext}")
        if os.path.exists(src):
            shutil.move(src, dst)
            print(f"wrote {os.path.basename(dst)}")


if __name__ == "__main__":
    main()
