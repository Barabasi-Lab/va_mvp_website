#!/usr/bin/env node
/**
 * Behaviour checks for the hierarchy-mask toggle (Part B, B1).
 *
 * The three things the spec asks for that the unit tests cannot see: the
 * toggle is off until asked for, its state survives opening the node view in
 * a new tab, and the edge view still works with the state riding along.
 *
 *   node scripts/test_toggle_state.js [baseUrl]
 *
 * Needs a dev server and puppeteer-core; CHROME_PATH picks the browser.
 */
const puppeteer = require('puppeteer-core');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const ESRD = '905';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};
const phenotypes = txt => {
  const m = /Phenotypes\s*([\d,]+)/.exec(txt.replace(/\s+/g, ' '));
  return m ? Number(m[1].replace(/,/g, '')) : null;
};
const summary = page => page.evaluate(
  () => ((document.querySelector('#summary-panel') || {}).textContent || ''));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  // --- off by default, on both pages ------------------------------------
  for (const [label, url] of [
    ['network view', `${BASE}/`],
    ['node view', `${BASE}/page2.html?ancestry=meta&pvalue=1e-04&centerPheno=${ESRD}`]
  ]) {
    const page = await browser.newPage();
    page.on('dialog', d => d.dismiss());
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
    await sleep(2500);
    const el = await page.$('#hierarchy-mask');
    check(`${label}: control present`, !!el);
    check(`${label}: off by default`,
      await page.evaluate(() => document.querySelector('#hierarchy-mask').checked) === false);
    await page.close();
  }

  // --- state survives opening the node view in a new tab ----------------
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss());
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 120000 });
  await sleep(2500);
  await page.evaluate(() => {
    const b = document.querySelector('#close-welcome');
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.click('#hierarchy-mask');
  await sleep(1500);

  const popupPromise = new Promise(res => browser.once('targetcreated', t => res(t.page())));
  await page.type('#node-search', 'End stage renal');
  await sleep(700);
  await page.evaluate(() => {
    const li = document.querySelector('#search-results li');
    if (li) li.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(1200);
  await page.evaluate(id => {
    const c = [...document.querySelectorAll('circle.node')]
      .find(c => c.__data__ && c.__data__.id === id);
    c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }, ESRD);
  const popup = await popupPromise;
  check('double-click opens the node view', !!popup);
  if (popup) {
    await popup.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 })
      .catch(() => {});
    await sleep(3000);
    check('mask=1 travels in the query string', popup.url().includes('mask=1'),
      popup.url().split('?')[1] || '');
    check('node view opens with the toggle already on',
      await popup.evaluate(() => {
        const e = document.querySelector('#hierarchy-mask');
        return e ? e.checked : null;
      }) === true);
    // and it is applied, not merely checked: META drops 905 from 111 outer
    // phenotypes to 104 under T1+T2
    const masked = phenotypes(await summary(popup));
    const plain = await browser.newPage();
    await plain.goto(
      `${BASE}/page2.html?ancestry=meta&pvalue=1e-04&centerPheno=${ESRD}`,
      { waitUntil: 'networkidle0', timeout: 120000 });
    await sleep(3000);
    const unmasked = phenotypes(await summary(plain));
    await plain.close();
    check('the carried state is applied, not just checked',
      masked !== null && unmasked !== null && masked < unmasked,
      `${unmasked} -> ${masked} outer phenotypes`);
    await popup.close();
  }
  await page.close();

  // --- the edge view is out of scope but must not break -----------------
  const p3 = await browser.newPage();
  const errors = [];
  p3.on('pageerror', e => errors.push(e.message));
  p3.on('dialog', d => d.dismiss());
  await p3.goto(
    `${BASE}/page3.html?ancestry=eur&pvalue=1e-04&leftPheno=905&rightPheno=903&mask=1`,
    { waitUntil: 'networkidle0', timeout: 120000 });
  await sleep(3000);
  const circles = await p3.evaluate(() => document.querySelectorAll('circle').length);
  check('edge view still renders with mask=1 in the url',
    circles > 0 && errors.length === 0,
    `${circles} circles, ${errors.length} page errors ${errors.slice(0, 1)}`);
  check('edge view has no toggle, as specified', !(await p3.$('#hierarchy-mask')));
  await p3.close();

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
