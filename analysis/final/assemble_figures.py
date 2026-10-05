#!/usr/bin/env python3
"""Draft composites of Figure 3 and the anemia figure.

Both are 3 rows of 2, a-f reading across, which is the layout the current
drafts use. Panels keep their own aspect ratio, are centred both ways in a
cell of uniform width, and the letter sits in a band above the panel rather
than on top of it, because the screenshots carry the control stack in their
top-left corner and a letter placed there covered it.

Centring matters for Figure 3: panel f is drawn rather than captured, so
without it the panel hung from the top of its row instead of sitting level
with the screenshot beside it. fig3_panel_f.py now also draws that panel at
panel e's 1.6:1, so the two are the same height as well as aligned.

These are drafts for the authors to replace, not final artwork.

    python3 analysis/final/assemble_figures.py
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FIGS = os.path.join(HERE, "figures")

CELL_W = 2000          # per-panel width in the composite
PAD = 32               # gutter between cells
MARGIN = 54            # outer margin
LETTER_H = 96          # band above each panel holding its letter
DPI = 400              # the brief asks for at least 300
BG = "white"

FIGURES = {
    "renal_disease_v3.png": [
        "fig3_a_network_eur_total", "fig3_b_network_afr_total",
        "fig3_c_network_eur_discordant", "fig3_d_network_afr_discordant",
        "fig3_e_node_afr_genes_apol1", "fig3_f_locus_map"],
    "anemias_v2.png": [
        "anemia_a_node_afr", "anemia_b_afr_meta",
        "anemia_c_eur_meta", "anemia_d_afr_eur",
        "anemia_e_pvd_eur_meta", "anemia_f_hb_afr_meta"],
}


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def build(name, panels):
    imgs = []
    for p in panels:
        f = os.path.join(FIGS, p + ".png")
        if not os.path.exists(f):
            raise SystemExit(f"missing panel {f}")
        im = Image.open(f).convert("RGB")
        # only ever downscale; upscaling a small panel would invent detail
        if im.width != CELL_W:
            im = im.resize((CELL_W, round(im.height * CELL_W / im.width)),
                           Image.LANCZOS)
        imgs.append(im)

    rows = [imgs[i:i + 2] for i in range(0, len(imgs), 2)]
    row_h = [max(im.height for im in r) + LETTER_H for r in rows]
    W = MARGIN * 2 + CELL_W * 2 + PAD
    H = MARGIN * 2 + sum(row_h) + PAD * (len(rows) - 1)

    out = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(out)
    fnt = font(74)

    y = MARGIN
    for ri, row in enumerate(rows):
        panel_h = row_h[ri] - LETTER_H
        for ci, im in enumerate(row):
            x = MARGIN + ci * (CELL_W + PAD)
            draw.text((x, y), "abcdef"[ri * 2 + ci], fill="black", font=fnt)
            # centre the panel in the cell, so a short panel sits level with
            # a tall one instead of hanging from the top of the row
            dy = (panel_h - im.height) // 2
            out.paste(im, (x, y + LETTER_H + dy))
        y += row_h[ri] + PAD

    path = os.path.join(FIGS, name)
    out.save(path, dpi=(DPI, DPI))
    print(f"wrote {name}  {W}x{H} at {DPI} dpi "
          f"({W / DPI:.1f} x {H / DPI:.1f} in)")


if __name__ == "__main__":
    for name, panels in FIGURES.items():
        build(name, panels)
