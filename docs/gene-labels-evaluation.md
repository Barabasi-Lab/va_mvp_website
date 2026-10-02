# Nearest-gene labels: evaluation

Branch `gene-labels`, from `main`. **Nothing merged, nothing uploaded.**

Stage 1 puts a nearest-gene line in the SNP tooltip on pages 2 and 3 and
gene columns in the downloads. Stage 2 adds group labels bracketing runs of
SNPs that share a nearest gene, behind a toggle that is off by default.

**Recommendation: ship Stage 1 after fixing the payload, and ship Stage 2.**
The numbers are in §6.

---

## 1. The annotation

### Rule

For every rsID in the store:

| Case | Label | Status |
|---|---|---|
| Inside one protein-coding gene | `APOL1` | `in_gene`, distance 0 |
| Inside several | `UGT1A8 +4`, all symbols kept in genomic order | `in_gene`, distance 0 |
| Outside, nearest within 1 Mb | `UMOD (21 bp)` | `near_gene`, signed bp |
| Nearest further than 1 Mb | `intergenic (nearest: GENE, 1.2 Mb)` | `intergenic_far` |
| Inside the extended MHC | `MHC region (nearest gene: HLA-DRB5)` | `mhc_region` |
| No position for the rsID | `position unknown` | `position_unknown` |

Distance is signed: negative when the SNP lies before the gene on the
reference strand. A gene body is the union of its transcripts, start to end.

A SNP inside a non-coding gene also gets a second tooltip line, `Within:
HFE-AS1 (non-coding)`, and a store column. The headline label stays
protein-coding so it matches the paper.

### Versions

Identical to the example reanalysis, so the paper's gene names and the
site's come from the same build (`public/data/annotation/*_versions.json`):

| | |
|---|---|
| R | 4.6.1 |
| TxDb.Hsapiens.UCSC.hg38.knownGene | 3.22.0 |
| org.Hs.eg.db | 3.23.1 |
| GenomicFeatures | 1.64.0 |
| SNPlocs.Hsapiens.dbSNP155.GRCh38 | 0.99.24 |
| Build | GRCh38 |
| Protein-coding genes | 19,651 |
| Far threshold | 1 Mb |

### Two decisions worth recording

**The gene universe is protein-coding only, and that differs from the
example reanalysis.** That work annotated against all 35,356 TxDb genes.
Five of the twenty gene labels in `EXAMPLES_REPORT.md` change as a result —
`LINC00861`→`LRATD2 (494 kb)`, `HLA-DRB6`→`HLA-DRB5 (18 kb)`,
`LOC105370635`→`SERPINA11 (71 kb)`, `HFE-AS1`→`H4C3 (66 bp)`,
`LOC101929532`→`DPP4 (33 kb)`. All five were non-coding or LOC entries. The
authors have confirmed the paper will adopt the protein-coding language.

**The extended MHC is excluded from gene labelling.** Genes there are packed
tightly and LD runs the length of the region, so a nearest gene means very
little — `rs78837720` moved from `HLA-DRB6` to `HLA-DRB5` purely on the
biotype filter, which makes the point. SNPs inside it read `MHC region
(nearest gene: X)`.

The boundary is not a copied coordinate. It is computed from this same gene
build using the anchor genes Horton et al. 2004 (*Nat Rev Genet* 5:889,
"Gene map of the extended human MHC") bound the region with: **H2BC1**
telomerically and **KIFC1** centromerically, giving
**chr6:25,726,777–33,409,896**. The 7.68 Mb span that produces matches the
7.6 Mb Horton reports, which is the check that the anchors are the right
ones. 51,885 SNPs fall inside.

> This machine has no network access, so the Horton boundary definition was
> applied from the anchor genes rather than verified against the paper
> directly. Worth one confirmation before publication. It is a single
> constant in `build_gene_annotation.R`.

---

## 2. Correctness

### 2.1 Unit tests

`node scripts/test_gene_annotation.js` — **16 passed, 0 failed**. Covers a
SNP inside one gene; inside two overlapping genes; upstream (negative
distance) and downstream (positive); more than 1 Mb away; an unmapped rsID;
a SNP exactly at each gene boundary (inside, distance 0); and exactly 1 Mb
away, which is `near_gene`, since the rule says *more than* 1 Mb. Also the
grouping and collision code.

### 2.2 Known loci

