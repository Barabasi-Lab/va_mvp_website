const express = require('express');
const compression = require('compression');
const path = require('path');
const { DuckDBInstance } = require('@duckdb/node-api');

const app = express();
app.use(compression());

const DB_DIR = path.join(__dirname, 'public', 'data', 'db');

// ---------------------------------------------------------------- constants

const ANCESTRIES = ['meta', 'eur', 'afr', 'amr', 'eas'];
const PVALUES = ['1e-04', '1e-05', '1e-06', '1e-07', '1e-08',
                 '1e-09', '1e-10', '1e-11', '1e-12'];

// page 2/3 drop links whose |beta| does not clear this; it is fixed in the
// client (the slider that used to drive it is commented out).
const BETA_THRESHOLD = 0.01;

// The legacy node_files coloured SNP nodes on a cyan->magenta ramp by
// chromosome. Reproduced here so the served rows keep the same rsid_hex.
const CHROM_COLORS = [
  '#00ffff', '#0bf4ff', '#17e8ff', '#22ddff', '#2ed1ff', '#3ac5ff',
  '#45baff', '#51aeff', '#5da2ff', '#6897ff', '#748bff', '#807fff',
  '#8b74ff', '#9768ff', '#a25dff', '#ae51ff', '#ba45ff', '#c539ff',
  '#d12eff', '#dd21ff', '#e817ff', '#f30bff'
];
const RSID_HEX_SQL =
  'CASE a.chrom ' +
  CHROM_COLORS.map((c, i) => `WHEN ${i + 1} THEN '${c}'`).join(' ') +
  " ELSE '#ffffff' END";

const STAT_COLS = ANCESTRIES
  .flatMap(a => [`a."pval.${a}"`, `a."beta.${a}"`])
  .join(', ');

// ---------------------------------------------------------------- db access

let landingConn;
let assocConn;

async function openDatabases() {
  const landingInst = await DuckDBInstance.create(
    path.join(DB_DIR, 'landing_page.duckdb'), { access_mode: 'READ_ONLY' });
  landingConn = await landingInst.connect();

  // The association data ships as chromosome-partitioned Parquet rather than
  // a single database file, so no shard exceeds GitHub's 100 MB limit.
  // DuckDB queries it in place through these views.
  const assocInst = await DuckDBInstance.create(':memory:');
  assocConn = await assocInst.connect();
  const parquet = p => path.join(DB_DIR, p).replace(/'/g, "''");
  await assocConn.run(
    `CREATE VIEW associations AS
     SELECT * FROM read_parquet('${parquet('associations/**/*.parquet')}',
                                hive_partitioning = true)`);
  await assocConn.run(
    `CREATE VIEW node_attributes AS
     SELECT * FROM read_parquet('${parquet('node_attributes.parquet')}')`);
}

// DuckDB returns BIGINT as BigInt, which JSON.stringify cannot serialise.
function plain(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

async function query(conn, sql, params = []) {
  const reader = params.length
    ? await conn.runAndReadAll(sql, params)
    : await conn.runAndReadAll(sql);
  return reader.getRowObjects().map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = plain(v);
    return out;
  });
}

// ------------------------------------------------------------- validation

function checkAncestry(value, res, field = 'ancestry') {
  const a = String(value || '').toLowerCase();
  if (!ANCESTRIES.includes(a)) {
    res.status(400).json({ error: `${field} must be one of ${ANCESTRIES.join(', ')}` });
    return null;
  }
  return a;
}

// Page 1 selects a discrete precomputed column, so the p-value has to be one
// of the nine built into the edgelist.
function checkPvalueColumn(value, res) {
  const raw = String(value || '');
  if (PVALUES.includes(raw)) return raw;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    const normalised = `1e-${String(Math.round(-Math.log10(n))).padStart(2, '0')}`;
    if (PVALUES.includes(normalised)) return normalised;
  }
  res.status(400).json({ error: `pvalue must be one of ${PVALUES.join(', ')}` });
  return null;
}

// Pages 2/3 use a continuous slider, so any positive threshold is valid.
function checkThreshold(value, res, field = 'pvalue') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    res.status(400).json({ error: `${field} must be a positive number` });
    return null;
  }
  return n;
}

async function nodeExists(id) {
  const rows = await query(assocConn,
    'SELECT 1 AS ok FROM node_attributes WHERE id = $1 LIMIT 1', [String(id)]);
  return rows.length > 0;
}

// ------------------------------------------------------------ page 1 routes

app.get('/api/landing/nodes', async (req, res, next) => {
  try {
    res.json({
      nodes: await query(landingConn,
        `SELECT CAST(id AS VARCHAR) AS id, x, y, size, label,
                phenotype_category AS category, hex, degree
         FROM node_attributes`)
    });
  } catch (err) { next(err); }
});

