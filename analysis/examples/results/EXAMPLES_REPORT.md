# The two worked examples, re-run against the corrected data

ESRD (585.32, `fig:renal_disease`) and iron deficiency anemia (280.1,
`fig:anemias`), audited claim by claim against the association store.

Every number below comes from the store unless a column says "screen".
Reproduce with:

```bash
python3 analysis/examples/p0_prerequisites.py     # Phase 0
python3 analysis/examples/e_esrd.py               # ESRD
python3 analysis/examples/a_anemia.py             # anemia
RANK_METRIC=pval node server.js &                 # P2
node analysis/examples/shoot_figures.js           # panels
python3 analysis/examples/fig_panel_f.py          # panel f, candidate 2
```

Inputs and checksums: `results/p0_summary.json`. Seed 20261002.
Positions and tier classification are reused from the previous task
(dbSNP155/GRCh38, 835,375 rsids resolved; `phecode_definitions1.2.csv`).

---

## 1. Prerequisites

### P1. Where the page-1 edgelist comes from

**Found.** `~/Desktop/debug_pheno_graphs.ipynb`, outside the repo. It
settles the Supplementary Methods question three ways:

| Question | What the notebook does |
|---|---|
| >40-phenotype filter | **Not applied.** `make_matrix` has it behind `frequent_snp`, which is set to `False`, and the source file is named `graphs_all_ancestries_False.csv` |
| Survey nodes | **Excluded** (`bio_cats_filtered` drops category `survey`) |
| Duplicate rows | Dropped with `~df[['phenotype','rsid']].duplicated()` — keeps whichever row came first, not the smallest p |
| Weight | Raw count of shared SNPs, split by sign agreement between the two phenotypes |

**The Supplementary Methods sentence about excluding SNPs in more than 40
phenotypes describes an option that was switched off. It should be removed.**

### P1.2–P1.3. Which definition matches

Both versions recomputed for the two neighbourhoods at p < 1e-4
(`results/p1_edgelist_match.csv`):

| Target | Ancestry | Unfiltered | With the >=40 filter |
|---|---|---|---|
| ESRD | AFR | **86 / 86, no set difference** | 54 / 86, 28 stored neighbours absent |
| ESRD | EUR | **142 / 142, no set difference** | 59 / 142, 75 absent |
| ESRD | META | **160 / 160, no set difference** | 94 / 160, 63 absent |
| anemia | AFR | 35 / 34, one extra | 35 / 34 |
| anemia | EUR | **238 / 237** | 100 / 237, 135 absent |
| anemia | META | **240 / 239** | 109 / 239, 127 absent |

Anemia's unfiltered ratio spread is 3.5e-16 (EUR) and 4.2e-16 (META) —
machine precision. **The unfiltered definition matches; the filtered one is
not close.**

### P1. The weights are max-normalised, per column

`scaled = raw / column_max × 50`, each column independently. Verified to
eight decimals: META concordant raw max 48,886 → k = 0.00102279; AFR
concordant raw max 6,044 → k = 0.00827267.

**Consequence worth stating in the methods: page-1 edge weights are not
comparable across ancestries, thresholds, or between the concordant and
discordant columns.** An AFR edge and a META edge drawn at the same
thickness differ by about 8× in underlying SNP count; within META a
concordant and a discordant edge at the same thickness differ by about
5.4×. Figure 3 panels a and b compare AFR against EUR appearance directly.

### P1.4. Only three of the nine thresholds are usable — stop and report

Network-wide per-edge agreement against an unfiltered recomputation at each
column's own threshold, using the notebook's duplicate rule
(`results/p1_threshold_sweep.csv`):

| Column | Recomputed edges | Stored edges | Only in one | Agreement |
|---|---|---|---|---|
| eur_1e-04 | 43,517 | 43,301 | 279 / 63 | **99.1%** |
| eur_1e-05 | 43,387 | 43,171 | 279 / 63 | **99.1%** |
| eur_1e-06 | 43,234 | 43,018 | 279 / 63 | **99.2%** |
| eur_1e-07 | 27,914 | 27,846 | 13,557 / 13,489 | **5.4%** |
| eur_1e-08 | 20,299 | 20,094 | 12,904 / 12,699 | **1.7%** |
| meta_1e-04 | 41,678 | 41,504 | 258 / 84 | 97.0% |
| meta_1e-07 | 23,011 | 23,054 | 13,168 / 13,211 | 6.2% |
| afr_1e-04 | 4,660 | 4,636 | 49 / 25 | 94.6% |
| afr_1e-08 | 1,276 | 1,353 | 1,247 / 1,324 | 6.9% |