| SNP | Role | Label | Status |
|---|---|---|---|
| rs9622362 | APOL1 locus, AFR lead | **APOL1** | in_gene |
| rs73885319 | **APOL1 G1, p.S342G** | **APOL1** | in_gene |
| rs7291184 | APOL1 locus, EUR lead | **APOL4 (3 kb)** | near_gene |
| rs7903146 | TCF7L2, AFR lead | **TCF7L2** | in_gene |
| rs34872471 | TCF7L2, EUR lead | **TCF7L2** | in_gene |
| rs4948524 | EUR chr10 discordant locus | BICC1 | in_gene |
| rs12922822 | EUR chr16 kidney-stone locus | UMOD (21 bp) | near_gene |

Both TCF7L2 leads and two of the three APOL1-region leads land exactly
where expected. The EUR APOL1 lead resolves to **APOL4**, 3 kb away — the
APOL gene cluster, which is what the task allows for, and a fair
illustration that nearest gene picks a neighbour rather than a mechanism.

### 2.3 External agreement with PheWeb

**Skipped. This machine has no network access**, so the MVP PheWeb pages
could not be reached. This is the one correctness check in the task that was
not run, and it is the one that would have characterised disagreement
against an external gene set.

### 2.4 Spot check

30 random SNPs with position, label, distance and status are in
`analysis/examples/results/` (regenerate with the coverage script). A sample:

| rsID | Label | Distance | Status |
|---|---|---|---|
| rs267736 | CERS2 | 0 | in_gene |
| rs35212593 | PSMA4 (920 bp) | −920 | near_gene |
| rs116752666 | UGT1A8 +4 | 0 | in_gene |
| rs9274060 | MHC region (nearest: HLA-DQB1) | 0 | mhc_region |
| rs149798878 | UNC5D (594 kb) | −594,285 | near_gene |
| rs1548945 | TNP1 (58 kb) | −58,392 | near_gene, within IGFBP-AS1 |

### 2.5 A bug this found, worth recording

The first annotation pass called `genes(single.strand.genes.only = TRUE)` on
the full TxDb, which carries 711 sequences including the GRCh38 alt
haplotypes. A gene that also maps to an alt scaffold spans several sequences
and was silently dropped: **1,375 protein-coding genes genome-wide, and all
but 10 of the 167 on chr6:29–33.5 Mb**, including TNF, HLA-A, HLA-B,
HLA-DRB1 and HLA-DQB1. Every MHC label in that pass was wrong. Restricting
seqlevels to the primary assembly before calling `genes()` fixes it.

---

## 3. Coverage

Over the 898,972 unique SNPs in the store:

| Status | SNPs | Share |
|---|---|---|
| `in_gene` | 425,733 | 47.4% |
| `near_gene` | 349,598 | 38.9% |
| `position_unknown` | 63,597 | 7.1% |
| `mhc_region` | 51,885 | 5.8% |
| `intergenic_far` | 8,159 | 0.9% |

`near_gene` distance, absolute: **median 52,068 bp**, IQR 13,721–199,526,
p95 642,027. 50.5% are upstream (negative).

**Including lncRNA would change 288,727 of 835,375 positioned labels
(34.6%)** — 219,916 `near_gene`, 39,258 `in_gene`, 21,521 `mhc_region`,
8,032 `intergenic_far`. The protein-coding choice is doing a lot of work and
should be stated in the methods, not assumed.

---

## 4. Speed

Baseline is `main` with the pre-annotation store on :3001; the feature
branch with the rebuilt store on :3000. Median of 10.
`python3 scripts/bench_gene_endpoints.py`,
`node scripts/bench_gene_labels.js`.

### Endpoint latency and transferred bytes

Bytes are what the server sends, measured before decoding, with
`Content-Encoding: gzip` confirmed on every response.

| Case | Latency | Δ | Transferred | Δ |
|---|---|---|---|---|
| page2 ESRD AFR | 585 → 590 ms | +1.0% | 113 → 132 kB | **+17.2%** |
| page2 Obesity META | 559 → 716 ms | **+28.2%** | 538 → 599 kB | **+11.4%** |
| page2 Asthma META | 409 → 496 ms | **+21.2%** | 182 → 221 kB | **+20.9%** |
| page3 ESRD–588 AFR | 174 → 206 ms | **+18.6%** | 19 → 22 kB | **+20.8%** |
| page3 Hyperlipidemia–lipoid EUR | 237 → 246 ms | +3.7% | 21 → 24 kB | **+16.4%** |

### Tooltip latency, 20 hovers each

