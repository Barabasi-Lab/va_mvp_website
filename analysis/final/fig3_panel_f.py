#!/usr/bin/env python3
"""Figure 3, panel f, for the final build.

The drawing is analysis/examples/fig_panel_f.py unchanged - same clumping,
same shared-locus rule, same APOL1/TCF7L2 labelling - re-run against the
regenerated store and written into analysis/final/figures/ under the
panel's final name.

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


def main():
    os.makedirs(OUT, exist_ok=True)
    fig_panel_f.OUT = OUT
    fig_panel_f.main()
    for ext in ("png", "pdf"):
        src = os.path.join(OUT, f"fig3_f2_locus_map.{ext}")
        dst = os.path.join(OUT, f"fig3_f_locus_map.{ext}")
        if os.path.exists(src):
            shutil.move(src, dst)
            print(f"wrote {os.path.basename(dst)}")


if __name__ == "__main__":
    main()
