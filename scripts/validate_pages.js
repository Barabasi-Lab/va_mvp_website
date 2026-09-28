/**
 * End-to-end check that the DuckDB endpoints drive the same networks the
 * legacy per-node CSVs did.
 *
 * For each case the real client functions (initializeNetwork / updateEdges /
 * updateNodes, lifted verbatim out of page2.js and page3.js) are run twice:
 * once over the legacy CSV and once over the endpoint response. The resulting
 * node and edge sets are then compared.
 *
 * Usage: node scripts/validate_pages.js [baseUrl]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.dirname(__dirname);
const NODE_FILES = path.join(REPO, 'public', 'data', 'node_files');
const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const SPLIT = new Set(['181', '167', '170', '175']);

// Node 25's label is HTML-escaped in node_attributes.csv, so the pipeline that
// produced the legacy CSVs never matched it and left it out of every
// neighbourhood. The DB fixes that, so ignore it when diffing against legacy.
const LEGACY_MISSING_PHE = '25';

// ------------------------------------------------------- load client helpers

function loadClientFns(file, globals) {
  const src = fs.readFileSync(path.join(REPO, 'public', 'js', file), 'utf8');
  const start = src.indexOf('function updateEdges(');
  if (start < 0) throw new Error(`no updateEdges in ${file}`);
  const quiet = { log() {}, warn() {}, error() {} };
  const ctx = vm.createContext({
    console: quiet,
    window: { innerWidth: 1920, innerHeight: 1080 },
    d3: { select: () => ({ selectAll: () => ({}) }), selectAll: () => ({}) },
    ...globals
  });
  vm.runInContext(src.slice(start), ctx);
  return ctx;
}

// ------------------------------------------------------------- csv + fetch

function parseCsv(text) {
  const lines = text.split('\n').filter(l => l.length);
  const head = splitRow(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitRow(line);
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function splitRow(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.replace(/\r$/, ''));
  return out;
}

function legacyRows(id) {
  const files = SPLIT.has(id)
    ? [`${id}_1.csv`, `${id}_2.csv`]
    : [`${id}.csv`];
  return files.flatMap(f => parseCsv(fs.readFileSync(path.join(NODE_FILES, f), 'utf8')));
}

// Reconcile the two encodings so the comparison isolates real differences:
//
//  - the legacy CSVs wrote absent ancestry data as pval=1/beta=0 where the
//    API returns nulls;
//  - a p-value of exactly 0 is now treated as maximally significant, but the
//    client's `parseFloat(p) || 1` turned it into 1 and dropped it. Standing
//    in a denormal keeps it non-zero for that idiom while preserving both its
//    rank and the tie order.
function normaliseLegacy(rows) {
  for (const r of rows) {
    for (const a of ['meta', 'eur', 'afr', 'amr', 'eas']) {
      const p = parseFloat(r[`pval.${a}`]);
      if (p === 1 && parseFloat(r[`beta.${a}`]) === 0) {
        r[`pval.${a}`] = '';
        r[`beta.${a}`] = '';
      } else if (p === 0) {
        r[`pval.${a}`] = '1e-320';
      }
    }
  }
  return rows;
}

async function api(route, params) {
  const res = await fetch(`${BASE}${route}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`${route}: ${res.status} ${JSON.stringify(await res.json())}`);
  return res.json();
}

// ---------------------------------------------------------------- compare

// Multisets, not sets: the raw data holds 2,777 duplicate (phenotype, rsid)
// pairs, which become duplicate edges the page really does draw, so the
// counts have to line up too.
function tally(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

function summarise(nodes, edges) {
  return {
    nodes: tally(nodes.map(n => n.id)),
    edges: tally(edges.map(e =>
      `${e.source.id}|${e.target.id}|${e.direction}|${Number(e.beta).toPrecision(10)}`))
  };
}

function diff(label, a, b) {
  const only = (x, y) => [...x].filter(([k, n]) => (y.get(k) || 0) !== n)
    .map(([k, n]) => `${k} x${n}`);
  const nMissing = only(a.nodes, b.nodes), nExtra = only(b.nodes, a.nodes);
  const eMissing = only(a.edges, b.edges), eExtra = only(b.edges, a.edges);
  const ok = !nMissing.length && !nExtra.length && !eMissing.length && !eExtra.length;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(46)} ` +
    `nodes ${a.nodes.size}/${b.nodes.size} edges ${a.edges.size}/${b.edges.size}` +
    (ok ? '' : ` | node -${nMissing.length}/+${nExtra.length} edge -${eMissing.length}/+${eExtra.length}`)
  );
  if (!ok) {
    if (nMissing.length) console.log('      nodes only in legacy:', nMissing.slice(0, 5));
    if (nExtra.length) console.log('      nodes only in api   :', nExtra.slice(0, 5));
    if (eMissing.length) console.log('      edges only in legacy:', eMissing.slice(0, 6));
    if (eExtra.length) console.log('      edges only in api   :', eExtra.slice(0, 3));
  }
  return ok;
}

// ----------------------------------------------------------------- page 2

async function checkPage2(node, ancestry, logP, ancestry2 = null, logP2 = null) {
  const pThreshold = Math.pow(10, logP);
  const pThreshold2 = logP2 === null ? null : Math.pow(10, logP2);
  const cmp = Boolean(ancestry2);
  const label = `page2 node=${node} ${ancestry}${cmp ? '+' + ancestry2 : ''} 1e${logP}` +
                (cmp ? `/1e${logP2}` : '');
  const ctx = loadClientFns('page2.js', { centerPheno: node, centerMeta: null });

  const run = rows => {
    const net = ctx.initializeNetwork(rows, `beta.${ancestry}`, `pval.${ancestry}`,
      cmp ? `beta.${ancestry2}` : null, cmp ? `pval.${ancestry2}` : null, cmp);
    const edges = ctx.updateEdges(pThreshold, 0.01, 0, net.links, rows, pThreshold2, cmp);
    const res = ctx.updateNodes(edges, net.nodes);
    return summarise(res.nodes, res.edges);
  };

  const params = { node, ancestry };
  if (cmp) params.ancestry2 = ancestry2;

  let legacyRowSet = normaliseLegacy(legacyRows(node)).filter(r => r.phe_id !== LEGACY_MISSING_PHE);
  const freshRows = (await api('/api/page2/rows', params))
    .rows.filter(r => r.phe_id !== LEGACY_MISSING_PHE);

  if (cmp) {
    // Comparison mode deliberately departs from the legacy ranking: the top
    // 150 are now chosen by the weaker of the two ancestries' p-values, not by
    // the first ancestry alone. Check that selection independently against the
    // legacy CSV, then compare the rendering over the same SNPs, so the two
    // concerns stay separable.
    const expected = expectedTopSnps(legacyRowSet, node, ancestry, ancestry2);
    const got = new Set(freshRows.map(r => r.rsid));
    const missing = [...expected].filter(r => !got.has(r));
    const extra = [...got].filter(r => !expected.has(r));
    if (missing.length || extra.length) {
      console.log(`FAIL ${label.padEnd(46)} top-${TOP_SNPS} selection: ` +
        `-${missing.length}/+${extra.length} (expected ${expected.size}, got ${got.size})`);
      return false;
    }
    legacyRowSet = legacyRowSet.filter(r => expected.has(r.rsid));
  }

  return diff(label, run(legacyRowSet), run(freshRows));
}

const TOP_SNPS = 150;

// The SNPs the endpoint should pick for a centre phenotype, derived from the
// legacy CSV so it is an independent check rather than a restatement of the
// query. The CSV is in the raw dataset's row order, so a stable sort over it
// breaks ties the same way src_row does server-side.
function expectedTopSnps(rows, node, a1, a2) {
  const finite = v => Number.isFinite(parseFloat(v));
  const pv = v => (finite(v) ? parseFloat(v) : 1);
  const centre = rows.filter(r =>
    r.phe_id === node &&
    finite(r[`beta.${a1}`]) &&
    (!a2 || finite(r[`beta.${a2}`])));
  const key = r => (a2 ? Math.max(pv(r[`pval.${a1}`]), pv(r[`pval.${a2}`])) : pv(r[`pval.${a1}`]));
  return new Set(centre
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((x, y) => x.k - y.k || x.i - y.i)
    .slice(0, TOP_SNPS)
    .map(o => o.r.rsid));
}

// ----------------------------------------------------------------- page 3

async function checkPage3(left, right, ancestry, logP, ancestry2 = null, logP2 = null) {
  const pThreshold = Math.pow(10, logP);
  const pThreshold2 = logP2 === null ? null : Math.pow(10, logP2);
  const cmp = Boolean(ancestry2);
  const label = `page3 ${left}->${right} ${ancestry}${cmp ? '+' + ancestry2 : ''} 1e${logP}` +
                (cmp ? `/1e${logP2}` : '');
  const ctx = loadClientFns('page3.js', { leftPheno: left, rightPheno: right });

  const run = rows => {
    const net = ctx.initializeNetwork(rows, `beta.${ancestry}`, `pval.${ancestry}`,
      cmp ? `beta.${ancestry2}` : null, cmp ? `pval.${ancestry2}` : null, cmp);
    const edges = ctx.updateEdges(pThreshold, 0.01, 0, net.links, rows, pThreshold2, cmp);
    const res = ctx.updateNodes(edges, net.nodes);
    return summarise(res.nodes, res.edges);
  };

  // reproduce the legacy client's own pre-filter: rows for the two
  // phenotypes, restricted to the SNPs they share
  let rows = normaliseLegacy(legacyRows(left))
    .filter(r => r.phe_id === left || r.phe_id === right);
  const leftRs = new Set(rows.filter(r => r.phe_id === left).map(r => r.rsid));
  const rightRs = new Set(rows.filter(r => r.phe_id === right).map(r => r.rsid));
  const common = new Set([...leftRs].filter(r => rightRs.has(r)));
  rows = rows.filter(r => common.has(r.rsid));

  const legacy = run(rows);
  // limit=50000 disables the display cap, so this stays a like-for-like
  // comparison of the whole shared-SNP set against the legacy CSVs
  const params = { left, right, ancestry, pvalue: pThreshold, limit: 50000 };
  if (cmp) { params.ancestry2 = ancestry2; params.pvalue2 = pThreshold2; }
  const fresh = run((await api('/api/page3/rows', params)).rows);
  return diff(label, legacy, fresh);
}

// -------------------------------------------------------------------- main

// `--sample N` adds N extra randomly chosen page-2 cases on top of the fixed
// set, for a broader sweep than the hand-picked regression cases.
function randomCases(n) {
  const ids = fs.readdirSync(NODE_FILES)
    .filter(f => !f.includes('_') && fs.statSync(path.join(NODE_FILES, f)).size > 200)
    .map(f => f.slice(0, -4));
  const ancestries = ['meta', 'eur', 'afr', 'amr', 'eas'];
  let seed = 20260925;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: n }, () => [
    ids[Math.floor(rnd() * ids.length)],
    ancestries[Math.floor(rnd() * ancestries.length)],
    -(4 + Math.floor(rnd() * 9))
  ]);
}

(async () => {
  const sampleArg = process.argv.indexOf('--sample');
  const page2Cases = [
    ['1320', 'meta', -4], ['255', 'eur', -4], ['407', 'meta', -6],
    ['349', 'meta', -4], ['579', 'afr', -4], ['226', 'meta', -8],
    ['708', 'eur', -8], ['236', 'meta', -4], ['87', 'meta', -10],
    ['185', 'amr', -4], ['560', 'meta', -4], ['181', 'meta', -4],
    ['708', 'eas', -4], ['181', 'meta', -12],
    // two-ancestry intersection mode
    ['264', 'amr', -4, 'eas', -4], ['264', 'meta', -4, 'eur', -4],
    ['230', 'eur', -6, 'afr', -4], ['229', 'meta', -8, 'amr', -4],
    ['708', 'eur', -4, 'meta', -8], ['87', 'meta', -4, 'eur', -10],
    ['181', 'meta', -4, 'amr', -4],
    ...(sampleArg > 0 ? randomCases(Number(process.argv[sampleArg + 1])) : [])
  ];
  const page3Cases = [
    ['708', '236', 'meta', -4], ['181', '87', 'meta', -4],
    ['349', '1', 'eur', -4], ['560', '185', 'meta', -8],
    ['236', '708', 'afr', -4],
    // two-ancestry intersection mode
    ['230', '229', 'meta', -4, 'eur', -4], ['708', '236', 'meta', -4, 'afr', -4],
    ['181', '87', 'eur', -4, 'meta', -6]
  ];

  let ok = true;
  for (const c of page2Cases) ok = (await checkPage2(...c)) && ok;
  for (const c of page3Cases) ok = (await checkPage3(...c)) && ok;
  console.log(ok ? '\nALL MATCH' : '\nMISMATCHES PRESENT');
  process.exit(ok ? 0 : 1);
})();