**18 of the 27 columns match nothing.** The break is between 1e-06 and
1e-07 and is identical in all three ancestries. The edge *counts* and the
weight *distributions* are right at every threshold — the values look like
correct weights attached to the wrong edges.

I inferred a mechanism from the notebook's `pd.concat(axis=1)` over blocks
whose index was never reset, tried to reproduce it in a toy case, and could
not. **The measurement stands; the cause is unexplained.**

Consequences:
- Both worked examples use p < 1e-4, inside the valid band, so everything
  below is unaffected.
- **Page 1's p-value slider produces wrong edges below 1e-6 on the live
  site.** That is a separate bug, not part of this task, and should be
  fixed or the slider limited to the three valid settings.
- No manuscript number may be taken from page 1 at 1e-7 or stricter.

### P1.5. Page 1 against page 3

19 of 20 random edges agree on the concordant count and 19 of 20 on the
discordant count (`results/p1_page1_vs_page3.csv`). The one disagreement is
a duplicate-row pair.

### P2. Ranking metric

Every panel in section 7 was captured from a build started with
`RANK_METRIC=pval`. The shipped default is still `z`.

### P3. Duplicate rows

36,693 (phenotype, SNP) pairs carry more than one row, but they are two
different things:

| | Count |
|---|---|
| Merged nodes carrying one row per phecode — **not duplicates** | 34,003 |
| **True duplicates** (one phecode, several rows) | **2,690** |
| …of which exact | **0** |
| …of which disagree on beta, SE or p | **2,690** |

**There are no exact duplicates. Every one disagrees.** The analysis rule
(keep the smallest p) therefore applies to all of them, and the choice is
never free.

The five merged nodes are 236 Gout, 373 Sleep apnea, 463 Glaucoma, 708
Asthma, 1175 Osteoporosis.

| Example | Neighbours | True duplicate pairs in scope | On the target itself | Merged neighbours |
|---|---|---|---|---|
| ESRD | 169 | 717 | **3** | Gout, Sleep apnea, Glaucoma |
| anemia 280.1 | 252 | 2,240 | 0 | all five |

**Where this changed a reported number.** ESRD's three are
(905, rs35305544), whose two rows have opposite AFR betas: +0.1582 at
p = 4.1e-7 and −0.2291 at p = 9.3e-22. In the shipped node view those two
rows drew two lines on top of each other, and the comparison join — keyed
on (source, target), last row wins — combined one row's AFR beta with the
other's EUR beta to produce a direction product of −1. That was the single
"discordant" edge visible on ESRD in AFR+EUR. It is an artefact: all 14 of
ESRD's shared AFR/EUR SNPs agree in sign. Fixed in `public/js/rows.js`;
regression test in `scripts/test_edge_colours.js`.

---

## 2. ESRD claim table

