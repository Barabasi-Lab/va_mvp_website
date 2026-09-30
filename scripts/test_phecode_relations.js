#!/usr/bin/env node
/**
 * Unit tests for the browser phecode relation classifier (Part B).
 *
 * Mirrors analysis/phecode_redundancy/test_phecode_relations.py case for
 * case, so the two implementations cannot drift apart. The Python suite
 * additionally covers T4 against the full ICD map; the browser only sees T4
 * through the shipped lookup table, so those cases are driven from a stub
 * table here and from the real map on the Python side.
 *
 * Run: node scripts/test_phecode_relations.js
 */
const assert = require('assert');
const R = require('../public/js/phecode-relations.js');

// T1 and T2 are derived in the browser from the code strings; T3 and T4
// arrive in a lookup table. The cases below that need a table build a stub
// one, so this suite stays a unit test of the rule rather than of the
// server. The Python suite checks the same pairs against the real files.

let pass = 0, fail = 0, skipped = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`ok   ${name}`); }
  catch (err) { fail++; console.log(`FAIL ${name}\n     ${err.message}`); }
}
function skip(name, why) { skipped++; console.log(`skip ${name} (${why})`); }

// --- the cases named in the task -----------------------------------------

test('585 vs 585.32 is T1', () => {
  assert.ok(R.isT1('585', '585.32'));
  assert.ok(!R.isT2('585', '585.32'));
});

test('585.3 vs 585.32 is T1', () => {
  assert.ok(R.isT1('585.3', '585.32'));
  assert.ok(!R.isT2('585.3', '585.32'));
});

test('585.31 vs 585.32 is T2', () => {
  assert.ok(R.isT2('585.31', '585.32'));
  assert.ok(!R.isT1('585.31', '585.32'));
});

test('585.32 vs 280.1 is neither', () => {
  assert.ok(!R.isT1('585.32', '280.1'));
  assert.ok(!R.isT2('585.32', '280.1'));
});

test('T4 comes from the lookup table, hand-verified pair', () => {
  // 297.2 (suicide/self-inflicted injury) and 986 (toxic effect of carbon
  // monoxide) share the T58.* ICD-10 codes. The Python suite checks this
  // against the real map; here it must survive the trip through the table.
  const phe = { a: ['297.2'], b: ['986'] };
  R.useLookup({ tiers: ['T4'], pairs: { 'a|b': R.T4 } });
  const m = R.maskOf('a', 'b', id => phe[id]);
  assert.strictEqual(m, R.T4);
  assert.ok(!(m & R.T1) && !(m & R.T2));
  R.useLookup(null);
});

test('without a lookup table the client answers T1 and T2 only', () => {
  // The truncation rule gets T1 and T2 from the code strings. T3 and T4
  // cannot be derived that way, and the client must say it cannot answer
  // them rather than report them as "not related".
  R.useLookup(null);
  assert.deepStrictEqual(R.relationsReady(), ['T1', 'T2']);
  assert.ok(R.relationsReady().indexOf('T3') < 0);
});

test('T3 hand-verified: 585.32 and 587, via the lookup table', () => {
  // Kidney replaced by transplant sits inside ESRD's exclusion range
  // 580-590.99, and vice versa. Different integer roots and no shared ICD,
  // so T3 is the only tier that fires - the same case the Python suite
  // checks against the definitions file directly.
  const phe = { esrd: ['585.32'], txp: ['587'] };
  R.useLookup({ tiers: ['T3', 'T4'], pairs: { 'esrd|txp': R.T3 } });
  const m = R.maskOf('esrd', 'txp', id => phe[id]);
  assert.strictEqual(m, R.T3);
  assert.ok(!(m & R.T1) && !(m & R.T2) && !(m & R.T4));
  assert.deepStrictEqual(R.relationsReady(), ['T1', 'T2', 'T3', 'T4']);
  R.useLookup(null);
});

// --- string handling ------------------------------------------------------

test('decimal strings are not floats', () => {
  assert.deepStrictEqual(R.split('585.30'), ['585', '30']);
  assert.deepStrictEqual(R.split('585.3'), ['585', '3']);
  assert.notStrictEqual('585.30', '585.3');
  assert.strictEqual(parseFloat('585.30'), parseFloat('585.3')); // the trap
  assert.ok(R.isT1('585.30', '585.3'));   // distinct, and hierarchical
  assert.ok(!R.isT2('585.30', '585.3'));
});

test('leading zero codes preserved', () => {
  assert.strictEqual(R.toPhecode('Phe_008_52'), '008.52');
  assert.strictEqual(R.toPhecode('Phe_008'), '008');
  assert.ok(R.isT1('008', '008.52'));
});

test('non-phecode codes rejected', () => {
  ['DoApnea', 'DoAsth', 'HVGlauc', 'SkMsGout', 'SkMsOP', 'A1C_Max_INT']
    .forEach(c => assert.strictEqual(R.toPhecode(c), null, c));
});

test('root lookalikes are not hierarchical', () => {
  assert.ok(!R.isT1('585', '5851'));
  assert.ok(!R.isT2('585', '5851'));
});

test('identity is not a relation', () => {
  assert.ok(!R.isT1('585.32', '585.32'));
  assert.ok(!R.isT2('585.32', '585.32'));
});

test('symmetry', () => {
  [['585', '585.32'], ['585.31', '585.32'], ['297.2', '986'],
   ['585.32', '280.1']].forEach(([a, b]) => {
    const phe = { a: [a], b: [b] };
    assert.strictEqual(R.maskOf('a', 'b', id => phe[id]),
                       R.maskOf('b', 'a', id => phe[id]), `${a} ${b}`);
  });
});

// --- browser-side specifics ----------------------------------------------

test('a node with no phecode is unclassifiable, not unrelated', () => {
  const phe = { x: ['585.32'], y: [] };   // y is e.g. DoApnea
  assert.strictEqual(R.maskOf('x', 'y', id => phe[id]), R.UNCLASSIFIABLE);
});

test('merged nodes count as related if any code pair is', () => {
  const phe = { m: ['585.32', '250.2'], n: ['585.3'] };
  assert.ok(R.maskOf('m', 'n', id => phe[id]) & R.T1);
});

test('maskFor turns tier names into a bitmask', () => {
  assert.strictEqual(R.maskFor(['T1']), 1);
  assert.strictEqual(R.maskFor(['T1', 'T2']), 3);
  assert.strictEqual(R.maskFor(['T1', 'T2', 'T3', 'T4']), 15);
});

console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
process.exit(fail ? 1 : 0);