| | Baseline | Feature |
|---|---|---|
| page 2 | 333.0 ms (p90 333.2) | 333.0 ms (p90 333.2) |
| page 3 | 332.8 ms (p90 333.0) | 332.5 ms (p90 332.9) |

### Stage 2 render, toggle on

| View | k=2 | k=3 | k=5 |
|---|---|---|---|
| page 2, 150 SNPs | 142.4 ms | 144.6 ms | 144.0 ms |
| page 3, 250 SNPs | 111.1 ms | 113.4 ms | 110.0 ms |

### Database size

| | Before | After | Δ |
|---|---|---|---|
| `associations/` total | 141.6 MB | 158.8 MB | **+12.2%** |
| largest shard (chrom=6) | 32.9 MB | 36.3 MB | +10.3% |
| shards | 22 | 22 | — |
| `public/data/db` total | 158.6 MB | 175.8 MB | +10.8% |

Plus `public/data/annotation/`: 12.7 MB parquet (protein-coding) and 6.0 MB
(lncRNA secondary, evaluation only, not read by the server).

### Against the acceptance guidelines

| Guideline | Result |
|---|---|
| Endpoint latency within 10% of baseline | **MISSED.** +1.0% to +28.2%; met on 2 of 5 cases |
| Payload increase under 5% for Stage 1 | **MISSED.** +11.4% to +20.9% on all 5 |
| No measurable change in tooltip responsiveness | **Met.** Identical to 0.5 ms |
| Stage 2 under 50 ms on the largest views | **MISSED.** 110–145 ms |

**The payload miss is structural and fixable.** The annotation is a
*per-SNP* fact sent on *every row*: page 2 returns 19 rows per SNP for ESRD
and 95 for Obesity. Sending it once per SNP in a side map keyed by rsID,
rather than on each row, was measured at **+1.0% (ESRD AFR) and +0.2%
(Obesity META)** against the same baseline — inside the guideline with room.
That is the change we would make before shipping Stage 1, and it is
contained: the response gains a `genes` object and the two pages read from
it instead of from each row.

The latency miss is partly the same cause — a larger response to serialise
and parse — and partly the wider Parquet rows. It is worth re-measuring
after the payload fix rather than treating it as settled.

The Stage 2 miss is against a 50 ms guideline that the existing filters do
not meet either: a p-value change on page 2 takes 685–1,082 ms. 110–145 ms
to redraw the whole network with labels is in line with the rest of the
page, and we would not hold Stage 2 for it — but it is a miss and is
reported as one.

### Two measurement errors made and corrected

Both inflated the payload figure, and both are worth knowing about if these
scripts are reused. Node's `fetch` transparently decompresses, so reading
the body length gives the *uncompressed* size however the request is
labelled; the first version reported those as gzipped and overstated the
cost about threefold. A second version used `new URL(...).path`, which does
not exist — every request went to `/` and returned "1 ms, 1 kB". The numbers
above come from `scripts/bench_gene_endpoints.py`, which reads the socket
directly and asserts the encoding.

---

## 5. Stage 2 readability

`analysis/examples/results/gene_label_shots/` — 15 panels, plus
`readability.json`.

| View | k | Groups | Drawn | Hidden | SNPs covered |
|---|---|---|---|---|---|
| page 2 — ESRD, AFR | 2 / 3 / 5 | 5 | 5 | 0 | 135/150 (90%) |
| page 2 — ESRD, EUR | 2 / 3 / 5 | 5 | 5 | 0 | 141/150 (94%) |
| page 2 — 280.1, AFR | 2 | 11 | 11 | 0 | 142/150 (95%) |
| page 2 — 280.1, AFR | 3 | 8 | 8 | 0 | 136/150 (91%) |
| page 2 — 280.1, AFR | 5 | 7 | 7 | 0 | 132/150 (88%) |
| page 2 — Obesity, META | 2 / 3 / 5 | 4 | 4 | 0 | 140/150 (93%) |
| page 3 — ESRD vs 588, AFR | 2 | 9 | 8 | 1 | 227/250 (91%) |
| page 3 — ESRD vs 588, AFR | 3 | 9 | 8 | 1 | 227/250 (91%) |
| page 3 — ESRD vs 588, AFR | 5 | 7 | 7 | 0 | 224/250 (90%) |

**Recommended k = 3.** Coverage is 90–94% everywhere, at most one label is
ever hidden, and k barely matters on four of the five views because the SNPs
in these neighbourhoods come from few loci. 280.1 in AFR is the one view
where k separates the options, and 3 keeps 91% coverage with 8 readable
labels where 2 gives 11 and starts to crowd. k=5 loses the smaller real
groups for nothing.

