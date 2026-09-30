/**
 * Browser smoke test for the three pages.
 *
 * The data validators check what the endpoints return; this checks what the
 * pages actually draw and where they put it. Mostly layout regressions, which
 * are easy to cause and invisible to the other suites.
 *
 * Needs a dev server on localhost:3000 and puppeteer-core:
 *   npm install --no-save puppeteer-core
 *   node scripts/validate_ui.js [baseUrl]
 */
const puppeteer = require('puppeteer-core');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const P2 = '/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=739';
const P3 = '/page3.html?ancestry=eur&pvalue=1e-04&leftPheno=739&rightPheno=741';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = '') => {
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

async function open(browser, url, w = 1600, h = 1000) {
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss());
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('404')) page.__errors.push(m.text());
  });
  await page.setViewport({ width: w, height: h });
  await page.evaluateOnNewDocument(() => localStorage.setItem('welcomeDismissed', 'true'));
  await page.goto(BASE + url, { waitUntil: 'networkidle0', timeout: 180000 });
  await sleep(2600);
  return page;
}

// Nothing in the left column, the readout, the About panel or the hover label
// may overlap anything else, and none may leave the window.
const layout = page => page.evaluate(() => {
  const rect = id => {
    const el = document.getElementById(id);
    return el && el.offsetHeight ? el.getBoundingClientRect() : null;
  };
  const stack = document.getElementById('left-stack');
  const kids = stack ? [...stack.children].map(c => ({
    id: c.id || (c.textContent || '').trim().slice(0, 22).replace(/\s+/g, ' '),
    top: c.getBoundingClientRect().top, bottom: c.getBoundingClientRect().bottom
  })) : [];
  const label = document.querySelector('text.label');
  let widest = null;
  for (const t of document.querySelectorAll('text.label')) {
    const b = t.getBBox();
    if (!widest || b.width > widest.width) {
      widest = { width: b.width, left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
    }
  }
  const hit = (a, o) => o && !(a.right < o.left || a.left > o.right || a.bottom < o.top || a.top > o.bottom);
  return {
    order: kids.map(k => k.id),
    kidOverlap: kids.some((k, i) => i < kids.length - 1 && k.bottom > kids[i + 1].top + 1),
    stackClearsReadout: !stack || !rect('bottom-left-stack') ||
      stack.getBoundingClientRect().bottom <= rect('bottom-left-stack').top + 1,
    labelClear: !widest || (!hit(widest, rect('left-stack')) &&
      !hit(widest, rect('bottom-left-stack')) && !hit(widest, rect('info-container')) &&
      widest.right <= window.innerWidth && widest.bottom <= window.innerHeight),
    hasLabel: !!label,
    pageScroll: Math.max(document.documentElement.scrollWidth - window.innerWidth,
                         document.documentElement.scrollHeight - window.innerHeight)
  };
});

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  // --- titles
  for (const [url, want] of [['/index.html', 'MVPheWAS Explorer'],
                             [P2, 'Phenotype view'], [P3, 'SNP view']]) {
    const p = await open(browser, url);
    check(`title of ${url.split('?')[0]}`, (await p.title()) === want, await p.title());
    await p.close();
  }

  // --- layout across window sizes
  for (const [name, url, wantReset] of [['page1', '/index.html', true],
                                        ['page2', P2, true], ['page3', P3, false]]) {
    for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1152, 560]]) {
      const p = await open(browser, url, w, h);
      const r = await layout(p);
      const si = r.order.findIndex(x => /search/i.test(x));
      const ri = r.order.findIndex(x => /reset/i.test(x));
      const orderOk = wantReset
        ? si === r.order.length - 2 && ri === r.order.length - 1
        : si === r.order.length - 1;
      check(`${name} ${w}x${h} layout`,
            !r.kidOverlap && r.stackClearsReadout && r.labelClear && r.pageScroll <= 0 && orderOk,
            (r.kidOverlap ? 'PANELS-OVERLAP ' : '') +
            (!r.stackClearsReadout ? 'HITS-READOUT ' : '') +
            (!r.labelClear ? 'LABEL-COLLIDES ' : '') +
            (r.pageScroll > 0 ? `SCROLL-${r.pageScroll}px ` : '') +
            (!orderOk ? `ORDER[${r.order.join('|')}]` : ''));
      if (p.__errors.length) check(`${name} ${w}x${h} console clean`, false, p.__errors[0]);
      await p.close();
    }
  }

  // --- About panels fit and use real paragraphs
  for (const [name, url, btn] of [['page1', '/index.html', 'About the network'],
                                  ['page2', P2, 'About Phenotype View'],
                                  ['page3', P3, 'About SNP View']]) {
    for (const [w, h] of [[1600, 1000], [900, 600], [700, 500]]) {
      const p = await open(browser, url, w, h);
      const r = await p.evaluate(label => {
        [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label).click();
        const el = document.querySelector('.about-panel');
        const b = el.getBoundingClientRect();
        return { l: b.left, r: b.right, t: b.top, bo: b.bottom,
                 vw: window.innerWidth, vh: window.innerHeight,
                 brs: el.querySelectorAll('br').length, ps: el.querySelectorAll('p').length,
                 scroll: document.documentElement.scrollWidth - window.innerWidth };
      }, btn);
      check(`${name} ${w}x${h} about panel`,
            r.l >= 0 && r.r <= r.vw + 1 && r.t >= 0 && r.bo <= r.vh + 1 && r.scroll <= 0 &&
            r.brs === 0 && r.ps >= 3,
            `${Math.round(r.l)}..${Math.round(r.r)} of ${r.vw}, ${r.ps} paragraphs, ${r.brs} <br>`);
      await p.close();
    }
  }

  // --- page 1 interactions
  {
    const p = await open(browser, '/index.html');
    const sel = await p.evaluate(() => {
      window.open = () => {};
      const circles = [...document.querySelectorAll('circle.node')];
      const big = circles.reduce((a, b) => (+b.getAttribute('r') > +a.getAttribute('r') ? b : a));
      big.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const r = new Map(circles.map(c => [window.d3.select(c).datum().id, +c.getAttribute('r')]));
      let overshoot = 0;
      for (const l of document.querySelectorAll('line.link')) {
        const d = window.d3.select(l).datum();
        const cap = 2 * Math.min(r.get(d.source) ?? Infinity, r.get(d.target) ?? Infinity);
        overshoot = Math.max(overshoot, +l.getAttribute('stroke-width') - cap);
      }
      const before = document.querySelector('g').getAttribute('transform');
      big.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 400 }));
      return { edges: document.querySelectorAll('line.link').length, overshoot,
               zoomed: before !== document.querySelector('g').getAttribute('transform'),
               summary: document.getElementById('summary-panel').innerText };
    });
    check('page1 click draws edges', sel.edges > 0, `${sel.edges} edges`);
    check('page1 edge width <= smaller node', sel.overshoot <= 1e-9, `overshoot ${sel.overshoot.toFixed(3)}px`);
    check('page1 double-click does not zoom', !sel.zoomed);
    check('page1 summary + terminology',
          /Selected/.test(sel.summary) && /concordant/.test(sel.summary) && /discordant/.test(sel.summary));
    await p.evaluate(() => document.getElementById('reset-view').click());
    await sleep(700);
    const after = await p.evaluate(() => ({
      edges: document.querySelectorAll('line.link').length,
      summary: document.getElementById('summary-panel').innerText }));
    check('page1 reset clears', after.edges === 0 && !/Selected/.test(after.summary));
    if (p.__errors.length) check('page1 console clean', false, p.__errors[0]);
    await p.close();
  }

  // --- page 1: the degree filter and the counts must track every filter
  {
    const readPanel = p => p.evaluate(() => {
      const rows = {};
      for (const d of document.querySelectorAll('#summary-panel > div')) {
        const sp = d.querySelectorAll('span');
        if (sp.length === 2) rows[sp[0].textContent.trim()] = +sp[1].textContent.replace(/,/g, '');
      }
      return { phenos: rows['Phenotypes'], assoc: rows['Associations'],
               lit: [...document.querySelectorAll('circle.node')]
                      .filter(c => +getComputedStyle(c).opacity > 0.9).length,
               sliderMax: +document.getElementById('degree-slider').max };
    });

    // recomputed from the API, independently of what the page did
    const expected = async (anc, pv, thresh, type) => {
      const d = await fetch(`${BASE}/api/landing/edges?ancestry=${anc}&pvalue=${pv}`).then(r => r.json());
      const present = e => type === 'diff' ? e.diff !== 0
                         : type === 'same' ? e.same !== 0
                         : e.same !== 0 || e.diff !== 0;
      const deg = {};
      for (const e of d.edges) {
        deg[e.source] = deg[e.source] || 0;
        deg[e.target] = deg[e.target] || 0;
        if (present(e)) { deg[e.source]++; deg[e.target]++; }
      }
      const min = Math.max(1, thresh);
      const keep = new Set(Object.keys(deg).filter(k => deg[k] >= min));
      return { phenos: keep.size,
               assoc: d.edges.filter(e => present(e) && keep.has(e.source) && keep.has(e.target)).length,
               maxDeg: Math.max(1, ...Object.values(deg)) };
    };

    const p = await open(browser, '/index.html');
    const compare = async (label, anc, pv, thresh, type) => {
      const got = await readPanel(p);
      const want = await expected(anc, pv, thresh, type);
      check(`page1 degree binding: ${label}`,
            got.phenos === want.phenos && got.assoc === want.assoc &&
            got.lit === want.phenos && got.sliderMax === want.maxDeg,
            `${got.phenos}ph/${got.assoc}as lit ${got.lit} max ${got.sliderMax} ` +
            `| want ${want.phenos}/${want.assoc} max ${want.maxDeg}`);
    };

    await compare('meta 1e-04', 'meta', '1e-04', 0, 'weight');

    await p.evaluate(() => { const s = document.getElementById('pvalue-slider');
      s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(900);
    await compare('meta 1e-12', 'meta', '1e-12', 0, 'weight');

    await p.evaluate(() => { const s = document.getElementById('pvalue-slider');
      s.value = 8; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(900);
    await p.evaluate(() => { const c = document.getElementById('chk-eas');
      c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(1200);
    await compare('eas 1e-04 (isolates dropped)', 'eas', '1e-04', 0, 'weight');

    await p.evaluate(() => { const c = document.getElementById('chk-meta');
      c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(1200);
    for (const t of [2, 50]) {
      await p.evaluate(v => { const s = document.getElementById('degree-input');
        s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); }, t);
      await sleep(700);
      await compare(`degree >= ${t}`, 'meta', '1e-04', t, 'weight');
    }
    await p.evaluate(() => { const s = document.getElementById('degree-input');
      s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(700);

    await p.evaluate(() => { const e = document.getElementById('chk-diff');
      e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(900);
    await compare('discordant only', 'meta', '1e-04', 0, 'diff');

    if (p.__errors.length) check('page1 degree console clean', false, p.__errors[0]);
    await p.close();
  }

  // --- page 2: cap fills, warning, context menu, comparison controls
  for (const [node, name] of [['708', 'Asthma'], ['375', 'Obstructive sleep apnea']]) {
    const p = await open(browser, `/page2.html?ancestry=meta&pvalue=1e-04&centerPheno=${node}`);
    const r = await p.evaluate(centre => {
      const snps = [...document.querySelectorAll('circle')]
        .filter(c => { const d = window.d3.select(c).datum(); return d && d.id && d.id.startsWith('rs'); }).length;
      const cs = [...document.querySelectorAll('circle')];
      const big = cs.reduce((a, b) => (+b.getAttribute('r') > +a.getAttribute('r') ? b : a));
      big.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const onCentre = document.querySelectorAll('.context-menu').length;
      document.querySelectorAll('.context-menu').forEach(m => m.remove());
      const other = cs.find(c => {
        const d = window.d3.select(c).datum();
        return d && !d.id.startsWith('rs') && d.id !== centre;
      });
      if (other) other.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const onOther = document.querySelectorAll('.context-menu').length;
      document.querySelectorAll('.context-menu').forEach(m => m.remove());
      return { snps, onCentre, onOther,
               warn: document.getElementById('snp-warning').textContent,
               radios: [...document.querySelectorAll('.beta-source')].filter(x => !x.disabled).length };
    }, node);
    check(`page2 ${name} fills the cap`, r.snps === 150, `${r.snps} SNPs`);
    check(`page2 ${name} warning wording`, /exceeds the maximum/.test(r.warn) && /150 SNPs/.test(r.warn));
    check(`page2 ${name} edge view withheld on centre`, r.onCentre === 0 && r.onOther === 1,
          `centre ${r.onCentre}, other ${r.onOther}`);
    check(`page2 ${name} thickness radios off until comparison`, r.radios === 0);
    if (p.__errors.length) check(`page2 ${name} console clean`, false, p.__errors[0]);
    await p.close();
  }

  // --- page 3
  {
    const p = await open(browser, P3);
    const r = await p.evaluate(() => ({
      summary: document.getElementById('summary-panel').innerText,
      warn: document.getElementById('snp-warning').textContent,
      snps: [...document.querySelectorAll('circle')].length - 2 }));
    check('page3 summary wording', /SNPs in this edge/.test(r.summary) && !/Shared SNPs/.test(r.summary));
    check('page3 cap warning says 250', /250 SNPs/.test(r.warn), `${r.snps} SNPs drawn`);
    if (p.__errors.length) check('page3 console clean', false, p.__errors[0]);
    await p.close();
  }

  await browser.close();
  console.log(failed ? '\nMISMATCHES PRESENT' : '\nALL OK');
  process.exit(failed ? 1 : 0);
})();
