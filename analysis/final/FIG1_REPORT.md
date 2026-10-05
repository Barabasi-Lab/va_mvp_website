# Figure 1 rebuilt — `fig1_data_stats.png`

Written for the manuscript authors.

With `data_stats_v6.png` now in `analysis/final/figures/`, the rebuild could
be checked against the published figure instead of inferred from the
caption. **It reproduces every printed number in it exactly** — all five
ancestry totals and all 29 printed UpSet bars. That also settles the three
`\tbd{}` placeholders.

Everything is at **p < 1e-4** over the whole download
(`/home/student/Desktop/full_dataset.csv`, 24,026,422 rows).

---

## 0. Read this first

### 0.1 The unit is the phenotype–SNP *pair*, with duplicates collapsed by minimum p

The published figure counts **distinct (phenotype, SNP) pairs**, where a pair
counts as significant in an ancestry if **any** of its duplicate rows is —
equivalently, collapse duplicates by taking the minimum p in each ancestry
independently, then count pairs.

This is not inferred. It is the only rule tried that hits all five published
totals on the nose:

| | EAS | AMR | AFR | META | EUR |
|---|---|---|---|---|---|
| published figure | 37,359 | 1,524,699 | 3,715,156 | 13,170,692 | 21,312,381 |
| this rebuild | **37,359** | **1,524,699** | **3,715,156** | **13,170,692** | **21,312,381** |

and all 29 of its UpSet bars, from 9,837,736 down to 51, with no exceptions.

### 0.2 "945,657" is 9,456,572 with the last digit dropped

The three placeholders resolve as:

| Placeholder | Published bar | Intersection |
|---|---|---|
| `\tbd{12,558}` | **12,558** ✓ exact | EUR+AFR+AMR+EAS+META |
| `\tbd{328,152}` | **328,152** ✓ exact | EUR+AFR+AMR+META |
| `\tbd{945,657}` | **9,456,572** | EUR alone |

9456572 → "945,657" is the same digits with the final `2` lost and the comma
re-placed. The figure has always had the right number; the text lost a digit
transcribing it. **The sentence is out by a factor of ten.**

### 0.3 …but the claim around it is still wrong

> "The largest intersection is EUR-specific (945,657 SNPs)"

EUR-alone is the **second** largest bar. The largest is **EUR+META at
9,837,736**. Suggested replacement:

> The two largest intersections are EUR with the meta-analysis (9,837,736
> pairs) and EUR alone (9,456,572), together representing variants
> detectable mainly with the statistical power afforded by the largest
> cohort.

### 0.4 The text and the figure were computed differently

The text's association counts are **raw rows**; the figure's are **collapsed
pairs**. They disagree:

| | text | figure | difference |
|---|---|---|---|
| EAS associations | **37,388** | **37,359** | 29 |
| EUR associations | 21.3 million | 21,312,381 | within rounding |
| META associations | 13.2 million | 13,170,692 | within rounding |

Only EAS is quoted precisely enough for the gap to show, and it is quoted in
the text at the raw-row value while panel a plots the pair value. **Pick one
unit.** The rebuilt panel a uses the figure's, so the text's "37,388" should
become **37,359**.

### 0.5 The word "SNPs" is wrong in three places

The text calls all three overlap numbers "SNPs"; they are phenotype–SNP
pairs. The caption is already right — it says "significant associations".
The SNP-level equivalents are far smaller (5,831 / 156,954 / 1,140,113), so
this is not a quibble.

---

## 1. The definition grid

Reproduced by `fig1_defgrid.py`, saved as `results/fig1_defgrid.csv`. Each
cell is a sum over the 30 membership patterns counted once by
`fig1_extract.py`.