| ID | Current claim | Store result | Screen | Verdict | Replacement |
|---|---|---|---|---|---|
| E1 | Verma reported AFR associations that did not reach significance in EUR | At p < 5e-8: AFR **389 SNPs / 5 loci**, EUR **372 SNPs / 3 loci**, META 467 / 10 | — | **Needs reframing** | EUR is not short of genome-wide signal. The difference is *which* loci, not how many |
| E2 | ESRD sits within a cluster of genitourinary and hematopoietic conditions | AFR: 18 of 86 neighbours, **70.3% of weight**. EUR: 27 of 142, **36.8% of weight** | — | **Supported with revised number** for AFR; weak for EUR | AFR 0.703, EUR 0.368 of edge weight |
| E3 | In AFR, numerous within-cluster connections, predominantly concordant | Concordant weight **0.998**; within-cluster weight **0.703**; but within-cluster *neighbours* 20.9% | panels b, d | **Supported with revised number** | Say "by edge weight". By neighbour count AFR (20.9%) and EUR (19.0%) are the same |
| E4 | In EUR, fewer within-cluster connections, many edges to unrelated phenotypes, **"most connections involve opposing directions"** | discordant weight **0.200**; neighbours with any discordant SNP **44/142 = 31.0%**; majority-discordant **34/142 = 23.9%** | panel c | **Not supported** | No reading reaches "most". Highest is 31% |
| E5 | Both ancestries have >100 SNPs at p < 1e-4 | AFR **713**, EUR **554** | — | **Supported as written** | — |
| E6 | The SNPs are distributed across different chromosomes | AFR **91.6% on chr22**; EUR **69.7% on chr10** | — | **Supported with revised number** | Quantify it; this is the strongest part of the case |
| E7 | Only one shared SNP, "nearly zero overlap" | **14 shared**, 1.12% of the union of 1,253 | panel f: 14 | **Not supported** | 14 SNPs, 1.12%; at the locus level 2 of 32 AFR loci |
| E8 | AFR n = 121,177; EUR n = 449,042 | **Not in the store** — no sample-size or case-count column | — | **Cannot verify** | Open item 8.1 |
| E9 | Consistent with APOL1 risk variants | APOL1 is AFR's heaviest locus (3,993 of 4,755 shared SNPs). **But it is present in EUR**: AFR lead rs9622362 has EUR beta −0.400 at p = 0.021, same direction | panel e | **Needs reframing** | "Far weaker in EUR", not "absent". Whether that is frequency or power needs allele frequencies the store lacks |
| E10 | The AFR architecture is "nearly absent" in EUR | Of AFR's 32 locus leads, 16 are **missing** from EUR's data, 6 **inconsistent**, 7 **consistent but not significant**, 3 **consistent and nominally significant** | — | **Supported with revised number** | Half of AFR's loci have no EUR data at all; the APOL1 lead is the exception and is present |

---

## 3. ESRD analyses

### E-B. Loci, and the TCF7L2 question

`results/esrd_loci.csv`. Positions cover 661 of 713 AFR SNPs and 506 of 554
EUR SNPs; locus metrics are on that subset.

| | AFR | EUR | META |
|---|---|---|---|
| Loci at p < 1e-4 | 32 | 23 | 33 |
| Shared AFR↔EUR (leads within ±500 kb) | **2** | | |

**Both questions in E-B.2 answer yes.** The two shared loci are **APOL1**
(chr22; AFR lead rs9622362, EUR lead rs7291184) and **TCF7L2** (chr10; AFR
lead rs7903146, EUR lead rs34872471). The EUR chr10 signal *is* TCF7L2.

**The two shared loci do opposite jobs in AFR** (`results/esrd_neighbours_by_locus_group.csv`):

| Ancestry | Locus group | Neighbours reached | Shared-SNP weight | Top categories |
|---|---|---|---|---|
| AFR | **APOL1** | 39 | **3,993** | genitourinary 15, endocrine/metabolic 12, circulatory 4 |
| AFR | **TCF7L2** | **61** | 131 | endocrine/metabolic 23, sense organs 8, genitourinary 7 |
| AFR | other | 14 | 239 | genitourinary 9, hematopoietic 2 |
| EUR | TCF7L2 | 88 | 1,560 | endocrine/metabolic 26, circulatory 12, sense organs 11 |
| EUR | other | 114 | 5,902 | endocrine/metabolic 23, circulatory 22, genitourinary 19 |

APOL1 carries the weight, TCF7L2 carries the breadth. Reporting either
alone misleads. **TCF7L2's edges are not mainly diabetes**: endocrine or
metabolic is the largest single category but is 23 of 61 AFR neighbours
(38%) and 26 of 88 in EUR (30%).

### E-B.4. EUR's discordant edges are concentrated, not diffuse

`results/esrd_eur_discordant_edges.csv`. 44 EUR neighbours carry at least
one discordant SNP; two loci produce almost all of them:

| Locus | Neighbours | Discordant SNPs |
|---|---|---|
| chr10:58.6 Mb, lead rs4948524 | Myopia (344/372), Primary open-angle glaucoma (344/344), Open-angle glaucoma (338/345) | 1,026 |
| chr16:20.3 Mb, lead rs12922822 | Calculus of kidney, Urinary calculus, Hydronephrosis, Calculus of ureter, Calculus of lower urinary tract (37–38 each) | 187 |

