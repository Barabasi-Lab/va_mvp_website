# Final revision: queries, slider fix, gene labels, deployment, figures

Every number below is traceable to a file in `analysis/final/results/` or
`analysis/examples/results/`; the source file is named in each row. Numbers
come from the store, never from a screenshot.

---

## 0. What contradicts the manuscript draft

Nine things. The first two change drafted sentences outright.

### 0.1 The anemia example used phecode 280.1, not 280

`analysis/examples/` ran on node 271, which is **280.1, Iron deficiency
anemias, unspecified or not due to blood loss**, not **280, Iron deficiency
anemias** (node 270). Q1 reran all of Phase 2 for 280. Two drafted numbers
are the 280.1 values:

| Drafted | Is actually | Value for phecode 280 | Source |
|---|---|---|---|
| "220 of 238 neighbors are EUR-predominant" | the 280.1 figure | **202 of 216** (7 AFR-predominant, 7 mixed) | `q1_full.json` → `280.a4_summary.cutoff_80%` |
| "205/205 with other hemoglobinopathies" | the 280.1 figure | **193/193** | `q1d_named_neighbours.json` |

Peripheral vascular disease is **107/107** under both codes, so that sentence
stands. The anemia figure has been regenerated on phecode 280 and its panel f
now shows 193 SNPs, not 205.

### 0.2 Production ranked SNPs by |beta/se|, not by p-value

The manuscript says SNPs are ranked by p-value. `server.js` read
`const RANK_METRIC = (process.env.RANK_METRIC || 'z').toLowerCase();` and the
Railway service set no `RANK_METRIC` variable, so production ranked by
|z| = |beta/se| (`q2_q10_answers.json` → `Q8`). Changed to default `pval` in
Part 3.1. This changes which 150 SNPs page 2 shows for six node/ancestry
combinations out of the validator's set.

### 0.3 Neither the store nor the source has allele columns

The Database section says the dbGaP download includes effect and reference
alleles. `q2_q10_answers.json` → `Q7` lists every column of both the store
and `/home/student/Desktop/full_dataset.csv`: **no allele column in either**.
Two consequences:

- the duplicate pairs cannot be tested for multiallelism, so Q7's follow-up
  is unanswerable with the data on hand;
- **Q3's "confirm both ancestries use the same effect allele" cannot be
  confirmed.** The betas are reported per ancestry with no allele recorded,
  so a sign difference between ancestries is indistinguishable from an
  allele flip. The Q3 numbers below are reported on the assumption the
  columns are aligned, which is an assumption, not a check.

### 0.4 The APOL1 share depends on a denominator the sentence does not state

91.5% and 84.0% are both correct and count different things. See Q4.

### 0.5 The edgelist is now 57,041 pairs, not 54,790

The regeneration (Part 2) added 2,321 phenotype pairs over 85 nodes the old
file never carried. Any drafted sentence quoting 54,790, or an edge count or
weight read off page 1 at 1e-04 to 1e-06, can move by a few per cent.

### 0.6 rs7291184's nearest protein-coding gene is APOL4, not APOL1

It sits at chr22:36,207,941, 3.1 kb from APOL4 (`q10_lead_genes.csv`). It is
inside the APOL1 *locus* under 500 kb clumping, so calling it an APOL1-locus
lead is fine; calling the gene APOL1 is not. rs73885319 and rs9622362 are
both inside APOL1 at 0 bp.

### 0.7 One Figure 1 number is wrong by 10×, and its sentence misstates the finding

The three overlap numbers are `\tbd{}` placeholders in the manuscript
source — never computed. Rebuilding Figure 1 recovered the definition behind
them, and two now land within 3 and 8 (**12,555** all four ancestries,
**328,160** all but EAS). The third, **945,657 "EUR-only"**, matches nothing
under any definition, and the claim attached to it is also false: the largest
intersection is **EUR+META at 9,846,238**, with EUR alone second at
9,464,718. Everything else in the Figure 1 text reproduces exactly. See
`FIG1_REPORT.md`.

Separately, panel b has a real step at p = 1e-6 — a 140× jump in EUR, absent
in META — which suggests the per-ancestry association sets were exported at a
stricter threshold than the meta-analysis. It affects no counted number but
does undercut a drafted sentence about distribution shape.

### 0.8 The stored META standard error is not the IVW standard error

The META *beta* is the inverse-variance-weighted combination the manuscript
describes (correlation 0.99988). The META *se* is not: `se_IVW / se_META` has
median 0.90 overall but 1.29 for large effects, so it is not a constant
factor either. See §2.6.

