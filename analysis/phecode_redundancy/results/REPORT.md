# Phecode-redundancy sensitivity analysis

**Reviewer question:** are the network's clusters produced by phecode
definitional overlap rather than genetic pleiotropy? ESRD (585.32) is the
worked example.

This reports what the data say, including where they weaken the manuscript.
No prose for the manuscript is written here.

Everything is reproducible from one entry point:

```bash
python3 analysis/phecode_redundancy/run_analysis.py --steps a2,a3,a5,a6
python3 -m pytest analysis/phecode_redundancy/test_phecode_relations.py -q
```

All parameters sit at the top of `run_analysis.py`; the seed is 20260930;
`results/provenance.json` records every input path, MD5 and the genome build.

---

## 1. Inputs and provenance

| File | MD5 | Notes |
|---|---|---|
| Association store, `public/data/db/associations/chrom=*/*.parquet` | 22 shards | 3,060,080 rows, 1,320 network phenotypes, 898,972 distinct rsids |
| `public/data/node_attributes.csv` | `1fe4e5d0be82f11c64f2cc37a96392c5` | 1,321 nodes |
| `~/Downloads/Phecode_map_v1_2_icd9_icd10cm.csv` | `fdd521f64b5a10481054e25e6d355a52` | 105,284 rows, 1,873 phecodes |
| `~/Desktop/phenotype_labels.pkl` | `ea8c809ee731c4ba862e6a658afbb319` | 1,749 codes |
| `results/snp_positions.csv` | see `provenance.json` | rsid → GRCh38, from SNPlocs.Hsapiens.dbSNP155.GRCh38 |
| **`phecode_definitions1.2.csv`** | — | **ABSENT** |

**Phecode map version and match rate.** Phecode Map 1.2 (ICD-9 + ICD-10-CM).
**99.92%** of the network's phecodes are in it: 1,319 of 1,320. The single
miss is `1010.5`, one of the unlabelled codes. Five further network
phenotypes are not phecodes at all — `DoApnea`, `DoAsth`, `HVGlauc`,
`SkMsGout`, `SkMsOP`, the second code of the five merged nodes — and are
reported as *unclassifiable*, never as *unrelated*.

**Genome build.** The association store records none, and carries no
base-pair column. Positions therefore come from outside it, resolved by rs
number against dbSNP155/GRCh38. rs numbers are stable across builds, so the
lookup does not depend on knowing the store's build; the coordinates that
come back are GRCh38 by construction. The one cross-check the data allows —
the store's own `chrom` column against the chromosome each rs number resolves
to — is in `results/position_qc.json` and reported in §5.

**Full summary statistics: no.** Of 3,060,080 rows, **0** fail to reach
p < 1e-4 in at least one ancestry. A (phenotype, SNP) row exists only if it
was significant somewhere. See §8.

**The supplied map is the ICD→phecode mapping only.** It has no
`phecode_exclude_range` column; that lives in the separate *definitions*
file, which is not on this machine. **T3 is therefore not computable**, and
this propagates through the whole report — see §9.

---

## 2. Baseline reproduction

| Manuscript claim | Reproduced | Verdict |
|---|---|---|
| >100 ESRD SNPs in AFR at p<1e-4 | 713 | reproduces |
| >100 ESRD SNPs in EUR at p<1e-4 | 554 | reproduces |
| Only 1 SNP shared between AFR and EUR | **14** raw / **7** after a >40-phenotype filter / **7** in the site's node view | **does not reproduce**; you have confirmed 14/7 is correct and the text will be revised |
| Network-view neighbours of ESRD | AFR 86, EUR 142, META 160 | reproduces exactly against the served edgelist |

The 14 split cleanly by chromosome: seven on chr10 (TCF7L2, including
rs7903146), each in 54–85 phenotypes, and seven on chr22, each in 22–27
phenotypes — the APOL1 region. §5 reports what they collapse to as loci.

`network.py` reproduces the served network exactly for ESRD in all three
ancestries, which is the gate the rest of the analysis rests on.

---

