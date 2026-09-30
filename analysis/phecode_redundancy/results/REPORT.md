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
| `~/Downloads/phecode_definitions1.2.csv` | `1a6d2f359c4d594861a1aa13a20abc07` | 1,866 phecodes, the exclusion ranges |
| `results/snp_positions.csv` | see `provenance.json` | rsid → GRCh38, from SNPlocs.Hsapiens.dbSNP155.GRCh38 |
| gene annotation | Bioconductor | TxDb.Hsapiens.UCSC.hg38.knownGene + org.Hs.eg.db, GRCh38 |

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

**Definitions coverage.** 1,312 of the 1,320 network phecodes (99.39%) have a
row in the definitions file. The eight without are the unlabelled `1010.*`,
`1089` and `1090` codes; a further 22 have a row whose exclusion range is
empty, which is a real "no exclusions" rather than a gap. T3 for a pair
involving one of the eight is reported as **unknown**, not as *unrelated*.
Exactly one network pair is in that state: phecodes 1010.3 and 1089, two of
the unlabelled codes, which carry an edge of 3/9/9 SNPs in AFR/EUR/META. It
is counted separately in §3 rather than folded into "unrelated".

---

## 2. Baseline reproduction

| Manuscript claim | Reproduced | Verdict |
|---|---|---|
| >100 ESRD SNPs in AFR at p<1e-4 | 713 | reproduces |
| >100 ESRD SNPs in EUR at p<1e-4 | 554 | reproduces |
| Only 1 SNP shared between AFR and EUR | **14** in the data; **7** drawn in the current node view; **1** drawn in the pre-`4165ea2` build | **does not reproduce**; the "1" is a defect artefact, traced in `ESRD_OVERLAP_INVESTIGATION.md` |
| Network-view neighbours of ESRD | AFR 86, EUR 142, META 160 | reproduces exactly against the served edgelist |

The 14 split cleanly by chromosome: seven on chr10 (TCF7L2, including
rs7903146), each in 54–85 phenotypes, and seven on chr22 at 36.207–36.228 Mb,
each in 22–27 phenotypes. §5 confirms the chr22 seven are inside the APOL1
window and collapse to a single clump.

That clump is **not** the source of the manuscript's "1", which was the
working hypothesis in A0. Checking out the pre-`4165ea2` build reproduces
the 1 exactly and shows it to be rs35305544 alone, surviving a selection
defect, a display rule and a duplicate row. `ESRD_OVERLAP_INVESTIGATION.md`
has the trace and the recommended replacement statistics.

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
| T3 | exclusion-range overlap | 1,140 |
| T4 | share ≥1 ICD code in Map 1.2 | 22 |
| — | unrelated | 52,702 |
| — | T3 unknown, nothing else fired | 1 |
| — | unclassifiable | 0 |

Tiers are assigned in the order T1 > T2 > T3 > T4, so each pair counts once;
2,330 pairs (4.2%) are related under some tier. A merged node carries two
source codes and a pair counts as related if any combination is.

**T3 is the largest tier and the bluntest.** Its exclusion ranges are
block-wide, not code-wide: 580, 585, 585.32, 587 and 588 all carry
`580-590.99`, so T3 fires between any two codes in a block. It is also not
symmetric in the source data — 580's range contains 590 but 590's range
(`590-593.99`) does not contain 580 — so both directions are tested. What T3
actually encodes is discussed in §9; it is not the same question the other
tiers answer.

**T4 is genuine overlap, not a roll-up artefact.** Each ICD in Map 1.2 is
assigned to one, most specific, phecode: 585.32, 585.3 and 585 share zero
ICDs. 7,821 (flag, ICD) keys map to more than one phecode, and those are the
real overlaps.

### Unit tests

`test_phecode_relations.py`: **17 passed, nothing skipped**. All four cases
named in the task pass: 585 vs 585.32 → T1; 585.3 vs 585.32 → T1; 585.31 vs 585.32 →
T2; 585.32 vs 280.1 → neither. The hand-verified T4 case is 297.2
(suicide/self-inflicted injury) against 986 (toxic effect of carbon
monoxide), which share 20 ICD-10 codes under T58.* — different roots, so a
genuine shared-ICD overlap and not a hierarchy.

The hand-verified T3 case is 585.32 (ESRD) against 587 (kidney replaced by
transplant): each falls inside the other's exclusion range `580-590.99`,
they have different integer roots and share no ICD code, so T3 is the only
tier that fires.

