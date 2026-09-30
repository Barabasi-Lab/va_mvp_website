# DuckDB / Parquet data layer

The three pages used to download flat CSVs and filter them in the browser.
Page 2 on a large phenotype meant a 128 MB download before anything rendered.
The same data now lives in columnar files that `server.js` queries directly.

## Where the data lives

The files are **not in the repo**. In production they sit on the Railway
volume `va_mvp_website-volume`, mounted at `/data`; locally they sit in
`public/data/db/`, which is gitignored. Both hold the same layout:

| Path under the db directory | Size | Contents |
| --- | --- | --- |
| `landing_page.duckdb` | 18 MB | `edges` (54,790 rows, all 90 precomputed weight columns) and `node_attributes`, for page 1 |
| `associations/chrom=*/data_0.parquet` | 148 MB, 22 shards | 3,060,080 phenotype–SNP associations, for pages 2 and 3 |
| `node_attributes.parquet` | 40 KB | node metadata shared by pages 2 and 3 |

Total 159 MB, replacing 5.5 GB of `public/data/node_files/`.

`server.js` resolves the directory in three steps:

1. `DB_DIR`, if set — an explicit override, handy for testing.
2. `RAILWAY_VOLUME_MOUNT_PATH` + `/db`, when a volume is attached.
3. otherwise `public/data/db/` in the checkout.

**Not `RAILWAY_ENVIRONMENT`.** Checked against the running service, that is
set to `production` on every Railway deploy whether or not a volume is
attached, so keying off it would send a volume-less deploy to a path that does
not exist. `RAILWAY_VOLUME_MOUNT_PATH` appears only when one is really
mounted, and it carries the mount point rather than hardcoding `/data`.

**Why Parquet, and why partitioned.** A single `.duckdb` holding the
associations is 358 MB and a single Parquet is 140 MB; GitHub rejects any file
over 100 MB. Partitioning by chromosome caps the largest shard at 34 MB, which
kept the files pushable while they were still in the repo, and still keeps any
one of them easy to re-upload. DuckDB reads the shard set through a view over
`associations/chrom=*/*.parquet`; the cost versus an indexed table is roughly
30 ms per query. The explicit `chrom=*` glob keeps a volume's `lost+found` out
of the scan.

The precomputed edge weights in `edgelist_updated_scaled.csv` are loaded
verbatim. Nothing recomputes them.

## When the data is missing

A wiped volume, or an environment created without one, used to mean empty
graphs and no explanation. Now:

- `scripts/ensure-db.js` runs as npm's `prestart` and names every missing or
  empty file, with the directory it checked and where that came from. It
  always exits 0: a non-zero `prestart` blocks `start`, turning a recoverable
  data problem into a total outage.
- `server.js` logs the same failure and still listens. Static pages serve and
  `/api/*` returns 503 with the directory it tried, instead of crash-looping
  with nothing to look at.

`ensure-db.js` deliberately does not download anything — no fallback URL is
configured, and a silently failed fetch would be worse than the warning. The
extension point for adding one is marked in the file.

## Rebuilding

```bash
pip install duckdb
python3 scripts/build_dbs.py --full-dataset /path/to/full_dataset.csv
```

Takes about a minute, and writes into `public/data/db/`. The raw 3.6 GB CSV is
not in the repo; it is expected as a sibling of the repo directory by default.

Neither are `edgelist_updated_scaled.csv` and `node_attributes.csv` any more —
they are gitignored, so a fresh clone cannot rebuild without copying them in.

To publish a rebuild to production, upload it to the volume:

```bash
railway volume files -v va_mvp_website-volume upload public/data/db /db
```

## Endpoints

| Route | Query params | Returns |
| --- | --- | --- |
| `GET /api/landing/nodes` | – | every node's layout and metadata |
| `GET /api/landing/edges` | `ancestry`, `pvalue` | `{source, target, same, diff}` per edge plus per-node degrees under that filter |
| `GET /api/node/:id/ancestries` | – | ancestries with data for that phenotype |
| `GET /api/page2/rows` | `node`, `ancestry`, optional `ancestry2` | association rows for the phenotype's 150 strongest SNPs |
| `GET /api/page2/download` | `node` | CSV: every association for that phenotype, uncapped |
| `GET /api/page3/download` | `left`, `right` | CSV: every shared SNP, both phenotypes, uncapped |
| `GET /api/page3/rows` | `left`, `right`, `ancestry`, optional `ancestry2`, optional `limit` | association rows for the SNPs the two phenotypes share |

