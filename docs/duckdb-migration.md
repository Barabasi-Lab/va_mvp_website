# DuckDB / Parquet data layer

The three pages used to download flat CSVs and filter them in the browser.
Page 2 on a large phenotype meant a 128 MB download before anything rendered.
The same data now lives in columnar files under `public/data/db/`, and
`server.js` answers narrow queries against them.

## What ships

| Path | Size | Contents |
| --- | --- | --- |
| `public/data/db/landing_page.duckdb` | 18 MB | `edges` (54,790 rows, all 90 precomputed weight columns) and `node_attributes`, for page 1 |
| `public/data/db/associations/chrom=*/data_0.parquet` | 148 MB, 22 shards | 3,060,080 phenotype–SNP associations, for pages 2 and 3 |
| `public/data/db/node_attributes.parquet` | 40 KB | node metadata shared by pages 2 and 3 |

Total 159 MB, replacing 5.5 GB of `public/data/node_files/`.

**Why Parquet, and why partitioned.** A single `.duckdb` holding the
associations is 358 MB and a single Parquet is 140 MB; GitHub rejects any file
over 100 MB. Partitioning by chromosome caps the largest shard at 34 MB, so the
data ships as ordinary repo files — no Git LFS, and no Railway volume. DuckDB
reads the shard set directly through a view; the cost versus an indexed table
is roughly 30 ms per query.

The precomputed edge weights in `edgelist_updated_scaled.csv` are loaded
verbatim. Nothing recomputes them.

## Rebuilding

```bash
pip install duckdb
python3 scripts/build_dbs.py --full-dataset /path/to/full_dataset.csv
```

Takes about a minute. The raw 3.6 GB CSV is not in the repo; it is expected as
a sibling of the repo directory by default.

## Endpoints

| Route | Query params | Returns |
| --- | --- | --- |
| `GET /api/landing/nodes` | – | every node's layout and metadata |
| `GET /api/landing/edges` | `ancestry`, `pvalue` | `{source, target, same, diff}` per edge plus per-node degrees under that filter |
| `GET /api/node/:id/ancestries` | – | ancestries with data for that phenotype |
| `GET /api/page2/rows` | `node`, `ancestry`, optional `ancestry2` | association rows for the phenotype's 150 strongest SNPs |
| `GET /api/page3/rows` | `left`, `right`, `ancestry`, `pvalue`, optional `ancestry2`/`pvalue2` | association rows for the SNPs the two phenotypes share |

`ancestry` is one of `meta, eur, afr, amr, eas`. Page 1's `pvalue` must be one
of the nine precomputed thresholds (`1e-04` … `1e-12`); page 3's is continuous.

### Why page 2 does not take a p-value

Page 2 ranks the centre phenotype's SNPs by p-value, keeps the top 150, and
*then* applies the threshold. Serving pre-thresholded rows would make the
client rank a smaller set, so SNPs that fail the threshold on the centre
phenotype but carry a strong association to a neighbour would vanish. The
response therefore depends only on the ancestry, and the p-value slider
filters client-side with no round trip.

## Payloads

Gzipped, as a browser receives them:

| View | Before | After |
| --- | --- | --- |
| Page 2, node 181 | 25.2 MB | 0.33 MB |
| Page 2, node 708 | 8.2 MB | 0.18 MB |
| Page 1 initial load | 5.1 MB | 0.47 MB |

Every endpoint responds in under 350 ms locally.

## Behaviour changes

Two differences from the old CSV pipeline are deliberate.

**Node 25 ("Viral warts & HPV") now appears.** Its label is stored
HTML-escaped in `node_attributes.csv` (`Viral warts &#38; HPV`), so whatever
generated `node_files/` never matched it: `node_files/25.csv` is empty and the
node is absent from every other neighbourhood, despite having 9,106 real
associations and degree 134 on page 1. The build unescapes the label, so the
node is now wired up on pages 2 and 3.

**A p-value of exactly 0 now counts as significant.** 4,533 rows have one.
The client's `parseFloat(p) || 1` turned 0 into 1, so the strongest
associations in the dataset were always filtered out. `toPvalue()` in
`page2.js`/`page3.js` now only falls back to 1 for missing values.

Everything else is byte-identical; see "Validation" below.

## Phenotype identity

The raw dataset keys phenotypes by code (`A1C_Max_INT`, `Phe_495`); the site
keys them by numeric node id. They are joined through the display label via
`phenotype_labels.pkl`. Two things to know:

- Five nodes are the **union of two phenotype codes** — Gout (`Phe_274_1` +
  `SkMsGout`), Sleep apnea, Glaucoma, Asthma, Osteoporosis. Verified: each
  node's rsid set equals the union of its two codes' sets exactly.
- Node 111 has the literal label `NAN` and no data in the raw dataset. Its
  legacy file is empty too. It stays in `node_attributes` for page 1.

Only 3.06M of the raw file's 24.0M rows map to the 1,320 network nodes; the
other 424 phenotype codes are not reachable from any page and are not loaded.
A global rsid search across all phenotypes would need a rebuild that keeps
them (~2.9 GB).

## Validation

Three scripts, all requiring the dev server on `localhost:3000` (except the
first):

```bash
python3 scripts/validate_node_files.py      # DB vs the legacy per-node CSVs
node     scripts/validate_pages.js --sample 60   # rendered networks, both sources
python3  scripts/validate_landing.py        # all 45 ancestry x p-value combos
```

`validate_pages.js` is the strongest check: it lifts `initializeNetwork`,
`updateEdges` and `updateNodes` straight out of `page2.js`/`page3.js`, runs
them over the legacy CSV and over the endpoint response, and compares the
resulting node and edge sets. All three suites pass with zero differences.

Reconciling the two encodings matters when reading these scripts: the legacy
CSVs wrote absent ancestry data as `pval=1, beta=0` where the raw dataset has
`NA`, and they carry float round-trip noise (`5.912000000000002e-07` for a raw
`5.912e-07`), so comparisons run at 10 significant figures.

### Tie-breaking

Ranking a phenotype's SNPs by p-value frequently ties right at the 150-row
cut — node 579 under AFR has fourteen SNPs at `p = 0.5901`. JavaScript's sort
is stable, so the legacy pick depended on CSV row order. The `src_row` column
preserves the raw file's ordering and the query sorts by
`(pval, phenotype, src_row)`, which reproduces it: the legacy per-node files
are each code's rows in file order, codes concatenated alphabetically.

## Railway notes

`server.js` now reads `process.env.PORT` (it previously hard-coded 3000, which
would not have bound correctly on Railway).

Not yet verified on Railway — the deploy still needs to be exercised on a
staging environment. Things to watch:

- The build must include `public/data/db/`. Nothing in `.gitignore` excludes
  it, but confirm the deployed image actually contains the 22 shards.
- `@duckdb/node-api` ships a native addon. It resolved cleanly on linux-x64
  here; confirm Railway's build image matches.
- The 159 MB of data files count against image size and push time.
- No persistent volume is required — the previous volume/mounting trouble
  should not recur, since everything is a static file in the image.

## Still using the old CSVs

`public/data/node_files/` (5.5 GB, 1,326 files) and
`public/data/edgelist_updated_scaled.csv` are still tracked. Nothing serves
them any more; they are kept only because the validation scripts diff against
them. Deleting `node_files/` is what actually shrinks the deploy. Note that
`.git` already carries ~921 MB of their history, which a plain delete does not
reclaim.
