const express = require('express');
const compression = require('compression');
const path = require('path');
const { DuckDBInstance } = require('@duckdb/node-api');

const app = express();
app.use(compression());

// Where the DuckDB/Parquet files live. In production they sit on a Railway
// volume rather than in the repo, so the deploy does not carry 159 MB of data.
//
// RAILWAY_VOLUME_MOUNT_PATH is injected only when a volume is actually
// attached (confirmed against the running service: it is "/data"), which makes
// it a better signal than RAILWAY_ENVIRONMENT - that one is set on every
// Railway deploy, volume or not, and would send us to a path that does not
// exist. Deploy without a volume and we fall back to the repo copy and say so
// loudly, instead of failing on a missing mount.
const DB_DIR = process.env.DB_DIR
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
        ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'db')
        : path.join(__dirname, 'public', 'data', 'db'));

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
let dbError = null;

async function openDatabases() {
  const landingInst = await DuckDBInstance.create(
    path.join(DB_DIR, 'landing_page.duckdb'), { access_mode: 'READ_ONLY' });
  landingConn = await landingInst.connect();

  // The association data is chromosome-partitioned Parquet rather than a
  // single database file. DuckDB queries it in place through these views;
  // the explicit chrom=* glob keeps anything else under the directory (a
  // volume's lost+found, say) out of the scan, and hive_partitioning lets
  // DuckDB prune whole chromosomes.
  const assocInst = await DuckDBInstance.create(':memory:');
  assocConn = await assocInst.connect();
  const parquet = p => path.join(DB_DIR, p).replace(/'/g, "''");
  await assocConn.run(
    `CREATE VIEW associations AS
     SELECT * FROM read_parquet('${parquet('associations/chrom=*/*.parquet')}',
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

// If the data never opened, say so on every API route rather than letting
// each one fail on an undefined connection.
app.use('/api', (req, res, next) => {
  if (!dbError) return next();
  res.status(503).json({
    error: 'data files unavailable on the server',
    detail: `could not open the database directory (${DB_DIR})`
  });
});

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

// Which statistic ranks SNPs for the top-N cut on pages 2 and 3.
//   'z'    - |beta / se|, the Wald statistic (default, per review)
//   'pval' - the reported p-value, the previous behaviour
// Set RANK_METRIC=pval to switch back without a code change. See the note on
// strength() for why the two disagree more than you might expect.
const RANK_METRIC = (process.env.RANK_METRIC || 'z').toLowerCase();

/**
 * Association strength for one ancestry, computed at query time. Larger is
 * stronger for both metrics, so every ranking below is a plain DESC and the
 * least()/min() composition means "weakest supporting side".
 *
 * z is computed on the fly rather than materialised into the Parquet:
 * benchmarked at -1.7 ms median and +5.7 ms worst against the shipped shards,
 * so it is not worth a rebuild and re-upload of the volume.
 *
 * NOTE: z and the reported p-value are NOT monotonically related in this
 * dataset. p is far less significant than |beta/se| would imply for rare
 * variants - the sampled median gap is 0.55 log10 and the tail reaches 290+ -
 * which is the signature of a saddlepoint-corrected test (SAIGE/REGENIE)
 * where the Wald standard error is anti-conservative for rare variants under
 * case-control imbalance. Ranking by z therefore promotes rare variants that
 * the reported p-value holds back; on Asthma it changes 74 of the top 150.
 *
 * se is never zero or negative here (checked), and se is NULL exactly where
 * beta is. The coalesce to -1 sorts unusable rows last under DESC and stops
 * least()/greatest() from silently ignoring a NULL side.
 */
function strength(a) {
  if (RANK_METRIC === 'pval') {
    // -log10(p), with p = 0 (4,533 rows underflow) treated as the strongest
    return `CASE WHEN "pval.${a}" IS NULL THEN -1
                 WHEN "pval.${a}" <= 0 THEN 1e308
                 ELSE -log10("pval.${a}") END`;
  }
  return `coalesce(abs("beta.${a}" / "se.${a}"), -1)`;
}

/**
 * The centre phenotype's strongest SNPs: any row with a usable beta, ordered
 * by descending strength(), with the p-value threshold deliberately NOT applied
 * (the client ranks first and thresholds second). Restricting to these rsids
 * is idempotent - the client's own top-150 pass over the result reproduces
 * the same set.
 *
 * With two ancestries the key is the weaker of the two, so a SNP only scores
 * well when both ancestries support it. Ranking on one ancestry
 * alone spent slots on SNPs the other ancestry's filter then removed, while
 * excluding SNPs that would have passed both.
 *
 * Ties are common right at the 150-row cut, and the client's sort is stable
 * over the row order of the legacy CSVs, which is exactly the raw dataset's
 * own row order - so src_row breaks ties the same way.
 */
function topSnpCte(a1, a2, thresholds, limit = TOP_SNPS) {
  const betaPresent = [`"beta.${a1}" IS NOT NULL`];
  if (a2) betaPresent.push(`"beta.${a2}" IS NOT NULL`);
  const rank = a2
    ? `least(${strength(a1)}, ${strength(a2)})`
    : strength(a1);

  // One row per SNP, strongest first. DISTINCT alone does not preserve
  // order, and the caller slices this list, so the ordering has to survive.
  const candidates = `cand AS (
            SELECT DISTINCT ON (rsid) rsid, ${rank} AS s, src_row
            FROM associations
            WHERE phe_id = $1 AND ${betaPresent.join(' AND ')}
            ORDER BY rsid, s DESC, src_row
          )`;

  if (!thresholds) {
    return `WITH ${candidates},
            top_rsids AS (
              SELECT rsid FROM cand ORDER BY s DESC, src_row LIMIT ${limit})`;
  }

  // Backfilled: skip SNPs the page would then drop, so the view fills up to
  // TOP_SNPS whenever that many actually qualify. A SNP survives only if at
  // least two of its links clear the p-value and |beta| filters - one to the
  // centre and one to a neighbour - which is the same rule updateNodes
  // applies client-side. That test is per-SNP: a SNP's own link count does
  // not depend on which other SNPs are shown, so deciding it here gives the
  // same answer the client would.
  return `WITH ${candidates},
          surviving AS (
            SELECT a.rsid FROM associations a
            WHERE a.rsid IN (SELECT rsid FROM cand)
              AND ${linkFilterSql(a1, a2, 2)}
            GROUP BY a.rsid HAVING count(*) >= 2
          ),
          top_rsids AS (
            SELECT c.rsid FROM cand c JOIN surviving v USING (rsid)
            ORDER BY c.s DESC, c.src_row
            LIMIT ${limit})`;
}

// rsids come straight back out of our own store, but this is still building
// SQL text, so vet them rather than trusting that.
function rsidList(rsids) {
  for (const r of rsids) {
    if (!/^[A-Za-z0-9_.:-]+$/.test(r)) throw new Error(`unexpected rsid: ${r}`);
  }
  return rsids.map(r => `'${r}'`).join(', ');
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

    // Optional. With a threshold the selection skips SNPs the page would
    // drop, so the view fills to TOP_SNPS whenever that many qualify; without
    // one it is the plain top-N and the thresholds stay client-side.
    let p1 = null, p2 = null;
    if (req.query.pvalue !== undefined) {
      p1 = checkThreshold(req.query.pvalue, res);
      if (!p1) return;
      if (a2) {
        p2 = checkThreshold(req.query.pvalue2, res, 'pvalue2');
        if (!p2) return;
      }
    }
    const params = p1 === null ? [node] : (a2 ? [node, p1, p2] : [node, p1]);

    // matches the client's `links.filter(l => !isNaN(l.beta))`
    const betaPresent = [`a."beta.${a1}" IS NOT NULL`];
    if (a2) betaPresent.push(`a."beta.${a2}" IS NOT NULL`);

    // Three independent lookups: the SNP selection, the centre's metadata
    // (the client reads label/category off the returned rows, and a strict
    // threshold can leave none), and the size of the pool the selection came
    // out of. Issued together rather than one after another.
    //
    // The selection asks for one more than we can show: if it comes back, the
    // cap is really hiding something and the page should say so.
    const [pickedRows, [meta], [{ total }]] = await Promise.all([
      query(assocConn,
        `${topSnpCte(a1, a2, p1 !== null, TOP_SNPS + 1)} SELECT rsid FROM top_rsids`,
        params),
      query(assocConn,
        `SELECT label AS phe_label, hex AS phe_hex,
                phenotype_category AS phe_cat
         FROM node_attributes WHERE id = $1`, [node]),
      query(assocConn,
        `SELECT count(DISTINCT rsid) AS total FROM associations a
         WHERE a.phe_id = $1 AND ${betaPresent.join(' AND ')}`, [node])
    ]);
    const picked = pickedRows.map(r => r.rsid);
    const more = picked.length > TOP_SNPS;
    const keep = picked.slice(0, TOP_SNPS);

    const rows = keep.length === 0 ? [] : await query(assocConn,
      `${ROW_SELECT}
       WHERE a.rsid IN (${rsidList(keep)})
         AND ${betaPresent.join(' AND ')}
       ORDER BY a.src_row`,
      []);

    res.json({
      node,
      center: meta || null,
      rows,
      availableSnps: Number(total),      // every SNP this phenotype has
      fetchedSnps: keep.length,
      moreAvailable: more,               // more qualify than fit on screen
      limit: TOP_SNPS
    });
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

    // only affects the ranking used when the cap bites; no rows are filtered
    let a2 = null;
    if (req.query.ancestry2) {
      a2 = checkAncestry(req.query.ancestry2, res, 'ancestry2');
      if (!a2) return;
    }

    // Optional, same meaning as on page 2.
    let p1 = null, p2 = null;
    if (req.query.pvalue !== undefined) {
      p1 = checkThreshold(req.query.pvalue, res);
      if (!p1) return;
      if (a2) {
        p2 = checkThreshold(req.query.pvalue2, res, 'pvalue2');
        if (!p2) return;
      }
    }

    let limit = PAGE3_DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n < 1 || n > PAGE3_MAX_LIMIT) {
        return res.status(400).json({ error: `limit must be an integer in 1..${PAGE3_MAX_LIMIT}` });
      }
      limit = n;
    }

    // A SNP is only drawn when it clears the threshold on *both* phenotypes,
    // and in comparison mode on both ancestries too, so rank by the weakest
    // strength() across all of those. min() over the two phenotypes' rows, then
    // least() across ancestries: a SNP scores well only where every side
    // supports it. Ranking on one ancestry alone spent slots on SNPs that the
    // other ancestry's filter then removed, while excluding SNPs that would
    // have passed: on Shortness of breath / Other dyspnea that left 215 of 250
    // slots used and 663 qualifying SNPs shut out.
    const weakestOf = [`coalesce(min(${strength(a1)}), -1)`];
    if (a2) weakestOf.push(`coalesce(min(${strength(a2)}), -1)`);
    const weakest = weakestOf.length > 1 ? `least(${weakestOf.join(', ')})` : weakestOf[0];

    // With a threshold, drop SNPs the page would then discard so the cap
    // fills up to `limit` whenever that many qualify. Here a SNP needs both
    // of its links - to the left and the right phenotype - to clear the
    // filters, which is what updateNodes' "at least two edges" amounts to
    // when only two phenotypes are on screen.
    const surviving = p1 === null ? '' : `,
      surviving AS (
        SELECT a.rsid FROM associations a
        WHERE a.phe_id IN ($1, $2) AND a.rsid IN (SELECT rsid FROM shared)
          AND ${linkFilterSql(a1, a2, 3)}
        GROUP BY a.rsid HAVING count(*) >= 2
      )`;
    const survJoin = p1 === null ? '' : 'AND a.rsid IN (SELECT rsid FROM surviving)';

    const cte = `
      WITH shared AS (
        SELECT rsid FROM associations WHERE phe_id = $1
        INTERSECT
        SELECT rsid FROM associations WHERE phe_id = $2
      )${surviving},
      ranked AS (
        SELECT rsid FROM (
          SELECT a.rsid, ${weakest} AS weakest
          FROM associations a
          WHERE a.phe_id IN ($1, $2) AND a.rsid IN (SELECT rsid FROM shared)
            ${survJoin}
          GROUP BY a.rsid
          ORDER BY weakest DESC, rsid ASC
          LIMIT ${limit + 1})
      )`;

    const qp = p1 === null ? [left, right] : (a2 ? [left, right, p1, p2] : [left, right, p1]);

    const [[{ total }], pickedRows] = await Promise.all([
      query(assocConn, `${cte} SELECT count(*) AS total FROM shared`, qp),
      query(assocConn, `${cte} SELECT rsid FROM ranked`, qp)
    ]);
    const picked = pickedRows.map(r => r.rsid);
    const more = picked.length > limit;
    const keep = picked.slice(0, limit);

    const rows = keep.length === 0 ? [] : await query(assocConn,
      `${ROW_SELECT}
       WHERE a.phe_id IN ($1, $2)
         AND a.rsid IN (${rsidList(keep)})
       ORDER BY a.src_row`,
      [left, right]);

    res.json({
      left, right, rows,
      sharedSnps: Number(total),   // SNPs the two phenotypes share
      shownSnps: keep.length,
      moreAvailable: more,         // more qualify than fit on screen
      limit
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------- downloads
//
// The pages cap how many SNPs they draw and tell the user to download the data
// to see the rest, so these deliberately ignore the cap and the p-value
// sliders: they return every association for the phenotype(s) in question,
// with se alongside beta so z can be recomputed offline.
//
// (The old client-side download built a CSV from a `network` variable that was
// not in scope, so it threw, and it would only have exported the rows already
// on screen - the opposite of what the message promises.)

const DOWNLOAD_COLS = ['phe_id', 'phe_label', 'rsid', 'chrom'].concat(
  ANCESTRIES.flatMap(a => [`pval.${a.toLowerCase()}`, `beta.${a.toLowerCase()}`, `se.${a.toLowerCase()}`]));

function toCsv(rows) {
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out = [DOWNLOAD_COLS.join(',')];
  for (const r of rows) out.push(DOWNLOAD_COLS.map(c => esc(r[c])).join(','));
  return out.join('\n') + '\n';
}

const DOWNLOAD_SELECT = `SELECT a.phe_id, n.label AS phe_label, a.rsid, a.chrom,
         ${ANCESTRIES.flatMap(a => [
           `a."pval.${a.toLowerCase()}"`, `a."beta.${a.toLowerCase()}"`, `a."se.${a.toLowerCase()}"`
         ]).join(', ')}
  FROM associations a
  JOIN node_attributes n ON n.id = a.phe_id`;

function sendCsv(res, name, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(toCsv(rows));
}

// Every SNP associated with this phenotype, uncapped.
app.get('/api/page2/download', async (req, res, next) => {
  try {
    const node = String(req.query.node || '');
    if (!(await nodeExists(node))) return res.status(404).json({ error: `unknown node ${node}` });
    const rows = await query(assocConn,
      `${DOWNLOAD_SELECT} WHERE a.phe_id = $1 ORDER BY a.src_row`, [node]);
    sendCsv(res, `phenotype_${node}_associations.csv`, rows);
  } catch (err) { next(err); }
});

// Every SNP the two phenotypes share, uncapped, for both of them.
app.get('/api/page3/download', async (req, res, next) => {
  try {
    const left = String(req.query.left || '');
    const right = String(req.query.right || '');
    if (!(await nodeExists(left))) return res.status(404).json({ error: `unknown node ${left}` });
    if (!(await nodeExists(right))) return res.status(404).json({ error: `unknown node ${right}` });
    const rows = await query(assocConn,
      `${DOWNLOAD_SELECT}
       WHERE a.phe_id IN ($1, $2)
         AND a.rsid IN (
               SELECT rsid FROM associations WHERE phe_id = $1
               INTERSECT
               SELECT rsid FROM associations WHERE phe_id = $2)
       ORDER BY a.src_row`, [left, right]);
    sendCsv(res, `shared_snps_${left}_${right}.csv`, rows);
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

// Serve the site even if the data files are unreachable. Exiting here would
// turn a missing volume into a crash loop with no page to look at; this way
// the site loads, the API says plainly what is wrong, and the reason is in
// the logs. scripts/ensure-db.js has already named the missing files.
openDatabases()
  .catch(err => {
    dbError = err;
    console.error('\n' + '='.repeat(70));
    console.error('DATA FILES UNAVAILABLE - the site will load but the API cannot answer.');
    console.error(`  looked in: ${DB_DIR}`);
    console.error(`  reason:    ${err.message}`);
    console.error('  Set DB_DIR, or attach the volume holding db/.');
    console.error('='.repeat(70) + '\n');
  })
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Server running at http://0.0.0.0:${port}/  (data: ${DB_DIR})`);
    });
  });
