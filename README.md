# MVPheWAS Explorer

An interactive browser for the multi-ancestry genome-wide phenome-wide
association study (gwPheWAS) run on the VA Million Veteran Program cohort —
635,969 participants, 2,068 phecodes, five ancestry groups (EUR, AFR, AMR,
EAS and a fixed-effects meta-analysis).

Live at **[appliedintegrativeanalytics.com](https://www.appliedintegrativeanalytics.com)**,
deployed from this repository through Railway.

If you use MVPheWAS Explorer in your research, please cite both this browser and 
the original analysis:

```
@article{Spector2026,
  author  = {Spector, J. and Ehlert, J. and Costa, L. and others},
  title   = {{MVPheWAS Explorer}: an open source platform for scalable {GWAS} visualization},
  journal = {Database},
  year    = {2026},
  note    = {In press}
}
```
```
@article{Verma2024,
author = {Anurag Verma  and Jennifer E. Huffman  and Alex Rodriguez and others},
title = {Diversity and scale: Genetic architecture of 2068 traits in the VA Million Veteran Program},
journal = {Science},
volume = {385},
number = {6706},
pages = {eadj1182},
year = {2024},
doi = {10.1126/science.adj1182},
URL = {https://www.science.org/doi/abs/10.1126/science.adj1182},
eprint = {https://www.science.org/doi/pdf/10.1126/science.adj1182},
}
```

> Verma, A., Huffman, J.E., Rodriguez, A., et al. (2024). Diversity and scale: Genetic architecture of 2068 traits in the VA million veteran program. *Science*, 385(6706), eadj1182.
>
> Spector, J., Ehlert, J., Costa, L., et al. (2026). MVPheWAS Explorer: an open source platform for scalable GWAS visualization. *Database*, in press.

---

| Page | Shows | Nodes |
|---|---|---|
| **Phenotype Network** (`/`) | every phenotype pair linked by SNPs associated with both | ~1,300 phenotypes |
| **Phenotype View** (`/page2.html`) | one phenotype, its strongest SNPs, and the other phenotypes those SNPs reach | 1 centre + SNPs + neighbours |
| **SNP View** (`/page3.html`) | the SNPs two phenotypes share | 2 phenotypes + shared SNPs |

All three filter by ancestry and p-value threshold, and all three can
compare two ancestries at once, in which case only associations present in
both are drawn.

Two distinctions are used consistently and mean different things:

- **concordant / discordant** — the effect has the same or opposite sign
  across the two **phenotypes** joined by a SNP.
- **same direction / opposite direction** — the effect has the same or
  opposite sign across the two **ancestries** being compared.

---

## How it works

### Data layer

The pages query DuckDB over chromosome-partitioned Parquet through endpoints in
`server.js`.

**The data is not in this repository.** In production it lives on a Railway
volume, which `server.js` finds through `RAILWAY_VOLUME_MOUNT_PATH`;
locally it falls back to `public/data/db/` (gitignored), and `DB_DIR`
overrides both.

```
<volume>/db/
  associations/chrom={1..22}/data_0.parquet   association rows + gene annotation
  landing_page.duckdb                          precomputed network-view edge weights
  node_attributes.parquet                      phenotype layout, colour, category
  edge_relations.parquet                       phecode relatedness, network view
  pair_relations.parquet                       phecode relatedness, phenotype view
  node_phecodes.json, pair_relations_t34.json
<volume>/annotation/                           nearest-gene build input
```

### Network view

Computing the phenotype network from raw associations takes minutes, so the
edge weights are precomputed for every combination of ancestry, threshold and
direction — 90 columns — and held in `landing_page.duckdb`.

The page builds one maximally connected network (every edge that appears
under *any* filter) and then swaps weights onto it. Changing a filter costs
one request for a single pair of weight columns plus the node degrees under
that filter; edges whose weight is zero are dropped rather than drawn.

### Phenotype and SNP views

Both are bipartite — SNPs connect only to phenotypes — so the network is just
the association rows. The server returns only what the page can draw: the
centre phenotype's 150 strongest SNPs and everything they touch, or the SNPs
two phenotypes share. Changing a p-value threshold re-filters rows already
loaded; only an ancestry change costs a request.

SNPs are ranked by reported p-value. `RANK_METRIC=z` switches to |beta/se|.

### Gene annotation

Every SNP carries its nearest protein-coding gene, the distance in base
pairs, any overlapping non-coding gene, and its GRCh38 position. The
annotation travels once per response in a map keyed by rsID rather than
repeated on every row. SNPs in the extended MHC are labelled as such rather
than given a single gene name.

---

## Running locally

```bash
npm install
npm start                       # http://localhost:3000
```

With no data present the site serves but the API returns 503. Point it at a
copy of the store:

```bash
DB_DIR=/path/to/db npm start
```

| Variable | Default | Does |
|---|---|---|
| `PORT` | 3000 | listen port |
| `DB_DIR` | volume, else `public/data/db` | where the data lives |
| `RAILWAY_VOLUME_MOUNT_PATH` | – | set by Railway; `<path>/db` is used |
| `RANK_METRIC` | `pval` | SNP ranking; `z` for \|beta/se\| |

---

## Repository layout

This repository holds the deployed application only:

```
server.js              API and static serving
public/                the three pages and their JavaScript
scripts/ensure-db.js   startup data check (npm prestart)
```

The analysis code, build tooling, internal documentation and the manuscript
reproducibility material are **not** on this branch — they are preserved on
the **`analysis-archive`** branch, which carries the full
`analysis/`, `docs/` and `scripts/` trees, including the data-layer
documentation (`docs/duckdb-migration.md`), the store build (`build_dbs.py`),
the gene annotation build (`build_gene_annotation.R`) and the validation
suite.

See [CHANGELOG.md](CHANGELOG.md) for what changed in the current release.
