#!/usr/bin/env node
/**
 * Part 3.2.3 checks on merged main: the hierarchy-mask toggle and the gene
 * labels have to work together, and the three pages have to load clean for
 * the phenotypes the manuscript uses.
 *
 *   node scripts/test_merged_323.js [baseUrl]
 *
 * Needs a dev server and puppeteer-core; CHROME_PATH picks the browser.
 */
const puppeteer = require('puppeteer-core');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

// ESRD, anemia (phecode 280, not the 280.1 child), Obesity
const PHENOS = [['ESRD', '905'], ['phecode 280', '270'], ['Obesity', '264']];

async function open(browser, url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !/favicon\.ico/.test(m.text()) &&
        !/Failed to load resource/.test(m.text()))
      errors.push(`console: ${m.text()}`);
  });
  // Chromium asks for /favicon.ico on the first page of a session and the
  // site ships none; it is the browser's request, not the app's.
  page.on('response', r => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico'))
      errors.push(`http ${r.status()}: ${r.url()}`);
  });
  page.on('requestfailed', r => {
    if (!r.url().endsWith('/favicon.ico'))
      errors.push(`request failed: ${r.url()} ${(r.failure() || {}).errorText}`);
  });
  page.on('dialog', d => d.dismiss());
  await page.setViewport({ width: 1800, height: 1150 });
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0', timeout: 180000 });
  await sleep(4000);
  return { page, errors };
}

const labelsOf = page => page.evaluate(() => ({
  labels: [...document.querySelectorAll('.gene-label-layer text')]
    .map(t => t.textContent).sort(),
  stats: window.GeneLabels ? window.GeneLabels.lastStats : null,
  // page 2 binds the node data straight onto the circles, with no class
  snps: [...document.querySelectorAll('svg circle')]
    .map(c => c.__data__ && c.__data__.id)
    .filter(id => id && id.startsWith('rs')).sort()
}));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // --- 1. toggle and gene labels together, ESRD in AFR ------------------
  const base = '/page2.html?ancestry=afr&pvalue=1e-04&centerPheno=905&geneLabels=1&geneLabelK=3';
  const a = await open(browser, base);
  const plain = await labelsOf(a.page);
  await a.page.close();
  const b = await open(browser, `${base}&mask=1`);
  const masked = await labelsOf(b.page);
  await b.page.close();

  const same = JSON.stringify(plain.labels) === JSON.stringify(masked.labels);
  check('ESRD/AFR: gene brackets unchanged when related phecodes are hidden',
    same, same ? `${plain.labels.length} labels, identical`
               : `off: [${plain.labels}]  on: [${masked.labels}]`);
  check('ESRD/AFR: the displayed SNP set is unchanged too',
    JSON.stringify(plain.snps) === JSON.stringify(masked.snps),
    `${plain.snps.length} vs ${masked.snps.length} SNPs`);
  check('ESRD/AFR: labels are actually drawn with the mask on',
    masked.labels.length > 0, `${masked.labels.length} drawn`);
  check('ESRD/AFR: no errors in either state',
    a.errors.length === 0 && b.errors.length === 0,
    [...a.errors, ...b.errors].join(' | '));

  // --- 2. pages 1-3 load clean for the three phenotypes -----------------
  const views = [['page 1', '/']];
  for (const [name, id] of PHENOS) {
    for (const anc of ['meta', 'eur', 'afr']) {
      views.push([`page 2 ${name} ${anc}`,
        `/page2.html?ancestry=${anc}&pvalue=1e-04&centerPheno=${id}&geneLabels=1`]);
    }
  }
  // one edge view per phenotype, paired with its heaviest partner
  views.push(['page 3 ESRD vs 913 afr',
    '/page3.html?ancestry=afr&pvalue=1e-04&leftPheno=905&rightPheno=913&geneLabels=1']);
  views.push(['page 3 280 vs 280.1 meta',
    '/page3.html?ancestry=meta&pvalue=1e-04&leftPheno=270&rightPheno=271&geneLabels=1']);
  views.push(['page 3 Obesity vs 272 meta',
    '/page3.html?ancestry=meta&pvalue=1e-04&leftPheno=264&rightPheno=272&geneLabels=1']);

  for (const [name, url] of views) {
    const v = await open(browser, url);
    const drew = await v.page.evaluate(
      () => document.querySelectorAll('circle').length);
    await v.page.close();
    check(`${name}: clean load`, v.errors.length === 0 && drew > 0,
      v.errors.length ? v.errors.slice(0, 3).join(' | ') : `${drew} circles`);
  }

  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL OK');
  process.exit(failed ? 1 : 0);
})();
