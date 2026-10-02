#!/usr/bin/env node
/**
 * The phenotype view's SNP rule.
 *
 * A SNP is drawn only if one of its surviving links reaches the centre
 * phenotype, and SNPs that also reach an outer phenotype take the 150 slots
 * first. Neither half is visible to validate_pages.js, which runs the served
 * and legacy rows through the same client code and compares the two
 * renderings - a change to the rule moves both sides together.
 *
 *   node scripts/test_page2_snp_rule.js [baseUrl]
 *
 * Needs a dev server and puppeteer-core; CHROME_PATH picks the browser.
 */
const puppeteer = require('puppeteer-core');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const TOP_SNPS = 150;                       // must match server.js
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

// node, first ancestry, second ancestry, what the store says qualifies
// (tier1 = also reaches an outer phenotype, tier2 = centre only), measured
// from the association store at p < 1e-4 - see the commit message.
const CASES = [
  { name: 'ESRD afr+eur', node: '905', a1: 'afr', a2: 'eur', tier1: 7, tier2: 7 },
  { name: 'ESRD afr', node: '905', a1: 'afr', a2: null, tier1: 575, tier2: 138 },
  { name: 'Type 2 diabetes eur+afr', node: '181', a1: 'eur', a2: 'afr', tier1: 3873, tier2: 212 },
  { name: 'Hyperlipidemia eur+meta', node: '739', a1: 'eur', a2: 'meta', tier1: 2506, tier2: 243 }
];

async function draw(browser, { node, a1, a2 }) {
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${BASE}/page2.html?ancestry=${a1}&pvalue=1e-04&centerPheno=${node}`,
    { waitUntil: 'networkidle0', timeout: 120000 });
  await sleep(3000);
  if (a2) {
    await page.evaluate(s => {
      const c = [...document.querySelectorAll('.ancestry-option')].find(x => x.value === s);
      c.checked = true;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    }, a2);
    await sleep(6000);
  }
  const out = await page.evaluate(id => {
    const lines = [...document.querySelectorAll('line')].filter(l => l.__data__);
    const snps = [...document.querySelectorAll('circle')]
      .filter(c => c.__data__ && String(c.__data__.id).startsWith('rs'))
      .map(c => c.__data__.id);
    const reachCentre = new Set();
    const outerDegree = new Map();
    for (const l of lines) {
      const s = l.__data__.source && l.__data__.source.id;
      const t = l.__data__.target && l.__data__.target.id;
      if (s === id && String(t).startsWith('rs')) reachCentre.add(t);
      else if (t === id && String(s).startsWith('rs')) reachCentre.add(s);
      else {
        const snp = String(s).startsWith('rs') ? s : String(t).startsWith('rs') ? t : null;
        if (snp) outerDegree.set(snp, (outerDegree.get(snp) || 0) + 1);
      }
    }
    return {
      snps,
      orphans: snps.filter(r => !reachCentre.has(r)),
      centreOnly: snps.filter(r => !outerDegree.has(r))
    };
  }, node);
  await page.close();
  return { ...out, errors };
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  for (const c of CASES) {
    const d = await draw(browser, c);
    const expected = Math.min(TOP_SNPS, c.tier1 + c.tier2);

    check(`${c.name}: every SNP drawn reaches the centre`,
      d.orphans.length === 0, `${d.orphans.length} orphan(s) of ${d.snps.length}`);
    check(`${c.name}: ${expected} SNPs drawn`,
      d.snps.length === expected, `got ${d.snps.length}`);

    if (c.tier1 >= TOP_SNPS) {
      // the cap is filled by SNPs that reach an outer phenotype, so a
      // centre-only SNP must not have taken a slot
      check(`${c.name}: cap full, no centre-only SNP shown`,
        d.centreOnly.length === 0, `${d.centreOnly.length} shown`);
    } else {
      // room to spare, so the centre-only SNPs appear - this is the case
      // that used to hide the APOL1 variants on ESRD
      check(`${c.name}: room to spare, all ${c.tier2} centre-only SNPs shown`,
        d.centreOnly.length === c.tier2, `${d.centreOnly.length} shown`);
    }
    check(`${c.name}: no page errors`, d.errors.length === 0, d.errors.slice(0, 1).join(''));
  }

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