| unit | sets | type | META reading | all four | all but EAS | EUR-only | exact hits |
|---|---|---|---|---|---|---|---|
| unique SNP | 4 ancestries | exclusive | – | 5,836 | 157,530 | 2,694,055 | 0 |
| unique SNP | 4 ancestries | inclusive | – | 5,836 | 157,530 | 2,694,055 | 0 |
| unique SNP | 4 + META | exclusive | META significant | 5,831 | 156,954 | 1,140,113 | 0 |
| unique SNP | 4 + META | exclusive | META not significant | 5 | 576 | 1,553,942 | 0 |
| unique SNP | 4 + META | inclusive | META significant | 5,831 | 156,954 | 1,140,113 | 0 |
| unique SNP | 4 + META | inclusive | META not significant | 5,836 | 157,530 | 2,694,055 | 0 |
| pair | 4 ancestries | exclusive | – | 12,609 | 330,777 | 19,294,308 | 0 |
| pair | 4 ancestries | inclusive | – | 12,609 | 330,777 | 19,294,308 | 0 |
| **pair** | **4 + META** | **exclusive** | **META significant** | **12,558** | **328,152** | 9,837,736 | **2** |
| pair | 4 + META | exclusive | META not significant | 51 | 2,625 | **9,456,572** | 0 |
| pair | 4 + META | inclusive | META significant | 12,558 | 328,152 | 9,837,736 | 2 |
| pair | 4 + META | inclusive | META not significant | 12,609 | 330,777 | 19,294,308 | 0 |
| | | | **drafted (`\tbd`)** | 12,558 | 328,152 | 945,657 | |

The bolded row is the definition. The third drafted number is the EUR-alone
bar from the row below it — a different bar of the same plot, not a
different definition.

### Caption sentence for panel c → now panel d

> **d.** UpSet plot of significant phenotype–SNP pairs across the four
> ancestry groups and the meta-analysis at p < 1e-4. Each bar counts the
> pairs significant in exactly that combination of groups and no other;
> duplicate rows are collapsed by taking the minimum p in each group. The
> horizontal bars give each group's total.

The only change from the current caption is naming the unit and stating that
the intersections are exclusive.

---

## 2. Every Figure 1 number in the text

| # | Drafted | Rebuilt | Verdict |
|---|---|---|---|
| 1 | EUR 21.3 million associations | 21,312,381 | ✓ |
| 2 | EAS 37,388 associations | **37,359** | **corrected** (text used raw rows, figure uses pairs — §0.4) |
| 3 | META 13.2 million associations | 13,170,692 | ✓ |
| 4 | 1,748 EUR phenotypes with ≥1 | 1,748 | ✓ |
| 5 | 441 EAS phenotypes | 441 | ✓ |
| 6 | 1,746 META phenotypes | 1,746 | ✓ |
| 7 | EUR 67-fold more participants than EAS | 67.0 | ✓ |
| 8 | phenotype coverage differs by only 4-fold | 3.96 | ✓ |
| 9 | 18.8% META SNPs with ≥10 phenotypes | 18.790% | ✓ |
| 10 | 1.1% META SNPs with ≥50 | 1.051% | ✓ |
| 11 | 17.3% EUR with ≥10 | 17.337% | ✓ |
| 12 | 1.6% EAS with ≥10 | 1.561% | ✓ |
| 13 | 5.8% AMR with ≥10 | 5.779% | ✓ |
| 14 | META 1.05% vs EUR 0.93% with ≥50 | 1.051% vs 0.930% | ✓ |
| 15 | cohort sizes EAS 6,702 / AMR 59,048 / AFR 121,177 / EUR 449,042 / META 635,969 | plotted as given | not checkable from the association file |
| 16 | `\tbd{12,558}` all four ancestries | 12,558 | ✓ exact |
| 17 | `\tbd{328,152}` all but EAS | 328,152 | ✓ exact |
| 18 | `\tbd{945,657}` EUR-only, "largest intersection" | **9,456,572**, and it is the second largest | **corrected, and the claim changes** (§0.2, §0.3) |

Panel a's full values (pairs; raw-row counts in `fig1_data.json` under
`panel_a_raw_rows`):

| Metric | EAS | AMR | AFR | EUR | META |
|---|---|---|---|---|---|
| significant SNPs | 16,651 | 446,316 | 841,904 | 3,322,414 | 1,973,373 |
| significant pairs | 37,359 | 1,524,699 | 3,715,156 | 21,312,381 | 13,170,692 |
| phenotypes with ≥1 | 441 | 1,448 | 1,735 | 1,748 | 1,746 |

---

## 3. The p-value discontinuity at 1e-6

Panel b steps at **p = 1e-6** in every ancestry except META, by 140× in EUR.
It is in the data rather than an artefact of the plot, and it is recorded
here only so the numbers are on the table; the authors have an explanation
for it.