### 0.9 The two discordant-locus counts hold only over the phenotypes named

chr10 BICC1 → three eye phenotypes, 1,026 discordant shared associations, and
chr16 UMOD → five kidney-stone phenotypes, 187: both exact. But ten
neighbours in total have BICC1 as their dominant discordant locus (1,088
associations) and eight have UMOD (259). The sentences are right; they are
narrower than they read (`q10_discordant_loci.csv`).

---

## 1. Placeholder answers

| Query | Manuscript location | Answer | Source file |
|---|---|---|---|
| **Q1a** | Supplementary Results, anemia | Phecode 280 at p < 1e-4: **597 SNPs in AFR, 1,245 in EUR, 12 in both**. Neighbours 35 AFR / 217 EUR, intersection 1 (280.1). | `q1a_snp_counts.csv` |
| **Q1b** | " | Share also significant in META — SNP level: **AFR 73.9% (441/597), EUR 92.8% (1,155/1,245)**. Locus level: **AFR 48.5% (16/33), EUR 72.5% (29/40)**. Neighbour level: AFR 77.1%, EUR 94.9%. | `q1b_meta_overlap.csv` |
| **Q1c** | " | **202 of 216** META neighbours EUR-predominant, 7 AFR-predominant, 7 mixed. **Cutoff: a neighbour is predominant in one ancestry when ≥80% of the shared META SNPs that are significant in exactly one of AFR/EUR are significant in that one**; neighbours split more evenly than 80/20 are "mixed". At a 60% cutoff it is 206/7/3. The draft's 220 of 238 is the 280.1 figure. | `q1_full.json`, `q1c_280_neighbour_split.csv`, `q1c_280_non_eur_predominant.csv` |
| **Q1d** | " | Peripheral vascular disease (node 649) **107/107** — every one of the 107 shared META SNPs is also significant in EUR, none in AFR. Other hemoglobinopathies (node 280) **193/193** in AFR, 0 in EUR. The drafted 205/205 is the 280.1 value. | `q1d_named_neighbours.json` |
| **Q1e** | " | Neighbours L0→L1→L2→L3: AFR 35→34→34→29, EUR 217→215→215→207, META 216→214→214→206. Within-cluster (hematopoietic) weight fraction: AFR 96.2→94.6→94.6→5.5%, EUR 13.4→7.6→7.6→3.2%, META 19.4→12.1→12.1→3.3%. **L1 and L2 are identical in all three** — every removed neighbour is T1, none is T2. Removed at L1: **280.1 (node 271)** in all three ancestries, and **280.2 (node 272)** in EUR and META. | `q1e_280_redundancy.csv`, `q1e_280_removed_neighbours.csv` |
| **Q2** | Supplementary Table `tab:esrd_redundancy` | ESRD, EUR, p < 1e-4. Degree **142 / 140 / 134 / 129** at L0–L3. Within-cluster weight share **36.8 / 30.0 / 18.5 / 17.1%**. Concordant weight share **80.0 / 77.9 / 74.3 / 73.7%**. The table's existing L0 (142, 36.8%, 80.0%) and L3 concordant (73.6% → **73.7%**) both confirm, the latter to rounding. | `q2_esrd_redundancy.csv` |
| **Q3** | Results, "Shared loci with different roles" | See table in §2.3. rs9622362 difference **z = 0.44, p = 0.66**, CIs overlap. rs73885319 **z = 2.50, p = 0.012**, CIs do not overlap. rs7291184 **z = 4.35, p = 1.3e-5**, CIs do not overlap. Effect-allele alignment **cannot be confirmed** (§0.3). | `q3_effect_comparison.csv` |
| **Q4** | Results, same subsection; Discussion | 4,755 is ESRD's AFR edge weight in SNP–neighbour pairs; 4,363 of those pairs involve a SNP with a GRCh38 position; 3,993 of them are APOL1. So **84.0% = APOL1 / all edge weight** and **91.5% = APOL1 / positioned edge weight**. "Share of ESRD's edge weight" is the first. **Use 84.0%.** The 39 neighbours figure is right either way. 89.4% at L2 is on the *positioned* basis and so is not comparable to 84.0%; its L0 counterpart is 91.5%. | `q4_apol1_share.csv`, `esrd_l2_locus_split.csv` |
| **Q5** | Data Content, final sentence of §2.3 | Numbers **do change**, slightly. See §2.4. The strongest movers are EUR neighbours with any discordant SNP (44 → 39) and AFR (7 → 6); shared SNPs 14 → 13. No share moves by more than 0.1 pp. | `q5_duplicate_robustness.csv` |
| **Q6** | Limitations, final sentence | Each row is **one unordered pair of phenotypes that share at least one significant SNP in at least one of the five ancestries at p < 1e-4, in at least one direction**, carrying 90 weight columns (5 ancestries × 9 thresholds × 2 directions). No self-pairs, no row with all-zero weights. The count is **57,041 after regeneration**, up from 54,790. The union is stable under tightening: across all 90 columns, **no column has more edges than the looser column beside it**. | `q2_q10_answers.json` → `Q6`, `q10_gaps.json` → `q6_regenerated` |
| **Q7** | Database section, allele bullet | Store: `phe_id, phenotype, rsid, src_row, pval/beta/se × {meta,eur,afr,amr,eas}, nearest_gene, nearest_genes_all, gene_distance_bp, annotation_status, overlapping_noncoding, grch38_pos, chrom`. Source CSV: `phenotype, rsid, chrom, pval/beta/se × {META,EUR,AFR,AMR,EAS}`. **Neither has an allele column**, so the multiallelic check cannot be run. | `q2_q10_answers.json` → `Q7` |
| **Q8** | Web Interface, Node View | Production default was **`z`**, with no `RANK_METRIC` set on the Railway service. Changed to **`pval`** in Part 3.1. | `q2_q10_answers.json` → `Q8` |
| **Q11** | Data Content §2.1, the IVW sentence | The stored META **beta** is the inverse-variance-weighted combination (corr **0.99988**; median relative difference 0.38% for \|beta\| ≥ 0.2). The stored META **se** is **not** the plain IVW se: the ratio runs 0.90 → 1.29 with effect size. §2.6. | `q11_ivw_check.csv` |
| **Q9** | Availability | **Python 3.14.7** is what the analysis and `build_dbs.py` were run with; DuckDB 1.5.5. The repo pins nothing — no `requirements.txt`, `pyproject.toml`, `.python-version` or `runtime.txt`, and `build_dbs.py` only says `#!/usr/bin/env python3`. "Python 3" is therefore accurate but unpinned; if the Availability section wants a version, **3.14.7** is the one that produced these results, and it should be stated as "run with" rather than "requires". | `q2_q10_answers.json` → `Q9`, `p0_summary.json` |

