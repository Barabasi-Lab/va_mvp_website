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

  // Styling for the "About" panels, shared by all three pages. They used to
  // be laid out with a fixed max-width and runs of <br><br>, which read badly
  // and did not adapt to the window.
  (function injectAboutStyles() {
    if (document.getElementById('about-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'about-panel-styles';
    style.textContent = `
      .about-panel {
        /* padding must count inside the width, or the panel overhangs the
           screen edge by exactly its horizontal padding on narrow windows */
        box-sizing: border-box;
        margin-top: 10px;
        padding: 16px 20px;
        background: rgba(0, 0, 0, 0.88);
        border-radius: 6px;
        /* follows the window instead of a fixed 600/1000px */
        width: min(42rem, calc(100vw - 40px));
        max-height: calc(100vh - 110px);
        overflow-y: auto;
        line-height: 1.55;
        font-size: 14px;
        text-align: left;
      }
      .about-panel h2 {
        margin: 0 0 0.6em;
        font-size: 1.25em;
        font-weight: 600;
      }
      .about-panel h3 {
        margin: 1.4em 0 0.35em;
        font-size: 1em;
        font-weight: 600;
        opacity: 0.75;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .about-panel p { margin: 0 0 0.75em; }
      .about-panel p:last-child { margin-bottom: 0; }
      .about-panel ul { margin: 0 0 0.75em; padding-left: 1.2em; }
      .about-panel li { margin: 0 0 0.3em; }
      .about-panel a { color: #8ecbff; }
    `;
    document.head.appendChild(style);
  })();

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
        // Clear both before measuring. The transform does not affect
        // offsetHeight but maxHeight does, so leaving a previous run's clip
        // in place makes `natural` the clipped height - the next fit then
        // decides it fits, removes the clip, and the column overflows again
        // on the following pass.
        wrap.style.transform = 'none';
        wrap.style.maxHeight = '';
        const natural = wrap.offsetHeight;
        const readout = document.getElementById('bottom-left-stack');
        // extraReserve lets a page keep room below the column for something
        // else - page 1 parks its hover label there.
        const reserved = (readout ? readout.offsetHeight + 20 : 0)
                       + (global.Panels.extraReserve || 0);
        const avail = window.innerHeight - top - reserved - 10;
        const needed = natural > 0 ? avail / natural : 1;
        const scale = needed >= 1 ? 1 : Math.max(minScale, needed);
        wrap.style.transform = scale === 1 ? 'none' : `scale(${scale})`;

        // Shrinking stops at minScale, and below that the column used to
        // keep its full height and run over whatever was beneath it - the
        // readout on page 2, the hover label on page 1. One more panel was
        // enough to cross that line on a 1152x560 window. Past the clamp,
        // scroll instead of overflowing: the text stays readable and the
        // column stays inside the space it has. maxHeight is applied in
        // pre-transform units, hence the division.
        if (scale > needed) {
          wrap.style.maxHeight = `${Math.max(0, avail / scale)}px`;
          wrap.style.overflowY = 'auto';
          wrap.style.overflowX = 'hidden';
        } else {
          wrap.style.maxHeight = '';
          wrap.style.overflowY = '';
          wrap.style.overflowX = '';
        }
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
      // Three lines of warning is a large change in the readout's height,
      // and the column above it is sized against that height.
      if (global.Panels.__refit) requestAnimationFrame(global.Panels.__refit);
    }
  };
})(window);
