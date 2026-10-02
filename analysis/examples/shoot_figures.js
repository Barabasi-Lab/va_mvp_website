#!/usr/bin/env node
/**
 * Figure panels for both worked examples (E-F and A-E).
 *
 * Every panel is captured from a build started with RANK_METRIC=pval, per
 * P2. Each panel's settings are written to results/figures/manifest.json
 * alongside the image, so the caption can state them.
 *
 *   RANK_METRIC=pval node server.js &
 *   node analysis/examples/shoot_figures.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const OUT = path.join(__dirname, 'results', 'figures');
const ESRD = '905', ANEMIA = '271';
const PVD = '649', HEMOGLOBINOPATHIES = '280';
const APOL1_SNP = 'rs73885319';          // APOL1 G1, p.S342G
const W = 2000, H = 1250;                 // publication resolution
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PANELS = [
  // --- Figure 3, ESRD -----------------------------------------------------
  { id: 'fig3_a_network_eur', fig: 'fig:renal_disease', panel: 'a',
    page: 'page1', ancestry: 'eur', pvalue: '1e-04', select: 'End stage renal disease',
    shows: 'network view, EUR, ESRD selected' },
  { id: 'fig3_b_network_afr', fig: 'fig:renal_disease', panel: 'b',
    page: 'page1', ancestry: 'afr', pvalue: '1e-04', select: 'End stage renal disease',
    shows: 'network view, AFR, ESRD selected' },
  { id: 'fig3_c_node_eur', fig: 'fig:renal_disease', panel: 'c',
    page: 'page2', node: ESRD, ancestry: 'eur', pvalue: '1e-04',
    shows: 'node view, EUR' },
  { id: 'fig3_d_node_afr', fig: 'fig:renal_disease', panel: 'd',
    page: 'page2', node: ESRD, ancestry: 'afr', pvalue: '1e-04',
    shows: 'node view, AFR' },
  { id: 'fig3_e_node_afr_apol1', fig: 'fig:renal_disease', panel: 'e',
    page: 'page2', node: ESRD, ancestry: 'afr', pvalue: '1e-04', clickSnp: APOL1_SNP,
    shows: `node view, AFR, ${APOL1_SNP} (APOL1 G1) selected` },
  { id: 'fig3_f1_comparison_afr_eur', fig: 'fig:renal_disease', panel: 'f (candidate 1)',
    page: 'page2', node: ESRD, ancestry: 'afr', ancestry2: 'eur', pvalue: '1e-04',
    shows: 'node view, AFR+EUR comparison - illustrative only' },
  // --- fig:anemias --------------------------------------------------------
  { id: 'anemia_a_node_afr', fig: 'fig:anemias', panel: 'a (AFR)',
    page: 'page2', node: ANEMIA, ancestry: 'afr', pvalue: '1e-04',
    shows: 'node view, AFR alone' },
  { id: 'anemia_a_node_eur', fig: 'fig:anemias', panel: 'a (EUR)',
    page: 'page2', node: ANEMIA, ancestry: 'eur', pvalue: '1e-04',
    shows: 'node view, EUR alone' },
  { id: 'anemia_b_afr_meta', fig: 'fig:anemias', panel: 'b',
    page: 'page2', node: ANEMIA, ancestry: 'afr', ancestry2: 'meta', pvalue: '1e-04',
    shows: 'node view, AFR+META intersection' },
  { id: 'anemia_c_eur_meta', fig: 'fig:anemias', panel: 'c',
    page: 'page2', node: ANEMIA, ancestry: 'eur', ancestry2: 'meta', pvalue: '1e-04',
    shows: 'node view, EUR+META intersection' },
  { id: 'anemia_d_afr_eur', fig: 'fig:anemias', panel: 'd',
    page: 'page2', node: ANEMIA, ancestry: 'afr', ancestry2: 'eur', pvalue: '1e-04',
    shows: 'node view, AFR+EUR intersection' },
  { id: 'anemia_e_pvd_eur_meta', fig: 'fig:anemias', panel: 'e',
    page: 'page3', left: ANEMIA, right: PVD, ancestry: 'eur', ancestry2: 'meta',
    pvalue: '1e-04', shows: 'edge view, 280.1 - Peripheral vascular disease, EUR+META' },
  { id: 'anemia_f_hb_afr_meta', fig: 'fig:anemias', panel: 'f',
    page: 'page3', left: ANEMIA, right: HEMOGLOBINOPATHIES, ancestry: 'afr',
    ancestry2: 'meta', pvalue: '1e-04',
    shows: 'edge view, 280.1 - Other hemoglobinopathies, AFR+META' }
];

function url(p) {
  if (p.page === 'page1') return `${BASE}/`;
  if (p.page === 'page2')
    return `${BASE}/page2.html?ancestry=${p.ancestry}&pvalue=${p.pvalue}&centerPheno=${p.node}`;
  return `${BASE}/page3.html?ancestry=${p.ancestry}&pvalue=${p.pvalue}` +
         `&leftPheno=${p.left}&rightPheno=${p.right}`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--window-size=${W},${H}`]
  });
  const manifest = [];
  for (const p of PANELS) {
    const page = await browser.newPage();
    page.on('dialog', d => d.dismiss());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
    await page.goto(url(p), { waitUntil: 'networkidle0', timeout: 180000 });
    await sleep(3500);
    await page.evaluate(() => {
      const b = document.querySelector('#close-welcome');
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(400);

    if (p.page === 'page1') {
      await page.evaluate(a => {
        const el = document.querySelector('#chk-' + a);
        if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, p.ancestry);
      await sleep(2500);
      await page.type('#node-search', p.select);
      await sleep(800);
      await page.evaluate(() => {
        const li = document.querySelector('#search-results li');
        if (li) li.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await sleep(1800);
    } else if (p.ancestry2) {
      await page.evaluate(s => {
        const el = [...document.querySelectorAll('.ancestry-option')].find(x => x.value === s);
        if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, p.ancestry2);
      await sleep(7000);
    }
    if (p.clickSnp) {
      const ok = await page.evaluate(rs => {
        const c = [...document.querySelectorAll('circle')]
          .find(x => x.__data__ && x.__data__.id === rs);
        if (!c) return false;
        c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }, p.clickSnp);
      if (!ok) errors.push(`SNP ${p.clickSnp} not on screen`);
      await sleep(1800);
    }

    const summary = await page.evaluate(() =>
      ((document.querySelector('#summary-panel') || {}).textContent || '')
        .replace(/\s+/g, ' ').trim());
    const file = path.join(OUT, `${p.id}.png`);
    await page.screenshot({ path: file });
    await page.close();
    manifest.push({ ...p, file: path.basename(file), screen_summary: summary,
                    rank_metric: 'pval', viewport: `${W}x${H} @2x`, errors });
    console.log(`${p.id.padEnd(30)} ${summary.slice(0, 80)}${errors.length ? '  ERRORS: ' + errors[0] : ''}`);
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`\nwrote ${PANELS.length} panels + manifest.json to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
