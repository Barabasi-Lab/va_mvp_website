#!/usr/bin/env node
/**
 * Edge colour and direction on pages 2 and 3.
 *
 * Single ancestry: cyan for a positive beta, red for negative.
 * Two ancestries: green where the two agree in sign, orange where they do
 * not. Nothing else should ever be drawn, one line per (SNP, phenotype).
 *
 * The last clause is the one that was broken. Duplicated rows drew a pair on
 * top of each other, and because the comparison join keeps the last row for
 * a (source, target) key, one line could be built from one row's beta and
 * another row's second-ancestry beta - producing an orange edge for a pair
 * that is consistent in every row the store holds.
 *
 *   node scripts/test_edge_colours.js [baseUrl]
 *
 * Needs a dev server and puppeteer-core; CHROME_PATH picks the browser.
 */
const puppeteer = require('puppeteer-core');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const SINGLE = { pos: '#16faef', neg: '#fc0339' };
const COMPARE = { consistent: '#32CD32', inconsistent: '#CC5500' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

// Counts come from the store; see the commit message for the queries.
const CASES = [
  { name: 'page2 ESRD afr+eur', url: '/page2.html?ancestry=afr&pvalue=1e-04&centerPheno=905',
    second: 'eur', palette: COMPARE,
    // all 14 shared SNPs agree in sign, so nothing may be orange
    wantInconsistent: 0 },
  { name: 'page2 node 150 afr+eur', url: '/page2.html?ancestry=afr&pvalue=1e-04&centerPheno=150',
    second: 'eur', palette: COMPARE, wantInconsistent: 'some' },
  { name: 'page2 node 175 eas+eur', url: '/page2.html?ancestry=eas&pvalue=1e-04&centerPheno=175',
    second: 'eur', palette: COMPARE, wantInconsistent: 'some' },
  { name: 'page2 Sarcoidosis eur only', url: '/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=1052',
    second: null, palette: SINGLE, wantInconsistent: 'some' },
  { name: 'page3 150-149 afr+eur',
    url: '/page3.html?ancestry=afr&pvalue=1e-04&leftPheno=150&rightPheno=149',
    second: 'eur', palette: COMPARE, wantInconsistent: 'some' },
  { name: 'page3 230-229 eur only',
    url: '/page3.html?ancestry=eur&pvalue=1e-04&leftPheno=230&rightPheno=229',
    second: null, palette: SINGLE, wantInconsistent: 'some' }
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  for (const c of CASES) {
    const page = await browser.newPage();
    page.on('dialog', d => d.dismiss());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(BASE + c.url, { waitUntil: 'networkidle0', timeout: 120000 });
    await sleep(3500);
    if (c.second) {
      await page.evaluate(s => {
        const el = [...document.querySelectorAll('.ancestry-option')].find(x => x.value === s);
        if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, c.second);
      await sleep(7000);
    }
    const d = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('line')].filter(l => l.__data__);
      const colours = {};
      const pairs = new Map();
      let mismatched = 0;
      for (const l of lines) {
        const stroke = l.getAttribute('stroke');
        colours[stroke] = (colours[stroke] || 0) + 1;
        const s = l.__data__.source && l.__data__.source.id;
        const t = l.__data__.target && l.__data__.target.id;
        pairs.set(`${s}|${t}`, (pairs.get(`${s}|${t}`) || 0) + 1);
        // the colour must follow the sign that the data carries
        const wantNeg = l.__data__.direction < 0;
        if (wantNeg !== (stroke !== '#32CD32' && stroke !== '#16faef')) mismatched++;
      }
      return { colours, mismatched, lines: lines.length,
               duplicated: [...pairs.values()].filter(v => v > 1).length };
    });
    await page.close();

    const palette = Object.values(c.palette);
    const used = Object.keys(d.colours);
    check(`${c.name}: only the palette's two colours are used`,
      used.every(x => palette.includes(x)), used.join(' '));
    check(`${c.name}: colour follows the sign on every line`,
      d.mismatched === 0, `${d.mismatched} of ${d.lines}`);
    check(`${c.name}: one line per (SNP, phenotype)`,
      d.duplicated === 0, `${d.duplicated} duplicated pair(s)`);
    const negKey = c.palette === COMPARE ? COMPARE.inconsistent : SINGLE.neg;
    const neg = d.colours[negKey] || 0;
    if (c.wantInconsistent === 0) {
      check(`${c.name}: no ${c.palette === COMPARE ? 'inconsistent' : 'negative'} edge drawn`,
        neg === 0, `${neg} drawn`);
    } else {
      check(`${c.name}: the other colour does render`, neg > 0, `${neg} drawn`);
    }
    check(`${c.name}: no page errors`, errors.length === 0, errors.slice(0, 1).join(''));
  }

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