## 3. Relationship table (A2)

`results/phecode_pair_relations.csv` — **55,033 distinct pairs**, the union
of every pair carrying an edge in AFR (5,517), EUR (53,403) or META (51,224)
at p < 1e-4.

| Tier | Definition | Pairs (primary tier) |
|---|---|---|
| T1 | ancestor–descendant, one code truncates the other | 678 |
| T2 | sibling, same integer root, not T1 | 490 |
| T3 | exclusion-range overlap | **not computable** |
| T4 | share ≥1 ICD code in Map 1.2 | 28 |
| — | unrelated | 53,837 |
| — | unclassifiable | 0 |

Tiers are assigned in the order T1 > T2 > T4, so each pair counts once. A
merged node carries two source codes and a pair counts as related if any
combination is.

**T4 is genuine overlap, not a roll-up artefact.** Each ICD in Map 1.2 is
assigned to one, most specific, phecode: 585.32, 585.3 and 585 share zero
ICDs. 7,821 (flag, ICD) keys map to more than one phecode, and those are the
real overlaps.

### Unit tests

`test_phecode_relations.py`: **12 passed, 1 skipped** (the skip is the
hand-verified T3 case, pending the definitions file). All four cases named in
the task pass: 585 vs 585.32 → T1; 585.3 vs 585.32 → T1; 585.31 vs 585.32 →
T2; 585.32 vs 280.1 → neither. The hand-verified T4 case is 297.2
(suicide/self-inflicted injury) against 986 (toxic effect of carbon
monoxide), which share 20 ICD-10 codes under T58.* — different roots, so a
genuine shared-ICD overlap and not a hierarchy.

Additional cases cover the traps: decimals are compared as strings, so
"585.30" and "585.3" stay distinct codes where `float()` would merge them;
leading zeros survive (`Phe_008_52` → `008.52`); "585" is not an ancestor of
"5851"; identity is not a relation; and classification is symmetric.

One correction to the task's own example: it gives 585.30 vs 585.3 as a
non-relation. Under the truncation rule they are T1, because "30" starts with
"3". No phecode in Map 1.2 has a trailing-zero decimal, so the pair is
hypothetical, and the point the example is making — that they are two codes
and not one — is the one the test asserts.

---

## 4. ESRD sensitivity (A3)

`results/esrd_sensitivity.csv`, `results/esrd_sensitivity.png`,
`results/esrd_top_neighbors.csv`.

Exclusion levels. **L3 as specified cannot be produced.** What is reported as
`L3_partial` is T1+T2+T4 with T3 omitted, and it is labelled that way in
every output file and figure.

| Level | Excludes |
|---|---|
| L0 | nothing |
| L1 | T1 |
| L2 | T1 + T2 |
| L3_partial | T1 + T2 + T4 (**T3 unavailable**) |
| L4 | L3_partial + every neighbour in ESRD's own category (genitourinary), a stress test |

"Within cluster" is genitourinary ∪ hematopoietic; genitourinary alone is
reported beside it. Weight is the count of shared SNPs.

### Main table, p < 1e-4

| Ancestry | Level | Degree | Weighted degree | Cluster (count) | Cluster (weight) | GU (count) | GU (weight) | Synergistic (weight) | Synergistic (edge) |
|---|---|---|---|---|---|---|---|---|---|
| AFR | L0 | 86 | 4,755 | 0.209 | 0.703 | 0.186 | 0.574 | **0.998** | 0.930 |
| AFR | L1 | 84 | 4,386 | 0.190 | 0.678 | 0.167 | 0.539 | **0.997** | 0.929 |
| AFR | L2 | 80 | 3,404 | 0.150 | 0.585 | 0.125 | 0.405 | **0.997** | 0.925 |
| AFR | L3_partial | 80 | 3,404 | 0.150 | 0.585 | 0.125 | 0.405 | **0.997** | 0.925 |
| EUR | L0 | 142 | 8,128 | 0.190 | 0.368 | 0.148 | 0.270 | 0.800 | 0.761 |
| EUR | L1 | 140 | 7,330 | 0.179 | 0.300 | 0.136 | 0.191 | 0.778 | 0.757 |
| EUR | L2 | 134 | 6,300 | 0.142 | 0.185 | 0.097 | 0.059 | 0.742 | 0.746 |
| EUR | L3_partial | 134 | 6,300 | 0.142 | 0.185 | 0.097 | 0.059 | 0.742 | 0.746 |