| Ancestry | pairs in (1e-6, 1e-4] | at p ≤ 1e-6 | step |
|---|---|---|---|
| EUR | 115,778 | 21,186,555 | **139.6×** |
| AFR | 581,077 | 3,126,157 | 5.3× |
| AMR | 776,318 | 749,299 | 1.7× |
| EAS | 21,022 | 16,366 | 2.9× |
| META | 5,237,906 | 7,935,232 | 0.9× (none) |

META is smooth across 1e-6; EUR jumps two orders of magnitude at exactly
that point.

It affects **no counted number** — those are all at p < 1e-4 and counted
directly. Whether it bears on the drafted sentence that "larger cohorts
exhibit broader distributions" depends on the explanation, which is the
authors'.

---

## 4. Panel a axis labels — the reviewer's point

**No axis carries offset or multiplier text.** Checked, not asserted:
`verify()` walks all **20 axes** of the rendered figure, reads
`axis.offsetText` from each, and fails the build if any is non-empty and
visible:

```
axis check: 20 axes, no offset or multiplier text
```

Per-axis record: `results/fig1_axis_check.json`. Crop:
`figures/fig1_panel_a_axes_crop.png`.

Panel a's y ticks now read `1,000 / 1e4 / 1e5 / 1e6` and so on — exponent in
the tick, plain below 10,000, so the phenotype panel reads "1,000" rather
than "1e3".

**Panel a is now log-scaled.** On the published linear axes EAS is a
zero-height bar in three of four metrics (6,702 against 635,969; 37,359
against 21.3 million). The log axis makes all five visible and makes the
text's own "67-fold vs 4-fold" comparison legible. Easy to revert.

---

## 5. What differs from `data_stats_v6.png`

| | Published | Here | Why |
|---|---|---|---|
| panel a scale | linear with a `1e5`-style multiplier above each axis | log, exponent in the tick | the reviewer's point, plus EAS was invisible |
| ancestry order | EAS → META ascending | same | matched |
| UpSet row order | EAS, AMR, AFR, META, EUR | same | matched (ascending set size) |
| panel b | ridgeline, one filled row per ancestry, x from −20 to 0 | overlaid density curves, full range to −306 | your call on the new layout; the full range is where the 1e-6 step shows |
| panel c / d | pleiotropy was d, UpSet was c | **pleiotropy is c, UpSet is d** | as requested |
| UpSet bars | 29 shown | **all 30** (adds AFR+AMR+EAS = 6) | as requested |
| pleiotropy | 5 subplots, 5 thresholds, linear 0–50 | one plot, 2 thresholds, log | your call on the new layout |
| colours | viridis | Okabe–Ito (below) | see note |

**Colours.** The published figure uses viridis. I kept the Okabe–Ito set
because viridis is a sequential ramp used on nominal categories — it
double-encodes order that ancestries do not have, and its light end (META
yellow) falls below the contrast floor on white. Okabe–Ito was validated:
worst adjacent pair ΔE 9.6 under deuteranopia, 18.4 under normal vision,
both passing, with lightness and chroma in band.

| | EAS | AMR | AFR | EUR | META |
|---|---|---|---|---|---|
| hex | `#56B4E9` | `#009E73` | `#D55E00` | `#0072B2` | `#CC79A7` |

Say the word and it goes back to viridis.

---

## 6. Files

| File | What |
|---|---|
| `figures/fig1_data_stats.png` | the figure, 2880×3160 at **400 dpi** (7.2 in wide) |
| `figures/fig1_data_stats.pdf` | vector |
| `figures/fig1_panel_a_axes_crop.png` | panel a's axes, for §4 |
| `figures/data_stats_v6.png` | the published figure, for comparison |
| `fig1_extract.py` | one pass over the 3.6 GB source → `results/fig1_data.json` |
| `fig1_defgrid.py` | the §1 grid → `results/fig1_defgrid.csv` |
| `fig1_data_stats.py` | the plot, including the axis check |

```
python3 analysis/final/fig1_extract.py      # ~2.5 min cold, seconds warm
python3 analysis/final/fig1_defgrid.py
python3 analysis/final/fig1_data_stats.py
```
