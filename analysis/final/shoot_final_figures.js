#!/usr/bin/env node
/**
 * Part 4 - every manuscript panel captured from the final build.
 *
 * Figure 3 (renal_disease_v3) and the anemia figure (anemias_v2, centred on
 * phecode 280 rather than 280.1), plus the Figure 2 interface sources. Each
 * panel's UI settings and the on-screen summary line are written to
 * figures/manifest.json so the caption can state them.
 *
 *   RANK_METRIC=pval node server.js &
 *   node analysis/final/shoot_final_figures.js
 *
 * Panel f of Figure 3 is drawn from the store by fig3_panel_f.py, not here.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const OUT = path.join(__dirname, 'figures');
const W = 2000, H = 1250;                 // publication resolution
// Device pixel ratio. The full-page panels are fine at 2 (4000x2500); the
// Figure 2 element crops are small, so they are re-shot at 4 to keep them
// above 300 dpi at the size a schematic would place them.
const SCALE = Number(process.env.PANEL_SCALE || 2);
// ONLY=fig2 re-shoots just the Figure 2 sources.
const ONLY = process.env.ONLY || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Node ids, which are not phecodes. 270 is phecode 280 (Iron deficiency
// anemias); 271 is 280.1; 280 is Other hemoglobinopathies; 649 is PVD.
const ESRD = '905';
const ANEMIA_280 = '270';
const PVD = '649', HEMOGLOBINOPATHIES = '280';
const APOL1_SNP = 'rs73885319';           // APOL1 G1, p.S342G

const PANELS = [
  // --- Figure 3, renal_disease_v3 ----------------------------------------
  { id: 'fig3_a_network_eur_total', fig: 'renal_disease_v3', panel: 'a',
    page: 'page1', ancestry: 'eur', pvalue: '1e-04', edgeType: 'weight',
    select: 'End stage renal disease',
    shows: 'network view, EUR, p < 1e-4, total edge weight, ESRD selected' },
  { id: 'fig3_b_network_afr_total', fig: 'renal_disease_v3', panel: 'b',
    page: 'page1', ancestry: 'afr', pvalue: '1e-04', edgeType: 'weight',
    select: 'End stage renal disease',
    shows: 'network view, AFR, p < 1e-4, total edge weight, ESRD selected' },
  { id: 'fig3_c_network_eur_discordant', fig: 'renal_disease_v3', panel: 'c',
    page: 'page1', ancestry: 'eur', pvalue: '1e-04', edgeType: 'diff_dir_weight',
    select: 'End stage renal disease',
    shows: 'network view, EUR, p < 1e-4, discordant weight only, ESRD selected' },
  { id: 'fig3_d_network_afr_discordant', fig: 'renal_disease_v3', panel: 'd',
    page: 'page1', ancestry: 'afr', pvalue: '1e-04', edgeType: 'diff_dir_weight',
    select: 'End stage renal disease',
    shows: 'network view, AFR, p < 1e-4, discordant weight only, ESRD selected' },
  { id: 'fig3_e_node_afr_genes_apol1', fig: 'renal_disease_v3', panel: 'e',
    page: 'page2', node: ESRD, ancestry: 'afr', pvalue: '1e-04',
    geneLabels: 3, clickSnp: APOL1_SNP,
    shows: `node view, ESRD, AFR, p < 1e-4, gene labels on (k = 3), ${APOL1_SNP} (APOL1 G1) selected` },

  // --- anemias_v2, centred on phecode 280 --------------------------------
  { id: 'anemia_a_node_afr', fig: 'anemias_v2', panel: 'a',
    page: 'page2', node: ANEMIA_280, ancestry: 'afr', pvalue: '1e-04',
    shows: 'node view, phecode 280, AFR, p < 1e-4' },
  { id: 'anemia_b_afr_meta', fig: 'anemias_v2', panel: 'b',
    page: 'page2', node: ANEMIA_280, ancestry: 'afr', ancestry2: 'meta', pvalue: '1e-04',
    shows: 'node view, phecode 280, AFR-META comparison, p < 1e-4' },
  { id: 'anemia_c_eur_meta', fig: 'anemias_v2', panel: 'c',
    page: 'page2', node: ANEMIA_280, ancestry: 'eur', ancestry2: 'meta', pvalue: '1e-04',
    shows: 'node view, phecode 280, EUR-META comparison, p < 1e-4' },
  { id: 'anemia_d_afr_eur', fig: 'anemias_v2', panel: 'd',
    page: 'page2', node: ANEMIA_280, ancestry: 'afr', ancestry2: 'eur', pvalue: '1e-04',
    shows: 'node view, phecode 280, AFR-EUR comparison, p < 1e-4' },
  { id: 'anemia_e_pvd_eur_meta', fig: 'anemias_v2', panel: 'e',
    page: 'page3', left: ANEMIA_280, right: PVD, ancestry: 'eur', ancestry2: 'meta',
    pvalue: '1e-04',
    shows: 'edge view, phecode 280 - Peripheral vascular disease, EUR-META comparison' },
  { id: 'anemia_f_hb_afr_meta', fig: 'anemias_v2', panel: 'f',
    page: 'page3', left: ANEMIA_280, right: HEMOGLOBINOPATHIES, ancestry: 'afr',
    ancestry2: 'meta', pvalue: '1e-04',
    shows: 'edge view, phecode 280 - Other hemoglobinopathies, AFR-META comparison' }
];

// Figure 2 is a schematic the authors assemble; these are its sources, each
// cropped to the element so the current interface is what gets drawn.
const FIG2 = [
  { id: 'fig2_summary_panel_network', sel: '#summary-panel',
    page: 'page1', ancestry: 'eur', pvalue: '1e-04', edgeType: 'weight',
    select: 'End stage renal disease', shows: 'summary panel, network view' },
  { id: 'fig2_edge_type_labels', sel: '#edge-checkboxes',
    page: 'page1', ancestry: 'eur', pvalue: '1e-04', edgeType: 'weight',
    shows: 'concordant / discordant edge-type labels' },
  { id: 'fig2_reset_button', sel: '#reset-container',
    page: 'page1', ancestry: 'eur', pvalue: '1e-04', edgeType: 'weight',
    shows: 'reset button' },
  { id: 'fig2_related_phecode_toggle', sel: '#hierarchy-mask-container',
    page: 'page1', ancestry: 'eur', pvalue: '1e-04', edgeType: 'weight',
    shows: 'related-phecode toggle' },
  { id: 'fig2_summary_panel_node', sel: '#summary-panel',
    page: 'page2', node: ESRD, ancestry: 'afr', pvalue: '1e-04',
    shows: 'summary panel, node view, single ancestry' },
  { id: 'fig2_comparison_legend', sel: '#summary-panel',
    page: 'page2', node: ESRD, ancestry: 'afr', ancestry2: 'eur', pvalue: '1e-04',
    shows: 'updated comparison legend (same direction / opposite direction)' }
];

function url(p) {
  if (p.page === 'page1') return `${BASE}/`;
  const g = p.geneLabels ? `&geneLabels=1&geneLabelK=${p.geneLabels}` : '';
  if (p.page === 'page2')
    return `${BASE}/page2.html?ancestry=${p.ancestry}&pvalue=${p.pvalue}` +
           `&centerPheno=${p.node}${g}`;
  return `${BASE}/page3.html?ancestry=${p.ancestry}&pvalue=${p.pvalue}` +
         `&leftPheno=${p.left}&rightPheno=${p.right}${g}`;
}

/** Drive the view into the state the panel describes. */
async function setUp(page, p, errors) {
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
    if (p.edgeType && p.edgeType !== 'weight') {
      const ok = await page.evaluate(t => {
        const el = [...document.querySelectorAll('.edge-option')].find(x => x.value === t);
        if (!el) return false;
        el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, p.edgeType);
      if (!ok) errors.push(`edge type ${p.edgeType} not available`);
      await sleep(2500);
    }
    if (p.select) {
      await page.type('#node-search', p.select);
      await sleep(900);
      const ok = await page.evaluate(() => {
        const li = document.querySelector('#search-results li');
        if (!li) return false;
        li.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      });
      if (!ok) errors.push(`search found nothing for "${p.select}"`);
      await sleep(1800);
    }
  } else if (p.ancestry2) {
    const ok = await page.evaluate(s => {
      const el = [...document.querySelectorAll('.ancestry-option')].find(x => x.value === s);
      if (!el) return false;
      el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, p.ancestry2);
    if (!ok) errors.push(`second ancestry ${p.ancestry2} not available`);
    await sleep(8000);
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
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--window-size=${W},${H}`]
  });
  const manifest = [];

  const todo = ONLY === 'fig2' ? FIG2 : ONLY === 'panels' ? PANELS
                                      : [...PANELS, ...FIG2];
  for (const p of todo) {
    const page = await browser.newPage();
    page.on('dialog', d => d.dismiss());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: W, height: H, deviceScaleFactor: SCALE });
    await page.goto(url(p), { waitUntil: 'networkidle0', timeout: 300000 });
    await sleep(4000);
    await setUp(page, p, errors);

    const summary = await page.evaluate(() =>
      ((document.querySelector('#summary-panel') || {}).textContent || '')
        .replace(/\s+/g, ' ').trim());
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.gene-label-layer text')].map(t => t.textContent));

    const file = path.join(OUT, `${p.id}.png`);
    if (p.sel) {
      const el = await page.$(p.sel);
      if (!el) { errors.push(`element ${p.sel} not found`); await page.screenshot({ path: file }); }
      else await el.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file });
    }
    await page.close();

    manifest.push({ ...p, file: path.basename(file), screen_summary: summary,
                    gene_labels_drawn: labels, rank_metric: process.env.RANK_METRIC || 'pval',
                    viewport: `${W}x${H} @${SCALE}x`, errors });
    console.log(`${p.id.padEnd(34)} ${summary.slice(0, 70)}` +
                `${errors.length ? '   ERRORS: ' + errors.join('; ') : ''}`);
  }

  await browser.close();
  // merge into the manifest rather than replacing it, so re-shooting one
  // group does not drop the settings recorded for the others
  const mf = path.join(OUT, 'manifest.json');
  let all = [];
  if (fs.existsSync(mf)) all = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const byId = new Map(all.map(m => [m.id, m]));
  for (const m of manifest) byId.set(m.id, m);
  fs.writeFileSync(mf, JSON.stringify([...byId.values()], null, 1));
  const bad = manifest.filter(m => m.errors.length);
  console.log(`\nwrote ${manifest.length} panels + manifest.json to ${OUT}`);
  if (bad.length) console.log(`${bad.length} with errors: ${bad.map(b => b.id).join(', ')}`);
})().catch(e => { console.error(e); process.exit(1); });