app.get('/api/landing/edges', async (req, res, next) => {
  try {
    const ancestry = checkAncestry(req.query.ancestry, res);
    if (!ancestry) return;
    const pvalue = checkPvalueColumn(req.query.pvalue, res);
    if (!pvalue) return;

    const same = `${ancestry}_${pvalue}_same_dir_weight`;
    const diff = `${ancestry}_${pvalue}_diff_dir_weight`;
    const sql = `SELECT source, target,
                        COALESCE("${same}", 0) AS same,
                        COALESCE("${diff}", 0) AS diff
                 FROM edges`;
    const edges = await query(landingConn, sql);

    // Degree under the current filter: an edge counts for both endpoints when
    // either direction carries a non-zero weight. Endpoints of zero-weight
    // edges still get an explicit 0 so the client can tell "no edges under
    // this filter" apart from "not in the edgelist at all".
    const degrees = {};
    for (const e of edges) {
      if (!(e.source in degrees)) degrees[e.source] = 0;
      if (!(e.target in degrees)) degrees[e.target] = 0;
      if (e.same !== 0 || e.diff !== 0) {
        degrees[e.source] += 1;
        degrees[e.target] += 1;
      }
    }
    res.json({ ancestry, pvalue, edges, degrees });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------- page 2/3 routes

// Which ancestries have any data for this phenotype, used to build the
// ancestry checkbox list.
app.get('/api/node/:id/ancestries', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!(await nodeExists(id))) return res.status(404).json({ error: `unknown node ${id}` });
    const counts = ANCESTRIES
      .map(a => `count("beta.${a}") AS "${a}"`)
      .join(', ');
    const [row] = await query(assocConn,
      `SELECT ${counts} FROM associations WHERE phe_id = $1`, [id]);
    res.json({ ancestries: ANCESTRIES.filter(a => Number(row[a]) > 0) });
  } catch (err) { next(err); }
});

/**
 * Builds the WHERE fragment replicating the client-side link filter:
 *   beta present and |beta| > 0.01, p-value present and below threshold.
 * In comparison mode both ancestries must qualify and the effective beta is
 * the larger of the two magnitudes, matching initializeNetwork().
 *
 * A p-value of exactly 0 is treated as significant. The client's
 * `parseFloat(p) || 1` silently coerced those 4,533 rows to 1 and dropped
 * them; that is not replicated here.
 */
function linkFilterSql(a1, a2, p1Index) {
  const clauses = [
    `a."beta.${a1}" IS NOT NULL`,
    `a."pval.${a1}" IS NOT NULL`,
    `a."pval.${a1}" < $${p1Index}`
  ];
  if (a2) {
    clauses.push(
      `a."beta.${a2}" IS NOT NULL`,
      `a."pval.${a2}" IS NOT NULL`,
      `a."pval.${a2}" < $${p1Index + 1}`,
      `greatest(abs(a."beta.${a1}"), abs(a."beta.${a2}")) > ${BETA_THRESHOLD}`
    );
  } else {
    clauses.push(`abs(a."beta.${a1}") > ${BETA_THRESHOLD}`);
  }
  return clauses.join(' AND ');
}

// Rows go back in the raw dataset's own row order (src_row). The legacy
// per-node CSVs were in exactly that order, and the client's comparison mode
// keeps the *last* row it sees for a duplicated (SNP, phenotype) pair, so the
// order is load-bearing wherever the raw data has duplicates.
const ROW_SELECT = `SELECT a.rsid, a.chrom, ${STAT_COLS},
         a.phe_id,
         n.label AS phe_label,
         n.hex AS phe_hex,
         ${RSID_HEX_SQL} AS rsid_hex,
         n.phenotype_category AS phe_cat
  FROM associations a
  JOIN node_attributes n ON n.id = a.phe_id`;

// Page 2 only ever draws the centre phenotype's strongest SNPs, so the
// neighbourhood is cut to that set server-side instead of shipping all
// ~840k rows and letting the browser throw most of them away.
const TOP_SNPS = 150;

/**
 * The centre phenotype's strongest SNPs, ranked exactly as initializeNetwork()
 * ranks them: any row with a usable beta, ordered by ascending p-value, with
 * the p-value threshold deliberately NOT applied (the client ranks first and
 * thresholds second). Restricting to these rsids is idempotent - the client's
 * own top-150 pass over the result reproduces the same set.
 *
 * Ties on p-value are common right at the 150-row cut, and the client's sort
 * is stable over the row order of the legacy CSVs, which is exactly the raw
 * dataset's own row order - so src_row breaks ties the same way.
 */
function topSnpCte(a1, a2) {
  const betaPresent = [`"beta.${a1}" IS NOT NULL`];
  if (a2) betaPresent.push(`"beta.${a2}" IS NOT NULL`);
  return `WITH top_rsids AS (
            SELECT DISTINCT rsid FROM (
              SELECT rsid FROM associations
              WHERE phe_id = $1 AND ${betaPresent.join(' AND ')}
              ORDER BY "pval.${a1}" ASC NULLS LAST, src_row ASC
              LIMIT ${TOP_SNPS}))`;
}