L2 and L3_partial are identical in both ancestries: **no T4-only pair is an
ESRD neighbour**, so the step from L2 to L3 adds nothing here. Whatever T3
would have added is unknown.

### Top remaining neighbours, p < 1e-4, L3_partial

AFR, by weight: 588 Disorders resulting from impaired renal function (436,
all concordant); 588.2 Secondary hyperparathyroidism of renal origin (369);
285.21 Anemia in chronic kidney disease (356); 587 Kidney replaced by
transplant (292); 401.22 Hypertensive chronic kidney disease (284); 285.2
Anemia of chronic disease (255); 401.2 Hypertensive heart and/or renal
disease (175); 275.5 Disorders of calcium/phosphorus metabolism (169); 580
Nephritis, nephrosis, renal sclerosis (152); 269 Proteinuria (130). Every one
is concordant; none is a phecode relative of 585.32.

EUR, by weight: 274.1 Gout (405: 376 concordant / 29 discordant); 274 Gout
and other crystal arthropathies (403); 401.22 Hypertensive chronic kidney
disease (383); 285 Other anemias (377); 285.21 Anemia in chronic kidney
disease (376); **367.1 Myopia (372: 28 concordant / 344 discordant)**; 365.1
Open-angle glaucoma (345: 6 / 339); 367.8 Hypermetropia (344); 365.11 Primary
open-angle glaucoma (344: 1 / 343); 274.11 Gouty arthropathy (342).

The contrast survives the exclusions in a readable form: after removing every
computable phecode relation, AFR's remaining ESRD partners are renal and
haematological and uniformly concordant, while EUR's are led by gout and by
ophthalmic traits that are largely *discordant*.

### Appendix: p < 1e-8 and the L4 stress test

| Ancestry | Level | Degree | Weighted degree | Cluster (weight) | Synergistic (weight) |
|---|---|---|---|---|---|
| AFR | L0 | 29 | 2,352 | 0.753 | **1.000** |
| AFR | L1 | 27 | 2,129 | 0.727 | **1.000** |
| AFR | L2 / L3_partial | 23 | 1,601 | 0.636 | **1.000** |
| AFR | L4 | 16 | 862 | 0.325 | **1.000** |
| EUR | L0 | 75 | 4,223 | 0.359 | 0.716 |
| EUR | L1 | 73 | 3,510 | 0.228 | 0.658 |
| EUR | L2 / L3_partial | 69 | 3,056 | 0.114 | 0.608 |
| EUR | L4 | 59 | 2,787 | 0.028 | 0.640 |

At p < 1e-4, L4 takes AFR to degree 70, weighted degree 2,024, cluster weight
0.302, synergistic weight 0.995; EUR to 121, 5,930, 0.134, 0.770. Genitourinary
fraction is 0 at L4 by construction.

META sits between the two throughout and is in the CSV.

---

## 5. Locus results (A4)

_(pending — the rsid → GRCh38 lookup is still running)_

---

## 6. Network-wide tiers (A5)

`results/network_wide_tiers.csv`, `results/network_wide_tiers.png`.
All at p < 1e-4. "Unrelated" necessarily includes any T3-only pairs.

### Tier counts and weight share

