# ESRD: why the AFR/EUR shared-SNP count changed, and what to do about it

**Question.** The updated interface shows 653 concordant associations for ESRD
in AFR+EUR comparison mode, against the 1 shared SNP the manuscript reports.
Is the change caused by removing the promiscuous-SNP filter, or by a bug?

**Answer.** Neither number is what the manuscript should quote, and the
promiscuous-SNP filter is not involved at any point — it has never existed in
the shipped code. The old "1" was produced by a selection defect, fixed in
commit `4165ea2`, compounded by a display rule and by a duplicate row in the
source data. The manuscript's *conclusion* survives; its supporting number
does not.

---

## 1. "653" and "1" are not the same measurement

653 is the total number of SNP–phenotype edges drawn in the node view. Only
**7 of them touch ESRD**. Driving the current build the way a reader would:

| | SNP nodes | Phenotype nodes | Total edges | **Edges touching ESRD** |
|---|---|---|---|---|
| ESRD, AFR+EUR, p < 1e-4 | 150 | 61 | 653 | **7** (7 concordant, 0 discordant) |

The other 646 edges connect the centre's 150 SNPs to the 60 *other*
phenotypes they also hit in both ancestries. The comparable figure to the
manuscript's "1" is **7**, not 653.

A coincidence worth naming so it does not cause confusion later: 653 is also
the number of ESRD's AFR SNPs that sit on chromosome 22. The two are
unrelated.

---

## 2. What the data actually say

Ground truth, straight from the association store, no interface involved:

| Quantity | Value |
|---|---|
| ESRD SNPs at p < 1e-4 in AFR | 713 |
| ESRD SNPs at p < 1e-4 in EUR | 554 |
| **In both** | **14** |
| …also passing \|beta\| > 0.01 in both | 14 |
| Jaccard overlap | **1.12%** |

The 14 fall into two tight groups:

| Group | rsIDs | Where | Phenotypes each reaches at p<1e-4 in both |
|---|---|---|---|
| chr10 | rs7903146, rs7074440, rs10659211, rs56087297, rs11196211, rs55853916, rs4267006 | TCF7L2, 113.0 Mb | 12–59 |
| chr22 | rs2016708, rs7291423, rs10854687, rs8142325, rs8142600, rs35305544, rs7291184 | APOL1, 36.21 Mb | **1 each — ESRD only** |

---

## 3. Why the old build showed 1

Three things stacked up. I reproduced the old behaviour by checking out
`4165ea2^` into a worktree and driving the same UI.

**(a) The selection defect — this is the bug.** Before `4165ea2`, page 2
picked the centre's top 150 SNPs by the **first ancestry's p-value alone**,
even with two ancestries selected. The commit that fixed it says so in its
own message. The consequence for ESRD:

| Build | Ranked by | Of the 14 shared SNPs, how many were even fetched |
|---|---|---|
| pre-fix, AFR first | p_afr | **7** (the chr22 group) |
| pre-fix, EUR first | p_eur | **1** (rs7903146) |
| current | min(\|z_afr\|, \|z_eur\|) | **14** |

Page 2 derives the "first" ancestry from checkbox DOM order, not the URL, so
in practice it was always AFR first for this pair: 7 of 14 fetched.

**(b) The min-degree-2 display rule.** `updateNodes()` drops any SNP node
with fewer than two surviving edges, so a SNP that reaches only the centre
phenotype is not drawn. All seven chr22 SNPs are in exactly that position —
they reach ESRD and nothing else at p < 1e-4 in both ancestries. Six of the
seven were therefore dropped.

**(c) A duplicate row.** The seventh, rs35305544, survived only because the
store holds **two rows** for (ESRD, rs35305544) where the other six have one.
That gave it a spurious degree of 2 and it passed the rule.

So the manuscript's "1" is one SNP that reached the screen through a
selection defect, a display rule, and a data-quality artefact. It is not a
measurement of anything.

**Observed, not inferred:**

| Build | Edges touching ESRD | Which SNPs |
|---|---|---|
| `4165ea2^` (pre-fix) | **1** | rs35305544 |
| `main` (current) | **7** | the chr10 / TCF7L2 group |

### The promiscuous-SNP filter plays no part

`grep` for a promiscuity filter in `page2.js` and `server.js` at `e26d9ae^`,
`4165ea2^` and `main` returns **zero hits in every version**. A0 established
the same for the page-1 edgelist: 4,552 SNPs appear in more than 40
phenotypes and the served network matches the unfiltered recomputation
exactly. There is no filter to have removed.

