#!/usr/bin/env Rscript
# Nearest gene for each lead SNP in the A4 locus tables.
#
# A4 asks for the major loci "with chromosome, position range, and nearest
# gene if annotation is available locally". It was not, so this installs the
# gap: TxDb.Hsapiens.UCSC.hg38.knownGene for gene bodies and org.Hs.eg.db for
# symbols, both GRCh38 like the positions themselves.
#
# "Nearest" is by distance to the gene body, 0 when the SNP is inside one.
# That is a weaker statement than "the causal gene" and the report says so;
# it is a label for a coordinate, not a mechanism.
#
# Usage: Rscript annotate_loci.R results/esrd_loci.csv [more.csv ...]
suppressMessages({
  library(TxDb.Hsapiens.UCSC.hg38.knownGene)
  library(org.Hs.eg.db)
  library(GenomicRanges)
})

genes_gr <- suppressMessages(genes(TxDb.Hsapiens.UCSC.hg38.knownGene))
sym <- suppressMessages(
  AnnotationDbi::select(org.Hs.eg.db, keys = genes_gr$gene_id,
                        keytype = "ENTREZID", columns = "SYMBOL"))
genes_gr$symbol <- sym$SYMBOL[match(genes_gr$gene_id, sym$ENTREZID)]
genes_gr <- genes_gr[!is.na(genes_gr$symbol)]

for (path in commandArgs(trailingOnly = TRUE)) {
  d <- read.csv(path, stringsAsFactors = FALSE)
  gr <- GRanges(paste0("chr", d$chrom), IRanges(d$lead_pos, d$lead_pos))
  hit <- suppressWarnings(distanceToNearest(gr, genes_gr))
  d$nearest_gene <- NA_character_
  d$distance_bp <- NA_integer_
  d$nearest_gene[queryHits(hit)] <- genes_gr$symbol[subjectHits(hit)]
  d$distance_bp[queryHits(hit)] <- mcols(hit)$distance
  write.csv(d, path, row.names = FALSE, quote = FALSE)
  cat(sprintf("annotated %s (%d rows)\n", path, nrow(d)))
}