`ancestry` is one of `meta, eur, afr, amr, eas`. Page 1's `pvalue` must be one
of the nine precomputed thresholds (`1e-04` … `1e-12`).

### Why pages 2 and 3 do not take a p-value

Two reasons, and both bite.

Page 2 ranks the centre phenotype's SNPs by p-value, keeps the top 150, and
*then* applies the threshold. Serving pre-thresholded rows would make the
client rank a smaller set, so SNPs that fail the threshold on the centre
phenotype but carry a strong association to a neighbour would vanish.

On both pages, two-ancestry comparison mode intersects the rows by
`(SNP, phenotype)` and keeps the **last** row it sees for a duplicated pair.
The raw data has 2,777 duplicate pairs, plus more from the five merged
phenotypes, so dropping rows server-side changed which duplicate won and
shifted an edge's beta and direction. Rows therefore come back in the raw
dataset's row order (`src_row`), which is exactly the order the legacy
per-node CSVs used.

Both responses depend only on the ancestry selection, so the p-value sliders
filter client-side with no round trip.

### How SNPs are ranked

Pages 2 and 3 keep only the strongest SNPs, and the statistic that decides
"strongest" is **|z| = |beta / se|**, computed at query time. `RANK_METRIC=pval`
switches back to ranking by the reported p-value without a code change.

z is computed on the fly rather than baked into the Parquet. Benchmarked on
the shipped shards across nine representative queries: **-1.7 ms median,
+5.7 ms worst** versus the p-value ordering, so it was not worth a rebuild and
re-upload of the volume.

**z and p do not agree here, and the gap is not rounding.** For a plain Wald
test p would be 2*Phi(-|z|), but in this dataset the sampled median gap is
0.55 log10 and the tail runs past 290 log10. The pattern is unmistakable: the
worst offenders are all rare variants with large |beta| and small se, e.g. a
variant with beta = -1.60, se = 0.044 gives |z| = 36.5 (p ~ 1e-292) against a
reported p of 1.2e-08. That is what a saddlepoint-corrected test
(SAIGE/REGENIE) does — the Wald standard error is anti-conservative for rare
variants under case-control imbalance, and the reported p is the corrected,
trustworthy one.

So ranking by z promotes rare variants that the reported p-value holds back.
Measured effect on what actually reaches the screen, z versus p-value:

| view | z | p-value |
| --- | --- | --- |
| page 2, Shortness of breath, EUR | 150 SNPs | 150 SNPs |
| page 2, Obesity, META | 150 SNPs | 150 SNPs |
| page 2, Asthma, META | **109 SNPs** | **148 SNPs** |
| page 3, 739-741, EUR | 250 SNPs | 250 SNPs |
| page 3, 230-229, META | 250 SNPs | 250 SNPs |

Most views are unchanged. Asthma is the outlier, and it is the case with the
strongest case-control imbalance, which is exactly where the correction bites
hardest.

With two ancestries selected the key is the **weaker** of the two |z| values,
so a SNP only scores well when both ancestries support it.

## Backfilling the cap

Pages 2 and 3 discard SNPs after the server picks them: a link needs
|beta| > 0.01 and a p-value under the slider, and `updateNodes` then drops any
SNP left with fewer than two surviving links. Taking the plain top N and
letting those fall away meant the view often showed fewer than it could.

The endpoints now take the thresholds and skip SNPs that would be dropped,
backfilling from further down the ranking, so the view fills to the cap
whenever that many qualify. Asthma under META went from 145 SNPs to 150.

This works because the "at least two links" test is **per SNP**: a SNP's own
link count does not depend on which other SNPs are on screen, so the server
can decide it and get the same answer the client would.

Two consequences:

- The response now depends on the sliders, so they re-fetch (debounced 200 ms)
  instead of re-rendering in place. Page 2 went from ~0.36 s to ~0.6 s per
  move; page 3 is ~0.3 s.
- Passing no `pvalue` still gives the plain top N, which is what the
  validation scripts use.

The client's own cap had the same flaw in a different form: it sliced 150
*links*, and the five merged phenotypes carry two rows per SNP, so Asthma
capped itself at 116. It now counts distinct SNPs.