ESRD in AFR reads `MYH9 (60)`, `APOL2 (28)`, `APOL1 (24)`, `APOL4 (14)`,
`MYH9 (9)` — the APOL1/MYH9 locus, bracketed, which is exactly what the
reviewers asked to be able to see. The two MYH9 groups are separate
stretches in genomic order, not a bug.

### The ordering change Stage 2 required

Built as specified, Stage 2 did not work. Both pages ordered SNPs by
chromosome alone, so SNPs sharing a gene were scattered around the ring and
a run-based label fragmented — ESRD in AFR drew **five separate MYH9
brackets**. The store has never carried base-pair positions, so the
annotation now brings the GRCh38 position through and both pages order by
chromosome then position.

ESRD in AFR, page 2, k=3, through the fixes:

| | Groups | Covered |
|---|---|---|
| chromosome-only ordering | 12 | 84/150 (56%) |
| + position ordering | 8 | 114/150 (76%) |
| + grouping on the symbol, not the display string | **5** | **135/150 (90%)** |

The last step fixed two further bugs: `APOL2` and `APOL2 (6 kb)` are the
same gene and were splitting into separate brackets; and `position unknown`
is not a gene, but 13 consecutive SNPs carrying that string were being
labelled as though it were. Runs of `intergenic (nearest: X, 1.2 Mb)` are
excluded on the same grounds.

> **This changes the SNP ring order, so the existing Figure 3 and
> `fig:anemias` panels no longer match the site.** They were not
> regenerated, by instruction.

---

## 6. Recommendation

**Ship Stage 1, after moving the annotation to a per-SNP side map.** The
annotation is correct, the known loci land where they should, coverage is
high, and the tooltip costs nothing measurable. The payload as built misses
the guideline by 2–4×, and the fix is small and already measured at +0.2% to
+1.0%. Shipping it per-row instead would put 11–21% on every page-2 and
page-3 response for a fact that repeats 19 to 95 times per SNP.

**Ship Stage 2 at k = 3.** 90–94% coverage, at most one hidden label on the
densest view tested, and it answers the reviewers' request directly: the
APOL1/MYH9 locus is visible as a bracket rather than something a reader has
to reconstruct from hovering. The 110–145 ms render is over the 50 ms
guideline but under what the page's existing filters cost.

**Two things that must travel with it:**

1. The figures must be regenerated — the SNP ring order has changed.
2. The PheWeb comparison (§2.3) was never run. If an external cross-check
   matters before publication, it still needs doing somewhere with network
   access.

---

## 7. Diff and deployment

Branch `gene-labels`, unmerged, nothing uploaded.

| File | Change |
|---|---|
| `scripts/build_gene_annotation.R` | +230, new — the annotation |
| `scripts/build_dbs.py` | +45 — LEFT JOIN the versioned annotation |
| `server.js` | +10 — four columns on the row select, five on the download |
| `public/js/gene-labels.js` | +215, new — Stage 2 |
| `public/js/page2.js` | +60 — tooltip lines, position ordering, toggle |
| `public/js/page3.js` | +55 — the same |
| `public/page2.html`, `public/page3.html` | +1 each — script tag |
| `scripts/test_gene_annotation.js` | +180, new — 16 unit tests |
| `scripts/bench_gene_endpoints.py`, `scripts/bench_gene_labels.js`, `scripts/shoot_gene_labels.js` | new — the evaluation |

Rebuilt files, not in the repo:

| Path | Size |
|---|---|
| `public/data/db/associations/` | 158.8 MB, 22 shards, largest 36.3 MB |
| `public/data/db/` total | 175.8 MB |
| `public/data/annotation/snp_gene_annotation_grch38_20261002.parquet` | 12.7 MB |

Validation: `validate_ranking.py` and `validate_pages.js` both report **ALL
MATCH** against the rebuilt store, unchanged apart from the new columns.

### Uploading the rebuilt database

Same command the migration doc gives, after rebuilding locally:

```bash
# 1. build the annotation (needs the Bioconductor packages above)
Rscript scripts/build_gene_annotation.R \
        analysis/phecode_redundancy/results/snp_positions.csv \
        public/data/annotation/snp_gene_annotation_grch38_20261002

# 2. convert it to parquet and rebuild the store
python3 scripts/build_dbs.py --skip-landing

# 3. publish to the Railway volume
railway volume files -v va_mvp_website-volume upload public/data/db /db
```

Step 3 is the authors' to run. It has not been run here.
