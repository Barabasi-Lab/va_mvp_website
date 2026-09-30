#!/usr/bin/env node
/**
 * Warm page-2 load, measured three ways (Part B, B3 follow-up).
 *
 * bench_toggle.js reported warm page-2 load at 1,043 ms on `main` against
 * ~2,050 ms on both feature builds, which reads as a 1 s regression. It is
 * not one: the toggle makes two extra serialized requests, each of which
 * resets networkidle0's 500 ms idle timer and pushes detection into a second
 * idle window. This measures networkidle0 alongside networkidle2 and
 * DOMContentLoaded; the latter two are identical across all three builds.
 *
 * Kept in the repo because the evaluation report quotes its numbers, and a
 * reader should be able to re-run the thing that turned an apparent
 * regression into an artefact.
 *
 *   node scripts/bench_load_signals.js
 *
 * Needs both servers up: `main` on :3001, the feature branch on :3000.
 */
const puppeteer=require('puppeteer-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const N=20;
const stats=xs=>{const s=[...xs].sort((a,b)=>a-b);const q=p=>s[Math.min(s.length-1,Math.floor(p*(s.length-1)+0.5))];
  return {n:s.length,med:q(0.5),p90:q(0.9),min:s[0],max:s[s.length-1]};};
(async()=>{
 const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium-browser',
   headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
 for (const [label,url] of [
   ['baseline','http://localhost:3001/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=905'],
   ['precomputed','http://localhost:3000/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=905&maskImpl=precomputed'],
   ['client','http://localhost:3000/page2.html?ancestry=eur&pvalue=1e-04&centerPheno=905&maskImpl=client']]) {
   const idle0=[], idle2=[], dcl=[];
   for(let i=0;i<N;i++){
     const p=await b.newPage(); p.on('dialog',d=>d.dismiss()); await p.setCacheEnabled(true);
     await p.goto(url,{waitUntil:'networkidle0',timeout:120000}); await sleep(300);
     let t=Date.now(); await p.goto(url,{waitUntil:'networkidle0',timeout:120000}); idle0.push(Date.now()-t);
     t=Date.now(); await p.goto(url,{waitUntil:'networkidle2',timeout:120000}); idle2.push(Date.now()-t);
     dcl.push(await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return n?Math.round(n.domContentLoadedEventEnd):null;}));
     await p.close();
   }
   const f=o=>`med ${o.med} p90 ${o.p90} [${o.min}-${o.max}]`;
   console.log(`${label.padEnd(12)} networkidle0 ${f(stats(idle0))}`);
   console.log(`${''.padEnd(12)} networkidle2 ${f(stats(idle2))}`);
   console.log(`${''.padEnd(12)} DOMContentLoaded ${f(stats(dcl.filter(Number.isFinite)))}`);
 }
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