## The SNP cap warning

Both pages cap how many SNPs they draw — 150 on page 2, 250 on page 3 — and
say so when the cap is actually biting:

> SNP count exceeds the maximum that can be displayed: N SNPs with strongest
> evidence shown. Download the data to see all SNPs.

The server settles this exactly: it asks the store for one SNP more than it
can display, and reports `moreAvailable` if that extra one comes back. So the
warning appears only when more SNPs cleared the filters than fit on screen,
and a view that is short simply because few SNPs qualify stays silent.

Earlier versions inferred it, and got it wrong in both directions: first by
asking whether the *fetch* was capped (`fetched < total`), which fired with as
few as 30 SNPs on screen, and then by testing whether the drawn set had filled
the cap, which could not tell a full view from a view with exactly N
qualifying SNPs.

The download buttons honour that message: they return every association for
the phenotype, or every shared SNP for the edge, ignoring both the cap and the
sliders, with `se` alongside `beta`.

## The page 3 cap

The median edge shares ~51 SNPs, but Hyperlipidemia and Disorders of lipoid
metabolism share 27,481. Drawing those is meaningless — they land 0.05 px
apart in the column — and enough DOM to hang the browser. `/api/page3/rows`
returns the 250 most significant by default; `limit` overrides it up to
50,000. About 16% of edges exceed the default.

The page states what it is showing: *"250 SNPs drawn — view is capped at the
250 most significant of 27,481 shared; loosening the filters will not show
more than that"*, or *"75 of 77 shared SNPs drawn"* when the cap does not
apply. If you want a different default, it is `PAGE3_DEFAULT_LIMIT` in
`server.js`.

The cap is a hard limit, not a first page: a SNP ranked 251st is never
reachable from the UI. That is deliberate, but it makes the ranking key the
thing to get right. A SNP is only drawn when it clears the threshold on both
phenotypes, and in comparison mode on both ancestries, so the key is the
weakest p-value across all of those. Because the key is the same quantity the
filters test, the visible set is a prefix of the ranking: tightening a slider
trims from the bottom and can never reveal something from beyond the cap.

Ranking on the first ancestry alone — which is what it did at first — spent
slots on SNPs that the second ancestry's filter then removed. On Shortness of
breath / Other dyspnea that showed 215 of 250 possible SNPs while excluding
663 that qualified.

## Payloads

Gzipped, as a browser receives them:

| View | Before | After |
| --- | --- | --- |
| Page 2, node 181 | 25.2 MB | 0.33 MB |
| Page 2, node 708 | 8.2 MB | 0.18 MB |
| Page 1 initial load | 5.1 MB | 0.47 MB |

Every endpoint responds in under 350 ms locally.

## Client-side performance

Moving the data off the critical path was not enough on its own: the page
scripts were quadratic or worse, and that dominated once the downloads shrank.
Measured in Chromium:

| | before | after |
| --- | --- | --- |
| Page 1 load | 8.2 s | 2.6 s |
| Page 3, Hyperlipidemia ↔ lipoid metabolism | 85.7 s | 3.2 s |
| Page 2 centre-node click, 13,914 edges | froze the tab | 122 ms to paint |

What had to change, in rough order of impact:

- `updateNodes` (both pages) scanned every edge once per node, and for
  phenotypes once per node *per SNP* — about 1e9 comparisons on a large edge
  view. It is two passes over the edges now.
- Page 3's `initializeNetwork` and `renderNetwork` each rescanned all links per
  SNP, or all data rows per SNP: four more ~1e9 loops.
- Page 1's `highlightNode` tested `filteredLinks.includes(l)` inside a pass
  over all 54,790 links — roughly 3e9 comparisons per click.
- Page 1 created all 54,790 `<line>` elements up front at opacity 0, so the
  browser laid out and composited every one on load. Only the selected node's
  edges are ever visible, so `drawLinks()` now creates just those.
- Pages 2 and 3 fetched and rendered the whole graph twice on load: once from
  the ancestry checkbox's synthetic `change` event, once from the explicit
  initial render.
- A 300 ms d3 transition over 14,000 elements was what actually froze the tab
  on a centre-node click. Above 2,000 elements the style is set outright.