---

## 2. Verification table (Q10)

### 2.1 ESRD (585.32, node 905), p < 1e-4

✓ means the store reproduces the drafted number.

| Claim | Drafted | From the store | |
|---|---|---|---|
| Neighbours | 86 AFR, 142 EUR | 86, 142 | ✓ |
| Within-cluster neighbour share | 20.9% AFR, 19.0% EUR | 20.93%, 19.01% | ✓ |
| Within-cluster weight share | 70.3% AFR, 36.8% EUR | 70.28%, 36.84% | ✓ |
| Concordant weight share | 99.8% AFR | 99.77% | ✓ |
| EUR discordant weight | 20.0% | 19.97% | ✓ |
| EUR neighbours, any discordant SNP | 31.0% (44/142) | 30.99% (44/142) | ✓ |
| EUR neighbours, majority discordant | 23.9% (34/142) | 23.94% (34/142) | ✓ |
| chr10 BICC1 → eye phenotypes | 3 phenotypes, 1,026 | 3, 1,026 | ✓ |
| chr16 UMOD → kidney-stone phenotypes | 5 phenotypes, 187 | 5, 187 | ✓ |
| AFR T1+T2 share of edge weight | 28% | 28.4% (positioned basis) | ✓ |
| AFR degree L0–L3 | 86 → 84 → 80 → 69 | identical | ✓ |
| AFR within-cluster weight L0–L3 | 70.3 → 67.8 → 58.5 → 30.7% | identical | ✓ |
| AFR concordant weight L0–L3 | 99.8 → 99.7 → 99.7 → 99.5% | 99.77 → 99.75 → 99.71 → 99.50 | ✓ |
| SNPs | 713 AFR, 554 EUR, 14 shared, 1,253 union | identical | ✓ |
| Chromosome concentration | 91.6% AFR on chr22, 69.7% EUR on chr10 | 91.58% (653/713), 69.68% (386/554) | ✓ |
| Loci | 32 AFR, 23 EUR, 2 shared, 53 union | identical | ✓ |
| APOL1 AFR neighbours | 39 | 39 | ✓ |
| APOL1 share of AFR weight at L2 | 89.4% | 89.4% | ✓ (positioned basis) |
| APOL1 share of EUR weight | 0.0% | 0.0% | ✓ |
| TCF7L2 AFR neighbours | 61 of 86 | 61 | ✓ |
| TCF7L2 shared associations | 131 | 131 | ✓ |
| rs9622362 EUR | β = −0.400, p = 0.021 | −0.4004, 0.02103 | ✓ |
| rs7291184 AFR | p = 1.5e-18 | 1.473e-18 | ✓ |
| rs73885319 AFR | p = 2.8e-40 | 2.84e-40 | ✓ |