This matters for E4: the discordance is three eye phenotypes and five
kidney-stone phenotypes from two loci, not a diffuse property of EUR's
network.

### E-C. Cross-ancestry lookup

`results/esrd_cross_ancestry_leads.csv`. Each locus lead looked up in the
other ancestry.

| | AFR leads (32) | EUR leads (23) |
|---|---|---|
| consistent and nominally significant (p < 0.05) | 3 | 6 |
| consistent but not significant | 7 | 5 |
| inconsistent direction | 6 | 10 |
| **missing** | **16** | 2 |

**Restriction, stated plainly:** the store holds a row only where some
ancestry or META reached p < 1e-4. A lead classified `missing` was either
never tested in the other ancestry or filtered before the store was built;
these cannot be told apart here.

**The APOL1 leads are the headline.** Both are present in the other
ancestry with the same direction:

| Lead | Own ancestry | Other ancestry |
|---|---|---|
| rs9622362 (AFR) | p = 1.7e-45 | EUR beta −0.400, **p = 0.021** |
| rs7291184 (EUR) | p = 1.1e-06 | AFR **p = 1.5e-18** |

**So the APOL1 absence in EUR is not an absence.** The variant is there and
points the same way; it is far weaker. Distinguishing allele frequency from
power requires frequencies the store does not carry (open item 8.2).

### E-E. Redundancy sensitivity, and the locus split at L2

Carried over from the previous task (`analysis/phecode_redundancy/results/REPORT.md` §4).
Headline L1 and L2:

| Ancestry | Level | Degree | Within-cluster weight | Concordant weight |
|---|---|---|---|---|
| AFR | L0 | 86 | 0.703 | 0.998 |
| AFR | **L1** | 84 | 0.678 | 0.997 |
| AFR | **L2** | 80 | 0.585 | 0.997 |
| AFR | L3 | 69 | 0.307 | 0.995 |
| EUR | L0 | 142 | 0.368 | 0.800 |
| EUR | **L1** | 140 | 0.300 | 0.778 |
| EUR | **L2** | 134 | 0.185 | 0.742 |
| EUR | L3 | 129 | 0.171 | 0.736 |

L3 and L4 are over-conservative and should be read as upper bounds.
`phecode_exclude_range` marks pairs that must not serve as each other's
controls, and pairs land there precisely when they overlap clinically —
which is usually because they share biology. For ESRD in AFR, L3 is
numerically identical to L4, the drop-the-whole-category stress test.

**New cross-tab (`results/esrd_l2_locus_split.csv`).** Share of the
remaining edge weight at L2:

| Ancestry | APOL1 | TCF7L2 | other |
|---|---|---|---|
| AFR | **89.4%** | 3.7% | 6.9% |
| EUR | **0.0%** | 25.1% | 74.9% |
| META | 25.2% | 20.7% | 54.1% |

After removing every parent, child and sibling phecode, nearly nine tenths
of what remains of AFR's ESRD neighbourhood is one locus.

---

## 4. Anemia claim table

| ID | Current claim | Store result | Screen | Verdict | Replacement |
|---|---|---|---|---|---|
| A1 | The AFR–EUR intersection gives two shared associations and one neighbouring phenotype | **17 shared SNPs**; **1 surviving neighbour**, node 270 *Iron deficiency anemias* | panel d: 17 SNPs, 2 phenotype nodes | **Supported with revised number** | 17, not 2. The one neighbour is **phecode 280, 280.1's parent** — a hierarchy relative, not an independent finding |
| A2 | Both ancestries show rich connectivity, >100 SNPs each, a mix of positive and negative effects | AFR **620 SNPs** (62 +, 558 −), 35 neighbours. EUR **1,256** (611 +, 645 −), 238 neighbours | panels a | **Supported with revised number** | ">100" holds. "A mix" holds for EUR (49% positive) but **not for AFR, which is 90% negative** |
| A3 | The AFR–META and EUR–META intersections preserve much of each network | AFR→META keeps **73.7%** of SNPs, **77.1%** of neighbours. EUR→META keeps **94.5%** / **97.1%** | panels b, c | **Supported with revised number** | Both preserved, but asymmetrically — EUR far more than AFR |
| A4 | A unifying effect: each neighbour's associations come predominantly from one ancestry, **and not the same ancestry across neighbours** | At the 80% cutoff: **220 of 238 neighbours are EUR-predominant, 9 AFR-predominant, 9 mixed**. At 60%: 226/9/3. At 90%: 220/9/9 | — | **Not supported** | The first half holds — neighbours are overwhelmingly single-ancestry. The second half is false: it is **the same ancestry (EUR) for 92% of them** |
| A5 | Peripheral vascular disease shows complete EUR–META agreement and no AFR associations | Of the 107 SNPs 280.1 shares with it in META, EUR covers **107 (100%)** and AFR **0 (0%)** | panel e: 107 SNPs | **Supported as written** | — |
| A6 | Other hemoglobinopathies shows complete AFR–META agreement and no EUR overlap | Of the 205 shared in META, AFR covers **205 (100%)** and EUR **0 (0%)** | panel f: 205 SNPs | **Supported as written** | — |
| A7 | "Unlike obesity, where EUR dominates META" — the obesity example is absent from the manuscript | Obesity (node 264): of 29,949 META-significant SNPs, EUR covers **98.5%**, AFR 9.7%, AMR 3.4% | — | **Supported** (as a fact) | The claim is true; the authors can restore the example or drop the reference |