Three T3 traps have tests of their own. A phecode's own exclusion range
contains that phecode, so identity needs the same guard T1/T2/T4 already
had. A code with no definitions row yields *unknown*, not False. And the
block-wide property is asserted directly, because anything that silently
narrowed T3 would change the analysis.

Additional cases cover the string traps: decimals are compared as strings, so
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

| Level | Excludes |
|---|---|
| L0 | nothing |
| L1 | T1 |
| L2 | T1 + T2 |
| L3 | T1 + T2 + T3 + T4 |
| L4 | L3 + every neighbour in ESRD's own category (genitourinary), a stress test |

"Within cluster" is genitourinary ∪ hematopoietic; genitourinary alone is
reported beside it. Weight is the count of shared SNPs.

### Main table, p < 1e-4

| Ancestry | Level | Degree | Weighted degree | Cluster (count) | Cluster (weight) | GU (count) | GU (weight) | Synergistic (weight) | Synergistic (edge) |
|---|---|---|---|---|---|---|---|---|---|
| AFR | L0 | 86 | 4,755 | 0.209 | 0.703 | 0.186 | 0.574 | **0.998** | 0.930 |
| AFR | L1 | 84 | 4,386 | 0.190 | 0.678 | 0.167 | 0.539 | **0.997** | 0.929 |
| AFR | L2 | 80 | 3,404 | 0.150 | 0.585 | 0.125 | 0.405 | **0.997** | 0.925 |
| AFR | L3 | 69 | 1,988 | 0.029 | 0.307 | 0.000 | 0.000 | **0.995** | 0.913 |
| EUR | L0 | 142 | 8,128 | 0.190 | 0.368 | 0.148 | 0.270 | 0.800 | 0.761 |
| EUR | L1 | 140 | 7,330 | 0.179 | 0.300 | 0.136 | 0.191 | 0.778 | 0.757 |
| EUR | L2 | 134 | 6,300 | 0.142 | 0.185 | 0.097 | 0.059 | 0.742 | 0.746 |
| EUR | L3 | 129 | 6,163 | 0.116 | 0.171 | 0.070 | 0.042 | 0.736 | 0.736 |

**For ESRD in AFR, L3 and L4 are the same thing.** Both give degree 69,
weighted degree 1,988 and a genitourinary fraction of exactly 0. ESRD's
exclusion range is `580-590.99`, which is the whole genitourinary block, so
T3 removes every one of ESRD's genitourinary neighbours in AFR, which is
the same set L4 removes by category. Whatever else L3 is testing for ESRD
in AFR, it is not testing anything narrower than "drop the category".

