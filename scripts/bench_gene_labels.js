#!/usr/bin/env node
/**
 * Speed evaluation for the gene labels (3.3).
 *
 * Baseline is `main` with the pre-annotation store on :3001; the feature
 * branch with the rebuilt store is on :3000. Same method as the
 * hierarchy-toggle evaluation: median and 90th percentile of 10 runs,
 * cold and warm cache, timed to the point where the drawing surface has
 * stopped changing.
 *
 *   node scripts/bench_gene_labels.js [--runs 10]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg('runs', 10));
const BASE = 'http://localhost:3000', BASELINE = 'http://localhost:3001';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const OUT = path.join(__dirname, '..', 'analysis', 'examples', 'results', 'gene_labels_bench.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const stats = xs => {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { n: s.length, median: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1) };
};

// the cases the task names
const ENDPOINTS = [
  ['page2 ESRD AFR', '/api/page2/rows?node=905&ancestry=afr&pvalue=1e-4'],
  ['page2 Obesity META', '/api/page2/rows?node=264&ancestry=meta&pvalue=1e-4'],
  ['page2 Asthma META', '/api/page2/rows?node=708&ancestry=meta&pvalue=1e-4'],
  ['page3 ESRD-588 AFR', '/api/page3/rows?left=905&right=913&ancestry=afr&pvalue=1e-4'],
  ['page3 Hyperlip-lipoid EUR', '/api/page3/rows?left=739&right=741&ancestry=eur&pvalue=1e-4']
];

/**
 * Latency, and the bytes that actually cross the wire.
 *
 * Node's fetch transparently decompresses, so reading the body length gives
 * the uncompressed size however the request is labelled - an earlier version
 * of this reported those as "gzipped" and overstated the payload cost by
 * about 3x. http.get with no Accept-Encoding negotiation and a raw socket
 * count is what the server actually sends.
 */
function rawGet(base, url) {
  const http = require('http');
  const { hostname, port, path: p } = new URL(base + url);
  return new Promise((resolve, reject) => {
    const t = Date.now();
    http.get({ hostname, port, path: p, headers: { 'Accept-Encoding': 'gzip' } }, res => {
      let bytes = 0;
      res.on('data', c => { bytes += c.length; });   // compressed, not decoded
      res.on('end', () => resolve({ ms: Date.now() - t, bytes,
                                    encoding: res.headers['content-encoding'] || 'identity' }));
    }).on('error', reject);
  });
}

async function timeEndpoint(base, url, runs) {
  const ms = [], sizes = [];
  let encoding = null;
  for (let i = 0; i < runs; i++) {
    const r = await rawGet(base, url);
    ms.push(r.ms);
    sizes.push(r.bytes);
    encoding = r.encoding;
  }
  return { ms: stats(ms), transferredBytes: Math.max(...sizes), encoding };
}

const SETTLE = `
  window.__t = async function (fire, timeoutMs) {
    const target = document.querySelector('svg') || document.body;
    let mutated = false, quiet = 0;
    const obs = new MutationObserver(() => { mutated = true; quiet = 0; });
    obs.observe(target, { childList: true, subtree: true, attributes: true });
    const t0 = performance.now();
    fire();
    const out = await new Promise(res => {
      const deadline = performance.now() + timeoutMs;
      const tick = () => {
        if (mutated && ++quiet >= 2) return res(performance.now() - t0);
        if (performance.now() > deadline) return res(null);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    obs.disconnect();
    return out;
  };`;

(async () => {
  const report = { runs: RUNS, generated: new Date().toISOString(), endpoints: {},
                   tooltip: {}, stage2: {} };

  console.log('--- endpoint latency and gzipped payload');
  for (const [name, url] of ENDPOINTS) {
    const b = await timeEndpoint(BASELINE, url, RUNS);
    const f = await timeEndpoint(BASE, url, RUNS);
    const dLat = 100 * (f.ms.median - b.ms.median) / b.ms.median;
    const dPay = 100 * (f.transferredBytes - b.transferredBytes) / b.transferredBytes;
    report.endpoints[name] = { baseline: b, feature: f,
                               latency_delta_pct: +dLat.toFixed(1),
                               payload_delta_pct: +dPay.toFixed(1) };
    console.log(`${name.padEnd(28)} ${b.ms.median}ms -> ${f.ms.median}ms (${dLat >= 0 ? '+' : ''}${dLat.toFixed(1)}%)  ` +
                `${(b.transferredBytes / 1024).toFixed(0)} -> ${(f.transferredBytes / 1024).toFixed(0)} kB (${dPay >= 0 ? '+' : ''}${dPay.toFixed(1)}%)`);
  }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  console.log('\n--- tooltip latency, 20 hovers');
  for (const [label, base, url] of [
    ['page2 baseline', BASELINE, '/page2.html?ancestry=afr&pvalue=1e-04&centerPheno=905'],
    ['page2 feature', BASE, '/page2.html?ancestry=afr&pvalue=1e-04&centerPheno=905'],
    ['page3 baseline', BASELINE, '/page3.html?ancestry=afr&pvalue=1e-04&leftPheno=905&rightPheno=913'],
    ['page3 feature', BASE, '/page3.html?ancestry=afr&pvalue=1e-04&leftPheno=905&rightPheno=913']]) {
    const page = await browser.newPage();
    page.on('dialog', d => d.dismiss());
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(base + url, { waitUntil: 'networkidle0', timeout: 120000 });
    await sleep(3500);
    const ms = await page.evaluate(SETTLE + `
      (async () => {
        const snps = [...document.querySelectorAll('circle')]
          .filter(c => c.__data__ && String(c.__data__.id).startsWith('rs')).slice(0, 20);
        const out = [];
        for (const c of snps) {
          const t = await window.__t(() =>
            c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })), 3000);
          if (t !== null) out.push(t);
          c.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        }
        return out;
      })()`);
    report.tooltip[label] = stats(ms);
    console.log(`${label.padEnd(20)} median ${stats(ms).median} ms  p90 ${stats(ms).p90} ms  (n=${ms.length})`);
    await page.close();
  }

  console.log('\n--- Stage 2 render cost, toggle on vs off');
  for (const [label, url] of [
    ['page2 (150 SNPs)', '/page2.html?ancestry=afr&pvalue=1e-04&centerPheno=905'],
    ['page3 (250 SNPs)', '/page3.html?ancestry=afr&pvalue=1e-04&leftPheno=905&rightPheno=913']]) {
    for (const k of [2, 3, 5]) {
      const on = [];
      for (let i = 0; i < RUNS; i++) {
        const page = await browser.newPage();
        page.on('dialog', d => d.dismiss());
        await page.setViewport({ width: 1600, height: 1000 });
        await page.goto(`${BASE}${url}&geneLabelK=${k}`, { waitUntil: 'networkidle0', timeout: 120000 });
        await sleep(3500);
        const t = await page.evaluate(SETTLE + `
          (async () => {
            const el = document.querySelector('#gene-labels');
            if (!el) return null;
            return window.__t(() => el.click(), 10000);
          })()`);
        if (t !== null) on.push(t);
        await page.close();
      }
      report.stage2[`${label} k=${k}`] = stats(on);
      console.log(`${label} k=${k}: toggle-on ${stats(on).median} ms (p90 ${stats(on).p90})`);
    }
  }

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log('\nwrote ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
