# Changelog

## 1.1 — 2026-10-05

### Fixed

- **The network view's p-value slider did nothing useful below 1e-6.** The
  edge-weight columns at 1e-07 and stricter were attached to the wrong
  phenotype pairs — counts and distributions looked plausible, but the
  network drawn did not correspond to the setting. Every one of the 90
  columns was regenerated and checked: weights never rise as the threshold
  tightens, no edge appears at a stricter threshold than it survives at, and
  the on-screen counts now equal a direct recomputation at every
  ancestry/threshold combination tested.

  The regeneration added 2,321 pairs over 85 phenotypes. Edge counts and
  weights at 1e-4 to 1e-6 can differ by a few percent from previously
  published values.

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

- **SNPs are ranked by |beta/se|, not by p-value**
- **The comparison legend now reads "same direction" and "opposite
  direction".** It had previously used concordant/discordant, which assigns
  two meanings to those terms and was confusing.

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

Initial release: the three network views, deployed through railway with data
stored locally as csvs per node, and two csvs (nodes and edges) for the page 1
network.