// Page 2: the neighbourhood of one phenotype, cut to its strongest SNPs.
//
// Deliberately NOT filtered by p-value. The client ranks the centre's SNPs
// before thresholding them, so a pre-thresholded response would make it rank
// a smaller set and silently drop neighbour links that clear the threshold on
// their own phenotype. The top-150 cut already shrinks the payload ~100x, and
// the response depends only on the ancestry, so the p-value slider stays
// entirely client-side.
app.get('/api/page2/rows', async (req, res, next) => {
  try {
    const node = String(req.query.node || '');
    if (!(await nodeExists(node))) return res.status(404).json({ error: `unknown node ${node}` });

    const a1 = checkAncestry(req.query.ancestry, res);
    if (!a1) return;

    let a2 = null;
    if (req.query.ancestry2) {
      a2 = checkAncestry(req.query.ancestry2, res, 'ancestry2');
      if (!a2) return;
    }

    // matches the client's `links.filter(l => !isNaN(l.beta))`
    const betaPresent = [`a."beta.${a1}" IS NOT NULL`];
    if (a2) betaPresent.push(`a."beta.${a2}" IS NOT NULL`);

    const rows = await query(assocConn,
      `${topSnpCte(a1, a2)}
       ${ROW_SELECT}
       WHERE a.rsid IN (SELECT rsid FROM top_rsids)
         AND ${betaPresent.join(' AND ')}
       ORDER BY a.src_row`,
      [node]);

    // The client reads the centre node's label/category off the returned rows;
    // a strict threshold can leave none, so send them separately too.
    const [meta] = await query(assocConn,
      `SELECT label AS phe_label, hex AS phe_hex,
              phenotype_category AS phe_cat
       FROM node_attributes WHERE id = $1`, [node]);
    res.json({ node, center: meta || null, rows });
  } catch (err) { next(err); }
});

// Page 3: the edge between two phenotypes - only the SNPs they share.
//
// Like page 2, deliberately NOT filtered by p-value: the client keeps the last
// row it sees for a duplicated (SNP, phenotype) pair when intersecting two
// ancestries, so dropping rows here would change which duplicate wins. The
// response depends only on the two phenotypes, and both sliders stay
// client-side.
//
// Capped, because the tail is brutal: the median edge shares ~51 SNPs, but
// Hyperlipidemia and Disorders of lipoid metabolism share 22,642. That is both
// unreadable - they land 0.05 px apart in the column - and enough DOM to hang
// the browser. When the cap bites the SNPs kept are the most significant, and
// the response reports the true total so the page can say what it is hiding.
const PAGE3_DEFAULT_LIMIT = 250;
const PAGE3_MAX_LIMIT = 50000;

app.get('/api/page3/rows', async (req, res, next) => {
  try {
    const left = String(req.query.left || '');
    const right = String(req.query.right || '');
    if (!(await nodeExists(left))) return res.status(404).json({ error: `unknown node ${left}` });
    if (!(await nodeExists(right))) return res.status(404).json({ error: `unknown node ${right}` });

    const a1 = checkAncestry(req.query.ancestry, res);
    if (!a1) return;

    let limit = PAGE3_DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n < 1 || n > PAGE3_MAX_LIMIT) {
        return res.status(400).json({ error: `limit must be an integer in 1..${PAGE3_MAX_LIMIT}` });
      }
      limit = n;
    }

    const cte = `
      WITH shared AS (
        SELECT rsid FROM associations WHERE phe_id = $1
        INTERSECT
        SELECT rsid FROM associations WHERE phe_id = $2
      ),
      ranked AS (
        SELECT rsid FROM (
          SELECT a.rsid, max(a."pval.${a1}") AS worst
          FROM associations a
          WHERE a.phe_id IN ($1, $2) AND a.rsid IN (SELECT rsid FROM shared)
          GROUP BY a.rsid
          ORDER BY worst ASC NULLS LAST, rsid ASC
          LIMIT ${limit})
      )`;

    const [{ total }] = await query(assocConn,
      `${cte} SELECT count(*) AS total FROM shared`, [left, right]);

    const rows = await query(assocConn,
      `${cte}
       ${ROW_SELECT}
       WHERE a.phe_id IN ($1, $2)
         AND a.rsid IN (SELECT rsid FROM ranked)
       ORDER BY a.src_row`,
      [left, right]);

    const shown = new Set(rows.map(r => r.rsid)).size;
    res.json({ left, right, rows, sharedSnps: Number(total), shownSnps: shown, limit });
  } catch (err) { next(err); }
});

// ----------------------------------------------------------------- static

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'), err => {
    if (err) res.status(404).send('404 Not Found');
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const port = process.env.PORT || 3000;
openDatabases().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}/`);
  });
}).catch(err => {
  console.error('Failed to open DuckDB files:', err);
  process.exit(1);
});
