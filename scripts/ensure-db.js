#!/usr/bin/env node
/**
 * Startup check for the DuckDB/Parquet data files.
 *
 * In production these live on a Railway volume, not in the repo, so a wiped
 * volume or a fresh environment created without one would otherwise show up as
 * empty graphs with nothing in the logs explaining why. This names the missing
 * files at boot.
 *
 * It never fails. It runs as npm's `prestart`, so a non-zero exit would stop
 * the server from starting at all, turning a recoverable data problem into a
 * total outage. Warn loudly, exit 0, and let server.js serve the site with the
 * API reporting 503.
 */
const fs = require('fs');
const path = require('path');

// Keep in step with the DB_DIR resolution in server.js.
const DB_DIR = process.env.DB_DIR
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
        ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'db')
        : path.join(path.dirname(__dirname), 'public', 'data', 'db'));

const CHROMOSOMES = 22;

function expectedFiles() {
  const files = ['landing_page.duckdb', 'node_attributes.parquet'];
  for (let c = 1; c <= CHROMOSOMES; c++) {
    files.push(path.join('associations', `chrom=${c}`, 'data_0.parquet'));
  }
  return files;
}

function describe(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB`
       : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB`
       : `${(bytes / 1e3).toFixed(1)} kB`;
}

function main() {
  const missing = [];
  const empty = [];
  let total = 0;

  for (const rel of expectedFiles()) {
    const full = path.join(DB_DIR, rel);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      missing.push(rel);
      continue;
    }
    if (!st.size) empty.push(rel);
    total += st.size;
  }

  const source = process.env.DB_DIR ? 'DB_DIR'
               : process.env.RAILWAY_VOLUME_MOUNT_PATH ? 'RAILWAY_VOLUME_MOUNT_PATH'
               : 'repo checkout';

  if (!missing.length && !empty.length) {
    console.log(`[ensure-db] ${expectedFiles().length} data files present in ${DB_DIR} ` +
                `(${describe(total)}, via ${source})`);
    return;
  }

  const line = '='.repeat(70);
  console.warn(`\n${line}`);
  console.warn('[ensure-db] DATA FILES MISSING - the API will return 503 until this is fixed.');
  console.warn(`  directory: ${DB_DIR}  (resolved from ${source})`);
  if (missing.length) {
    console.warn(`  missing (${missing.length}):`);
    for (const f of missing) console.warn(`    - ${f}`);
  }
  if (empty.length) {
    console.warn(`  present but empty (${empty.length}):`);
    for (const f of empty) console.warn(`    - ${f}`);
  }
  console.warn('');
  console.warn('  To fix: confirm the Railway volume is attached and populated');
  console.warn('  (railway volume files -v <volume> list /db), or point DB_DIR at');
  console.warn('  a directory holding them. To rebuild from the raw dataset:');
  console.warn('    python3 scripts/build_dbs.py --full-dataset /path/to/full_dataset.csv');
  console.warn(`${line}\n`);

  // Deliberately no automatic download. No fallback URL is configured, and a
  // silent failed fetch would be worse than this warning.
  //
  // EXTENSION POINT: to enable one, read a URL from the environment here
  // (e.g. DB_BOOTSTRAP_URL), fetch into DB_DIR, and re-run the check above.
  // Deferred on purpose - ask before building it.
}

try {
  main();
} catch (err) {
  console.warn(`[ensure-db] check itself failed (continuing anyway): ${err.message}`);
}
process.exit(0);
