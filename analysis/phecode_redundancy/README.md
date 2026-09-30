# Phecode-redundancy sensitivity analysis

Read-only analysis of whether the network's clusters are driven by phecode
definitional overlap rather than pleiotropy, plus the prototype for the
"Hide edges between related phecodes" toggle.

Nothing here writes to production data, the precomputed network files or the
served site. The only files written outside `results/` are the four
companion files the toggle prototype reads, which sit beside the precomputed
data rather than inside it.

## Reports

| File | What it is |
|---|---|
| `results/A0_RECON.md` | reconnaissance, baseline reproduction, and the inputs that were missing |
| `results/REPORT.md` | the sensitivity analysis (Part A) |
| `results/TOGGLE_EVALUATION.md` | the toggle prototype, speed and effectiveness (Part B) |

## Running it

```bash
# Part A. All parameters are at the top of run_analysis.py.
python3 analysis/phecode_redundancy/run_analysis.py --steps a2,a3,a5,a6
python3 -m pytest analysis/phecode_redundancy/test_phecode_relations.py -q

# Positions for the locus work (A4). Needs Bioconductor and
# SNPlocs.Hsapiens.dbSNP155.GRCh38; takes about an hour and ~10 GB.
Rscript analysis/phecode_redundancy/snp_positions.R \
        results/rsids.txt results/snp_positions.csv

# Part B.
python3 analysis/phecode_redundancy/build_relations.py
python3 analysis/phecode_redundancy/evaluate_toggle.py
node scripts/test_phecode_relations.js
node scripts/test_toggle_state.js     # needs a dev server on :3000
node scripts/shoot_toggle.js
node scripts/bench_toggle.js --runs 10  # also needs `main` running on :3001
```

## Files

| File | Role |
|---|---|
| `phecode_relations.py` | the tier classifier — **single source of truth** |
| `test_phecode_relations.py` | its unit tests; `scripts/test_phecode_relations.js` runs the same cases against the browser port |
| `network.py` | rebuilds the phenotype network the way the site does; its docstring lists the three deviations |
| `run_analysis.py` | entry point for A2–A6 |
| `snp_positions.R` | rsid → GRCh38, via SNPlocs/dbSNP155 |
| `build_relations.py` | the toggle's companion data, both implementation options |
| `evaluate_toggle.py` | B4 coverage, over-masking and spot-check samples |

## What is missing

**`phecode_definitions1.2.csv`.** The supplied map is ICD→phecode only and
carries no `phecode_exclude_range`, so **T3 cannot be computed**. Every
output labels the affected level `L3_partial` rather than `L3`, and the
classifier returns `None` for T3 rather than `False` — an absent tier must
not read as an absent relationship. If the file arrives, set `DEFINITIONS`
in `run_analysis.py` and rerun.
