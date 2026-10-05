# Figure 1 rebuilt — `fig1_data_stats.png`

Written for the manuscript authors.

The published figure is `figs/data_stats_v6.png` and **neither it nor any
plotting script for it is anywhere on this machine**, so it could not be
opened and matched panel for panel. What follows is rebuilt from the
caption, the four panel descriptions, and the source data; the layout and
the ancestry order (EUR, AFR, AMR, EAS, META) follow the caption and the
order the text uses. **The old colours could not be identified, and the site
has no ancestry palette** — it colours by phenotype category — so the figure
uses the Okabe–Ito accessible set (below). If the originals matter, send the
file and it can be re-matched.

Everything here is at **p < 1e-4 with duplicate rows kept**, over the whole
download (`/home/student/Desktop/full_dataset.csv`, 24,026,422 rows).

---

## 0. Read this first

**The three overlap numbers are `\tbd{}` placeholders in the manuscript
source.** They are not findings that failed to reproduce — they were never
computed. `\tbd{12,558}`, `\tbd{328,152}`, `\tbd{945,657}` all appear wrapped
in the to-be-determined macro in `MVPheWAS_revised.tex`.

Two of the three are nonetheless almost exactly right, which is worth
knowing before anyone rewrites the sentence:

| Placeholder | Rebuilt | Difference |
|---|---|---|
| 12,558 in all four ancestries | **12,555** | 3 |
| 328,152 in all but EAS | **328,160** | 8 |
| 945,657 EUR-only | **9,846,238** | 10.4× |

The first two agree to within 0.03% under one specific definition, which is
strong evidence that definition is the one the original figure used. The
third does not match that definition or any other tried, and the sentence
around it also needs its claim changed — see §3.

**Two further things that are wrong in the text, independent of the
placeholders:**

- **The caption and the text disagree on the unit.** The caption says panel c
  shows "intersection patterns of significant **associations**"; the text
  calls all three numbers "**SNPs**". The numbers that reproduce are
  associations. One of the two has to change.
- **"The largest intersection is EUR-specific" is not true as written.** The
  largest bar is EUR+META (9,846,238). EUR alone is second at 9,464,718.

---

## 1. The definition grid

Every cell is a sum over the 32 ancestry-membership patterns counted once by
`fig1_extract.py`, so the grid costs no extra pass over the source.
Reproduced by `analysis/final/fig1_defgrid.py`; saved as
`results/fig1_defgrid.csv`.

| unit | sets | type | META reading | all four | all but EAS | EUR-only | exact hits |
|---|---|---|---|---|---|---|---|
| unique SNP | 4 ancestries | exclusive | – | 5,836 | 157,530 | 2,694,055 | 0 |
| unique SNP | 4 ancestries | inclusive | – | 5,836 | 157,530 | 2,694,055 | 0 |
| unique SNP | 4 + META | exclusive | META significant | 5,831 | 156,954 | 1,140,113 | 0 |
| unique SNP | 4 + META | exclusive | META not significant | 5 | 576 | 1,553,942 | 0 |
| unique SNP | 4 + META | inclusive | META significant | 5,831 | 156,954 | 1,140,113 | 0 |
| unique SNP | 4 + META | inclusive | META not significant | 5,836 | 157,530 | 2,694,055 | 0 |
| association | 4 ancestries | exclusive | – | 12,606 | 330,798 | 19,310,956 | 0 |
| association | 4 ancestries | inclusive | – | 12,606 | 330,798 | 19,310,956 | 0 |
| **association** | **4 + META** | **exclusive** | **META significant** | **12,555** | **328,160** | 9,846,238 | 0 |
| association | 4 + META | exclusive | META not significant | 51 | 2,638 | 9,464,718 | 0 |
| association | 4 + META | inclusive | META significant | 12,555 | 328,160 | 9,846,238 | 0 |
| association | 4 + META | inclusive | META not significant | 12,606 | 330,798 | 19,310,956 | 0 |
| | | | **drafted (`\tbd`)** | 12,558 | 328,152 | 945,657 | |

**No combination reproduces all three.** The closest is the bolded row, and
it is not close by accident: 12,555 against 12,558 and 328,160 against
328,152 are within 3 and 8 on counts of 10⁴ and 10⁵. Nothing else in the
grid is within three orders of magnitude of two targets at once.