EUR is not quite identical (129 against L4's 120) because the genitourinary
*category* runs to 629 while the exclusion block stops at 590.99: nine of
EUR's remaining ESRD neighbours are genitourinary codes outside the block,
mostly urinary-tract, and L4 removes those where L3 does not.

T4 contributes nothing at any level: no T4-only pair is an ESRD neighbour in
any ancestry.

### Top remaining neighbours, p < 1e-4, L3

AFR, by weight: 285.21 Anemia in chronic kidney disease (356, all
concordant); 401.22 Hypertensive chronic kidney disease (284); 285.2 Anemia
of chronic disease (255); 401.2 Hypertensive heart and/or renal disease
(175); 275.5 Disorders of calcium/phosphorus metabolism (169); 269
Proteinuria (130); 275.53 Disorders of phosphorus metabolism (126); 854
Complications of cardiac/vascular device, implant and graft (78); 276.13
Hyperkalemia (71); 276.6 Fluid overload (48). Every one is concordant.

This is the result that matters most for the reviewer's question. After
removing the entire 580–590.99 block — every code that shares ESRD's
exclusion range, which for AFR is every genitourinary neighbour it had —
what is left is *renal failure's physiological consequences coded in other
blocks*: the anemia of CKD, renal hypertension, the calcium/phosphate and
potassium disturbances, proteinuria, fluid overload, and the complications
of dialysis access. That is a coherent clinical picture reached without any
phecode in ESRD's own family, and it is uniformly concordant.

EUR, by weight: 274.1 Gout (405: 376 concordant / 29 discordant); 274 Gout
and other crystal arthropathies (403); 401.22 Hypertensive chronic kidney
disease (383); 285 Other anemias (377); 285.21 Anemia in chronic kidney
disease (376); **367.1 Myopia (372: 28 concordant / 344 discordant)**; 365.1
Open-angle glaucoma (345: 6 / 339); 365.11 Primary open-angle glaucoma (344:
1 / 343); 367.8 Hypermetropia (344); 274.11 Gouty arthropathy (342).

The ancestry contrast survives the exclusions in a readable form: AFR's
remaining ESRD partners are renal-adjacent and uniformly concordant, while
EUR's are led by gout and by ophthalmic traits that are largely
*discordant*.

### Appendix: p < 1e-8 and the L4 stress test

| Ancestry | Level | Degree | Weighted degree | Cluster (weight) | Synergistic (weight) |
|---|---|---|---|---|---|
| AFR | L0 | 29 | 2,352 | 0.753 | **1.000** |
| AFR | L1 | 27 | 2,129 | 0.727 | **1.000** |
| AFR | L2 | 23 | 1,601 | 0.636 | **1.000** |
| AFR | L3 / L4 | 15 | 850 | 0.329 | **1.000** |
| EUR | L0 | 75 | 4,223 | 0.359 | 0.716 |
| EUR | L1 | 73 | 3,510 | 0.228 | 0.658 |
| EUR | L2 | 69 | 3,056 | 0.114 | 0.608 |
| EUR | L3 | 65 | 2,973 | 0.092 | 0.597 |
| EUR | L4 | 58 | 2,778 | 0.028 | 0.639 |

At p < 1e-4, L4 takes AFR to degree 69, weighted degree 1,988, cluster
weight 0.307, synergistic weight 0.995 — identical to L3 — and EUR to 120,
5,903, 0.135, 0.769. Genitourinary fraction is 0 at L4 by construction. AFR's
synergistic fraction is exactly 1.000 at p < 1e-8 at every level including
L4: not one discordant SNP survives in any of ESRD's AFR partners.

META sits between the two throughout and is in the CSV.

---

## 5. Locus results (A4)

`results/esrd_loci.csv`, `results/esrd_locus_overlap.csv`, and the same two
for anemia. Gene labels come from `annotate_loci.R`. SNPs are collapsed by greedy ±500 kb distance clumping on the
target's own p-value ordering: take the strongest unassigned SNP as a lead,
absorb every unassigned SNP within the window on the same chromosome,
repeat. No LD reference is installed, so no r²-based clumping was done and
none was downloaded. Gene annotation was not available locally either; the
two Bioconductor annotation packages were installed for this step, which is
a departure from "if annotation is available locally" and is noted here
because it is the only download beyond the position mapping you asked for.

### Positions and the build question

The store has no base-pair column and records no build, so positions were
resolved by rs number against **SNPlocs.Hsapiens.dbSNP155.GRCh38**:
**835,375 of 898,972 rsids (92.93%)**. The unresolved 7% are merged or
retired rs numbers and variants dbSNP155 does not carry as SNVs.

rs numbers are stable across builds, so the lookup does not depend on
knowing the store's build. The one cross-check the data allows — the
store's own `chrom` column against the chromosome each rs number resolves
to — **agrees for 100.00% of the 835,375** (`results/position_qc.json`).
Across ESRD's and anemia's edges, 91–95% of shared SNPs carry a position,
so the locus figures below are computed on that subset and the CSV reports
the covered fraction at every level.

### Loci per edge, and the APOL1 share

| Ancestry | Level | Degree | Loci in edges | Mean loci/edge | APOL1 % of shared SNPs | APOL1 % of edges |
|---|---|---|---|---|---|---|
| AFR | L0 | 86 | 11 | 1.58 | **91.5%** | 45.3% |
| AFR | L1 | 84 | 11 | 1.57 | **91.0%** | 44.0% |
| AFR | L2 | 80 | 8 | 1.45 | **89.4%** | 41.2% |
| AFR | L3 / L4 | 69 | 7 | 1.26 | **88.7%** | 33.3% |
| EUR | L0 | 142 | 11 | 1.71 | 0.0% | 0.0% |
| EUR | L1 | 140 | 11 | 1.66 | 0.0% | 0.0% |
| EUR | L2 | 134 | 8 | 1.59 | 0.0% | 0.0% |
| EUR | L3 | 129 | 8 | 1.61 | 0.0% | 0.0% |
| EUR | L4 | 120 | 7 | 1.63 | 0.0% | 0.0% |
| META | L0 | 160 | 13 | 1.84 | 27.1% | 23.1% |
| META | L2 | 152 | 11 | 1.68 | 25.2% | 20.4% |
| META | L3 | 141 | 11 | 1.65 | 16.7% | 14.9% |

Two APOL1 columns are given because they answer different questions. "% of
edges" counts every edge that touches the locus, and an edge can carry SNPs
elsewhere as well, so it overstates. "% of shared SNPs" is the strict
version and is the one to quote.

**Edges are close to single-locus objects.** The mean is 1.26–1.84 loci per
edge and the median is 1 at every ancestry and level. An ESRD edge of 400
shared SNPs is typically one LD block, not 400 independent signals. Edge
weights should be read as evidence strength at a locus, not as a count of
distinct genetic mechanisms.

### Major loci

ESRD, at L0, by the number of edges each locus contributes:

| Ancestry | Locus (GRCh38) | Lead | Nearest gene | Span | SNPs | Edges |
|---|---|---|---|---|---|---|
| AFR | chr10:112,998,590 | rs7903146 | **TCF7L2** (0) | 112,998,590–113,057,250 | 6 | **61** |
| AFR | **chr22:36,260,398** | **rs9622362** | **APOL1** (0) | 36,026,856–36,747,187 | **481** | **39** |
| AFR | chr22:35,695,911 | rs7292101 | APOL6 (27.5 kb) | 35,196,622–35,734,510 | 78 | 13 |
| AFR | chr22:37,023,301 | rs10427778 | MPST (0) | 36,775,567–37,434,045 | 15 | 9 |
| EUR | chr16:53,773,852 | rs17817288 | FTO (0) | single SNP | 1 | 90 |
| EUR | chr10:112,994,312 | rs34872471 | **TCF7L2** (0) | 112,990,477–113,058,995 | 28 | 88 |
| EUR | chr16:20,356,323 | rs12922822 | **UMOD** (21 bp) | 20,339,137–20,381,010 | 32 | 31 |
| EUR | chr10:58,591,464 | rs4948524 | BICC1 (0) | 58,504,611–58,615,138 | 316 | 20 |

Nearest gene is distance from the lead SNP to the nearest gene body,
0 meaning inside one, from TxDb.Hsapiens.UCSC.hg38.knownGene and
org.Hs.eg.db (`annotate_loci.R`). It is a label for a coordinate, not a
claim about mechanism: the nearest gene is frequently not the causal one.

The annotation is reassuring about the clumping. AFR's top loci are TCF7L2
and the chr22q12.3 APOL cluster; EUR's are FTO, TCF7L2, **UMOD** — the
canonical European kidney-function locus — and BICC1, also a kidney gene.
Neither ancestry's list looks like noise.

The AFR picture needs both columns to read correctly. **chr10 is the
broadest locus and APOL1 is the heaviest.** rs7903146 — the canonical TCF7L2
type-2-diabetes variant — appears on 61 of ESRD's 86 AFR edges but carries
only 6 SNPs. The APOL1 clump carries 481 SNPs across 39 edges, which is
where the 91.5% weight share comes from. So APOL1 explains almost all of the
*weight* of AFR ESRD connectivity, and TCF7L2 explains much of its *breadth*.

The APOL1 clump is centred at chr22:36,260,398, 2 kb inside APOL1
(36,253,071–36,267,530), and spans 36.03–36.75 Mb, which takes in APOL2/3
and MYH9. At ±500 kb the clump cannot separate APOL1 from MYH9; both are
established African-ancestry kidney-disease loci and this analysis does not
distinguish them.

**A0's open question is now answered.** The seven chr22 SNPs shared between
AFR and EUR sit at 36.207–36.228 Mb — inside the APOL1 window. A0 guessed
this from the phenotype counts; the positions confirm it.

### AFR vs EUR at the locus level

The manuscript states that only one SNP is shared and that the SNPs sit on
different chromosomes. At the locus level:

| Comparison | Loci A | Loci B | Shared (leads within ±500 kb) | % of A | % of B |
|---|---|---|---|---|---|
| ESRD AFR vs EUR | 32 | 23 | **2** | 6.3% | 8.7% |
| ESRD AFR vs META | 32 | 33 | 18 | 56.3% | 54.5% |
| ESRD EUR vs META | 23 | 33 | 17 | 73.9% | 51.5% |
| Anemia AFR vs EUR | 21 | 35 | **4** | 19.0% | 11.4% |
| Anemia AFR vs META | 21 | 38 | 11 | 52.4% | 28.9% |
| Anemia EUR vs META | 35 | 38 | 30 | 85.7% | 81.6% |

Chromosome distribution of ESRD's loci: AFR is concentrated on chr22 (7 of
32) with chr1 next (5); EUR has no chr22 concentration at all (1 of 23) and
spreads across chr10, chr2 and chr4 (3 each).

