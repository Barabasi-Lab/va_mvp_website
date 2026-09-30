# A0 — Reconnaissance and baseline reproduction

Status: **stopped at gate A0.5.** The baseline does not reproduce, and three
inputs required by Parts A and B are absent. No analysis code has been written
beyond the read-only queries reported here. Nothing in production was touched.

## 1. Inputs and provenance

| File | Path | MD5 | Notes |
|---|---|---|---|
| Raw associations | `~/Desktop/full_dataset.csv` | `39bffbd35036d78c0c0ef94f54068ad4` | 24.0M rows, 3.35 GB |
| Association store (served) | `public/data/db/associations/chrom=*/*.parquet` | built from the above | 3,060,080 rows, the 1,320 network phenotypes |
| Network edgelist (page 1) | `public/data/edgelist_updated_scaled.csv` | `f6590ea4bb73f1f27f54dff0462c28ca` | 54,790 edges, precomputed weights |
| Node attributes | `public/data/node_attributes.csv` | `1fe4e5d0be82f11c64f2cc37a96392c5` | 1,321 nodes |
| Phenotype code→label | `~/Desktop/phenotype_labels.pkl` | `ea8c809ee731c4ba862e6a658afbb319` | 1,749 codes |
| **Phecode Map 1.2** | — | — | **ABSENT** |
| **ICD→phecode map** | — | — | **ABSENT** |

## 2. Columns present (A0.1)

`phe_id, phenotype, rsid, chrom, src_row`, and `pval/beta/se` for each of
META, EUR, AFR, AMR, EAS.

- **Chromosome: yes. Base-pair position: NO.** There is no position column
  anywhere in the raw file or the store.
- **Genome build: not recorded**, and not inferable without positions.
- **Per-ancestry case/control counts: NO.**

## 3. Genome-wide summary statistics? (A0.2)

**No.** Of 3,060,080 rows, **0** fail to reach p < 1e-4 in at least one
ancestry. The dataset is ascertained on significance: a (phenotype, SNP) row
exists only if it was significant in some ancestry, with the other ancestries'
statistics reported alongside.

Consequence: **A7 is skipped**, exactly per the task's own instruction — the
"null" z-scores on this subset would be biased by the ascertainment.

## 4. Phecode map (A0.3)

Not in the repo, not on the Desktop, nowhere under the working tree. Match
rate against our phenotypes therefore cannot be computed, and the phecode
version cannot be confirmed.

Phenotype coding in our data: 1,325 codes back the 1,320 network nodes.
1,320 are `Phe_<int>[_<dec>]` (e.g. `Phe_585_32` = phecode 585.32). Five are
not phecodes at all — `DoApnea, DoAsth, HVGlauc, SkMsGout, SkMsOP` — and these
are the second code of the five merged nodes (Sleep apnea, Asthma, Glaucoma,
Gout, Osteoporosis). They cannot be tier-classified.

No `survey`-category nodes are present; the network's categories are the 16
phecode categories. Survey exclusion appears to have happened upstream.

## 5. Baseline reproduction (A0.4) — **does not reproduce**

ESRD = phecode 585.32 = `Phe_585_32` = node id `905`. Present.

| Manuscript claim | Reproduced | Verdict |
|---|---|---|
| >100 ESRD SNPs in AFR at p<1e-4 | **713** | reproduces |
| >100 ESRD SNPs in EUR at p<1e-4 | **554** | reproduces |
| **Only 1 SNP shared between AFR and EUR** | **14** raw / **7** after the >40 filter / **7** in the site's node view | **does not reproduce** |
| Network-view neighbours of ESRD | AFR 86, EUR 142, META 160 — matches the served edgelist exactly | reproduces |

### The 14 shared SNPs split cleanly in two

| rsid | chr | phenotypes carrying this SNP |
|---|---|---|
| rs7903146, rs7074440, rs10659211, rs56087297, rs11196211, rs55853916, rs4267006 | **10** | 54–85 — all **>40** |
| rs2016708, rs7291423, rs10854687, rs8142325, rs8142600, rs35305544, rs7291184 | **22** | 22–27 — all ≤40 |