Sources: `esrd_claims.json`, `q2_esrd_redundancy.csv`, `esrd_l2_locus_split.csv`,
`esrd_neighbours_by_locus_group.csv`, `q10_discordant_loci.csv`,
`q3_effect_comparison.csv`, `q4_apol1_share.csv`, `q10_t1t2_share.csv`.

**Nothing in the ESRD table is wrong.** The two qualifications are the APOL1
denominator (§0.4) and the locus-count scoping (§0.7).

### 2.2 Figure 1 text

See §2.5. These are over the whole download, not the store, so they needed a
separate pass.

### 2.3 Q3, per-allele effect comparison

| SNP | β AFR (SE) | β EUR (SE) | 95% CI AFR | 95% CI EUR | Overlap | z | p |
|---|---|---|---|---|---|---|---|
| rs9622362 | −0.3252 (0.02303) | −0.4004 (0.1675) | [−0.370, −0.280] | [−0.729, −0.072] | yes | 0.4448 | 0.656 |
| rs73885319 | −0.3368 (0.02464) | −1.038 (0.2793) | [−0.385, −0.289] | [−1.585, −0.491] | no | 2.5008 | 0.0124 |
| rs7291184 | −0.2090 (0.02368) | −1.062 (0.1945) | [−0.255, −0.163] | [−1.443, −0.681] | no | 4.3535 | 1.34e-5 |

All three have the same sign in both ancestries. Not interpreted, per the
brief. The effect-allele caveat in §0.3 applies to all three.

### 2.4 Q5, drop-both-rows robustness

Rule: for each of the 2,690 true duplicate `(phenotype, rsid)` pairs, drop
**both** rows rather than keeping the smaller p.

| Field | Keep-smallest-p | Drop both | Δ |
|---|---|---|---|
| AFR edge weight | 4,755 | 4,719 | −36 |
| AFR within-cluster weight share | 70.28% | 70.33% | +0.05 pp |
| AFR concordant weight share | 99.77% | 99.79% | +0.02 pp |
| AFR neighbours with any discordant SNP | 7 | 6 | −1 |
| AFR SNPs | 713 | 711 | −2 |
| AFR chr22 share | 91.58% | 91.56% | −0.02 pp |
| EUR edge weight | 8,128 | 8,110 | −18 |
| EUR within-cluster weight share | 36.84% | 36.83% | −0.01 pp |
| EUR concordant weight share | 80.03% | 80.06% | +0.03 pp |
| EUR neighbours with any discordant SNP | 44 | 39 | −5 |
| EUR SNPs | 554 | 552 | −2 |
| EUR chr10 share | 69.68% | 69.75% | +0.07 pp |
| AFR∩EUR shared SNPs | 14 | 13 | −1 |
| AFR∪EUR SNPs | 1,253 | 1,250 | −3 |

**The manuscript cannot say nothing changes.** Every share is stable to
0.1 pp, but five counts move: EUR neighbours with any discordant SNP is the
largest at 44 → 39 (−11%), and the headline "14 shared SNPs" becomes 13.
A defensible rewrite is *"every weight share is stable to within 0.1
percentage points under either duplicate rule; small counts move by at most
five"*. Source: `q5_duplicate_robustness.csv`.

### 2.5 Figure 1 text numbers

These are over the **whole download** — `/home/student/Desktop/full_dataset.csv`,
**24,026,422 rows** — not the store, which holds only the filtered 3,060,080
rows the site serves. They cannot be checked against the store at all.

**The threshold is p < 1e-4, and the duplicate rows are kept.** That is not a
guess: every count was produced at 5e-08, 1e-04 and "any row", under both
duplicate conventions, and only one combination reproduces the drafted
numbers — several of them exactly.