**The non-overlap is real and survives the locus-level check.** This
mattered because SNP-level non-overlap can be an LD artefact — the same
locus tagged by different variants in different ancestries — and that is not
what is happening here. Only 2 of 32 AFR loci have a EUR lead within
±500 kb. The manuscript's claim holds at the level that matters, and holds
better than its SNP-level phrasing suggests.

### Anemia

| Ancestry | Locus (GRCh38) | Lead | Nearest gene | SNPs | Edges | % of shared SNPs |
|---|---|---|---|---|---|---|
| AFR | chr16:249,924 | rs13331259 | FAM234A (0) | 505 | 7 | **86.3%** |
| AFR | chr11:5,227,100 | rs34598529 | **HBB** (0) | 40 | **23** | — |
| AFR | chr15:45,039,491 | rs3874239 | SORD (0) | 11 | 11 | — |
| EUR | chr16:53,772,541 | rs56094641 | FTO (0) | 116 | **137** | 72.4% |
| EUR | chr6:32,548,607 | rs78837720 | HLA-DRB6 (3.2 kb) | 6 | 53 | — |
| EUR | chr6:26,104,404 | rs198851 | **HFE-AS1** (0) | 330 | 29 | — |

**AFR anemia is the globin clusters.** chr11:5,227,100 sits inside HBB, about
100 bp from rs334, the sickle variant, and contributes the most edges. The
heaviest locus, chr16:12,965–700,107, spans the alpha-globin cluster —
HBA1/HBA2 sit at ~0.18 Mb, inside the clump, though the lead SNP's own
nearest gene is FAM234A — and carries 86.3% of the shared SNPs.