---

## 5. Anemia analyses

### A-B. Loci and genes

`results/anemia_loci.csv`. **The store covers autosomes only (22 shards),
so X-linked loci cannot appear.**

| Ancestry | Loci (p<1e-4) | Dominant locus | Share of mapped edge weight |
|---|---|---|---|
| AFR | 21 | chr16:249,924 (rs13331259) — the **alpha-globin** cluster | **86.3%** |
| EUR | 35 | chr16:53,772,541 (rs56094641) — **FTO** | **72.4%** |
| META | 38 | chr16:53,775,211 (rs55872725) — FTO | 67.8% |

At genome-wide significance: AFR 456 SNPs / 4 loci, EUR 752 / 13, META
915 / 12.

**Yes, a locus dominates the anemia neighbourhood the way APOL1 dominates
ESRD** — and it is a different locus in each ancestry. AFR's second locus
is chr11:5,227,100, inside **HBB**, about 100 bp from rs334 (the sickle
variant), reaching the most neighbours. These are the loci driving the
AFR-specific neighbours in A4 and A6; EUR's FTO and chr6:26.1 Mb loci
drive the EUR-specific ones in A5.

> **Correction.** An earlier version of this section described EUR's
> chr6:26.1 Mb locus as "HFE — hereditary haemochromatosis, i.e. iron
> overload", reading a mechanism out of a nearest-gene label. The lead
> rs198851 sits inside *HFE-AS1*, a non-coding RNA; its nearest
> protein-coding gene is the histone gene **H4C3 at 66 bp**, and **HFE is
> 6,060 bp away**. The locus is in the histone cluster adjacent to HFE.
> HFE may well be the relevant gene — the region is strongly associated
> with iron traits — but the annotation does not establish that, and the
> earlier wording implied it did. The loci are named here by coordinate
> and nearest gene only; no causal gene is assigned.

### A-C. Cross-ancestry lookup

| | AFR leads (21) | EUR leads (35) |
|---|---|---|
| consistent and nominally significant | 1 | 7 |
| consistent but not significant | 7 | 11 |
| inconsistent direction | 5 | 13 |
| missing | 8 | 4 |

Same restriction as E-C applies.

### A-D. Redundancy sensitivity

`results/anemia_redundancy.csv`. Within-cluster is the hematopoietic
category.

| Ancestry | Level | Neighbours | Weight | Hematopoietic weight | Concordant weight |
|---|---|---|---|---|---|
| AFR | L0 | 35 | 1,890 | 0.960 | 0.988 |
| AFR | **L1** | 34 | 1,339 | 0.943 | 0.984 |
| AFR | **L2** | 34 | 1,339 | 0.943 | 0.984 |
| AFR | L3 | 29 | **80** | 0.050 | 0.725 |
| EUR | L0 | 238 | 18,183 | 0.135 | 0.840 |
| EUR | **L1** | 237 | 17,073 | 0.079 | 0.829 |
| EUR | **L2** | 236 | 17,024 | 0.076 | 0.829 |
| EUR | L3 | 231 | 16,234 | 0.031 | 0.821 |