| Ancestry | Tier | Edges | Fraction of edges | Fraction of weight |
|---|---|---|---|---|
| AFR | T1 | 469 | 8.50% | 28.3% |
| AFR | T2 | 169 | 3.06% | 9.73% |
| AFR | T4 | 13 | 0.24% | 0.03% |
| AFR | unrelated | 4,866 | 88.2% | 61.9% |
| EUR | T1 | 624 | 1.17% | 8.95% |
| EUR | T2 | 479 | 0.90% | 3.40% |
| EUR | T4 | 26 | 0.05% | 0.03% |
| EUR | unrelated | 52,274 | 97.9% | 87.6% |
| META | T1 | 627 | 1.22% | 8.43% |
| META | T2 | 481 | 0.94% | 3.46% |
| META | T4 | 28 | 0.05% | 0.03% |
| META | unrelated | 50,088 | 97.8% | 88.1% |

Related pairs are a small minority of edges and a much larger minority of
weight: 11.8% of AFR edges carry 38.1% of AFR weight. That asymmetry is the
reviewer's concern expressed as a number, and it is real.

### Weight by tier, against unrelated

Median [IQR] shared SNPs, Mann–Whitney two-sided against unrelated pairs,
with the rank-biserial correlation as the effect size:

| Ancestry | Tier | Median [IQR] | Unrelated median [IQR] | p | rank-biserial |
|---|---|---|---|---|---|
| AFR | T1 | 12 [3, 62] | 3 [1, 16] | 1.3e-30 | 0.32 |
| AFR | T2 | 40 [8, 151] | 3 [1, 16] | 1.1e-25 | 0.47 |
| AFR | T4 | 5 [3, 13] | 3 [1, 16] | 0.59 | 0.08 |
| EUR | T1 | 176 [20, 1,286] | 33 [5, 126] | 8.6e-51 | 0.35 |
| EUR | T2 | 100 [16, 628] | 33 [5, 126] | 7.4e-26 | 0.28 |
| EUR | T4 | 98 [34, 244] | 33 [5, 126] | 0.023 | 0.26 |
| META | T1 | 184 [21, 1,130] | 29 [5, 117] | 4.7e-56 | 0.37 |
| META | T2 | 103 [17, 575] | 29 [5, 117] | 4.4e-29 | 0.30 |
| META | T4 | 84.5 [18, 232] | 29 [5, 117] | 0.065 | 0.20 |

T1 and T2 edges are reliably heavier than unrelated ones. The effect is
moderate, not overwhelming: a rank-biserial of 0.3–0.5 means a related pair
outweighs an unrelated one roughly 65–74% of the time. T4 is not
distinguishable from unrelated in AFR or META.

### Synergy by tier

Synergistic fraction by weight (and, in brackets, the fraction of edges whose
concordant SNPs outnumber their discordant ones):

| Ancestry | T1 | T2 | T4 | unrelated |
|---|---|---|---|---|
| AFR | 0.948 (0.994) | 0.803 (0.959) | 1.000 (1.000) | 0.780 (0.808) |
| EUR | 0.998 (0.992) | 0.986 (0.935) | 0.841 (0.923) | 0.717 (0.721) |
| META | 0.996 (0.990) | 0.980 (0.933) | 0.840 (0.929) | 0.718 (0.723) |

**The prediction holds.** T1 and T2 edges are overwhelmingly synergistic —
0.95 to 0.998 by weight — against 0.72–0.78 for unrelated pairs. Two codes
that describe the same illness do move together, as they should.

The AFR T2 figure (0.803) is the one departure, and it is driven by a small
number of heavy discordant sibling edges rather than by many edges: 95.9% of
AFR T2 edges are concordant by majority.

### Antagonistic check

Share of all antagonistic edge weight coming from each tier:

| Ancestry | T1 | T2 | T4 | unrelated |
|---|---|---|---|---|
| AFR | 8.71% | 11.3% | 0.00% | 80.0% |
| EUR | 0.08% | 0.19% | 0.02% | 99.7% |
| META | 0.12% | 0.27% | 0.02% | 99.6% |

**Antagonistic edges are not a redundancy artefact.** In EUR and META,
99.6–99.7% of antagonistic weight comes from unrelated pairs. AFR is less
extreme at 80.0%, but related pairs still carry a smaller share of
antagonistic weight (20.0%) than of total weight (38.1%) — they are
*under*-represented among discordant edges, which is the opposite of what
definitional overlap would produce.