| Drafted | At p < 1e-4, duplicates kept | |
|---|---|---|
| 21.3 million EUR associations | 21,329,976 | ✓ |
| **37,388 EAS associations** | **37,388** | ✓ exact |
| 13.2 million META associations | 13,181,839 | ✓ |
| 1,748 EUR phenotypes with ≥1 association | 1,748 | ✓ |
| 441 EAS phenotypes | 441 | ✓ |
| 1,746 META phenotypes | 1,746 | ✓ |
| 18.8% META SNPs with ≥10 phenotypes | 18.79% | ✓ |
| 1.1% META SNPs with ≥50 | 1.051% | ✓ |
| 17.3% EUR with ≥10 | 17.337% | ✓ |
| 1.6% EAS with ≥10 | 1.561% | ✓ |
| 5.8% AMR with ≥10 | 5.779% | ✓ |
| 1.05% META vs 0.93% EUR, ≥50 | 1.051% vs 0.930% | ✓ |

**Answer to "with or without the duplicate rows": with them.** Removing them
changes EAS from 37,388 to 37,337 and EUR from 21,329,976 to 21,312,032, so
the drafted figures are the duplicate-inclusive ones. The pleiotropy
percentages are unaffected to three decimals.

#### The three SNP-overlap numbers — superseded, see `FIG1_REPORT.md`

These three are `\tbd{}` placeholders in `MVPheWAS_revised.tex`: they were
never computed, which is why no threshold reproduced them. Rebuilding
Figure 1 found the definition they almost certainly came from — associations,
five sets including META, exclusive intersections — under which two of the
three land within 3 and 8 (**12,555** and **328,160**). The third, 945,657,
matches nothing at any definition, and the sentence around it is also wrong:
the largest intersection is EUR+META at 9,846,238, not EUR alone.

Full grid and recommended wording: `FIG1_REPORT.md`.

Source: `fig1_defgrid.csv`, `q10_figure1.json`, `q10_figure1_overlap_sweep.json`.


---

### 2.6 Q11, is the stored META beta the inverse-variance-weighted combination?

The Data Content section says META is "a meta-analysis across all ancestries
using inverse-variance weighted fixed-effects models". That is a closed-form
prediction, so it was checked over all 3,036,438 store rows with a META beta:

    w_i = 1 / se_i^2,  beta_IVW = sum(w_i b_i) / sum(w_i),  se_IVW = sqrt(1 / sum(w_i))

**Yes for the beta.** Correlation between the recomputed and stored META beta
is **0.99988**, and it holds in every stratum. Agreement tightens as the
effect gets better determined, which is what a near-exact formula plus noise
on tiny betas looks like:

| Stratum | n | corr | median relative difference | within 1% |
|---|---|---|---|---|
| all rows | 3,036,438 | 0.99988 | 1.61% | 37.6% |
| \|z\| ≥ 5 | 1,502,191 | 0.99993 | 0.81% | 56.3% |
| \|z\| ≥ 10 | 249,677 | 0.99994 | 0.55% | 67.5% |
| \|beta\| ≥ 0.2 | 286,921 | 0.99990 | 0.38% | 79.0% |

The overall 1.61% is an artefact of dividing by a near-zero beta: the worst
rows all have \|beta_META\| ≈ 0.01–0.03. There is a small systematic offset —
the recomputed beta is about **0.3–1.3% larger in magnitude** than the stored
one, consistently in every stratum.

**No for the standard error.** `se_IVW / se_META` is not 1 and not even
constant: median **0.90** overall, 0.95 at \|z\| ≥ 5, **1.16** at \|z\| ≥ 10
and **1.29** at \|beta\| ≥ 0.2. A plain IVW standard error would reproduce
exactly; the stored one does not, and the discrepancy scales with effect
size.

That is the signature already documented for this dataset in
`docs/duckdb-migration.md`: the per-ancestry p-values and standard errors are
saddlepoint-corrected (SAIGE), and the correction bites hardest on rare
variants with large \|beta\|. So the stored META **beta** is the IVW
combination as the manuscript says, but the stored META **se** is not the
plain IVW se of the stored per-ancestry standard errors, and anyone
recomputing a meta-analytic p-value from these columns will not get the
stored p.

Every row has at least two ancestry groups contributing, so none of this is a
single-cohort pass-through.

Source: `q11_ivw_check.csv`, `q11_ivw_check.json`, `q11_ivw_worst.csv`.

## 3. Slider fix (Part 2)

### 3.1 The diagnosis