The thing to avoid reintroducing is an `.includes()`, `.some()` or `.find()`
over nodes, links or data rows inside a callback that already runs once per
node or per link.

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

## Page 2's 150-SNP cap

Page 2 shows the centre phenotype's 150 strongest SNPs. That is original
behaviour, not something this work introduced, and it binds hard: Obesity has
54,875 SNPs with EUR data, of which 54,297 clear 1e-4, and the page has always
drawn 150. The p-value slider cannot reveal a 151st.

The "About Phenotype View" text used to say "top 100 associated SNPs" while
the code used 150; it now says 150, and states that the limit is hard.

Comparison mode ranks by the weaker of the two ancestries' p-values, the same
key page 3 uses, so every slot goes to a SNP that clears both filters. This is
a deliberate departure from the legacy ranking, which used the first ancestry
alone: on Hyperlipidemia with EUR+AFR that filled 110 of 150 slots, and now
fills all 150.

It is not a free win everywhere. The jointly-strongest SNPs are not always the
most pleiotropic, so on Asthma with EUR+META the drawn count fell from 150 to
131 even though the centre-link pass rate barely moved (150 to 148). The SNPs
now shown are the ones most strongly associated in both ancestries; fewer of
them happen to reach a second phenotype.

Because this deviates from legacy, `validate_pages.js` checks comparison-mode
page 2 in two parts: it derives the expected top-150 from the legacy CSV using
the new key and asserts the endpoint returned exactly that set, then compares
the rendering over those same SNPs. Single-ancestry cases still compare
against legacy unchanged.

Merged phenotypes cap slightly below 150: Asthma has 10,767 duplicated rsids,
so the top 150 rows collapse to 148 SNPs. The legacy code did the same.

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
python3  scripts/validate_ranking.py        # which SNPs the top-N picks
```

`validate_pages.js` is the strongest check: it lifts `initializeNetwork`,
`updateEdges` and `updateNodes` straight out of `page2.js`/`page3.js`, runs
them over the legacy CSV and over the endpoint response, and compares the
resulting node and edge multisets. It compares the two sources **over the same
SNP set**, because which SNPs get picked is no longer derivable from the legacy
CSVs — they carry no `se` column. `validate_ranking.py` covers the selection
itself, recomputing the expected top-N from the Parquet independently of the
server's SQL. 89 cases, including ten in two-ancestry
comparison mode, which is where the duplicate-row ordering problem showed up.
All three suites pass with zero differences.

`--sample N` adds N randomly chosen page-2 cases on top of the fixed
regression set.

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

Project `responsible-liberation`, service `va_mvp_website`, environment
`production` (the only one), serving www.appliedintegrativeanalytics.com.
Volume `va_mvp_website-volume` is mounted at `/data` and holds `db/`.

`server.js` reads `process.env.PORT` (it previously hard-coded 3000, which
would not have bound correctly on Railway).

Useful commands:

```bash
railway volume list --json
railway volume files -v va_mvp_website-volume list /db
railway variables --json          # shows the injected RAILWAY_* set
railway logs --service va_mvp_website --lines 100
```

Still to confirm on a real deploy:

- `@duckdb/node-api` ships a native addon. It resolves cleanly on linux-x64
  here; confirm Railway's build image matches.
- The boot log should read `data: /data/db`, and `ensure-db` should report 24
  files present. If it reports the repo checkout instead, the volume is not
  attached to that service instance.

## Still using the old CSVs

`public/data/node_files/` (5.5 GB, 1,326 files) and the two source CSVs are no
longer tracked, but they are still on disk locally and the validation scripts
still diff against them. Keep them.

They remain in git history, and on `origin/main`, so `.git` still carries about
921 MB. Removing that would mean rewriting `main`'s history, which is shared —
out of scope here.

`public/data/db/` was removed from this branch's history with:

```bash
git filter-repo --path public/data/db --invert-paths --refs e763483..speed-test --force
```

The `--refs` range matters. Without it, filter-repo rewrites every reachable
commit, and because it strips GPG signatures it changed the hash of eight
signed GitHub web-edit commits — including `main`'s tip, which would have
detached this branch from the shared history. Scoping the rewrite to the
unpushed commits leaves `main` byte-identical. Note that filter-repo also
deletes the now-untracked files from the working tree and removes the `origin`
remote; both need restoring afterwards.
