#!/usr/bin/env node
/**
 * Speed evaluation for the hierarchy-mask toggle (Part B, B3).
 *
 * Every latency here is measured the same way: start the clock, fire the
 * control, and stop once the summary panel reflects the change and two
 * animation frames have gone by. The point of the exercise is to compare the
 * toggle against the filters the page already has, and that only means
 * anything if both are timed to the same finish line - "the new state is on
 * screen", not "the handler returned".
 *
 * Two servers run side by side so before/after is a real comparison rather
 * than a feature flag: `main` on the baseline port, the feature branch on
 * the other. The baseline has no toggle, so it contributes the initial-load,
 * payload and existing-filter numbers only.
 *
 *   node scripts/bench_toggle.js [--runs 10] [--base http://localhost:3000]
 *                               [--baseline http://localhost:3001]
 *
 * Needs puppeteer-core and CHROME_PATH.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const RUNS = Number(arg('runs', 10));
// Page 2's p-value sliders debounce for 200 ms before they refetch. That sits
// inside every page-2 p-value figure below, because it sits inside what the
// user waits through.
const PAGE2_DEBOUNCE_MS = 200;
const BASE = arg('base', 'http://localhost:3000');
const BASELINE = arg('baseline', 'http://localhost:3001');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const OUT = path.join(__dirname, '..', 'analysis', 'phecode_redundancy',
                      'results', 'toggle_bench.json');

// page 1: the default view, and the densest one (EUR at 1e-04, 53,125 edges
// against META's 50,973)
const PAGE1 = [
  { name: 'default (META, 1e-04, total)', ancestry: 'meta', pIndex: 8 },
  { name: 'densest (EUR, 1e-04, total)', ancestry: 'eur', pIndex: 8 }
];
// page 2: the three highest-degree phenotypes, then ESRD
const PAGE2 = [
  { id: '181', name: 'Type 2 diabetes (deg 481)' },
  { id: '175', name: 'Diabetes mellitus (deg 476)' },
  { id: '560', name: 'Coronary atherosclerosis (deg 399)' },
  { id: '905', name: 'ESRD (585.32)' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function stats(xs) {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { n: s.length, median: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1),
           min: +s[0].toFixed(1), max: +s[s.length - 1].toFixed(1) };
}

const SETTLE = `
  window.__benchTimed = async function (fire, timeoutMs) {
    let mutated = false, quiet = 0;
    // Watch the drawing surface, not the whole body. Watching the body
    // stopped the clock on the p-value label, which updates the instant the
    // slider moves - 200 ms of debounce, a fetch and a re-render before
    // anything the user came for appears. The svg is where the answer lands.
    const target = document.querySelector('svg') || document.body;
    const obs = new MutationObserver(() => { mutated = true; quiet = 0; });
    obs.observe(target, { childList: true, subtree: true,
                          attributes: true, characterData: true });
    const t0 = performance.now();
    fire();
    const ms = await new Promise(res => {
      const deadline = performance.now() + timeoutMs;
      const tick = () => {
        if (mutated && ++quiet >= 2) return res(performance.now() - t0);
        if (performance.now() > deadline) return res(null);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    obs.disconnect();
    return ms;
  };
`;

/**
 * Time an action to the point where the page has stopped changing.
 *
 * A MutationObserver watches the whole body; the clock stops once a mutation
 * has been seen and then two animation frames pass with no further ones.
 * Waiting on the summary text instead looked simpler but silently produced
 * no measurement whenever a filter change happened to leave the counts
 * identical, and it would have stopped the clock before the re-render on the
 * occasions it did fire.
 *
 * Returns null if nothing moved inside the timeout, which is a result worth
 * seeing rather than a hang.
 */
const TIMED = (selector, kind) => SETTLE + `
  (async () => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    return window.__benchTimed(() => ${kind === 'click'
      ? 'el.click()'
      : 'el.dispatchEvent(new Event("input", { bubbles: true }))'}, 25000);
  })()`;