### Definition used for panel c

> **Associations, five sets (the four ancestry groups and META), exclusive
> intersections.** Each bar counts the phenotype–SNP associations significant
> at p < 1e-4 in exactly that set of groups and in no other. Duplicate rows
> are kept.

That is the standard UpSet reading, it matches the caption's existing word
"associations", and it reproduces two of the three placeholders.

### What panel c shows under it

The three bars the text names:

| Intersection | Count |
|---|---|
| EUR + AFR + AMR + EAS + META (all four ancestries) | **12,555** |
| EUR + AFR + AMR + META (all but EAS) | **328,160** |
| EUR + META (the largest bar) | **9,846,238** |
| EUR alone (second largest, the genuinely EUR-specific bar) | 9,464,718 |

**Reasoning for the third.** "945,657" matches no cell of the grid at any
unit, intersection type or META reading, and the gap is a factor of 10, not
a rounding or revision difference. Since the other two match to within 8, the
definition is not in doubt; the number itself appears simply never to have
been computed, which is what `\tbd` records. Rather than pick a definition
that produces something near 945,657 — the brief says not to — panel c shows
the bars as they fall, and the sentence needs rewriting around two facts:
the largest intersection is **EUR + META at 9,846,238**, and the
EUR-and-nothing-else bar is **9,464,718**.

Suggested replacement for the drafted sentence:

> The largest intersection is EUR with the meta-analysis (9,846,238
> associations), followed closely by associations significant in EUR alone
> (9,464,718), together representing variants detectable mainly with the
> statistical power afforded by the largest cohort.

---

## 2. Every Figure 1 number in the text

| # | Drafted | Rebuilt | Verdict |
|---|---|---|---|
| 1 | EUR 21.3 million associations | 21,329,976 | ✓ |
| 2 | EAS 37,388 associations | 37,388 | ✓ exact |
| 3 | META 13.2 million associations | 13,181,839 | ✓ |
| 4 | 1,748 EUR phenotypes with ≥1 association | 1,748 | ✓ |
| 5 | 441 EAS phenotypes | 441 | ✓ |
| 6 | 1,746 META phenotypes | 1,746 | ✓ |
| 7 | EUR 67-fold more participants than EAS | 449,042 / 6,702 = 67.0 | ✓ |
| 8 | phenotype coverage differs by only 4-fold | 1,748 / 441 = 3.96 | ✓ |
| 9 | 18.8% META SNPs with ≥10 phenotypes | 18.790% | ✓ |
| 10 | 1.1% META SNPs with ≥50 | 1.051% | ✓ |
| 11 | 17.3% EUR with ≥10 | 17.337% | ✓ |
| 12 | 1.6% EAS with ≥10 | 1.561% | ✓ |
| 13 | 5.8% AMR with ≥10 | 5.779% | ✓ |
| 14 | META 1.05% vs EUR 0.93% with ≥50 | 1.051% vs 0.930% | ✓ |
| 15 | cohort sizes EAS 6,702 / AMR 59,048 / AFR 121,177 / EUR 449,042 / META 635,969 | from the manuscript, plotted as given | not independently checkable from the association file |
| 16 | `\tbd{12,558}` all four ancestries | 12,555 | **corrected** |
| 17 | `\tbd{328,152}` all but EAS | 328,160 | **corrected** |
| 18 | `\tbd{945,657}` EUR-only, "largest intersection" | 9,846,238 (EUR+META, largest); 9,464,718 (EUR alone) | **corrected, and the claim changes** |

Values not previously in the text, now shown in panel a:

| Metric | EUR | AFR | AMR | EAS | META |
|---|---|---|---|---|---|
| significant SNPs | 3,322,414 | 841,904 | 446,316 | 16,651 | 1,973,373 |
| significant associations | 21,329,976 | 3,718,597 | 1,525,633 | 37,388 | 13,181,839 |
| phenotypes with ≥1 | 1,748 | 1,735 | 1,448 | 441 | 1,746 |

Source: `results/fig1_data.json`.

---

## 3. A discontinuity in panel b worth knowing about