Page 1's p-value slider below 1e-06 drew a network that did not correspond to
its setting. The edge *counts* and weight distributions in those columns were
plausible, but the values sat on the wrong phenotype pairs: agreement between
the stored column and a recomputation from the store was **1.7–6.9% per
column from 1e-07 down**, against **93–99% at 1e-04 to 1e-06**. The columns
were misattached, not miscomputed.

### 3.2 Per-column edge counts, old vs new

Every one of the 90 columns was regenerated. Representative counts from
`edgelist_rebuild_counts.json` (`edges` = rows with a non-zero weight in that
column); the full table is in the JSON.

| Column | Regenerated edges |
|---|---|
| eur 1e-04 / 1e-06 / 1e-08 / 1e-12 | 53,400 / 53,003 / 24,800 / 10,408 |
| afr 1e-04 / 1e-06 / 1e-08 / 1e-12 | 5,509 / 3,538 / 1,373 / 554 |
| amr 1e-04 / 1e-06 / 1e-08 / 1e-12 | 2,161 / 966 / 318 / 131 |
| eas 1e-04 / 1e-06 / 1e-08 / 1e-12 | 63 / 39 / 5 / 1 |

Pair universe **54,790 → 57,041**, adding 2,321 pairs over 85 nodes the old
file never carried. Node positions are byte-identical: the layout comes from
`node_attributes.csv`, which was not rebuilt.

### 3.3 The gate the task set, and why it was not met

The brief said the 1e-04, 1e-05 and 1e-06 columns must match the current file
exactly, and to stop and report if they did not. **They did not.** Best
agreement was **99.1%** on `eur_1e-04` using the generating notebook's
duplicate rule, and 89.8% using the rule the rest of the analysis uses. The
residual is duplicates: pairs touching no duplicated SNP agree at **99.96%**,
pairs touching one at **95.13%**. The notebook kept whichever row came first
in its per-ancestry pickle; the store's `src_row` is the order of the combined
CSV, and that per-ancestry ordering cannot be reconstructed from it. This was
reported, and the authors chose to regenerate everything and accept the drift.

### 3.4 Internal consistency checks, all passing

- column names identical to the old file;
- no negative weight components;
- over all 80 adjacent threshold pairs, no edge weighs more at the stricter
  threshold than at the looser one;
- no edge present at a stricter threshold and absent at a looser one;
- no self-pairs; no row with every weight zero;
- the summary panel's edge and node counts equal a direct recomputation at
  **1e-08, 1e-10 and 1e-12 in META, EUR and AFR — 9 of 9 exact**
  (`slider_below_1e6.csv`).

---

## 4. Gene labels (Part 3.1)

### 4.1 Payload, re-measured after the side map

The annotation is a property of the SNP, so it now travels once per response
in a `genes` map keyed by rsID instead of once per row. Four arrangements
were measured; collecting the map during row construction won, and it adds no
read of the store. Against the guidelines of ≤5% payload and ≤10% latency:

| View | Payload Δ | Latency Δ | Within guideline |
|---|---|---|---|
| page 2, ESRD AFR | +1.6% | +19.0% | payload yes, latency no |
| page 2, Obesity META | +0.3% | +27.9% | payload yes, latency no |
| page 2, Asthma META | −5.6% | +17.9% | payload yes, latency no |
| page 3, ESRD–588 AFR | +15.1% | +7.4% | latency yes, payload no |
| page 3, Hyperlip–lipoid EUR | +13.5% | +7.8% | latency yes, payload no |

The page-3 payload misses are a fixed ~3 kB map against 19 and 21 kB
responses. The page-2 latency misses are the cost of reading four more
columns per row: the old code against the new store runs at baseline speed,
so it is not the wider store. Source: `gene_labels_endpoints.json`.

### 4.2 Label confirmation

**14 of the 15 labels that were meant to be unchanged are unchanged**, and
both the APOL1 and the TCF7L2 lead read APOL1 and TCF7L2. The exception is
**rs7292101, APOL6 → APOL5 (22 kb)**: APOL5 is one of the 1,375
protein-coding genes the alt-contig bug had been dropping, and it is the
closer of the two. Six of the twenty published labels now differ from
`EXAMPLES_REPORT.md` rather than five.

### 4.3 Ranking default

`RANK_METRIC` now defaults to `pval`. `scripts/validate_ranking.py` was
rebuilt to read `RANK_METRIC` the way the server does — it had the z metric
hardcoded, so it reported six mismatches against the new default. Both
settings now report ALL MATCH.

