/**
 * "Hide edges between related phecodes" - prototype (Part B).
 *
 * Off by default. The state travels between pages in the query string, the
 * same way ancestry and pvalue already do.
 *
 * Two implementations sit behind one interface so the evaluation can time
 * them against each other without touching the pages:
 *
 *   IMPL = 'precomputed'  the server sends a tier bitmask per edge
 *                         (/api/landing/edges?rel=1) and per pair
 *                         (/api/relations/pairs). Covers every tier that
 *                         was computable when the data was built.
 *   IMPL = 'client'       the browser applies the truncation rule to the
 *                         phecode strings. Covers T1 and T2 with no pair
 *                         data at all; T3 and T4 need the extra lookup
 *                         (/api/relations/lookup?tiers=all).
 *
 * Which tiers are masked is one config value, TIERS. Both it and IMPL can be
 * overridden from the query string (maskTiers=T1,T2 / maskImpl=client) so the
 * benchmark can sweep them; nothing in the UI exposes them.
 *
 * T3 is never masked on this data: the exclusion ranges are not in any input
 * file we have. The server reports it under unavailableTiers and the control
 * says so rather than pretending T3 was checked and came back empty.
 */
(function (global) {
  'use strict';

  const R = global.PhecodeRelations;

  const HierarchyMask = {
    // ------------------------------------------------------------- config
    TIERS: ['T1', 'T2'],            // the tier set under evaluation (B4)
    IMPL: 'precomputed',            // 'precomputed' | 'client'

    enabled: false,
    available: false,
    tiers: [],                      // tiers the server can actually answer
    unavailableTiers: [],
    _phecodes: null,                // node id -> phecode strings (client impl)
    _pairs: null,                   // "a|b" -> mask   (precomputed impl)
    _wantMask: 0,

    /** Read the initial state out of the URL. Absent means off. */
    readParams(params) {
      this.enabled = params.get('mask') === '1';
      const t = params.get('maskTiers');
      if (t) this.TIERS = t.split(',').map(s => s.trim()).filter(Boolean);
      const i = params.get('maskImpl');
      if (i === 'client' || i === 'precomputed') this.IMPL = i;
      this._wantMask = R.maskFor(this.TIERS);
      return this;
    },

    /** Append the state to a URL the page is about to open. */
    params() {
      const p = [];
      if (this.enabled) p.push('mask=1');
      if (this.TIERS.join(',') !== 'T1,T2') p.push('maskTiers=' + this.TIERS.join(','));
      if (this.IMPL !== 'precomputed') p.push('maskImpl=' + this.IMPL);
      return p.length ? '&' + p.join('&') : '';
    },

    /** Does the landing-edges request need the per-edge bitmask? */
    needsEdgeRel() {
      return this.IMPL === 'precomputed';
    },

    /**
     * Ask the server what it can offer and fetch whatever this
     * implementation needs. Resolves to `available`; a false value means the
     * companion files were never built and the caller should not draw the
     * control at all.
     */
    async init(nodeId) {
      let status;
      try {
        status = await fetch('/api/relations/status').then(r => r.json());
      } catch (err) {
        console.warn('hierarchy mask unavailable:', err);
        return false;
      }
      if (!status.available) return false;
      this.available = true;
      this.tiers = status.tiers || [];
      this.unavailableTiers = status.unavailableTiers || [];

      if (this.IMPL === 'client') {
        const needsPairs = this.TIERS.some(t => t === 'T3' || t === 'T4');
        const url = '/api/relations/lookup' + (needsPairs ? '?tiers=all' : '');
        const lookup = await fetch(url).then(r => r.json());
        this._phecodes = lookup.phecodes;
        R.useLookup(needsPairs ? lookup : null);
      } else if (nodeId != null) {
        // node view: the outer ring is not in the landing edgelist, so the
        // per-edge file cannot answer it
        const res = await fetch('/api/relations/pairs?node=' + encodeURIComponent(nodeId))
          .then(r => r.json());
        this._pairs = res.related || {};
      }
      return true;
    },

    /** Tier names the toggle will actually act on, given what is available. */
    effectiveTiers() {
      return this.TIERS.filter(t => this.tiers.indexOf(t) >= 0);
    },

    /**
     * Bitmask for a node pair. `servedRel` is the per-edge value from the
     * landing response, used by the precomputed implementation when it has
     * one; the pair table is the fallback for everything else.
     */
    maskOf(a, b, servedRel) {
      if (this.IMPL === 'client') {
        const phe = this._phecodes;
        return R.maskOf(a, b, id => (phe && phe[id]) || []);
      }
      if (servedRel !== undefined && servedRel !== null) return servedRel;
      // the pair table was fetched for one node, so it is keyed by the other
      // endpoint; whichever of the two is not the centre is the key
      if (this._pairs) return this._pairs[b] ?? this._pairs[a] ?? 0;
      return 0;
    },

    /** Should this edge be hidden right now? */
    isMasked(a, b, servedRel) {
      if (!this.enabled) return false;
      return (this.maskOf(a, b, servedRel) & this._wantMask) !== 0;
    },

    /** Is this outer-ring phenotype related to the centre? */
    isRelatedToCenter(otherId) {
      if (!this.enabled) return false;
      if (this.IMPL === 'client') {
        const phe = this._phecodes;
        return (R.maskOf(this._center, otherId, id => (phe && phe[id]) || [])
                & this._wantMask) !== 0;
      }
      return (((this._pairs || {})[otherId] || 0) & this._wantMask) !== 0;
    },

    setCenter(id) { this._center = String(id); return this; },

    /**
     * Draw the control. `onChange` is called after `enabled` flips.
     * Returns the container element so the caller can place it in its own
     * panel stack.
     */
    control(onChange) {
      const div = document.createElement('div');
      div.id = 'hierarchy-mask-container';
      div.style.color = 'white';
      div.style.padding = '10px';
      const eff = this.effectiveTiers();
      const note = this.unavailableTiers.length
        ? `<div style="font-size: 11px; opacity: 0.7;">masking ${eff.join(', ')};` +
          ` ${this.unavailableTiers.join(', ')} unavailable on this data</div>`
        : `<div style="font-size: 11px; opacity: 0.7;">masking ${eff.join(', ')}</div>`;
      div.innerHTML =
        `<div><input type="checkbox" id="hierarchy-mask"` +
        `${this.enabled ? ' checked' : ''}>` +
        `<label for="hierarchy-mask">Hide edges between related phecodes</label></div>` +
        note;
      document.body.appendChild(div);
      const self = this;
      div.querySelector('#hierarchy-mask').addEventListener('change', function () {
        self.enabled = this.checked;
        performance.mark('mask-toggle-start');
        onChange();
        performance.mark('mask-toggle-end');
        performance.measure('mask-toggle', 'mask-toggle-start', 'mask-toggle-end');
      });
      return div;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = HierarchyMask;
  global.HierarchyMask = HierarchyMask;
}(typeof window !== 'undefined' ? window : globalThis));