This is the signal T3 removes wholesale (§7). It is pleiotropy at two of
the best-characterised loci in human genetics, not definitional overlap.

**EUR anemia is a different set entirely**, led by FTO, the HLA class II
region, and HFE — hereditary haemochromatosis, i.e. iron overload rather
than iron deficiency, which is consistent with the discordant direction of
effect on the 275.1 edge noted in §7. None of these overlaps the AFR loci.

---

## 6. Network-wide tiers (A5)

`results/network_wide_tiers.csv`, `results/network_wide_tiers.png`.
All at p < 1e-4. Tiers are mutually exclusive, assigned T1 > T2 > T3 > T4.

### Tier counts and weight share

| Ancestry | Tier | Edges | Fraction of edges | Fraction of weight |
|---|---|---|---|---|
| AFR | T1 | 469 | 8.50% | 28.3% |
| AFR | T2 | 169 | 3.06% | 9.73% |
| AFR | T3 | 403 | 7.30% | 9.43% |
| AFR | T4 | 9 | 0.16% | 0.03% |
| AFR | unrelated | 4,467 | 81.0% | 52.5% |
| EUR | T1 | 624 | 1.17% | 8.95% |
| EUR | T2 | 479 | 0.90% | 3.40% |
| EUR | T3 | 1,051 | 1.97% | 3.60% |
| EUR | T4 | 20 | 0.04% | 0.03% |
| EUR | unrelated | 51,229 | 95.9% | 84.0% |
| META | T1 | 627 | 1.22% | 8.43% |
| META | T2 | 481 | 0.94% | 3.46% |
| META | T3 | 1,110 | 2.17% | 3.93% |
| META | T4 | 22 | 0.04% | 0.03% |
| META | unrelated | 48,984 | 95.6% | 84.2% |

Related pairs are a minority of edges and a much larger share of weight:
19.0% of AFR edges carry 47.5% of AFR weight (EUR: 4.1% and 16.0%). That
asymmetry is the reviewer's concern expressed as a number, and it is real.

### Weight by tier, against unrelated