---

## 5. Deployment (Part 3.3)

### 5.1 Order followed

Store before code, as specified, because merged `main` requires four relation
files (`edge_relations.parquet`, `pair_relations.parquet`,
`node_phecodes.json`, `pair_relations_t34.json`) that the volume does not yet
carry. Pushing the code first would have broken the site.

### 5.2 Backward compatibility, confirmed

The deployed commit `f0680f9` was checked out into a worktree and run against
the regenerated store. All green:

| Check | Result |
|---|---|
| `/api/landing/nodes` | 200, 1,321 nodes |
| `/api/landing/edges` meta 1e-04 | 200, **57,041 edges**, 1,159 degrees |
| `/api/landing/edges` eur 1e-08 | 200 |
| `/api/landing/edges` afr 1e-12 | 200 |
| `/api/page2/rows`, three phenotypes | 200 |
| `/api/page3/rows`, two pairs | 200 |
| pages 1–3 headless, 7 views | ALL OK, no console errors |

### 5.3 Pre-merge and post-merge test suites

On merged `main`:

| Suite | Result |
|---|---|
| `scripts/test_gene_annotation.js` | 16 passed, 0 failed |
| `scripts/test_phecode_relations.js` | 16 passed, 0 failed, 0 skipped |
| `pytest test_phecode_relations.py` | 17 passed |
| `scripts/validate_ranking.py` | ALL MATCH (after §4.3) |
| `scripts/validate_pages.js` | ALL MATCH |
| `scripts/validate_landing.py` | ALL MATCH |
| `scripts/validate_ui.js` | ALL OK |
| `scripts/test_merged_323.js` | ALL OK — 17 checks |

`test_merged_323.js` covers the two things the unit suites cannot see once the
branches are in one tree: hiding related phecodes leaves the ESRD/AFR gene
brackets alone (same 5 brackets over the same 150 SNPs, with and without
`mask=1`), and pages 1–3 load without console errors for ESRD, phecode 280 and
Obesity in all three ancestries.

### 5.4 Status: deployed

The authors confirmed the upload, and the store went up. The Railway CLI,
given an existing `/db`, nested the upload at `/db/db` rather than replacing
`/db`, and the three renames that swap it into place were blocked by this
environment's permission policy; **the authors ran them**, then pushed.

Verified live on 2026-10-05 at `www.appliedintegrativeanalytics.com`:

| Check | Result |
|---|---|
| `/api/landing/edges` meta 1e-04 | 200, **57,041 pairs**, 1,159 degrees — the regenerated store |
| `/api/landing/edges` eur 1e-08 | 200 — the sub-1e-6 columns are populated |
| `/api/relations/pairs?node=905` | 200, 4 tiers, 25 related — the relation files are on the volume, so the toggle works |
| `/api/page2/rows` | 200, response carries the `genes` side map — merged `main` is the running code |

**Production commit: `2c7260f`**, which is `origin/main` and equals local
`main`. The old store remains on the volume as the rollback.

## 6. Figure manifest

Full-page panels captured at **2000×1250, deviceScaleFactor 2** (4000×2500
px), `RANK_METRIC=pval`, from a local build of merged `main` against the
regenerated store. The Figure 2 element crops are re-shot at
deviceScaleFactor 4, since they are small. Full per-panel settings, including
each panel's on-screen summary line, are in
`analysis/final/figures/manifest.json`.

**Resolution.** Every figure declares at least 300 dpi; the composites, the
locus map and Figure 1 are at 400. `check_figure_dpi.py` stamps a resolution
on the screenshot PNGs, which carry none of their own, and fails if anything
is below 300. The per-file table, with the print width each supports, is
`results/figure_resolutions.csv`.

### Figure 3 — `renal_disease_v3.png`

| Panel | File | Settings |
|---|---|---|
| a | `fig3_a_network_eur_total.png` | page 1, EUR, p < 1e-4, edge type **Weight**, ESRD selected |
| b | `fig3_b_network_afr_total.png` | page 1, AFR, p < 1e-4, edge type **Weight**, ESRD selected |
| c | `fig3_c_network_eur_discordant.png` | page 1, EUR, p < 1e-4, edge type **Discordant Weight**, ESRD selected |
| d | `fig3_d_network_afr_discordant.png` | page 1, AFR, p < 1e-4, edge type **Discordant Weight**, ESRD selected |
| e | `fig3_e_node_afr_genes_apol1.png` | page 2, node 905, AFR, p < 1e-4, gene labels on, k = 3, rs73885319 clicked |
| f | `fig3_f_locus_map.png` / `.pdf` | drawn from the store by `fig3_panel_f.py`; 32 AFR loci, 23 EUR, 2 shared; APOL1 and TCF7L2 labelled. Redrawn at panel e's 1.6:1 so the two sit level and the same height, and the AFR/EUR labels are offset to opposite sides — centred, they collided at chr10 and the chr22 one ran off the axes |

