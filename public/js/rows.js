/**
 * One association row per (SNP, phenotype), for pages 2 and 3.
 *
 * 2,777 (phenotype, SNP) pairs in the store carry more than one row, and not
 * all of them agree. (ESRD, rs35305544) is two rows whose AFR betas have
 * opposite signs: +0.1582 at p = 4.1e-7 and -0.2291 at p = 9.3e-22.
 *
 * Left alone, a duplicated pair draws two lines on top of each other, and in
 * comparison mode they can disagree about direction, so one is green and one
 * orange with the later one hiding the earlier. Worse, the comparison join is
 * keyed on (source, target) and keeps the last row it sees, so a link built
 * from one row gets enriched with a *different* row's second-ancestry
 * statistics. That is how (ESRD, rs35305544) produced the single "discordant"
 * edge on ESRD in AFR+EUR: row A's AFR beta (+) combined with row B's EUR beta
 * (-) to give a direction product of -1, for a pair that is concordant in
 * every row the store actually holds. It also let row A through the p-value
 * filter on row B's EUR p-value, where its own is 0.78.
 *
 * The rule here matches the one the analysis uses: keep the row with the
 * strongest evidence, which in comparison mode means the weaker of its two
 * p-values, since that is what both filters have to clear. Ties keep the
 * earlier row, so the choice is stable.
 */
(function (global) {
  'use strict';

  function dedupeRows(data, pColumn, pColumn2) {
    const best = new Map();
    const order = [];
    for (const row of data) {
      const key = `${row.rsid}|${row.phe_id}`;
      // A missing or unparseable p-value sorts last rather than winning.
      const p1 = Number(row[pColumn]);
      const rank = pColumn2
        ? Math.max(Number.isFinite(p1) ? p1 : Infinity,
                   (n => Number.isFinite(n) ? n : Infinity)(Number(row[pColumn2])))
        : (Number.isFinite(p1) ? p1 : Infinity);
      const seen = best.get(key);
      if (seen === undefined) {
        best.set(key, { row, rank });
        order.push(key);
      } else if (rank < seen.rank) {
        seen.row = row;
        seen.rank = rank;
      }
    }
    return order.map(key => best.get(key).row);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { dedupeRows };
  global.Rows = { dedupeRows: dedupeRows };
}(typeof window !== 'undefined' ? window : globalThis));
