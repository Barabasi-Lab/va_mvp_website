#!/usr/bin/env node
/**
 * Unit tests for the nearest-gene assignment rule (3.1.1).
 *
 * The rule itself runs in R over the whole store, so these test the rule's
 * logic against a small synthetic gene set using the same decision
 * procedure, plus the display-string and grouping code the browser uses.
 *
 *   node scripts/test_gene_annotation.js
 */
const assert = require('assert');
const GeneLabels = require('../public/js/gene-labels.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

// A reimplementation of the R rule, kept deliberately small, so the
// decision boundaries can be tested without a Bioconductor round trip.
// Any change to build_gene_annotation.R must be mirrored here.
const FAR = 1e6;
function assign(pos, genes, opts = {}) {
  if (pos === null || pos === undefined) {
    return { status: 'position_unknown', gene: 'position unknown', dist: null };
  }
  const inside = genes.filter(g => pos >= g.start && pos <= g.end)
                      .sort((a, b) => a.start - b.start);
  if (inside.length) {
    const display = inside.length > 1
      ? `${inside[0].sym} +${inside.length - 1}` : inside[0].sym;
    return { status: 'in_gene', gene: display, dist: 0,
             all: inside.map(g => g.sym).join('|') };
  }
  let best = null;
  for (const g of genes) {
    const d = pos < g.start ? pos - g.start : pos - g.end;   // signed
    if (best === null || Math.abs(d) < Math.abs(best.d)) best = { g, d };
  }
  if (!best) return { status: 'position_unknown', gene: 'position unknown', dist: null };
  const far = Math.abs(best.d) > FAR;
  return { status: far ? 'intergenic_far' : 'near_gene',
           gene: best.g.sym, dist: best.d, all: best.g.sym };
}

const GENES = [
  { sym: 'AAA', start: 1000, end: 2000 },
  { sym: 'BBB', start: 1500, end: 2500 },   // overlaps AAA
  { sym: 'FAR', start: 5000000, end: 5001000 }
];

test('a SNP inside a single gene', () => {
  const r = assign(1200, [GENES[0], GENES[2]]);
  assert.strictEqual(r.status, 'in_gene');
  assert.strictEqual(r.gene, 'AAA');
  assert.strictEqual(r.dist, 0);
});

test('a SNP inside two overlapping genes', () => {
  const r = assign(1800, GENES);
  assert.strictEqual(r.status, 'in_gene');
  assert.strictEqual(r.gene, 'AAA +1');      // first in genomic order, plus N
  assert.strictEqual(r.all, 'AAA|BBB');
  assert.strictEqual(r.dist, 0);
});

test('a SNP upstream of a gene has a negative distance', () => {
  const r = assign(900, [GENES[0]]);
  assert.strictEqual(r.status, 'near_gene');
  assert.strictEqual(r.dist, -100);
});

test('a SNP downstream of a gene has a positive distance', () => {
  const r = assign(2100, [GENES[0]]);
  assert.strictEqual(r.status, 'near_gene');
  assert.strictEqual(r.dist, 100);
});

test('more than 1 Mb from any gene is intergenic_far', () => {
  const r = assign(3200000, [GENES[0], GENES[2]]);
  assert.strictEqual(r.status, 'intergenic_far');
  assert.ok(Math.abs(r.dist) > 1e6, String(r.dist));
});

test('exactly 1 Mb away is still near_gene, not far', () => {
  const r = assign(2000 + 1000000, [GENES[0]]);
  assert.strictEqual(r.dist, 1000000);
  assert.strictEqual(r.status, 'near_gene');   // the rule is "more than 1 Mb"
});

test('an unmapped rsID is position_unknown', () => {
  const r = assign(null, GENES);
  assert.strictEqual(r.status, 'position_unknown');
  assert.strictEqual(r.gene, 'position unknown');
  assert.strictEqual(r.dist, null);
});

test('a SNP exactly at a gene boundary is inside it', () => {
  for (const p of [1000, 2000]) {
    const r = assign(p, [GENES[0]]);
    assert.strictEqual(r.status, 'in_gene', `position ${p}`);
    assert.strictEqual(r.dist, 0, `position ${p}`);
  }
});

// --- the grouping and display code the browser runs --------------------

test('groups are maximal runs of consecutive SNPs sharing a gene', () => {
  const nodes = [
    { id: 'rs1', nearestGene: 'A' }, { id: 'rs2', nearestGene: 'A' },
    { id: 'rs3', nearestGene: 'B' },
    { id: 'rs4', nearestGene: 'A' }, { id: 'rs5', nearestGene: 'A' },
    { id: 'rs6', nearestGene: 'A' }
  ];
  const g = GeneLabels.groups(nodes);
  assert.deepStrictEqual(g.map(x => [x.gene, x.nodes.length]),
                         [['A', 2], ['B', 1], ['A', 3]]);
});

test('a SNP with no gene breaks a run rather than joining it', () => {
  const g = GeneLabels.groups([
    { id: 'rs1', nearestGene: 'A' }, { id: 'rs2', nearestGene: null },
    { id: 'rs3', nearestGene: 'A' }]);
  assert.deepStrictEqual(g.map(x => [x.gene, x.nodes.length]), [['A', 1], ['A', 1]]);
});

test('the label counts the SNPs in the group', () => {
  assert.strictEqual(GeneLabels.text({ gene: 'APOL1', nodes: [1, 2, 3] }), 'APOL1 (3)');
});

test('an MHC group is labelled MHC region, not by its nearest gene', () => {
  assert.strictEqual(GeneLabels.geneKey({ nearestGene: 'MHC region (nearest: HLA-DRB5)' }),
                     'MHC region');
  assert.strictEqual(GeneLabels.text({ gene: 'MHC region', nodes: [1, 2] }), 'MHC region (2)');
});

test('the same gene groups whether the SNP is inside it or near it', () => {
  // "APOL2" and "APOL2 (6 kb)" split into two brackets while the key was
  // the display string
  const g = GeneLabels.groups([
    { nearestGene: 'APOL2' }, { nearestGene: 'APOL2 (6 kb)' },
    { nearestGene: 'APOL2 +1' }]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].gene, 'APOL2');
  assert.strictEqual(g[0].nodes.length, 3);
});

test('unpositioned and far-intergenic SNPs are never grouped', () => {
  for (const s of ['position unknown', 'intergenic (nearest: ABC, 1.2 Mb)']) {
    assert.strictEqual(GeneLabels.geneKey({ nearestGene: s }), null, s);
  }
  const g = GeneLabels.groups([
    { nearestGene: 'position unknown' }, { nearestGene: 'position unknown' },
    { nearestGene: 'position unknown' }]);
  assert.strictEqual(g.length, 0);
});

test('the larger group wins a collision', () => {
  const big = { gene: 'BIG', nodes: [1, 2, 3, 4], box: { x1: 0, x2: 50, y1: 0, y2: 10 } };
  const small = { gene: 'SMALL', nodes: [1, 2], box: { x1: 25, x2: 75, y1: 0, y2: 10 } };
  const { placed, hidden } = GeneLabels.place([small, big]);
  assert.deepStrictEqual(placed.map(p => p.gene), ['BIG']);
  assert.deepStrictEqual(hidden.map(p => p.gene), ['SMALL']);
});

test('non-overlapping labels are both placed', () => {
  const a = { gene: 'A', nodes: [1, 2], box: { x1: 0, x2: 10, y1: 0, y2: 10 } };
  const b = { gene: 'B', nodes: [1, 2], box: { x1: 20, x2: 30, y1: 0, y2: 10 } };
  assert.strictEqual(GeneLabels.place([a, b]).placed.length, 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
