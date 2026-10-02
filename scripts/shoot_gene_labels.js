#!/usr/bin/env node
/**
 * Readability of the Stage 2 group labels (3.4).
 *
 * The views the task names, at each candidate k, with the counts that
 * decide whether a k is usable: groups found, labels drawn, labels hidden
 * by collision, and the share of displayed SNPs a drawn label covers.
 *
 *   node scripts/shoot_gene_labels.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const OUT = path.join(__dirname, '..', 'analysis', 'examples', 'results', 'gene_label_shots');
const KS = [2, 3, 5];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const VIEWS = [
  { id: 'p2_esrd_afr', label: 'page 2 — ESRD, AFR',
    url: '/page2.html?ancestry=afr&pvalue=1e-04&centerPheno=905' },
  { id: 'p2_esrd_eur', label: 'page 2 — ESRD, EUR',
    url: '/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=905' },
  { id: 'p2_anemia_afr', label: 'page 2 — 280.1, AFR',
    url: '/page2.html?ancestry=afr&pvalue=1e-04&centerPheno=271' },
  { id: 'p2_obesity_meta', label: 'page 2 — Obesity, META',
    url: '/page2.html?ancestry=meta&pvalue=1e-04&centerPheno=264' },
  { id: 'p3_esrd_heaviest_afr', label: 'page 3 — ESRD vs 588 (heaviest AFR edge)',
    url: '/page3.html?ancestry=afr&pvalue=1e-04&leftPheno=905&rightPheno=913' }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const rows = [];
  for (const v of VIEWS) {
    for (const k of KS) {
      const page = await browser.newPage();
      page.on('dialog', d => d.dismiss());
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width: 1800, height: 1150, deviceScaleFactor: 2 });
      await page.goto(`${BASE}${v.url}&geneLabels=1&geneLabelK=${k}`,
                      { waitUntil: 'networkidle0', timeout: 180000 });
      await sleep(4500);
      const d = await page.evaluate(() => ({
        stats: window.GeneLabels.lastStats,
        labels: [...document.querySelectorAll('.gene-label-layer text')].map(t => t.textContent)
      }));
      const file = `${v.id}_k${k}.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      await page.close();
      const s = d.stats || { groups: 0, drawn: 0, hidden: 0, snpsCovered: 0, snpsTotal: 0 };
      rows.push({ view: v.label, k, file, ...s, labels: d.labels, errors });
      console.log(`${v.label.padEnd(42)} k=${k}  groups ${String(s.groups).padStart(3)}  ` +
        `drawn ${String(s.drawn).padStart(3)}  hidden ${String(s.hidden).padStart(3)}  ` +
        `covered ${s.snpsCovered}/${s.snpsTotal} ` +
        `(${s.snpsTotal ? (100 * s.snpsCovered / s.snpsTotal).toFixed(0) : 0}%)` +
        (errors.length ? `  ERR ${errors[0]}` : ''));
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'readability.json'), JSON.stringify(rows, null, 1));
  console.log(`\nwrote ${rows.length} panels + readability.json`);
})().catch(e => { console.error(e); process.exit(1); });
