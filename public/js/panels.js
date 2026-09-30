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
     * Lay the left-hand control panels out top to bottom, and shrink them to
     * fit the window.
     *
     * They used to be absolutely positioned at hand-written offsets, which
     * collided as soon as a panel grew. Now they flow inside one wrapper, and
     * if that wrapper is taller than the space above the bottom-left readout
     * the whole column is scaled down - text and gaps together - so the
     * filters stay on screen on a short laptop display.
     *
     * Call after the panels exist; it re-runs itself on resize.
     */
    stackLeft(selectors, { top = 10, left = 10, gap = 12, minScale = 0.55 } = {}) {
      let wrap = document.getElementById('left-stack');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'left-stack';
        Object.assign(wrap.style, {
          position: 'absolute',
          transformOrigin: 'top left',
          zIndex: '900'
        });
        document.body.appendChild(wrap);
      }
      wrap.style.top = `${top}px`;
      wrap.style.left = `${left}px`;

      const els = selectors
        .map(sel => (typeof sel === 'string' ? document.querySelector(sel) : sel))
        .filter(Boolean);
      els.forEach((el, i) => {
        wrap.appendChild(el);                 // also reorders, so order is the order given
        el.style.position = 'static';
        el.style.top = '';
        el.style.left = '';
        el.style.marginBottom = i === els.length - 1 ? '0px' : `${gap}px`;
      });

      const fit = () => {
        wrap.style.transform = 'none';
        const natural = wrap.offsetHeight;
        const readout = document.getElementById('bottom-left-stack');
        // extraReserve lets a page keep room below the column for something
        // else - page 1 parks its hover label there.
        const reserved = (readout ? readout.offsetHeight + 20 : 0)
                       + (global.Panels.extraReserve || 0);
        const avail = window.innerHeight - top - reserved - 10;
        const scale = natural > avail && natural > 0
          ? Math.max(minScale, avail / natural)
          : 1;
        wrap.style.transform = scale === 1 ? 'none' : `scale(${scale})`;
      };
      fit();

      if (!wrap.dataset.resizeBound) {
        wrap.dataset.resizeBound = '1';
        window.addEventListener('resize', () => requestAnimationFrame(fit));
      }
      // the readout changes height as counts and labels change, which moves
      // the space this column has to live in
      global.Panels.__refit = fit;
      return wrap;
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
      if (global.Panels.__refit) requestAnimationFrame(global.Panels.__refit);
      if (global.Panels.onResize) requestAnimationFrame(global.Panels.onResize);
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