---

## 7. Secondary example: iron deficiency anemia (A6)

280.1, node 271, hematopoietic. Obesity was dropped at your instruction. No
L4, per the task.

| Ancestry | Level | Degree | Weighted degree | Cluster (count) | Cluster (weight) | Synergistic (weight) | Synergistic (edge) |
|---|---|---|---|---|---|---|---|
| AFR | L0 | 35 | 1,890 | 0.429 | 0.966 | 0.988 | 0.800 |
| AFR | L1 | 34 | 1,339 | 0.412 | 0.952 | 0.984 | 0.794 |
| AFR | L2 / L3_partial | 34 | 1,339 | 0.412 | 0.952 | 0.984 | 0.794 |
| EUR | L0 | 238 | 18,180 | 0.105 | 0.178 | 0.840 | 0.761 |
| EUR | L1 | 237 | 17,070 | 0.101 | 0.124 | 0.829 | 0.760 |
| EUR | L2 / L3_partial | 236 | 17,020 | 0.097 | 0.122 | 0.829 | 0.759 |
| META | L0 | 240 | 18,260 | 0.117 | 0.236 | 0.850 | 0.750 |
| META | L1 | 239 | 16,800 | 0.113 | 0.170 | 0.837 | 0.749 |
| META | L2 / L3_partial | 238 | 16,750 | 0.109 | 0.167 | 0.837 | 0.748 |

Anemia is the cleaner case of the two. In AFR the exclusions remove exactly
one neighbour — 280 Iron deficiency anemias, the parent, 551 shared SNPs —
and everything else stays: **cluster weight falls only from 0.966 to 0.952**,
and the top three remaining partners are 282.8 Other hemoglobinopathies
(456), 285 Other anemias (438) and 282 Hereditary hemolytic anemias (363),
all concordant and none a phecode relative. In AFR that is the
haemoglobinopathy signal, which is not a definitional artefact under any
reading.

EUR behaves as it does for ESRD: a large, diffuse, largely non-cluster
neighbourhood that the exclusions barely touch.

Locus results for anemia are in §5.

---

## 8. A7 — skipped, and why

**Skipped, on the task's own instruction.** A7 requires genome-wide summary
statistics. Of 3,060,080 rows in the store, **0** fail to reach p < 1e-4 in at
least one ancestry: a (phenotype, SNP) row exists only if it was significant
somewhere, with the other ancestries' statistics reported alongside.

The rows are therefore ascertained on significance, and the "null" z-scores
the method needs — SNPs with p > 0.05 in both traits — are not a null sample.
Running it on this subset would produce a number that looks like a
phenotypic correlation and is not one. No approximation has been substituted.

If genome-wide statistics exist elsewhere, A7 becomes possible and
`run_analysis.py` has the hook for it.

---

## 9. Deviations and caveats

### Deviations from the site's pipeline

1. **Weights are recomputed, not read off the edgelist.** Page 1's stored
   weights are scaled: ESRD's 86 AFR edges sum to 39.58, not 4,755. A3's
   "weighted degree = shared SNP count" therefore has to come from the
   association store. Neighbour *counts* match the served edgelist exactly
   (AFR 86, EUR 142, META 160), so the network itself is the same one.

2. **No promiscuous-SNP filter is applied**, because the shipped pipeline has
   none. 4,552 SNPs appear in more than 40 phenotypes (max 122), and page 1's
   edgelist matches the unfiltered recomputation exactly. You have confirmed
   the filter will be removed from the manuscript text. For reference, it
   would be a large change: ESRD's neighbours would go 86 → 39 in AFR and
   142 → 59 in EUR.

3. **Pages 1 and 2/3 are built from different SNP sets.** Page 1 uses the
   precomputed edgelist; pages 2/3 query the store and cap at the 150
   strongest SNPs per phenotype. This analysis uses the store directly and
   applies no cap, which matches page 1.

These three are documented in the module docstring of `network.py`.

### Caveats