AFR survives L1 and L2 almost untouched — one neighbour removed, the
parent phecode — and then **collapses at L3**, from 1,339 shared SNPs to
80. 280.1's exclusion range is 280–285.99, which contains every
hemoglobinopathy and anemia code. That is the alpha- and beta-globin signal
being removed wholesale, which is pleiotropy at two of the
best-characterised loci in human genetics, not one illness coded twice.
**Headline L1 and L2 for this example; L3 removes the finding.**

---

## 6. Story check

### ESRD: network differences → SNP divergence → implications

| Step | Holds? |
|---|---|
| ESRD sits in a genitourinary/hematopoietic cluster | **Holds for AFR by weight** (0.703). Weak for EUR (0.368) |
| AFR: many within-cluster, concordant connections | **Holds with a change of measure.** True by weight (0.998 concordant, 0.703 within-cluster); *not* true by neighbour count, where AFR and EUR are the same |
| EUR: fewer within-cluster, mostly opposing directions | **Breaks.** Discordance is 20–31% depending on reading, never "most", and it comes from two loci hitting eight phenotypes |
| Both ancestries have >100 SNPs | **Holds** (713, 554) |
| SNPs sit on different chromosomes | **Holds, and is the strongest step** (91.6% chr22 vs 69.7% chr10) |
| Only one shared SNP | **Breaks.** 14 SNPs, 1.12%. At the locus level 2 of 32 |
| Consistent with APOL1 | **Holds as biology, breaks as "absent in EUR."** APOL1 is present in EUR at p = 0.021 with the same direction |

**What can substitute where a step breaks.** For E4, the replacement is not
a weaker version of the same claim but a different and stronger one: EUR's
discordant edges are *concentrated in two loci* reaching three eye
phenotypes and five kidney-stone phenotypes. For E7, the locus-level
statement (2 of 32 AFR loci shared) is both true and more robust than the
SNP count, because SNP-level non-overlap can be an LD artefact and this is
not — the locus check rules that out.

### Anemia: rich alone, sparse in the AFR–EUR intersection, preserved in META

| Step | Holds? |
|---|---|
| Each ancestry is rich alone | **Holds** (620 and 1,256 SNPs), but AFR's effects are 90% negative, not "a mix" |
| The AFR–EUR intersection is sparse | **Holds**, 17 SNPs and 1 neighbour — though that neighbour is 280.1's own parent phecode |
| META preserves much of each | **Holds, asymmetrically** — EUR 94.5%, AFR 73.7% |
| A unifying effect, different ancestry per neighbour | **Breaks.** 220 of 238 neighbours are EUR-predominant |
| Panel e and f exemplars | **Both hold exactly as written** (107/107 and 205/205) |

### New findings strong enough to consider adding

1. **The APOL1/TCF7L2 split.** ESRD's two shared loci do opposite jobs:
   APOL1 carries 84% of AFR's edge weight across 39 neighbours, TCF7L2
   carries 3% across 61. After redundancy exclusions at L2, APOL1 is 89.4%
   of what remains in AFR and 0.0% in EUR. This is a cleaner statement of
   "ancestry-specific architecture" than the SNP-overlap count.
2. **Absence is not absence.** Both APOL1 leads are present in the other
   ancestry with consistent direction. The ancestry difference is in effect
   size and significance, not in which variants exist. This is a frequency
   question the current data cannot close, and saying so is stronger than
   implying the locus is missing.
3. **EUR's discordance is two loci, not a property of the network.**
4. **A4's unifying effect is real but one-directional** — neighbours are
   single-ancestry, and that ancestry is EUR 92% of the time. That is a
   statement about EUR's power dominance, which is a different and probably
   more defensible point than the one currently made.

---

## 7. Figure manifest

All panels captured with `RANK_METRIC=pval`, viewport 2000×1250 at 2× device
scale. Settings and on-screen summaries in
`results/figures/manifest.json`. No page errors in any capture.

