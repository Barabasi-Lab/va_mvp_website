# ESRD worked example at p < 1e-6

Written for the manuscript authors. Reproduce with
`python3 analysis/final/esrd_1e6.py`; outputs in
`analysis/final/results/esrd_1e6/` and
`analysis/final/results/esrd_threshold_comparison.csv`. The 1e-4 run in
`analysis/examples/results/` is untouched.

Nothing was reimplemented — this is `analysis/examples/e_esrd.py` with its
threshold moved, so the two runs are comparable line for line.

---

## Verdict

**The qualitative story holds. One specific claim does not: APOL1 is no
longer a shared AFR–EUR locus at 1e-6.**

52 numbers were compared; 3 are bit-identical and the rest move. But almost
all of the movement is small and in the direction that *strengthens* the
drafted interpretation. Two things genuinely break.

---

## 1. What breaks

### 1.1 "2 shared loci (APOL1 and TCF7L2)" becomes 1

| | p < 1e-4 | p < 1e-6 |
|---|---|---|
| shared AFR–EUR loci | **2** — chr10/TCF7L2, chr22/APOL1 | **1** — chr10/TCF7L2 |

APOL1 drops out because EUR's best lead in the region, **rs7291184, has
p = 1.118e-6** — 12% above the threshold. The other two APOL1 leads are
nowhere near: rs9622362 p = 0.021 and rs73885319 p = 9.2e-4 in EUR.

So the shared-APOL1 finding rests on a single EUR p-value that is within a
factor of 1.2 of 1e-6. It survives at the threshold the manuscript uses, but
it is the most threshold-fragile claim in the example and worth a hedge in
the text.

Knock-on: the EUR cross-ancestry lead table loses its APOL1 entry, and EUR
loci fall 23 → 22 with "consistent and nominally significant" 6 → 5. Every
other EUR category is unchanged.

### 1.2 The AFR–EUR SNP overlap nearly vanishes

| | p < 1e-4 | p < 1e-6 |
|---|---|---|
| shared SNPs | 14 | **2** |
| union | 1,253 | 1,253 |
| Jaccard | 1.12% | **0.16%** |

The union being 1,253 at both is a coincidence (713 + 554 − 14 = 708 + 547 − 2).

A drafted sentence that quotes "14 shared SNPs" is threshold-specific. The
*direction* of the claim — that AFR and EUR share almost nothing at the SNP
level — is unchanged and in fact stronger.

---

## 2. What holds

### 2.1 Every contrast the example is built on

| Claim | p < 1e-4 | p < 1e-6 | |
|---|---|---|---|
| AFR within-cluster weight share | 70.3% | 71.4% | holds, slightly stronger |
| EUR within-cluster weight share | 36.8% | 36.9% | holds |
| AFR concordant weight share | 99.77% | 99.83% | holds |
| EUR discordant weight share | 20.0% | 20.0% | holds |
| EUR neighbours with any discordant SNP | 44 (31.0%) | 44 (31.2%) | holds |
| EUR majority-discordant share | 23.9% | 24.1% | holds |
| AFR concentration on chr22 | 91.6% | 92.2% | holds, stronger |
| EUR concentration on chr10 | 69.7% | 70.6% | holds, stronger |
| APOL1 AFR neighbours | 39 | **39** | identical |
| APOL1 AFR group weight | 3,993 | **3,993** | identical |
| APOL1 share of EUR weight | 0.0% | 0.0% | holds |

### 2.2 Both discordant-locus claims are bit-identical

| | p < 1e-4 | p < 1e-6 |
|---|---|---|
| chr10 BICC1 → eye phenotypes | 3 phenotypes, **1,026** | 3 phenotypes, **1,026** |
| chr16 UMOD → kidney-stone phenotypes | 5 phenotypes, **187** | 5 phenotypes, **187** |

Every SNP driving these is below 1e-6 already.

### 2.3 The redundancy sensitivity keeps its shape

EUR barely moves — degree 142/140/134/129 → 141/139/133/128 at L0–L3, with
within-cluster weight 36.8/30.0/18.5/17.1% → 36.9/30.0/18.5/17.2%.

AFR loses more degree (86/84/80/69 → 71/69/65/55) but the pattern the text
describes is intact and sharper: within-cluster weight 70.3/67.8/58.5/30.7%
→ 71.4/69.0/59.9/32.0%, still collapsing at L3; concordant weight stays
above 99.5% at every level.

---

## 3. Numbers that change and would need re-quoting

If the manuscript moved to 1e-6, these drafted values change:

| Quantity | 1e-4 | 1e-6 |
|---|---|---|
| AFR neighbours | 86 | **71** |
| EUR neighbours | 142 | **141** |
| AFR / EUR significant SNPs | 713 / 554 | **708 / 547** |
| AFR–EUR shared SNPs | 14 | **2** |
| loci AFR / EUR / META | 32 / 23 / 33 | **32 / 22 / 23** |
| shared loci | 2 | **1** |
| APOL1 share of AFR weight at L2 | 89.4% | **91.5%** |
| TCF7L2 AFR neighbours / weight | 61 / 131 | **40 / 48** |
| AFR edge weight | 4,755 | **4,655** |
| EUR edge weight | 8,128 | **8,116** |

META is the biggest mover: 33 loci → 23. AFR's locus count is unchanged at
32 even though its SNP count falls, so the loci it loses were singletons.

The genome-wide counts (389 AFR / 372 EUR / 467 META SNPs at 5e-8) are
unaffected, as they use their own fixed threshold.

---

## 4. Recommendation

Keep 1e-4 as the primary threshold — it is what the database retains and
what the figures use. The one thing to change in the text regardless of
threshold is the APOL1 shared-locus sentence: it should say the EUR signal
at APOL1 is suggestive (rs7291184, p = 1.1e-6) rather than implying it is
robust, because at a threshold one decade stricter it is not there at all.
