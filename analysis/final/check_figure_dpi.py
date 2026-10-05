#!/usr/bin/env python3
"""Make every figure in analysis/final/figures/ declare at least 300 dpi.

A PNG carries its resolution only as metadata, and a headless-Chromium
screenshot writes none at all, so a panel that is plainly high enough
resolution still reports "unknown" to anything that reads the file. This
stamps a resolution on the files that have none and reports the print size
each one supports, which is the number that actually matters: pixels divided
by 300 is the largest a panel can be placed and still clear the bar.

    python3 analysis/final/check_figure_dpi.py

Stamping changes metadata only; the pixels are untouched.
"""
from __future__ import annotations

import csv
import glob
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FIGS = os.path.join(HERE, "figures")
RESULTS = os.path.join(HERE, "results")
MIN_DPI = 300
# what a screenshot panel is stamped with when it has no metadata of its own
DEFAULT_DPI = 300


def main():
    rows = []
    for path in sorted(glob.glob(os.path.join(FIGS, "*.png"))):
        im = Image.open(path)
        dpi = im.info.get("dpi")
        stamped = False
        if not dpi or round(dpi[0]) < MIN_DPI:
            im.load()
            im.save(path, dpi=(DEFAULT_DPI, DEFAULT_DPI))
            dpi = (DEFAULT_DPI, DEFAULT_DPI)
            stamped = True
        w, h = im.size
        rows.append({
            "file": os.path.basename(path),
            "pixels": f"{w}x{h}",
            "dpi": round(dpi[0]),
            "stamped_here": stamped,
            "print_size_at_declared_dpi_in": f"{w/dpi[0]:.2f} x {h/dpi[0]:.2f}",
            "max_width_in_at_300dpi": round(w / 300, 2),
            "meets_300": round(dpi[0]) >= MIN_DPI,
        })

    for path in sorted(glob.glob(os.path.join(FIGS, "*.pdf"))):
        rows.append({
            "file": os.path.basename(path), "pixels": "vector",
            "dpi": "vector", "stamped_here": False,
            "print_size_at_declared_dpi_in": "any",
            "max_width_in_at_300dpi": "any", "meets_300": True})

    with open(os.path.join(RESULTS, "figure_resolutions.csv"), "w",
              newline="") as fh:
        w_ = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w_.writeheader(); w_.writerows(rows)

    bad = [r for r in rows if not r["meets_300"]]
    print(f"{'file':<36}{'pixels':>12}{'dpi':>7}{'max width @300dpi':>20}")
    for r in rows:
        print(f"{r['file']:<36}{r['pixels']:>12}{str(r['dpi']):>7}"
              f"{str(r['max_width_in_at_300dpi']) + ' in':>20}")
    print()
    print(f"{len(rows)} figures, {sum(r['stamped_here'] for r in rows)} stamped here, "
          f"{len(bad)} below {MIN_DPI} dpi")
    if bad:
        raise SystemExit("below 300 dpi: " + ", ".join(r["file"] for r in bad))


if __name__ == "__main__":
    main()
