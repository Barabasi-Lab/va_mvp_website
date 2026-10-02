#!/usr/bin/env Rscript
# rsid -> GRCh38 position for every SNP in the association store.
#
# The store records no genome build and carries no base-pair column, so A4
# needs positions from outside. dbSNP is keyed by rs number, which is stable
# across builds, so the lookup itself does not depend on knowing the store's
# build; the coordinates that come back are GRCh38 by construction. The
# store's own `chrom` column is written out alongside so the caller can check
# the two agree.
#
# Usage: Rscript snp_positions.R rsids.txt out.csv
suppressMessages({
  library(SNPlocs.Hsapiens.dbSNP155.GRCh38)
  library(BSgenome)
})

args <- commandArgs(trailingOnly = TRUE)
ids <- readLines(args[1])
snps <- SNPlocs.Hsapiens.dbSNP155.GRCh38

cat(sprintf("looking up %d rsids\n", length(ids)))
# snpsById is memory-hungry on the full set; go in chunks
chunks <- split(ids, ceiling(seq_along(ids) / 50000))
out <- vector("list", length(chunks))
for (i in seq_along(chunks)) {
  g <- snpsById(snps, chunks[[i]], ifnotfound = "drop")
  out[[i]] <- data.frame(rsid = mcols(g)$RefSNP_id,
                         chrom = as.character(seqnames(g)),
                         pos = start(g),
                         stringsAsFactors = FALSE)
  cat(sprintf("  chunk %d/%d: %d found\n", i, length(chunks), nrow(out[[i]])))
}
res <- do.call(rbind, out)
write.csv(res, args[2], row.names = FALSE, quote = FALSE)
cat(sprintf("wrote %s (%d of %d rsids resolved)\n",
            args[2], nrow(res), length(ids)))
