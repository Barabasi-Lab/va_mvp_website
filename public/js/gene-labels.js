/**
 * Stage 2: group labels bracketing runs of SNPs that share a nearest gene.
 *
 * Off by default, behind "Show gene labels". A group is a maximal run of
 * SNPs that are consecutive in display order and share `nearest_gene`;
 * only groups of at least K are labelled. K is one config value, and
 * `geneLabelK` in the query string overrides it so the evaluation can
 * sweep it without a rebuild.
 *
 * Display order is recovered from the drawn geometry rather than from the
 * array the caller happens to hold: page 2 sorts by angle around the ring
 * centre, page 3 by vertical position down the column. Both pages place
 * their SNPs once and reuse the coordinates across redraws, so reading the
 * order back off the screen is the only way to be sure it matches what a
 * reader sees.
 *
 * Performance, per docs/duckdb-migration.md: the grouping is one linear
 * pass, collision testing is over the handful of placed labels rather than
 * over nodes, and nothing is drawn while the toggle is off - no hidden
 * elements waiting in the DOM.
 */
(function (global) {
  'use strict';

  const GeneLabels = {
    K: 3,                 // minimum SNPs in a labelled group
    enabled: false,
    available: true,
    lastStats: null,      // {groups, drawn, hidden, snpsCovered, snpsTotal}

    readParams(params) {
      this.enabled = params.get('geneLabels') === '1';
      const k = parseInt(params.get('geneLabelK'), 10);
      if (Number.isFinite(k) && k >= 1) this.K = k;
      return this;
    },

    /**
     * The gene a run is keyed on, or null for a SNP that should not be in
     * one at all.
     *
     * Keying on the display string was wrong twice over. "APOL2" and
     * "APOL2 (6 kb)" are the same gene and split into two brackets, and
     * "position unknown" is not a gene but 13 consecutive SNPs carrying
     * that string were labelled as though it were. Runs of
     * "intergenic (nearest: X, 1.2 Mb)" are excluded for the same reason:
     * a bracket saying X over SNPs more than a megabase from X claims
     * something the annotation does not support.
     */
    geneKey(n) {
      const g = n && n.nearestGene;
      if (!g) return null;
      if (g.startsWith('position unknown') || g.startsWith('intergenic (')) return null;
      if (g.startsWith('MHC region')) return 'MHC region';
      return g.split(' (')[0].split(' +')[0];
    },

    /**
     * Maximal runs of consecutive SNPs sharing a nearest gene.
     * `ordered` is the SNP nodes already in display order.
     */
    groups(ordered) {
      const out = [];
      let run = null;
      for (const n of ordered) {
        const gene = this.geneKey(n);
        if (run && gene && run.gene === gene) {
          run.nodes.push(n);
        } else {
          if (run && run.nodes.length) out.push(run);
          run = gene ? { gene: gene, nodes: [n] } : null;
        }
      }
      if (run && run.nodes.length) out.push(run);
      return out;
    },

    /** Label text. The key is already the bare symbol, or "MHC region". */
    text(group) {
      return `${group.gene} (${group.nodes.length})`;
    },

    /**
     * Greedy placement, largest group first, skipping any label whose box
     * overlaps one already placed. That is the "larger group wins" rule,
     * and the skipped count is what the readability evaluation reports.
     */
    place(candidates) {
      const placed = [], hidden = [];
      candidates.sort((a, b) => b.nodes.length - a.nodes.length);
      for (const c of candidates) {
        const hit = placed.some(p =>                      // over placed labels,
          !(c.box.x2 < p.box.x1 || c.box.x1 > p.box.x2 || // not over nodes
            c.box.y2 < p.box.y1 || c.box.y1 > p.box.y2));
        if (hit) hidden.push(c); else placed.push(c);
      }
      return { placed, hidden };
    },

    clear(svg) {
      svg.selectAll('.gene-label-layer').remove();
    },

    /**
     * Page 2: an arc bracket outside the SNP ring with the label set
     * radially beyond it.
     */
    drawRing(svg, snpNodes, opts) {
      this.clear(svg);
      if (!this.enabled || !snpNodes.length) { this.lastStats = null; return; }
      const { centerX, centerY } = opts;
      const ordered = snpNodes
        .map(n => ({ n: n, a: Math.atan2(n.y - centerY, n.x - centerX) }))
        .sort((p, q) => p.a - q.a)
        .map(p => p.n);
      const radius = Math.max(...ordered.map(
        n => Math.hypot(n.x - centerX, n.y - centerY)));
      const bracketR = radius + 18, labelR = radius + 40;
      const groups = this.groups(ordered).filter(g => g.nodes.length >= this.K);

      const angle = n => Math.atan2(n.y - centerY, n.x - centerX);
      const candidates = groups.map(g => {
        const a0 = angle(g.nodes[0]), a1 = angle(g.nodes[g.nodes.length - 1]);
        const mid = (a0 + a1) / 2;
        const label = this.text(g);
        const w = label.length * 7.2, h = 15;
        const cx = centerX + labelR * Math.cos(mid);
        const cy = centerY + labelR * Math.sin(mid);
        return { ...g, a0, a1, mid, label,
                 box: { x1: cx - w / 2, x2: cx + w / 2, y1: cy - h / 2, y2: cy + h / 2 },
                 cx, cy };
      });
      const { placed, hidden } = this.place(candidates);

      const layer = svg.append('g').attr('class', 'gene-label-layer')
        .style('pointer-events', 'none');
      const arc = d3.arc()
        .innerRadius(bracketR).outerRadius(bracketR + 2)
        .startAngle(d => d.a0 + Math.PI / 2).endAngle(d => d.a1 + Math.PI / 2);
      layer.selectAll('path').data(placed).enter().append('path')
        .attr('d', arc).attr('transform', `translate(${centerX},${centerY})`)
        .attr('fill', '#9ecae1').attr('opacity', 0.9);
      layer.selectAll('text').data(placed).enter().append('text')
        .attr('x', d => d.cx).attr('y', d => d.cy)
        .attr('text-anchor', d => (Math.cos(d.mid) < -0.1 ? 'end'
                                 : Math.cos(d.mid) > 0.1 ? 'start' : 'middle'))
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 13).attr('fill', '#cfe8ff')
        .text(d => d.label);

      this.lastStats = {
        groups: groups.length, drawn: placed.length, hidden: hidden.length,
        snpsCovered: placed.reduce((s, g) => s + g.nodes.length, 0),
        snpsTotal: ordered.length, k: this.K
      };
    },

    /** Page 3: a vertical bracket beside the chromosome-ordered column. */
    drawColumn(svg, snpNodes, opts) {
      this.clear(svg);
      if (!this.enabled || !snpNodes.length) { this.lastStats = null; return; }
      const ordered = snpNodes.slice().sort((a, b) => a.y - b.y);
      const x = Math.max(...ordered.map(n => n.x)) + 16;
      const groups = this.groups(ordered).filter(g => g.nodes.length >= this.K);
      const candidates = groups.map(g => {
        const y0 = g.nodes[0].y, y1 = g.nodes[g.nodes.length - 1].y;
        const label = this.text(g);
        return { ...g, y0, y1, label,
                 box: { x1: x + 6, x2: x + 6 + label.length * 7.2,
                        y1: (y0 + y1) / 2 - 8, y2: (y0 + y1) / 2 + 8 } };
      });
      const { placed, hidden } = this.place(candidates);

      const layer = svg.append('g').attr('class', 'gene-label-layer')
        .style('pointer-events', 'none');
      layer.selectAll('path').data(placed).enter().append('path')
        .attr('d', d => `M${x},${d.y0} L${x + 5},${d.y0} L${x + 5},${d.y1} L${x},${d.y1}`)
        .attr('stroke', '#9ecae1').attr('fill', 'none').attr('stroke-width', 1.5);
      layer.selectAll('text').data(placed).enter().append('text')
        .attr('x', x + 8).attr('y', d => (d.y0 + d.y1) / 2)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 12).attr('fill', '#cfe8ff').text(d => d.label);

      this.lastStats = {
        groups: groups.length, drawn: placed.length, hidden: hidden.length,
        snpsCovered: placed.reduce((s, g) => s + g.nodes.length, 0),
        snpsTotal: ordered.length, k: this.K
      };
    },

    /** The checkbox, in the page's own panel stack. */
    control(onChange) {
      const div = document.createElement('div');
      div.id = 'gene-labels-container';
      div.style.color = 'white';
      div.style.padding = '10px';
      div.innerHTML =
        `<div><input type="checkbox" id="gene-labels"` +
        `${this.enabled ? ' checked' : ''}>` +
        `<label for="gene-labels">Show gene labels</label></div>` +
        `<div style="font-size: 11px; opacity: 0.7;">runs of ${this.K}+ SNPs ` +
        `sharing a nearest gene</div>`;
      document.body.appendChild(div);
      const self = this;
      div.querySelector('#gene-labels').addEventListener('change', function () {
        self.enabled = this.checked;
        performance.mark('gene-labels-start');
        onChange();
        performance.mark('gene-labels-end');
        performance.measure('gene-labels', 'gene-labels-start', 'gene-labels-end');
      });
      return div;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GeneLabels;
  global.GeneLabels = GeneLabels;
}(typeof window !== 'undefined' ? window : globalThis));