### Anemia figure — `anemias_v2.png`, **phecode 280** (node 270)

| Panel | File | Settings |
|---|---|---|
| a | `anemia_a_node_afr.png` | page 2, node 270, AFR, p < 1e-4 |
| b | `anemia_b_afr_meta.png` | page 2, node 270, AFR + META |
| c | `anemia_c_eur_meta.png` | page 2, node 270, EUR + META |
| d | `anemia_d_afr_eur.png` | page 2, node 270, AFR + EUR |
| e | `anemia_e_pvd_eur_meta.png` | page 3, 270 × 649 (Peripheral vascular disease), EUR + META — **107 SNPs**, matching Q1d |
| f | `anemia_f_hb_afr_meta.png` | page 3, 270 × 280 (Other hemoglobinopathies), AFR + META — **193 SNPs, not 205** (§0.1) |

Both neighbours still fit their panels under phecode 280, so nothing was
substituted; only panel f's caption number changes.

### Figure 2 — interface sources

Each cropped to the element, for the authors to assemble.

| File | Shows |
|---|---|
| `fig2_summary_panel_network.png` | summary panel, network view |
| `fig2_summary_panel_node.png` | summary panel, node view, single ancestry |
| `fig2_comparison_legend.png` | **updated comparison legend** — "same direction" / "opposite direction" |
| `fig2_edge_type_labels.png` | concordant / discordant edge-type selector |
| `fig2_reset_button.png` | reset button |
| `fig2_related_phecode_toggle.png` | related-phecode toggle |

### Figure 1 — `fig1_data_stats.png`, rebuilt

There was no `data_stats` plotting script in the repo and the published
`figs/data_stats_v6.png` is not on this machine either, so Figure 1 was
rebuilt from the caption and the source data by `fig1_data_stats.py`. The
reviewer's y-axis point is fixed — the exponent is in the tick label and no
axis carries a multiplier, checked across all 16 axes rather than asserted.

Two of the three `\tbd{}` overlap placeholders now resolve to within 3 and 8
(12,555 and 328,160); the third does not reproduce under any definition and
its surrounding claim is wrong as written. Panel b also turns out to have a
real discontinuity at p = 1e-6. **See `FIG1_REPORT.md`** — those findings are
not repeated here.

### Draft composites

`renal_disease_v3.png` and `anemias_v2.png` are 3×2 drafts built by
`assemble_figures.py`, letters a–f reading across in a band above each panel,
4140×4210 at 400 dpi (10.3 in wide). Panels are centred both ways in their
cell, so a short panel sits level with a tall one instead of hanging from the
top of the row. They are for the authors to replace, not final artwork.

---

## Scripts added

| Script | Does |
|---|---|
| `analysis/final/q1_anemia_280.py` | reruns Phase 2 for phecode 280 beside 280.1 |
| `analysis/final/q2_q10_queries.py` | Q2–Q10 |
| `analysis/final/q10_gaps.py` | the Q10 entries no earlier output covered |
| `analysis/final/q10_figure1.py` | Figure 1 counts from the source CSV |
| `analysis/final/q11_ivw_check.py` | the IVW recomputation against the stored META beta |
| `analysis/final/fig1_extract.py` | one pass over the source for everything Figure 1 needs |
| `analysis/final/fig1_defgrid.py` | the panel c definition grid |
| `analysis/final/fig1_data_stats.py` | Figure 1, with the axis check |
| `analysis/final/check_figure_dpi.py` | stamps and verifies >= 300 dpi on every figure |
| `analysis/final/check_slider.py` | summary panel vs a direct recomputation below 1e-6 |
| `analysis/final/shoot_final_figures.js` | every captured panel |
| `analysis/final/fig3_panel_f.py` | Figure 3 panel f |
| `analysis/final/assemble_figures.py` | the two draft composites |
| `scripts/rebuild_edgelist.py` | all 90 edgelist columns |
| `scripts/test_merged_323.js` | toggle × gene labels, and clean loads on pages 1–3 |
