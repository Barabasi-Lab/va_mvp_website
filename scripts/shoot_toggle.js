#!/usr/bin/env node
/**
 * Use-case screenshots for the hierarchy-mask toggle (Part B, B4.4).
 *
 * ESRD (585.32, node 905) in AFR and EUR, network view and node view, with
 * the toggle off and on, for each candidate tier set. The counts printed
 * next to each pair are what the report checks against the A3 numbers.
 *
 *   node scripts/shoot_toggle.js [--base http://localhost:3000]
 *
 * Needs puppeteer-core and CHROME_PATH.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:3000');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const OUT = path.join(__dirname, '..', 'analysis', 'phecode_redundancy',
                      'results', 'screenshots');
const NODE = '905';
const LABEL = 'End stage renal disease';
const TIER_SETS = ['T1', 'T1,T2', 'T1,T2,T4'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const summary = page => page.evaluate(
  () => (document.querySelector('#summary-panel') || {}).textContent
        ? document.querySelector('#summary-panel').textContent
            .replace(/\s+/g, ' ').trim()
        : '(no summary)');

async function shoot(browser, url, name, prepare) {
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  await sleep(2500);
  // the welcome modal covers the middle of the network view
  await page.evaluate(() => {
    const b = document.querySelector('#close-welcome');
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(400);
  if (prepare) await prepare(page);
  const before = await summary(page);
  await page.screenshot({ path: path.join(OUT, `${name}_off.png`) });

  const has = await page.$('#hierarchy-mask');
  let after = '(no control)';
  if (has) {
    await page.click('#hierarchy-mask');
    await sleep(2000);
    after = await summary(page);
    await page.screenshot({ path: path.join(OUT, `${name}_on.png`) });
  }
  await page.close();
  return { name, before, after, errors };
}

// Page 1 draws edges only for the selected phenotype, so the screenshot is
// worthless until ESRD is selected. The search box is how a reader would do
// it, so the shot matches what they would see.
async function selectEsrd(page) {
  await page.type('#node-search', LABEL.slice(0, 20));
  await sleep(600);
  await page.evaluate(() => {
    const li = document.querySelector('#search-results li');
    if (li) li.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(1200);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const log = [];
  for (const tiers of TIER_SETS) {
    const slug = tiers.replace(/,/g, '');
    for (const anc of ['afr', 'eur']) {
      log.push(await shoot(browser,
        `${BASE}/?maskTiers=${tiers}`,
        `page1_esrd_${anc}_${slug}`,
        async page => {
          await page.evaluate(a => document.querySelector('#chk-' + a)
            .dispatchEvent(new Event('change', { bubbles: true })), anc);
          await sleep(1800);
          await selectEsrd(page);
        }));
      log.push(await shoot(browser,
        `${BASE}/page2.html?ancestry=${anc}&pvalue=1e-04&centerPheno=${NODE}` +
        `&maskTiers=${tiers}`,
        `page2_esrd_${anc}_${slug}`));
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'counts.json'), JSON.stringify(log, null, 2));
  for (const r of log) {
    console.log(`\n${r.name}`);
    console.log('  off:', r.before);
    console.log('  on :', r.after);
    if (r.errors.length) console.log('  ERRORS:', r.errors.slice(0, 2));
  }
  console.log(`\nwrote ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