Median [IQR] shared SNPs, Mann–Whitney two-sided against unrelated pairs,
with the rank-biserial correlation as the effect size:

| Ancestry | Tier | Median [IQR] | Unrelated median [IQR] | p | rank-biserial |
|---|---|---|---|---|---|
| AFR | T1 | 12 [3, 62] | 3 [1, 14] | 9.9e-35 | 0.34 |
| AFR | T2 | 40 [8, 151] | 3 [1, 14] | 6.7e-28 | 0.49 |
| AFR | T3 | 11 [2, 59] | 3 [1, 14] | 2.2e-18 | 0.26 |
| AFR | T4 | 5 [3, 16] | 3 [1, 14] | 0.20 | 0.24 |
| EUR | T1 | 176 [20, 1,286] | 32 [5, 125] | 1.3e-51 | 0.35 |
| EUR | T2 | 100 [16, 628] | 32 [5, 125] | 2.0e-26 | 0.28 |
| EUR | T3 | 70 [11, 284] | 32 [5, 125] | 5.7e-24 | 0.18 |
| EUR | T4 | 84.5 [27, 246] | 32 [5, 125] | 0.068 | 0.24 |
| META | T1 | 184 [21, 1,130] | 29 [5, 115] | 4.3e-57 | 0.37 |
| META | T2 | 103 [17, 575] | 29 [5, 115] | 7.8e-30 | 0.30 |
| META | T3 | 74 [13, 236] | 29 [5, 115] | 6.7e-32 | 0.21 |
| META | T4 | 67 [14, 169] | 29 [5, 115] | 0.17 | 0.17 |

T1, T2 and T3 edges are all reliably heavier than unrelated ones. The effect
is moderate, not overwhelming: a rank-biserial of 0.2–0.5 means a related
pair outweighs an unrelated one roughly 60–74% of the time. T3's effect is
the weakest of the three, consistent with it being the coarsest rule. T4 is
not distinguishable from unrelated in any ancestry.

### Synergy by tier

Synergistic fraction by weight (and, in brackets, the fraction of edges whose
concordant SNPs outnumber their discordant ones):

| Ancestry | T1 | T2 | T3 | T4 | unrelated |
|---|---|---|---|---|---|
| AFR | 0.948 (0.994) | 0.803 (0.959) | 0.972 (0.921) | 1.000 (1.000) | 0.746 (0.798) |
| EUR | 0.998 (0.992) | 0.986 (0.935) | 0.824 (0.821) | 0.809 (0.900) | 0.712 (0.719) |
| META | 0.996 (0.990) | 0.980 (0.933) | 0.825 (0.832) | 0.804 (0.909) | 0.713 (0.721) |

**The prediction holds for T1 and T2.** They are overwhelmingly synergistic
— 0.95 to 0.998 by weight — against 0.71–0.75 for unrelated pairs. Two codes
that describe the same illness do move together, as they should.

T3 sits in between: 0.82–0.97 by weight, clearly above unrelated but below
T1/T2 in EUR and META. That is what a coarse rule should look like — it is
catching some genuine duplicates and a good deal of ordinary same-block
comorbidity.

The AFR T2 figure (0.803) is the one departure among the strong tiers, and
it is driven by a small number of heavy discordant sibling edges rather than
by many edges: 95.9% of AFR T2 edges are concordant by majority.

### Antagonistic check

Share of all antagonistic edge weight coming from each tier:

| Ancestry | T1 | T2 | T3 | T4 | unrelated |
|---|---|---|---|---|---|
| AFR | 8.71% | 11.3% | 1.53% | 0.00% | 78.5% |
| EUR | 0.08% | 0.19% | 2.55% | 0.02% | 97.2% |
| META | 0.12% | 0.27% | 2.76% | 0.02% | 96.8% |

**Antagonistic edges are not a redundancy artefact.** In EUR and META,
96.8–97.2% of antagonistic weight comes from unrelated pairs. AFR is less
extreme at 78.5%, but related pairs still carry a smaller share of
antagonistic weight (21.5%) than of total weight (47.5%) — they are
*under*-represented among discordant edges, which is the opposite of what
definitional overlap would produce.

---

## 7. Secondary example: iron deficiency anemia (A6)

280.1, node 271, hematopoietic. Obesity was dropped at your instruction. No
L4, per the task.

