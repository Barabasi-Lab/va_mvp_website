# Changelog

## 1.1 — 2026-10-05

The first release since the data layer moved to DuckDB. Four things are new
in the interface, one long-standing bug is fixed, and the deployment is
substantially smaller.

### Fixed

- **The network view's p-value slider did nothing useful below 1e-6.** The
  edge-weight columns at 1e-07 and stricter were attached to the wrong
  phenotype pairs — counts and distributions looked plausible, but the
  network drawn did not correspond to the setting. Every one of the 90
  columns was regenerated and checked: weights never rise as the threshold
  tightens, no edge appears at a stricter threshold than it survives at, and
  the on-screen counts now equal a direct recomputation at every
  ancestry/threshold combination tested.

  The regeneration grew the pair universe from 54,790 to **57,041**, adding
  2,321 pairs over 85 phenotypes the old file never carried. Edge counts and
  weights at 1e-4 to 1e-6 can differ by a few per cent from previously
  published values.

- **SNPs were ranked by |beta/se|, not by p-value**, contrary to the
  manuscript. The default is now the reported p-value.

- Duplicate (SNP, phenotype) rows are collapsed on the phenotype and SNP
  views rather than drawn twice.

### Added

- **Nearest-gene labels.** Every SNP carries its nearest protein-coding gene,
  the distance in base pairs, any overlapping non-coding gene, and its GRCh38
  position, in tooltips and in downloads. SNPs in the extended MHC are
  labelled as a region rather than given one gene name. An optional layer
  brackets runs of adjacent SNPs that share a gene.

- **A related-phecode toggle.** Phecodes that are ancestor and descendant of
  one another, or siblings, share ICD codes by construction, so edges between
  them are partly an artefact of the coding system. The toggle hides them.
  Off by default, and it carries across views.

- Downloads now include the gene annotation columns.

### Changed

- **The comparison legend now reads "same direction" and "opposite
  direction".** It previously said concordant/discordant, which elsewhere
  means sign agreement between two *phenotypes*; in comparison mode the
  quantity is agreement between two *ancestries*. The two are now never
  confused.

- The phenotype view draws only SNPs that reach the centre phenotype, and
  prioritises SNPs with more than one edge.

- The network view has a floor on drawn edge width — the thinnest real edges
  were rendering at a few thousandths of a pixel — and searching for a
  phenotype now selects it.

- The gene annotation travels once per response, keyed by rsID, instead of
  being repeated on every row.

- The filter column scrolls instead of overflowing once it runs out of room.

### Deployment

- **The data has moved off GitHub.** The association store, the edgelists and
  the nearest-gene annotation all live on the Railway volume. The deployed
  checkout is now ~600 kB of application code rather than several hundred
  megabytes of data and analysis.

- Analysis code, build tooling and internal documentation are preserved on
  the `analysis-archive` branch and are no longer shipped.

## 1.0

Initial release: the three views, the DuckDB/Parquet data layer, and the
Railway deployment.
