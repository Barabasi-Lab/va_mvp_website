/**
 * Structural relationships between phecodes - browser port.
 *
 * This is a line-for-line port of analysis/phecode_redundancy/
 * phecode_relations.py, which is the single source of truth. The same test
 * cases run against both (scripts/test_phecode_relations.js and
 * analysis/phecode_redundancy/test_phecode_relations.py); change one and the
 * other has to change with it.
 *
 *   T1  ancestor-descendant   one code is a truncation of the other
 *   T2  sibling / same family same integer root, not T1
 *   T3  exclusion-range overlap
 *   T4  shared ICD codes
 *
 * T1 and T2 come from the code strings alone, so they work with no lookup
 * table at all. T3 and T4 cannot: they need the phecode map, which the
 * browser only has if a lookup table was fetched. Until then relationsReady()
 * reports which tiers are actually answerable, and maskOf() reports the
 * unanswerable ones as unknown rather than as "not related".
 *
 * Phecodes stay strings: "585.30" and "585.3" are different codes and
 * parseFloat would merge them.
 */
(function (global) {
  'use strict';

  var CODE_RE = /^Phe_(\d+)(?:_(\d+))?$/;

  // bit positions, shared with analysis/phecode_redundancy/build_relations.py
  var T1 = 1, T2 = 2, T3 = 4, T4 = 8, UNCLASSIFIABLE = 16;

  /** Dataset phenotype code -> phecode string, or null when it is not one.
   *  Five network phenotypes (DoApnea, DoAsth, HVGlauc, SkMsGout, SkMsOP)
   *  are not phecodes and cannot be classified. */
  function toPhecode(datasetCode) {
    var m = CODE_RE.exec(String(datasetCode || ''));
    if (!m) return null;
    return m[2] ? m[1] + '.' + m[2] : m[1];
  }

  /** "585.32" -> ["585", "32"]; "585" -> ["585", ""] */
  function split(phecode) {
    var i = String(phecode).indexOf('.');
    if (i < 0) return [String(phecode), ''];
    return [String(phecode).slice(0, i), String(phecode).slice(i + 1)];
  }

  /** Ancestor-descendant: same root, one decimal part prefixes the other.
   *  Compared on the parsed decimal, so "585" vs "5851" is not a hierarchy. */
  function isT1(a, b) {
    if (a === b) return false;
    var A = split(a), B = split(b);
    if (A[0] !== B[0]) return false;
    return A[1].indexOf(B[1]) === 0 || B[1].indexOf(A[1]) === 0;
  }

  /** Same integer root, but not ancestor-descendant. */
  function isT2(a, b) {
    if (a === b) return false;
    return split(a)[0] === split(b)[0] && !isT1(a, b);
  }

  /**
   * Optional lookup table, fetched from /api/relations/lookup. Shape:
   *   { phecodes: {nodeId: ["585.32", ...]},
   *     pairs:    {"a|b": mask},     // T3/T4 bits only, T1/T2 recomputed
   *     tiers:    ["T1","T2","T4"] } // which tiers the table can answer
   * Option 2 works without it for T1/T2; T3/T4 need it.
   */
  var table = null;

  function useLookup(t) { table = t || null; }

  /** Which tiers this client can currently answer. */
  function relationsReady() {
    var tiers = ['T1', 'T2'];
    if (table && table.tiers) {
      table.tiers.forEach(function (t) {
        if (tiers.indexOf(t) < 0) tiers.push(t);
      });
    }
    return tiers;
  }

  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  /**
   * Relation bitmask for two node ids.
   * `phecodesOf` maps a node id to its phecode strings; a merged node carries
   * more than one and the pair counts as related if any combination is.
   * Returns UNCLASSIFIABLE when either side has no phecode.
   */
  function maskOf(idA, idB, phecodesOf) {
    var as = phecodesOf(idA) || [], bs = phecodesOf(idB) || [];
    if (!as.length || !bs.length) return UNCLASSIFIABLE;
    var mask = 0;
    for (var i = 0; i < as.length; i++) {
      for (var j = 0; j < bs.length; j++) {
        if (isT1(as[i], bs[j])) mask |= T1;
        if (isT2(as[i], bs[j])) mask |= T2;
      }
    }
    if (table && table.pairs) {
      var extra = table.pairs[pairKey(idA, idB)];
      if (extra) mask |= extra;
    }
    return mask;
  }

  var api = {
    T1: T1, T2: T2, T3: T3, T4: T4, UNCLASSIFIABLE: UNCLASSIFIABLE,
    toPhecode: toPhecode, split: split, isT1: isT1, isT2: isT2,
    maskOf: maskOf, useLookup: useLookup, relationsReady: relationsReady,
    pairKey: pairKey,
    /** tier names -> bitmask, e.g. ["T1","T2"] -> 3 */
    maskFor: function (tiers) {
      return (tiers || []).reduce(function (m, t) {
        return m | (api[t] || 0);
      }, 0);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PhecodeRelations = api;
}(typeof window !== 'undefined' ? window : globalThis));