| Ancestry | Level | Degree | Weighted degree | Cluster (count) | Cluster (weight) | Synergistic (weight) | Synergistic (edge) |
|---|---|---|---|---|---|---|---|
| AFR | L0 | 35 | 1,890 | 0.429 | 0.966 | 0.988 | 0.800 |
| AFR | L1 | 34 | 1,339 | 0.412 | 0.951 | 0.984 | 0.794 |
| AFR | L2 | 34 | 1,339 | 0.412 | 0.951 | 0.984 | 0.794 |
| AFR | **L3** | **29** | **80** | **0.310** | **0.188** | **0.725** | **0.759** |
| EUR | L0 | 238 | 18,183 | 0.105 | 0.177 | 0.840 | 0.761 |
| EUR | L1 | 237 | 17,073 | 0.101 | 0.124 | 0.829 | 0.759 |
| EUR | L2 | 236 | 17,024 | 0.097 | 0.121 | 0.829 | 0.758 |
| EUR | L3 | 231 | 16,234 | 0.078 | 0.079 | 0.821 | 0.762 |
| META | L0 | 240 | 18,257 | 0.117 | 0.236 | 0.850 | 0.750 |
| META | L1 | 239 | 16,798 | 0.113 | 0.169 | 0.837 | 0.749 |
| META | L2 | 238 | 16,754 | 0.109 | 0.167 | 0.837 | 0.748 |
| META | L3 | 233 | 15,209 | 0.090 | 0.083 | 0.820 | 0.742 |

Anemia separates the tiers more sharply than ESRD does, and it is the
clearest illustration in the whole analysis of what T3 costs.

**Through L2, anemia in AFR is almost untouched.** The exclusions remove
exactly one neighbour — 280 Iron deficiency anemias, its parent, 551 shared
SNPs — and cluster weight falls only from 0.966 to 0.951. The top three
remaining partners are 282.8 Other hemoglobinopathies (456), 285 Other
anemias (438) and 282 Hereditary hemolytic anemias (363), all concordant.

**L3 destroys it.** Weighted degree collapses from 1,339 to **80**, cluster
weight from 0.951 to 0.188, synergistic weight from 0.984 to 0.725. The top
remaining partner has 11 shared SNPs. 280.1's exclusion range is
`280-285.99`, which contains every one of those hemoglobinopathy and anemia
codes, so T3 removes the entire signal in one step.

Whether that is the right thing to do is a clinical question, and we think
the answer is clearly no: in an African-ancestry cohort the shared genetics
of iron deficiency anemia and the hemoglobinopathies is the sickle-cell and
thalassemia trait story, which is pleiotropy, not one illness coded twice.
It is also the strongest case in this analysis for reading T3 as something
other than a redundancy measure — see §9.

EUR behaves as it does for ESRD throughout: a large, diffuse, largely
non-cluster neighbourhood that even L3 barely touches (238 → 231). Its
heaviest surviving partner is 275.1 Disorders of iron metabolism, 390 shared
SNPs of which 389 are *discordant* — which is what one would expect of iron
deficiency against iron overload, and which no exclusion level removes.

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

**T3 does not measure what the reviewer's argument needs, and this is the
most important caveat in the report.** `phecode_exclude_range` exists to say
which patients must not be used as controls for a phenotype. Two conditions
land in each other's exclusion range precisely *because* they overlap
clinically — which is very often because they share biology. 715.2
(ankylosing spondylitis) explicitly excludes `696-696.99` (psoriasis); those
two share 9,728 SNPs in EUR and are a textbook shared-genetics pair, not one
illness coded twice. Across the network, T3 alone would mask 2,547 edges
including that one (`results/toggle_t3_only_edges.csv`).

Two further properties compound it. T3 is **block-wide**: every code in
580–590.99 carries that same range, so it fires between any two codes in a
block irrespective of how different they are. And it is **not symmetric** in
the source data — 580's range contains 590 but 590's does not contain 580 —
so it has to be evaluated in both directions, which widens it further.