async function newPage(browser, cold) {
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss());
  await page.setCacheEnabled(!cold);
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  return page;
}

/** Initial load time and the bytes the browser actually pulled down. */
async function loadProfile(browser, url, cold) {
  const page = await newPage(browser, cold);
  if (!cold) {                       // prime the cache, then measure
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
    await sleep(500);
  }
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  const wall = Date.now() - t0;
  const res = await page.evaluate(() => {
    const r = performance.getEntriesByType('resource');
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return {
      transferred: r.reduce((a, e) => a + (e.transferSize || 0), 0)
                   + (nav.transferSize || 0),
      decoded: r.reduce((a, e) => a + (e.decodedBodySize || 0), 0)
               + (nav.decodedBodySize || 0),
      requests: r.length + 1,
      domContentLoaded: nav.domContentLoadedEventEnd || null,
      memory: performance.memory
        ? performance.memory.usedJSHeapSize : null
    };
  });
  const errors = page.__errors.slice();
  await page.close();
  return { wall, ...res, errors };
}

async function page1Runs(base, cfg, impl) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--expose-gc']
  });
  const out = { toggleOn: [], toggleOff: [], ancestry: [], pvalue: [],
                errors: [], memoryOff: [], memoryOn: [] };
  for (let i = 0; i < RUNS; i++) {
    const page = await newPage(browser, false);
    const url = `${base}/${impl ? '?maskImpl=' + impl : ''}`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
    await sleep(2000);
    // put the page in the configuration under test
    if (cfg.ancestry !== 'meta') {
      await page.evaluate(a => document.querySelector('#chk-' + a)
        .dispatchEvent(new Event('change', { bubbles: true })), cfg.ancestry);
      await sleep(1500);
    }
    if (impl) {
      out.memoryOff.push(await page.evaluate(
        () => performance.memory ? performance.memory.usedJSHeapSize : null));
      const on = await page.evaluate(TIMED('#hierarchy-mask', 'click'));
      const off = await page.evaluate(TIMED('#hierarchy-mask', 'click'));
      if (on !== null) out.toggleOn.push(on);
      if (off !== null) out.toggleOff.push(off);
      out.memoryOn.push(await page.evaluate(
        () => performance.memory ? performance.memory.usedJSHeapSize : null));
    }
    // the filters that already exist, for the comparison the guideline asks for
    const other = cfg.ancestry === 'meta' ? 'eur' : 'meta';
    const anc = await page.evaluate(SETTLE + `
      (async () => {
        const el = document.querySelector('#chk-${other}');
        if (!el) return null;
        return window.__benchTimed(
          () => el.dispatchEvent(new Event('change', { bubbles: true })), 25000);
      })()`);
    if (anc !== null) out.ancestry.push(anc);
    const pv = await page.evaluate(SETTLE + `
      (async () => {
        const el = document.querySelector('#pvalue-slider');
        el.value = String(Math.max(0, +el.value - 4));
        return window.__benchTimed(
          () => el.dispatchEvent(new Event('input', { bubbles: true })), 25000);
      })()`);
    if (pv !== null) out.pvalue.push(pv);
    out.errors.push(...page.__errors);
    await page.close();
  }
  await browser.close();
  return out;
}

async function page2Runs(base, node, impl) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const out = { toggleOn: [], toggleOff: [], pvalue: [], errors: [] };
  for (let i = 0; i < RUNS; i++) {
    const page = await newPage(browser, false);
    await page.goto(
      `${base}/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=${node}` +
      (impl ? '&maskImpl=' + impl : ''),
      { waitUntil: 'networkidle0', timeout: 120000 });
    await sleep(2500);
    if (impl) {
      const on = await page.evaluate(TIMED('#hierarchy-mask', 'click'));
      const off = await page.evaluate(TIMED('#hierarchy-mask', 'click'));
      if (on !== null) out.toggleOn.push(on);
      if (off !== null) out.toggleOff.push(off);
    }
    const pv = await page.evaluate(SETTLE + `
      (async () => {
        const el = document.querySelector('#pvalue-slider');
        const min = +el.min || 0;
        el.value = String(Math.max(min, +el.value - 2));
        return window.__benchTimed(
          () => el.dispatchEvent(new Event('input', { bubbles: true })), 30000);
      })()`);
    if (pv !== null) out.pvalue.push(pv);
    out.errors.push(...page.__errors);
    await page.close();
  }
  await browser.close();
  return out;
}