The chr10 group is the TCF7L2 region (rs7903146 is the canonical T2D variant)
and is removed by a >40-phenotype promiscuity filter. The seven survivors are
all on chr22 and are almost certainly one LD block — the APOL1 region sits at
22q12.3.

**Most likely explanation for "1":** the manuscript counts *loci*, not SNPs,
after promiscuity filtering and LD/distance clumping — seven chr22 SNPs in one
block collapse to one lead SNP. I cannot confirm this, because clumping needs
base-pair positions, which we do not have (§2).

This needs an answer from you rather than a guess, because the number is a
headline claim and the difference between "1 SNP" and "7 SNPs in 1 locus"
changes what the sensitivity analysis is testing.

## 6. Pipeline deviations found

These matter because the task says to reuse the site's network code.

1. **The promiscuous-SNP filter does not exist in the shipped pipeline.**
   4,552 SNPs appear in >40 phenotypes (max 122). ESRD's page-1 neighbour
   counts (AFR 86, EUR 142) match the *unfiltered* recomputation exactly, so
   `edgelist_updated_scaled.csv` was built without it too. There is no code to
   reuse; it must be reimplemented, and the threshold and tie-handling need to
   come from you.

   Its effect is large: ESRD's AFR neighbours go 86 → 39 and EUR 142 → 59.

2. **Page-1 edge weights are scaled, not SNP counts.** ESRD's 86 AFR edges sum
   to 39.58. A3's "weighted degree: sum of shared-SNP counts" must therefore be
   recomputed from the association store, not read off the edgelist.

3. **Pages 1 and 2/3 are built from different SNP sets.** Page 1 uses the
   precomputed edgelist; pages 2/3 query the association store and cap at the
   150 strongest SNPs per phenotype. ESRD has 1,245 candidate SNPs in AFR+EUR
   comparison mode, so the node view shows a capped subset. A3 should use the
   store directly; which view the manuscript's figures came from affects what
   "matches the site" means.

## 7. What is blocked, and what is not

| Item | Status |
|---|---|
| A2 tiers T1, T2 | **Unblocked** — derivable from the code strings |
| A2 tiers T3, T4 | **Blocked** — need the phecode map (`phecode_exclude_range`, ICD mapping) |
| A2 case-count column | **Blocked** — no case/control counts |
| A3 levels L0, L1, L2 | Unblocked once the baseline question is settled |
| A3 levels L3, L4 | **Blocked** — L3 needs T3/T4; L4 needs only categories, so L4 alone is fine |
| A4 (all locus work, APOL1 share, locus overlap) | **Blocked** — no base-pair positions |
| A5 network-wide tiers | Partially — T1/T2 only |
| A6 anemia (280.1 = `Phe_280_1`, node 271) | Same constraints as A3/A4 |
| A7 | **Skipped**, correctly: data is significance-ascertained |
| Part B, tier set {T1,T2} | Feasible |
| Part B, tier sets involving T3/T4, and B4 coverage comparison | **Blocked** |

## 8. What I need to proceed

1. **Phecode Map 1.2 definitions** (with `phecode_exclude_range`) and the
   **ICD→phecode mapping**. Without these, T3 and T4 do not exist, so L3 —
   the level the reviewer's argument really turns on — cannot be computed.
2. **SNP positions** (a build-annotated rsid→chr:pos table, or the original
   summary statistics with positions). Without these, all of A4 is impossible:
   no clumping, no APOL1 share, no locus-level AFR/EUR comparison. Please also
   state the genome build.
3. **A decision on the baseline discrepancy.** Either the manuscript's
   definition of the "1 shared SNP" figure (filters, clumping, which view), or
   confirmation that 14 raw / 7 post-filter is the correct current number and
   the manuscript text will be revised.

Useful but not blocking: per-ancestry case/control counts, and confirmation of
the promiscuity threshold (>40) and where it should apply.

## 9. Note on the task text

A6 as written asks for anemia and obesity. Per your instruction, obesity is
dropped; A6 will cover iron deficiency anemia (280.1) only.