| Panel | File | Settings | Screen shows | Store says |
|---|---|---|---|---|
| fig3 a | `fig3_a_network_eur.png` | page 1, EUR, 1e-04, ESRD selected | 996 phenotypes, 53,125 edges | ESRD has 142 EUR neighbours |
| fig3 b | `fig3_b_network_afr.png` | page 1, AFR, 1e-04, ESRD selected | 755 phenotypes, 5,461 edges | ESRD has 86 AFR neighbours |
| fig3 c | `fig3_c_node_eur.png` | page 2, EUR, 1e-04 | 150 SNPs, 99 phenotypes | **caption must change — E4 not supported** |
| fig3 d | `fig3_d_node_afr.png` | page 2, AFR, 1e-04 | 150 SNPs, 38 phenotypes | 0.998 concordant weight |
| fig3 e | `fig3_e_node_afr_apol1.png` | page 2, AFR, 1e-04, **rs73885319 selected** | 150 SNPs, 38 phenotypes | rs73885319 is **APOL1 G1 (p.S342G)**, p_AFR = 2.8e-40, in 31 phenotypes |
| fig3 f, candidate 1 | `fig3_f1_comparison_afr_eur.png` | page 2, AFR+EUR, 1e-04 | 14 SNPs, 158 edges, **0 discordant** | 14 shared SNPs — illustrative only, display rules apply |
| fig3 f, candidate 2 | `fig3_f2_locus_map.png` / `.pdf` | built from the store | 32 AFR, 23 EUR, 2 shared loci on a chromosome axis | the same fact without display rules |
| anemia a | `anemia_a_node_afr.png`, `anemia_a_node_eur.png` | page 2, AFR / EUR, 1e-04 | 150 SNPs, 8 / 145 phenotypes | 620 / 1,256 SNPs |
| anemia b | `anemia_b_afr_meta.png` | page 2, AFR+META | 150 SNPs, 8 phenotypes | 73.7% of AFR SNPs kept |
| anemia c | `anemia_c_eur_meta.png` | page 2, EUR+META | 150 SNPs, 142 phenotypes | 94.5% of EUR SNPs kept |
| anemia d | `anemia_d_afr_eur.png` | page 2, AFR+EUR | **17 SNPs, 2 phenotypes** | 17 shared SNPs, 1 neighbour |
| anemia e | `anemia_e_pvd_eur_meta.png` | page 3, 280.1–649, EUR+META | 107 SNPs, 0 discordant | 107/107 EUR coverage, 0 AFR |
| anemia f | `anemia_f_hb_afr_meta.png` | page 3, 280.1–280, AFR+META | 205 SNPs, 0 discordant | 205/205 AFR coverage, 0 EUR |

**Panel c must keep its image but change its caption** — E4 is not
supported at any reading.

**Panel f: the two candidates differ in kind.** Candidate 1 is the
interface and is subject to the 150-SNP cap and the centre-connection rule;
candidate 2 is the store and is not. If the panel is meant to *quantify*
divergence, use candidate 2. If it is meant to show what a reader sees when
they do this themselves, use candidate 1.

**A5/A6 named neighbours resolved to nodes 649 (*Peripheral vascular
disease*) and 280 (*Other hemoglobinopathies*).** Note node 652,
*Peripheral vascular disease, unspecified*, also exists and gives 113
shared SNPs rather than 107; the caption's wording matches 649. Both hold
the claim.

---

## 8. Open items for the authors

1. **ESRD case counts by ancestry.** Not in the store — it has no
   sample-size or case/control column. Needed from the MVP PheWeb
   phenotype page for 585.32 or the Verma supplementary tables. **This
   machine has no network access, so I could not retrieve either.** The
   cohort sizes currently quoted (AFR 121,177; EUR 449,042) are also
   unverifiable here and need a cited source.
2. **Allele frequencies.** Needed to settle whether APOL1's weakness in EUR
   is frequency or power — the single most load-bearing open question for
   E9 and E10. The store has no frequency column.
3. **The 1e-07 and stricter edgelist columns** (P1.4). Either regenerate
   them or restrict page 1's slider to 1e-04, 1e-05 and 1e-06.
4. **The Supplementary Methods >40-phenotype sentence** should be removed.
5. **Whether to report page-1 weights at all**, given they are
   per-column max-normalised and not comparable across panels.
6. **Which panel-f candidate** to use.
7. **The duplicate-row rule.** The published edgelist used first-row-wins;
   this analysis used smallest-p. 2,690 pairs are affected and none is
   exact. Worth one sentence in the methods.
