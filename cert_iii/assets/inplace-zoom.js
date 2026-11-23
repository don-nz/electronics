/* ══════════════════════════════════════════════════════════════════════
   inplace-zoom.js — zoom an <svg> diagram where it sits (no pop-up).

   InPlaceZoom.attach(svg, { tapToZoom, wrap })
     - +, − and reset buttons are added to the svg's parent (bottom-right).
     - While zoomed: drag (mouse or one finger) pans; wheel / pinch zooms.
       Unzoomed, the wheel and a one-finger swipe scroll the page as normal.
       Ctrl+wheel (a laptop trackpad pinch) zooms at any time.
     - tapToZoom: a plain tap/click zooms 2× around that spot and the next tap
       zooms back out — for diagrams with nothing tappable inside them (the
       quiz circuit panels). Leave it off for interactive diagrams (the
       breadboard simulators), where taps belong to the page.
     - wrap: put the svg in its own positioned box for the buttons (use when
       the svg's parent holds other content too).
     - A drag never fires the page's own click handlers (the click that ends
       a pan is swallowed), so panning across tappable holes is safe.
     - Zooming works by narrowing the svg's own viewBox, so lines and text stay
       sharp. If anything else changes the viewBox (a quiz swapping figures
       per question), that becomes the new full view and the zoom resets.
       The full view is kept in svg.dataset.baseViewBox (print uses it).

   quiz-engine.js attaches this automatically to every quiz circuit panel
   that used to open the zoom pop-up; other pages include this file and call
   attach() themselves.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.InPlaceZoom) return;

  const MAX = 8, STEP = 1.5, TAP_SCALE = 2, DRAG_PX = 6;

  function injectStyle() {
    if (document.getElementById('inplaceZoomStyle')) return;
    const st = document.createElement('style');
    st.id = 'inplaceZoomStyle';
    st.textContent = `
.ipz-controls { position:absolute; right:.5rem; bottom:.5rem; display:flex; gap:.3rem; z-index:5; }
.ipz-controls button {
  width:2rem; height:2rem; padding:0; border-radius:6px; cursor:pointer;
  font:700 1.05rem/1 system-ui, sans-serif;
  background:var(--colour-panel, #fff); color:var(--colour-text, #1e293b);
  border:1px solid var(--colour-border, #cbd5e1); opacity:.85;
  display:flex; align-items:center; justify-content:center;
}
.ipz-controls button:hover { opacity:1; }
.ipz-controls button:disabled { opacity:.35; cursor:default; }
.ipz-controls .ipz-level { min-width:2.6rem; width:auto; font-size:.7rem; cursor:default; opacity:.7; padding:0 .3rem; }
svg.ipz-tap { cursor:zoom-in; }
svg.ipz-zoomed { cursor:grab; }
svg.ipz-tap.ipz-zoomed { cursor:zoom-out; }
svg.ipz-panning { cursor:grabbing !important; }
@media print { .ipz-controls { display:none; } }`;
    document.head.appendChild(st);
  }

  function parseVB(s) {
    const v = (s || '').trim().split(/[\s,]+/).map(Number);
    return v.length === 4 && v.every(isFinite) && v[2] > 0 && v[3] > 0 ? { x: v[0], y: v[1], w: v[2], h: v[3] } : null;
  }

  function attach(svg, opts) {
    if (!svg || svg._ipz) return svg && svg._ipz;
    opts = opts || {};
    injectStyle();

    let base = parseVB(svg.getAttribute('viewBox'));
    if (!base) {                                   // no viewBox — use the drawn size
      const r = svg.getBoundingClientRect();
      base = { x: 0, y: 0, w: r.width || 300, h: r.height || 150 };
      svg.setAttribute('viewBox', `0 0 ${base.w} ${base.h}`);
    }
    let scale = 1, vx = base.x, vy = base.y, lastSet = svg.getAttribute('viewBox');
    svg.dataset.baseViewBox = lastSet;

    // ── controls ── (opts.wrap: give the svg its own box first, so the buttons
    // sit in the diagram's corner even when its parent holds other content)
    if (opts.wrap) {
      const w = document.createElement('div');
      w.className = 'ipz-wrap';
      w.style.position = 'relative';
      svg.parentNode.insertBefore(w, svg);
      w.appendChild(svg);
    }
    const host = svg.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.querySelectorAll(':scope > .zoom-hint').forEach(h => { h.style.display = 'none'; });
    const bar = document.createElement('div');
    bar.className = 'ipz-controls';
    bar.innerHTML = '<button type="button" class="ipz-out" title="Zoom out" aria-label="Zoom out">−</button>'
      + '<button type="button" class="ipz-level" disabled aria-live="polite">100%</button>'
      + '<button type="button" class="ipz-in" title="Zoom in" aria-label="Zoom in">+</button>'
      + '<button type="button" class="ipz-reset" title="Reset zoom" aria-label="Reset zoom">⟲</button>';
    host.appendChild(bar);
    // Keep button clicks away from the panel's own onclick (and from the page).
    bar.addEventListener('click', e => e.stopPropagation());
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    const bOut = bar.querySelector('.ipz-out'), bIn = bar.querySelector('.ipz-in'),
          bReset = bar.querySelector('.ipz-reset'), bLevel = bar.querySelector('.ipz-level');
    if (opts.tapToZoom) svg.classList.add('ipz-tap');

    function clamp() {
      const w = base.w / scale, h = base.h / scale;
      vx = Math.min(Math.max(vx, base.x), base.x + base.w - w);
      vy = Math.min(Math.max(vy, base.y), base.y + base.h - h);
    }
    function apply() {
      clamp();
      const w = base.w / scale, h = base.h / scale;
      lastSet = scale === 1 ? `${base.x} ${base.y} ${base.w} ${base.h}`
                            : `${+vx.toFixed(3)} ${+vy.toFixed(3)} ${+w.toFixed(3)} ${+h.toFixed(3)}`;
      svg.setAttribute('viewBox', lastSet);
      const zoomed = scale > 1.001;
      svg.classList.toggle('ipz-zoomed', zoomed);
      // Zoomed: one finger pans the diagram. Unzoomed: one finger scrolls the page.
      svg.style.touchAction = zoomed ? 'none' : 'pan-x pan-y';
      bOut.disabled = bReset.disabled = !zoomed;
      bIn.disabled = scale >= MAX - 0.001;
      bLevel.textContent = Math.round(scale * 100) + '%';
    }
    // Screen point → svg user units (allows for preserveAspectRatio letterboxing).
    function toUser(cx, cy) {
      const m = svg.getScreenCTM();
      if (!m) return { x: vx + base.w / scale / 2, y: vy + base.h / scale / 2 };
      const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    }
    function zoomAt(cx, cy, newScale) {
      newScale = Math.min(MAX, Math.max(1, newScale));
      if (cx == null) {                            // buttons: zoom about the middle of the view
        const r = svg.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      }
      const p = toUser(cx, cy);
      const w0 = base.w / scale, h0 = base.h / scale, w1 = base.w / newScale, h1 = base.h / newScale;
      vx = p.x - (p.x - vx) * (w1 / w0);
      vy = p.y - (p.y - vy) * (h1 / h0);
      scale = newScale;
      apply();
    }
    function reset() { scale = 1; vx = base.x; vy = base.y; apply(); }

    bIn.addEventListener('click', () => zoomAt(null, null, scale * STEP));
    bOut.addEventListener('click', () => zoomAt(null, null, scale / STEP));
    bReset.addEventListener('click', reset);

    // ── someone else changed the viewBox → new full view ──
    new MutationObserver(() => {
      const now = svg.getAttribute('viewBox');
      if (now === lastSet) return;
      const b = parseVB(now);
      if (!b) return;
      base = b; svg.dataset.baseViewBox = now; scale = 1; vx = b.x; vy = b.y; lastSet = now;
      apply();
    }).observe(svg, { attributes: true, attributeFilter: ['viewBox'] });

    // ── wheel ──
    svg.addEventListener('wheel', e => {
      if (!e.ctrlKey && scale <= 1.001) return;    // unzoomed: let the page scroll
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      zoomAt(e.clientX, e.clientY, scale * f);
    }, { passive: false });

    // ── pointers: drag to pan, two fingers to pinch ──
    const pts = new Map();
    let dragged = false, startX = 0, startY = 0, pinch = null;
    svg.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { dragged = false; startX = e.clientX; startY = e.clientY; }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: scale };
        dragged = true;
      }
    });
    svg.addEventListener('pointermove', e => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.s * d / pinch.d);
        return;
      }
      if (scale <= 1.001) return;                  // nothing to pan
      if (!dragged && Math.hypot(cur.x - startX, cur.y - startY) < DRAG_PX) return;
      if (!dragged) { dragged = true; try { svg.setPointerCapture(e.pointerId); } catch (_) {} svg.classList.add('ipz-panning'); }
      const m = svg.getScreenCTM();
      const k = m ? 1 / m.a : base.w / scale / (svg.getBoundingClientRect().width || 1);
      vx -= (cur.x - prev.x) * k;
      vy -= (cur.y - prev.y) * k;
      apply();
    });
    function up(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) svg.classList.remove('ipz-panning');
    }
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);

    // A drag/pinch must not count as a tap on whatever it ended over.
    svg.addEventListener('click', e => {
      if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; return; }
      if (opts.tapToZoom) {
        e.stopPropagation();
        if (scale > 1.001) reset(); else zoomAt(e.clientX, e.clientY, TAP_SCALE);
      }
    }, true);

    apply();
    return (svg._ipz = { reset, zoomAt: (s) => zoomAt(null, null, s), get scale() { return scale; } });
  }

  window.InPlaceZoom = { attach };
})();
