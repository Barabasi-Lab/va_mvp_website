/**
 * Bottom-left overlays shared by all three pages: a live count of what is on
 * screen, and the warning shown when the SNP cap is actually truncating the
 * view. Both sit in one stack so they cannot overlap each other; the summary
 * is above the warning.
 *
 * Styling follows the existing control panels - white text, no background,
 * click-through.
 */
(function (global) {
  const STACK_ID = 'bottom-left-stack';

  function stack() {
    let el = document.getElementById(STACK_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = STACK_ID;
      Object.assign(el.style, {
        position: 'absolute',
        bottom: '10px',
        left: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '360px',
        color: 'white',
        fontSize: '16.5px',
        lineHeight: '1.45',
        pointerEvents: 'none',
        zIndex: '900'
      });
      document.body.appendChild(el);
    }
    return el;
  }

  // `order` keeps the summary above the warning regardless of which appears
  // first, since either can be created before the other.
  function slot(id, order) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.order = String(order);
      stack().appendChild(el);
    }
    return el;
  }

  function line(label, value) {
    return `<div><span style="opacity:.7">${label}</span> ` +
           `<span style="font-variant-numeric:tabular-nums">${value}</span></div>`;
  }

  const fmt = n => Number(n).toLocaleString();

  global.Panels = {
    /**
     * Lay the left-hand control panels out top to bottom from measured
     * heights, in the order given. They were absolutely positioned at
     * hand-written offsets, which collided as soon as a panel grew - the
     * ancestry list is a different length per phenotype, and the edge
     * thickness radios and reset button were added underneath it.
     *
     * Call after the panels exist, and again if one changes height.
     */
    stackLeft(selectors, { top = 10, left = 10, gap = 12 } = {}) {
      let y = top;
      for (const sel of selectors) {
        const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
        if (!el) continue;
        el.style.position = 'absolute';
        el.style.left = `${left}px`;
        el.style.top = `${y}px`;
        y += el.getBoundingClientRect().height + gap;
      }
      return y;
    },

    /**
     * Live counts for whatever is currently drawn. `entries` is a list of
     * [label, value] pairs; pages decide what is meaningful for them.
     */
    summary(entries) {
      const el = slot('summary-panel', 1);
      el.innerHTML = entries
        .filter(e => e && e[1] !== null && e[1] !== undefined)
        .map(([label, value]) => line(label, typeof value === 'number' ? fmt(value) : value))
        .join('');
    },

    /**
     * The cap warning. `show` should be true only when the view is genuinely
     * truncated - see the callers for why "the fetch was capped" is not the
     * same question.
     */
    snpWarning(limit, show) {
      const el = slot('snp-warning', 2);
      el.style.color = '#ffcc66';
      el.textContent = show
        ? `SNP count exceeds the maximum that can be displayed: ${fmt(limit)} ` +
          `SNPs with strongest evidence shown. Download the data to see all SNPs.`
        : '';
    }
  };
})(window);