(async () => {
  const report = { runs: RUNS, generated: new Date().toISOString(),
                   base: BASE, baseline: BASELINE,
                   page2DebounceMs: PAGE2_DEBOUNCE_MS,
                   note: 'latency = event fired -> svg mutations quiesce for ' +
                         'two animation frames',
                   page1: {}, page2: {}, load: {} };

  // --- initial load and payload, before vs after, cold and warm ----------
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  for (const [label, url] of [
    ['baseline page1', `${BASELINE}/`],
    ['precomputed page1', `${BASE}/?maskImpl=precomputed`],
    ['client page1', `${BASE}/?maskImpl=client`],
    ['baseline page2', `${BASELINE}/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=905`],
    ['precomputed page2', `${BASE}/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=905&maskImpl=precomputed`],
    ['client page2', `${BASE}/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=905&maskImpl=client`]
  ]) {
    const cold = [], warm = [];
    let last = null;
    for (let i = 0; i < RUNS; i++) {
      const c = await loadProfile(browser, url, true);
      cold.push(c.wall);
      const w = await loadProfile(browser, url, false);
      warm.push(w.wall);
      last = c;
    }
    report.load[label] = {
      coldMs: stats(cold), warmMs: stats(warm),
      transferredBytes: last.transferred, decodedBytes: last.decoded,
      requests: last.requests, errors: last.errors
    };
    console.log(`load ${label}: cold ${report.load[label].coldMs.median} ms, ` +
                `warm ${report.load[label].warmMs.median} ms, ` +
                `${last.transferred.toLocaleString()} B transferred`);
  }
  await browser.close();

  // --- latencies ---------------------------------------------------------
  for (const cfg of PAGE1) {
    for (const [label, base, impl] of [
      ['baseline', BASELINE, null],
      ['precomputed', BASE, 'precomputed'],
      ['client', BASE, 'client']
    ]) {
      const r = await page1Runs(base, cfg, impl);
      report.page1[`${cfg.name} | ${label}`] = {
        toggleOn: stats(r.toggleOn), toggleOff: stats(r.toggleOff),
        ancestrySwitch: stats(r.ancestry), pvalueSwitch: stats(r.pvalue),
        heapOffBytes: stats(r.memoryOff.filter(Number.isFinite)),
        heapOnBytes: stats(r.memoryOn.filter(Number.isFinite)),
        errors: [...new Set(r.errors)]
      };
      console.log(`page1 ${cfg.name} ${label}: toggle on ` +
                  `${report.page1[`${cfg.name} | ${label}`].toggleOn.median ?? '-'} ms, ` +
                  `ancestry ${report.page1[`${cfg.name} | ${label}`].ancestrySwitch.median} ms`);
    }
  }

  for (const n of PAGE2) {
    for (const [label, base, impl] of [
      ['baseline', BASELINE, null],
      ['precomputed', BASE, 'precomputed'],
      ['client', BASE, 'client']
    ]) {
      const r = await page2Runs(base, n.id, impl);
      report.page2[`${n.name} | ${label}`] = {
        toggleOn: stats(r.toggleOn), toggleOff: stats(r.toggleOff),
        pvalueSwitch: stats(r.pvalue), errors: [...new Set(r.errors)]
      };
      console.log(`page2 ${n.name} ${label}: toggle on ` +
                  `${report.page2[`${n.name} | ${label}`].toggleOn.median ?? '-'} ms, ` +
                  `pvalue ${report.page2[`${n.name} | ${label}`].pvalueSwitch.median} ms`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nwrote ' + OUT);
})().catch(err => { console.error(err); process.exit(1); });