**T3 does not exist in this analysis.** This is the most important limit. The
reviewer's argument turns on definitional overlap, and exclusion ranges are
the part of the phecode system that encodes it most directly. Everything
labelled `L3_partial` is T1+T2+T4. Since T4 turned out to add nothing to
ESRD's neighbourhood, `L3_partial` is in practice L2 for the worked example,
and whatever T3 would have removed is unmeasured. **Send
`phecode_definitions1.2.csv` and this becomes a one-command rerun.**

**Structural tiers are a weak proxy for case overlap.** What the reviewer's
objection is really about is whether the same patients are counted in both
phenotypes. That is measurable only with case-level data, or at least
per-phenotype case counts and their intersections. The store has neither.
T1–T4 say that two codes are *definitionally* close, which is correlated with
case overlap but is neither necessary nor sufficient: two sibling codes can
be mutually exclusive in practice, and two unrelated codes can share most of
their cases through comorbidity. Read the sensitivity levels as "removing
pairs that look related on paper", not as "removing shared cases".

**T4 as defined fires on a single shared ICD**, with no threshold on how
many. It is nearly inert in this analysis (28 pairs, 0.03% of weight, no ESRD
neighbours), so it does not affect the conclusions here — but see
`TOGGLE_EVALUATION.md` §4.3, where the same rule applied across the whole
network hides some clinically distinct pairs on the strength of one code.

**The L4 stress test is not a redundancy control.** Removing every
genitourinary neighbour of a kidney phenotype removes real biology along with
any artefact. It is reported because the task asks for it, and it should be
read as an upper bound on what exclusion can take away, not as an estimate.

**Ascertainment.** Every association in the store was significant in some
ancestry. Edge weights are counts of jointly-significant SNPs and inherit
that ascertainment; they are not effect-size correlations.

**Antagonistic edges at p < 1e-4 in EUR include an ophthalmic group** (myopia,
hypermetropia, glaucoma) whose relationship to ESRD is strongly discordant.
We have not investigated whether this is biology or an artefact of the
ranking; it is visible in `esrd_top_neighbors.csv` and worth a look.

---

## 10. Plain answers

**Does ESRD's within-cluster, synergistic connectivity in AFR persist at L1,
L2, and L3?**

Yes, with the within-cluster share falling and the synergistic share not
moving. At p < 1e-4 the within-cluster weight fraction goes 0.703 (L0) →
0.678 (L1) → 0.585 (L2 = L3_partial), and the synergistic weight fraction
goes 0.998 → 0.997 → 0.997. Degree goes 86 → 84 → 80. L3 proper is not
computable; L3_partial equals L2 here because no T4-only pair is an ESRD
neighbour.

**Does the AFR vs. EUR contrast in synergistic fraction persist at each
level?**

Yes, and it widens slightly. Synergistic weight fraction, AFR against EUR:
0.998 vs 0.800 at L0, 0.997 vs 0.778 at L1, and 0.997 vs 0.742 at both L2 and
L3_partial. At p < 1e-8 AFR is 1.000 at every level against EUR's 0.716 →
0.608. The gap comes from EUR losing synergy as exclusions are applied while
AFR does not move.

**How much of AFR ESRD connectivity is attributable to one locus?**

_(pending §5)_

**How much of the ESRD cluster is definitional overlap?**

Between 17% and 28% of ESRD's AFR connectivity by weight, and none of its
direction-of-effect signal. At p < 1e-4, phecode-related neighbours account
for 1,351 of 4,755 shared SNPs in AFR (28.4%) and 1,828 of 8,128 in EUR
(22.5%); the drop in within-cluster weight from L0 to L3_partial is 0.703 →
0.585 in AFR (a 17% relative fall) and 0.368 → 0.185 in EUR (a 50% relative
fall). Six of ESRD's 86 AFR neighbours are phecode relatives. The synergistic
fraction is unchanged by the exclusions in AFR (0.998 → 0.997), so the part
of the cluster that is definitional is not the part that carries the
concordant-direction signal. This is a lower bound: T3 is not included, and
structural tiers do not capture case overlap (§9).
