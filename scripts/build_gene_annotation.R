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
  library(GenomeInfoDb)
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

# Primary assembly only, and this matters more than it looks. TxDb carries
# 711 sequences including the GRCh38 alt haplotypes, and a gene that also
# maps to an alt scaffold spans several sequences, so
# single.strand.genes.only = TRUE silently drops it. Left alone that removed
# 1,375 protein-coding genes genome-wide and all but 10 of the 167 on
# chr6:29-33.5 Mb - TNF, HLA-A, HLA-B, HLA-DRB1 and HLA-DQB1 among them -
# which would have put badly wrong labels on every MHC SNP.
txdb <- TxDb.Hsapiens.UCSC.hg38.knownGene
seqlevels(txdb) <- paste0("chr", c(1:22, "X", "Y", "M"))
all_genes <- suppressMessages(genes(txdb, single.strand.genes.only = TRUE))
ann <- suppressMessages(AnnotationDbi::select(
  org.Hs.eg.db, keys = all_genes$gene_id, keytype = "ENTREZID",
  columns = c("SYMBOL", "GENETYPE")))
ann <- ann[!duplicated(ann$ENTREZID), ]
idx <- match(all_genes$gene_id, ann$ENTREZID)
all_genes$symbol <- ann$SYMBOL[idx]
all_genes$genetype <- ann$GENETYPE[idx]
all_genes <- all_genes[!is.na(all_genes$symbol)]

# The extended MHC (Horton et al. 2004, Nat Rev Genet 5:889, "Gene map of
# the extended human MHC"), which that paper bounds by the histone cluster
# telomerically and KIFC1 centromerically. Both anchors are taken from this
# same annotation rather than from a copied coordinate, so the boundary
# moves with the gene build and can be checked. The span it produces,
# 7.68 Mb, matches the 7.6 Mb Horton reports.
#
# Nearest gene means very little in here: the genes are packed tightly and
# LD runs the length of the region, so a SNP's nearest gene is close to
# arbitrary. SNPs inside it are labelled "MHC region (nearest: X)".
mhc_anchor <- function(sym) {
  h <- all_genes[!is.na(all_genes$symbol) & all_genes$symbol == sym &
                 as.character(seqnames(all_genes)) == "chr6"]
  if (!length(h)) stop("MHC anchor gene not found: ", sym)
  c(start(h)[1], end(h)[1])
}

universes <- list(
  protein_coding = all_genes[!is.na(all_genes$genetype) &
                             all_genes$genetype == "protein-coding"],
  with_lncrna = all_genes[!is.na(all_genes$genetype) &
                          all_genes$genetype %in% c("protein-coding", "ncRNA")]
)

MHC_START <- NULL; MHC_END <- NULL   # filled after symbols are attached

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

MHC_START <- mhc_anchor("H2BC1")[1]
MHC_END <- mhc_anchor("KIFC1")[2]
message(sprintf("  extended MHC: chr6:%d-%d (%.2f Mb), anchored on H2BC1 and KIFC1",
                MHC_START, MHC_END, (MHC_END - MHC_START) / 1e6))

results <- lapply(names(universes), function(u) annotate(universes[[u]], u))

# non-coding genes the SNP sits inside, as secondary information. Kept
# separate from the label so the displayed gene stays protein-coding and
# agrees with the paper.
noncoding <- all_genes[is.na(all_genes$genetype) | all_genes$genetype != "protein-coding"]
nc_hits <- findOverlaps(snps, noncoding, ignore.strand = TRUE)
nc_df <- data.frame(q = queryHits(nc_hits), s = subjectHits(nc_hits))
nc_df <- nc_df[order(nc_df$q, start(noncoding)[nc_df$s]), ]
nc_sym <- tapply(noncoding$symbol[nc_df$s], nc_df$q,
                 function(x) paste(unique(x), collapse = "|"))
overlapping_noncoding <- rep(NA_character_, length(snps))
overlapping_noncoding[as.integer(names(nc_sym))] <- as.character(nc_sym)
message(sprintf("  %d SNPs sit inside at least one non-coding gene",
                sum(!is.na(overlapping_noncoding))))
names(results) <- names(universes)

# the display string, protein-coding only
pc <- results$protein_coding
first <- sub("\\|.*$", "", pc$nearest_genes_all)
kb <- function(bp) {
  a <- abs(bp)
  ifelse(a >= 1e6, sprintf("%.1f Mb", a / 1e6),
         ifelse(a >= 1e3, sprintf("%.0f kb", a / 1e3), sprintf("%d bp", a)))
}
pc$in_mhc <- as.character(seqnames(snps)) == "chr6" &
             start(snps) >= MHC_START & start(snps) <= MHC_END
pc$nearest_gene <- ifelse(
  pc$annotation_status == "in_gene",
  ifelse(pc$n_genes > 1, sprintf("%s +%d", first, pc$n_genes - 1L), first),
  ifelse(pc$annotation_status == "near_gene",
         sprintf("%s (%s)", first, kb(pc$gene_distance_bp)),
         sprintf("intergenic (nearest: %s, %s)", first, kb(pc$gene_distance_bp))))
# the MHC overrides whatever the nearest-gene string would have said
pc$nearest_gene <- ifelse(pc$in_mhc,
                          sprintf("MHC region (nearest: %s)", first),
                          pc$nearest_gene)
pc$annotation_status <- ifelse(pc$in_mhc, "mhc_region", pc$annotation_status)
pc$overlapping_noncoding <- overlapping_noncoding
message(sprintf("  %d SNPs in the extended MHC", sum(pc$in_mhc)))

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
  with_lncrna_genes = as.character(length(universes$with_lncrna)),
  mhc_region = sprintf("chr6:%d-%d", MHC_START, MHC_END),
  mhc_definition = paste("extended MHC, Horton et al. 2004 Nat Rev Genet 5:889;",
                         "anchored on H2BC1 and KIFC1 in this gene build"))

write.csv(pc[, c("rsid", "nearest_gene", "nearest_genes_all",
                 "gene_distance_bp", "annotation_status",
                 "overlapping_noncoding")],
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
