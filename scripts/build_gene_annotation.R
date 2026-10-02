#!/usr/bin/env Rscript
# Nearest protein-coding gene for every rsID in the association store.
#
# One annotation serves the site and the paper, so this uses exactly the
# packages the example reanalysis used (analysis/examples, P4):
#   SNPlocs.Hsapiens.dbSNP155.GRCh38  positions, already dumped to CSV
#   TxDb.Hsapiens.UCSC.hg38.knownGene gene bodies
#   org.Hs.eg.db                      symbols and GENETYPE
# Versions are written into the output so the site and the report can both
# quote them.
#
# The rule, per the task:
#   inside one or more gene bodies -> those genes, distance 0
#   otherwise                      -> nearest gene body edge, signed bp,
#                                     negative when the SNP lies upstream
#                                     of the gene on the reference strand
#   nearest gene more than 1 Mb    -> intergenic_far
#   no position                    -> position_unknown
#
# A gene body is the union of its transcripts, start to end, which is what
# GenomicFeatures::genes() returns.
#
# Two universes are computed. The protein-coding one is what the site
# displays; the second adds lncRNA and is written alongside for the
# coverage evaluation only (3.2). It is never displayed.
#
# Usage:
#   Rscript scripts/build_gene_annotation.R <positions.csv> <out_prefix>
suppressMessages({
  library(TxDb.Hsapiens.UCSC.hg38.knownGene)
  library(org.Hs.eg.db)
  library(GenomicRanges)
  library(GenomicFeatures)
})

args <- commandArgs(trailingOnly = TRUE)
positions_csv <- args[1]
out_prefix <- args[2]
FAR_BP <- 1e6

message("positions: ", positions_csv)
pos <- read.csv(positions_csv, stringsAsFactors = FALSE)
pos$chrom <- paste0("chr", pos$chrom)
snps <- GRanges(pos$chrom, IRanges(pos$pos, pos$pos))
mcols(snps)$rsid <- pos$rsid
message(sprintf("  %d positioned rsIDs", length(snps)))

all_genes <- suppressMessages(
  genes(TxDb.Hsapiens.UCSC.hg38.knownGene, single.strand.genes.only = TRUE))
ann <- suppressMessages(AnnotationDbi::select(
  org.Hs.eg.db, keys = all_genes$gene_id, keytype = "ENTREZID",
  columns = c("SYMBOL", "GENETYPE")))
ann <- ann[!duplicated(ann$ENTREZID), ]
idx <- match(all_genes$gene_id, ann$ENTREZID)
all_genes$symbol <- ann$SYMBOL[idx]
all_genes$genetype <- ann$GENETYPE[idx]
all_genes <- all_genes[!is.na(all_genes$symbol)]

universes <- list(
  protein_coding = all_genes[!is.na(all_genes$genetype) &
                             all_genes$genetype == "protein-coding"],
  with_lncrna = all_genes[!is.na(all_genes$genetype) &
                          all_genes$genetype %in% c("protein-coding", "ncRNA")]
)

annotate <- function(genes_gr, label) {
  message(sprintf("  %s universe: %d genes", label, length(genes_gr)))
  genes_gr <- sort(genes_gr)

  # inside: every overlapping gene, kept in genomic order
  hits <- findOverlaps(snps, genes_gr, ignore.strand = TRUE)
  inside <- data.frame(q = queryHits(hits), s = subjectHits(hits))
  inside <- inside[order(inside$q, start(genes_gr)[inside$s]), ]
  inside_sym <- tapply(genes_gr$symbol[inside$s], inside$q,
                       function(x) paste(unique(x), collapse = "|"))
  inside_n <- tapply(genes_gr$symbol[inside$s], inside$q,
                     function(x) length(unique(x)))

  out <- data.frame(
    rsid = mcols(snps)$rsid,
    nearest_genes_all = NA_character_,
    n_genes = 0L,
    gene_distance_bp = NA_integer_,
    annotation_status = NA_character_,
    stringsAsFactors = FALSE)
  qi <- as.integer(names(inside_sym))
  out$nearest_genes_all[qi] <- as.character(inside_sym)
  out$n_genes[qi] <- as.integer(inside_n)
  out$gene_distance_bp[qi] <- 0L
  out$annotation_status[qi] <- "in_gene"

  # outside: nearest body edge, signed
  todo <- which(is.na(out$annotation_status))
  if (length(todo)) {
    nr <- suppressWarnings(distanceToNearest(snps[todo], genes_gr,
                                             ignore.strand = TRUE))
    q <- todo[queryHits(nr)]
    s <- subjectHits(nr)
    d <- mcols(nr)$distance
    # negative when the SNP sits before the gene on the reference strand
    sgn <- ifelse(start(snps)[q] < start(genes_gr)[s], -1L, 1L)
    out$nearest_genes_all[q] <- genes_gr$symbol[s]
    out$n_genes[q] <- 1L
    out$gene_distance_bp[q] <- as.integer(d) * sgn
    out$annotation_status[q] <- ifelse(d > FAR_BP, "intergenic_far", "near_gene")
  }
  out$universe <- label
  out
}

results <- lapply(names(universes), function(u) annotate(universes[[u]], u))
names(results) <- names(universes)

# the display string, protein-coding only
pc <- results$protein_coding
first <- sub("\\|.*$", "", pc$nearest_genes_all)
kb <- function(bp) {
  a <- abs(bp)
  ifelse(a >= 1e6, sprintf("%.1f Mb", a / 1e6),
         ifelse(a >= 1e3, sprintf("%.0f kb", a / 1e3), sprintf("%d bp", a)))
}
pc$nearest_gene <- ifelse(
  pc$annotation_status == "in_gene",
  ifelse(pc$n_genes > 1, sprintf("%s +%d", first, pc$n_genes - 1L), first),
  ifelse(pc$annotation_status == "near_gene",
         sprintf("%s (%s)", first, kb(pc$gene_distance_bp)),
         sprintf("intergenic (nearest: %s, %s)", first, kb(pc$gene_distance_bp))))

versions <- c(
  R = R.version.string,
  TxDb.Hsapiens.UCSC.hg38.knownGene =
    as.character(packageVersion("TxDb.Hsapiens.UCSC.hg38.knownGene")),
  org.Hs.eg.db = as.character(packageVersion("org.Hs.eg.db")),
  GenomicFeatures = as.character(packageVersion("GenomicFeatures")),
  SNPlocs.Hsapiens.dbSNP155.GRCh38 = "0.99.24",
  genome_build = "GRCh38",
  far_threshold_bp = as.character(FAR_BP),
  protein_coding_genes = as.character(length(universes$protein_coding)),
  with_lncrna_genes = as.character(length(universes$with_lncrna)))

write.csv(pc[, c("rsid", "nearest_gene", "nearest_genes_all",
                 "gene_distance_bp", "annotation_status")],
          paste0(out_prefix, ".csv"), row.names = FALSE, quote = TRUE, na = "")
write.csv(results$with_lncrna[, c("rsid", "nearest_genes_all",
                                  "gene_distance_bp", "annotation_status")],
          paste0(out_prefix, "_with_lncrna.csv"), row.names = FALSE,
          quote = TRUE, na = "")
writeLines(jsonlite::toJSON(as.list(versions), auto_unbox = TRUE, pretty = TRUE),
           paste0(out_prefix, "_versions.json"))

message("status counts (protein-coding):")
print(table(pc$annotation_status, useNA = "ifany"))
message("wrote ", out_prefix, ".csv")