Panel b has a visible step at **p = 1e-6** in every ancestry except META.
It is in the data, not the plot, so the figure marks it rather than smoothing
it away:

| Ancestry | associations in (1e-6, 1e-4] | at p ≤ 1e-6 | step across 1e-6 |
|---|---|---|---|
| EUR | 115,778 | 21,186,555 | **139.6×** |
| AFR | 581,077 | 3,126,157 | 5.3× |
| AMR | 776,318 | 749,299 | 1.7× |
| EAS | 21,022 | 16,366 | 2.9× |
| META | 5,237,906 | 7,935,232 | 0.9× (none) |

META is smooth across 1e-6; EUR jumps by two orders of magnitude at exactly
that point. The pattern is what you would see if the per-ancestry
association sets were exported at a stricter threshold than the
meta-analysis was, with the few EUR rows above 1e-6 present only because some
other ancestry met the retention rule for that phenotype–SNP pair.

**This does not affect any number in §2** — those are all defined at p < 1e-4
and are counted directly. But it means the sentence "larger cohorts exhibit
broader distributions extending to highly significant p-values" is describing
a shape that is partly a filtering artefact, and someone should confirm what
threshold each per-ancestry file was exported at before that sentence stands.

---

## 4. Panel a axis labels — the reviewer's point

**No axis in the figure carries offset or multiplier text.** This is checked,
not asserted: `verify()` in `fig1_data_stats.py` walks all **16 axes** of the
rendered figure, reads `axis.offsetText` from each, and fails the build if
any is non-empty and visible. The run reports:

```
axis check: 16 axes, no offset or multiplier text
```

The per-axis record is in `results/fig1_axis_check.json`. Panel a's four y
axes now read:

| Panel a subplot | y tick labels |
|---|---|
| sample size | 100, 1,000, 1e4, 1e5, 1e6, 1e7 |
| significant SNPs | 1,000, 1e4, 1e5, 1e6, 1e7 |
| significant associations | 1,000, 1e4, 1e5, 1e6, 1e7, 1e8 |
| phenotypes with an association | 10, 100, 1,000, 1e4 |

The exponent is in the tick. Labels stay plain between 0.01 and 9,999, so an
axis that does not need an exponent does not get one — which is why the
phenotype panel reads "1,000" and not "1e3".

Crop of panel a's axes: **`figures/fig1_panel_a_axes_crop.png`**.

**One change beyond the labels.** Panel a's y axes are now **logarithmic**.
On a linear axis EAS is a zero-height bar in three of the four metrics —
6,702 against 635,969, and 37,388 against 21.3 million — and an invisible bar
is worse than a confusing tick. The log axis is what makes the text's own
comparison ("67-fold more participants… only 4-fold more phenotypes")
legible. Say the word and it goes back to linear.

---

## 5. Colours

Okabe–Ito, assigned in a fixed order and validated rather than eyeballed:

| | EUR | AFR | AMR | EAS | META |
|---|---|---|---|---|---|
| hex | `#0072B2` | `#D55E00` | `#009E73` | `#56B4E9` | `#CC79A7` |

Checked against the lightness band, chroma floor, colour-vision-deficiency
separation and normal-vision floor. Worst adjacent pair ΔE 9.6 under
deuteranopia and 18.4 under normal vision, both passing. Two slots sit below
3:1 against white, which is why every panel carries a legend and axis labels
rather than relying on hue alone.

---

## 6. Files

| File | What |
|---|---|
| `figures/fig1_data_stats.png` | the figure, 2880×3040 at **400 dpi** (9.6 in wide) |
| `figures/fig1_data_stats.pdf` | vector |
| `figures/fig1_panel_a_axes_crop.png` | panel a's axes, for §4 |
| `fig1_extract.py` | one pass over the 3.6 GB source → `results/fig1_data.json` (~2.5 min) |
| `fig1_defgrid.py` | the §1 grid → `results/fig1_defgrid.csv` |
| `fig1_data_stats.py` | the plot, including the axis check |
| `results/fig1_axis_check.json` | every axis's tick labels and offset text |

Regenerate with:

```
python3 analysis/final/fig1_extract.py      # once
python3 analysis/final/fig1_defgrid.py
python3 analysis/final/fig1_data_stats.py
```