The idea is easy to reach for because a >40-phenotype filter happens to leave
7 SNPs as well — but **the opposite 7**. That filter would drop the chr10
group (54–85 phenotypes each) and keep chr22. The interface drops chr22 and
keeps chr10. Equal counts, disjoint sets, unrelated causes.

---

## 4. Why the current view still shows 7 and not 14

The same min-degree-2 rule, now applied to a correctly selected set. The
seven chr22/APOL1 SNPs reach ESRD and nothing else, so they are still hidden
as singletons; the seven chr10/TCF7L2 SNPs each reach 12–59 other phenotypes
and are drawn.

This is defensible behaviour for a *shared-SNP* view — a SNP with one edge
shows nothing about sharing — but it means **the node view's on-screen count
is not a measurement of ancestry overlap and should not be quoted as one.**
It is a function of the top-150 cap, the min-degree-2 rule, and duplicate
rows, none of which are properties of the biology.

---

## 5. Recommendation

### 5.1 The conclusion holds. Change the evidence, not the claim.

Every independent line of evidence supports divergent genetic architecture,
and each is stronger than the number currently cited:

**SNP level.** 713 AFR and 554 EUR associations, 14 shared — **1.12%** of the
union.

**Chromosome level.** The "distributed across different chromosomes"
observation is the strongest part of the current text and is badly
under-quantified:

| | AFR | EUR |
|---|---|---|
| chr22 | **653 (91.6%)** | 7 (1.3%) |
| chr10 | 8 (1.1%) | **386 (69.7%)** |
| all others | 52 | 161 |

**Locus level** (±500 kb clumping, GRCh38 positions from dbSNP155 — see
`REPORT.md` §5). This is the check that matters most, because SNP-level
non-overlap can be an artefact of different LD structure tagging the *same*
locus in different ancestries. It is not:

| | AFR | EUR | Shared (leads within ±500 kb) |
|---|---|---|---|
| ESRD loci | 32 | 23 | **2 (6.3% of AFR)** |

**Effect concentration.** APOL1 carries **91.5%** of the SNP weight across
ESRD's AFR edges and **0.0%** in EUR. The AFR signal is one African-ancestry
kidney locus; the EUR signal is led by UMOD and TCF7L2.

### 5.2 Concretely, for the text

Replace the sentence

> Activating ancestry comparison mode (Figure 3f) confirms only one shared
> SNP association between AFR and EUR, despite each ancestry having 100+
> total associations.

with something built on the numbers above — for example, that 14 of 1,253
associations (1.1%) are shared; that 91.6% of AFR's sit on chr22 against
69.7% of EUR's on chr10; and that only 2 of 32 AFR loci have a EUR lead
within 500 kb. We are not drafting manuscript prose, but those are the
figures to draft from, and they are all in `REPORT.md` §5 and
`esrd_locus_overlap.csv`.

### 5.3 Figure 3f has to be regenerated

It will now show 7 shared associations rather than 1, and the caption must
change with it. If the figure is meant to *illustrate* divergence rather than
quantify it, consider showing the two ancestries side by side with the
chromosome distribution visible — that is where the divergence is obvious —
rather than the intersection view, whose count is an artefact of display
rules.

### 5.4 Two further things to check before submission

**Sample sizes.** The text cites AFR n=121,177 and EUR n=449,042. The
association store holds no case/control or sample-size columns, so **we
cannot verify these numbers from the data we have.** They need to come from
the source summary statistics.

**Don't quote interface counts anywhere else in the paper.** The same three
mechanisms apply to every node-view screenshot. Quote from the association
store; use the interface to illustrate.

---

## 6. Reproducing this

```bash
# ground truth
python3 - <<'PY'
import duckdb
con = duckdb.connect()
con.execute("CREATE VIEW a AS SELECT * FROM read_parquet("
            "'public/data/db/associations/chrom=*/*.parquet', hive_partitioning=true)")
print(con.execute('''SELECT count(DISTINCT rsid) FROM a
    WHERE phe_id='905' AND "pval.afr"<1e-4 AND "pval.eur"<1e-4''').fetchall())
PY

# the old behaviour, side by side with the current one
git worktree add --detach /tmp/wt-prefix '4165ea2^'   # needs ~6 GB, tracks the legacy CSVs
cd /tmp/wt-prefix && PORT=3002 node server.js &        # pre-fix build
cd - && node server.js &                               # current build
# then drive page2.html?ancestry=afr&pvalue=1e-04&centerPheno=905 on both
# and check both ancestry boxes
```

Locus numbers: `results/esrd_locus_overlap.csv`, `results/esrd_loci.csv`.