The practical consequence is that L3 is not a stricter version of L2. For
ESRD in AFR it is numerically identical to L4, the drop-the-whole-category
stress test (§4). For iron deficiency anemia in AFR it removes the
hemoglobinopathies and takes weighted degree from 1,339 to 80 (§7). **Read
L3 as "drop the phecode block", not as "drop definitional duplicates".** L2
is the level that corresponds to the reviewer's question as posed, and L3 is
an upper bound alongside L4.

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
many. It is nearly inert in this analysis (22 pairs as a primary tier, 0.03%
of weight, no ESRD neighbours at any level), so it does not affect the
conclusions here — but see `TOGGLE_EVALUATION.md` §4.3, where the same rule
applied across the whole network hides some clinically distinct pairs on the
strength of one code.

**The L4 stress test is not a redundancy control.** Removing every
genitourinary neighbour of a kidney phenotype removes real biology along
with any artefact. It is reported because the task asks for it, and it
should be read as an upper bound on what exclusion can take away, not as an
estimate. On this data L3 has turned out to be the same kind of thing.

**Clumping is by distance, not LD.** No LD reference is installed and the
task forbids downloading one, so a ±500 kb window stands in for an LD
block. It will merge independent signals that happen to sit close together
— the APOL1 clump spans 36.03–36.75 Mb and takes in MYH9, which this
analysis cannot separate from APOL1 — and it will split a long-range block.
Locus counts are therefore approximate, and "APOL1" should be read as "the
chr22q12.3 region containing APOL1 and MYH9".

**Positions cover 93% of rsids.** 63,597 of 898,972 did not resolve against
dbSNP155, and 5–9% of the shared SNPs on any given edge have no position.
Locus metrics are computed on the covered subset and the CSVs report the
coverage at every level, but a systematically unusual set of unresolved
variants would bias them.

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

The synergistic part persists completely; the within-cluster part halves. At
p < 1e-4 the synergistic weight fraction is 0.998 (L0), 0.997 (L1), 0.997
(L2), 0.995 (L3) — unchanged for practical purposes. The within-cluster
weight fraction falls 0.703 → 0.678 → 0.585 → 0.307, and degree 86 → 84 → 80
→ 69. Note that L3 for AFR is numerically identical to the L4 category
stress test, so the 0.307 figure is what survives dropping the entire
genitourinary block, not a redundancy-only exclusion (§9).

**Does the AFR vs. EUR contrast in synergistic fraction persist at each
level?**

Yes, and it widens at every level. Synergistic weight fraction, AFR against
EUR: 0.998 vs 0.800 (L0), 0.997 vs 0.778 (L1), 0.997 vs 0.742 (L2), 0.995 vs
0.736 (L3). At p < 1e-8 AFR is exactly 1.000 at every level including L4,
against EUR's 0.716 → 0.658 → 0.608 → 0.597. The gap comes from EUR losing
synergy as exclusions are applied while AFR does not move at all.

**How much of AFR ESRD connectivity is attributable to one locus?**

By weight, almost all of it: **91.5% of the SNPs shared across ESRD's AFR
edges sit in the APOL1 clump** (chr22:36.03–36.75 Mb, lead rs9622362), and
that falls only to 88.7% at L3. By breadth it is a different locus: TCF7L2
(chr10:113.0 Mb, rs7903146) appears on 61 of the 86 edges but carries 6
SNPs. In EUR the APOL1 share is 0.0% at every level. The AFR result is
therefore one locus with many phenotypic consequences rather than a
polygenic cluster, and that locus is absent from EUR.

**How much of the ESRD cluster is definitional overlap?**

On the narrow reading, 28% of AFR connectivity by weight; on the widest
reading, 58%; and none of the direction-of-effect signal on either. At
p < 1e-4, T1+T2 neighbours account for 1,351 of ESRD's 4,755 AFR shared SNPs
(28.4%) and 1,828 of 8,128 in EUR (22.5%); adding T3 takes AFR to 2,767 of
4,755 (58.2%) and EUR to 1,965 of 8,128 (24.2%). Six of ESRD's 86 AFR
neighbours are T1/T2 relatives and 17 are relatives under any tier.

The two readings differ because T3 is the whole 580–590.99 block, so the
58% figure counts every genitourinary partner as "definitional" — including
kidney transplant and secondary hyperparathyroidism of renal origin, which
are consequences of ESRD rather than restatements of it. We would report the
28% figure as the answer and the 58% as an upper bound.

Either way the synergistic fraction is unchanged (0.998 → 0.997 → 0.995), so
whatever part of the cluster is definitional is not the part carrying the
concordant-direction signal. Both figures remain bounds rather than
estimates, because structural tiers do not measure case overlap (§9).
