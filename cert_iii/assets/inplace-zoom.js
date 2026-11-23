/* ══════════════════════════════════════════════════════════════════════
   inplace-zoom.js — zoom an <svg> diagram where it sits (no pop-up).

   InPlaceZoom.attach(svg, { tapToZoom, wrap, group, onChange, barIn, barBefore })
     - −, %, + and reset buttons are added to the svg's parent (top-right).
       Zooms in to 200% and out to 50% (smaller than its panel); +/− step 10%.
     - group: diagrams given the same group name share ONE set of buttons
       (on the first one attached) and always share a zoom level — zooming any
       of them zooms them all; each still pans on its own.
     - While zoomed: drag (mouse or one finger) pans; wheel / pinch zooms.
       Unzoomed, the wheel and a one-finger swipe scroll the page as normal.
       Ctrl+wheel (a laptop trackpad pinch) zooms at any time.
     - tapToZoom: a plain tap/click zooms 2× around that spot and the next tap
       zooms back out — for diagrams with nothing tappable inside them (the
       quiz circuit panels). Leave it off for interactive diagrams (the
       breadboard simulators), where taps belong to the page.
     - wrap: put the svg in its own box, with the buttons in a strip ABOVE it
       rather than over its corner (for drawings whose labels reach the top
       edge, and when the svg's parent holds other content too).
     - barIn / barBefore: put the buttons inside barIn (before barBefore) — a
       toolbar the page already has — instead of on the diagram.
     - Drags that start on a slider, button, link or other form control are
       left to it (never pan) — e.g. a range input laid over a drawing.
     - onChange(scale): called after every zoom/pan/reset (e.g. to re-place
       pop-ups that are positioned from the drawing).
     - A drag never fires the page's own click handlers (the click that ends
       a pan is swallowed), so panning across tappable holes is safe.
     - Zooming works by narrowing the svg's own viewBox, so lines and text stay
       sharp. If anything else changes the viewBox (a quiz swapping figures
       per question), that becomes the new full view and the zoom resets.
       The full view is kept in svg.dataset.baseViewBox (print uses it).

   InPlaceZoom.attachUnit(el, { barAbove })
     - Zooms a whole block of the page (several diagrams and whatever sits
       between them) as ONE unit, so the gaps scale with the diagrams. Same
       buttons (top-right of el), drag/wheel/pinch rules and 50%–200% range;
       scales el's contents with a CSS transform and clips to el's box.
       Taps are left to the page (like tapToZoom off). barAbove: buttons in a
       strip just above el instead of over its top-right corner.

   quiz-engine.js attaches this automatically to every quiz circuit panel
   that used to open the zoom pop-up; other pages include this file and call
   attach() themselves.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.InPlaceZoom) return;

  const MAX = 2, MIN = 0.5, TAP_SCALE = 2, DRAG_PX = 6;
  // +/− move in 10% steps on a 10% grid (so 100% is always reachable);
  // wheel/pinch are smooth but settle on 100% when they pass within 4% of it.
  const stepScale = (s, dir) => Math.round(s * 10 + dir) / 10;
  const settle = s => { s = Math.min(MAX, Math.max(MIN, s)); return Math.abs(s - 1) < 0.04 ? 1 : s; };

  function injectStyle() {
    if (document.getElementById('inplaceZoomStyle')) return;
    const st = document.createElement('style');
    st.id = 'inplaceZoomStyle';
    st.textContent = `
.ipz-controls { position:absolute; right:.5rem; top:.5rem; display:flex; gap:.3rem; z-index:5; }
.ipz-controls.ipz-row { position:static; justify-content:flex-end; margin:0 0 .3rem; }
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
svg.ipz-zoomed, .ipz-stage.ipz-zoomed { cursor:grab; }
svg.ipz-tap.ipz-zoomed { cursor:zoom-out; }
svg.ipz-panning, .ipz-stage.ipz-panning { cursor:grabbing !important; }
@media print { .ipz-controls { display:none; } }`;
    document.head.appendChild(st);
  }

  function parseVB(s) {
    const v = (s || '').trim().split(/[\s,]+/).map(Number);
    return v.length === 4 && v.every(isFinite) && v[2] > 0 && v[3] > 0 ? { x: v[0], y: v[1], w: v[2], h: v[3] } : null;
  }

  const groups = {};                               // group name → [controllers]

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
    const members = opts.group ? (groups[opts.group] = groups[opts.group] || []) : null;
    const hasBar = !members || members.length === 0;  // grouped: only the first gets buttons
    const bar = document.createElement('div');
    bar.className = 'ipz-controls';
    bar.innerHTML = '<button type="button" class="ipz-out" title="Zoom out" aria-label="Zoom out">−</button>'
      + '<button type="button" class="ipz-level" disabled aria-live="polite">100%</button>'
      + '<button type="button" class="ipz-in" title="Zoom in" aria-label="Zoom in">+</button>'
      + '<button type="button" class="ipz-reset" title="Reset zoom" aria-label="Reset zoom">⟲</button>';
    if (hasBar) {
      if (opts.barIn) {                                                            // a spot the page chose (e.g. a toolbar)
        bar.style.position = 'static';
        opts.barIn.insertBefore(bar, opts.barBefore || null);
      } else if (opts.wrap) { bar.classList.add('ipz-row'); host.insertBefore(bar, svg); }  // own strip above the diagram
      else host.appendChild(bar);                                                  // over its top-right corner
    }
    // Keep button clicks away from the panel's own onclick (and from the page).
    bar.addEventListener('click', e => e.stopPropagation());
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    const bOut = bar.querySelector('.ipz-out'), bIn = bar.querySelector('.ipz-in'),
          bReset = bar.querySelector('.ipz-reset'), bLevel = bar.querySelector('.ipz-level');
    if (opts.tapToZoom) svg.classList.add('ipz-tap');

    function clamp() {                           // zoomed out below 100%: keep it centred
      const w = base.w / scale, h = base.h / scale;
      vx = w >= base.w ? base.x - (w - base.w) / 2 : Math.min(Math.max(vx, base.x), base.x + base.w - w);
      vy = h >= base.h ? base.y - (h - base.h) / 2 : Math.min(Math.max(vy, base.y), base.y + base.h - h);
    }
    function apply() {
      clamp();
      const w = base.w / scale, h = base.h / scale;
      lastSet = Math.abs(scale - 1) < 0.001 ? `${base.x} ${base.y} ${base.w} ${base.h}`
                            : `${+vx.toFixed(3)} ${+vy.toFixed(3)} ${+w.toFixed(3)} ${+h.toFixed(3)}`;
      svg.setAttribute('viewBox', lastSet);
      const zoomed = scale > 1.001;
      svg.classList.toggle('ipz-zoomed', zoomed);
      // Zoomed: one finger pans the diagram. Unzoomed: one finger scrolls the page.
      svg.style.touchAction = zoomed ? 'none' : 'pan-x pan-y';
      bOut.disabled = scale <= MIN + 0.001;
      bReset.disabled = Math.abs(scale - 1) < 0.001;
      bIn.disabled = scale >= MAX - 0.001;
      bLevel.textContent = Math.round(scale * 100) + '%';
      if (opts.onChange) opts.onChange(scale);
    }
    // Screen point → svg user units (allows for preserveAspectRatio letterboxing).
    function toUser(cx, cy) {
      const m = svg.getScreenCTM();
      if (!m) return { x: vx + base.w / scale / 2, y: vy + base.h / scale / 2 };
      const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    }
    function zoomAt(cx, cy, newScale, fromGroup) {
      newScale = settle(newScale);
      if (cx == null) {                            // buttons: zoom about the middle of the view
        const r = svg.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      }
      const p = toUser(cx, cy);
      const w0 = base.w / scale, h0 = base.h / scale, w1 = base.w / newScale, h1 = base.h / newScale;
      vx = p.x - (p.x - vx) * (w1 / w0);
      vy = p.y - (p.y - vy) * (h1 / h0);
      scale = newScale;
      apply();
      if (members && !fromGroup) members.forEach(m => { if (m !== ctrl) m._zoom(scale); });
    }
    function reset(fromGroup) {
      scale = 1; vx = base.x; vy = base.y; apply();
      if (members && fromGroup !== true) members.forEach(m => { if (m !== ctrl) m._reset(); });
    }

    bIn.addEventListener('click', () => zoomAt(null, null, stepScale(scale, +1)));
    bOut.addEventListener('click', () => zoomAt(null, null, stepScale(scale, -1)));
    bReset.addEventListener('click', () => reset());

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
      if (!e.ctrlKey && Math.abs(scale - 1) < 0.001) return;   // unzoomed: let the page scroll
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      zoomAt(e.clientX, e.clientY, scale * f);
    }, { passive: false });

    // ── pointers: drag to pan, two fingers to pinch ──
    const pts = new Map();
    let dragged = false, startX = 0, startY = 0, pinch = null;
    svg.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest && e.target.closest('input, select, textarea, button, a, label')) return;
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
        if (Math.abs(scale - 1) >= 0.001) reset(); else zoomAt(e.clientX, e.clientY, TAP_SCALE);
      }
    }, true);

    const ctrl = {
      reset: () => reset(),
      zoomAt: (s) => zoomAt(null, null, s),
      get scale() { return scale; },
      _zoom: (s) => zoomAt(null, null, s, true),  // from another group member
      _reset: () => reset(true),
    };
    if (members) { members.push(ctrl); if (members.length > 1) zoomAt(null, null, members[0].scale, true); }
    apply();
    return (svg._ipz = ctrl);
  }

  // ── a whole block as one unit (CSS transform on a stage inside el) ──
  function attachUnit(el, opts) {
    if (!el || el._ipz) return el && el._ipz;
    opts = opts || {};
    injectStyle();
    const stage = document.createElement('div');
    stage.className = 'ipz-stage';
    stage.style.transformOrigin = '0 0';
    // fill el and be the box absolutely-placed children measure from, zoomed or not
    // (a transform would otherwise switch their containing block mid-zoom)
    stage.style.position = 'relative';
    stage.style.height = '100%';
    while (el.firstChild) stage.appendChild(el.firstChild);
    el.appendChild(stage);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.overflow = 'hidden';

    const bar = document.createElement('div');
    bar.className = 'ipz-controls';
    bar.innerHTML = '<button type="button" class="ipz-out" title="Zoom out" aria-label="Zoom out">−</button>'
      + '<button type="button" class="ipz-level" disabled aria-live="polite">100%</button>'
      + '<button type="button" class="ipz-in" title="Zoom in" aria-label="Zoom in">+</button>'
      + '<button type="button" class="ipz-reset" title="Reset zoom" aria-label="Reset zoom">⟲</button>';
    if (opts.barAbove) { bar.classList.add('ipz-row'); el.parentNode.insertBefore(bar, el); }  // own strip above el
    else el.appendChild(bar);                                                                  // over el's top-right corner
    bar.addEventListener('click', e => e.stopPropagation());
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    const bOut = bar.querySelector('.ipz-out'), bIn = bar.querySelector('.ipz-in'),
          bReset = bar.querySelector('.ipz-reset'), bLevel = bar.querySelector('.ipz-level');

    let scale = 1, tx = 0, ty = 0;
    const W = () => stage.offsetWidth, H = () => stage.offsetHeight;  // unscaled size (transforms don't change layout)
    function clamp() {
      const w = W() * scale, h = H() * scale;
      tx = w <= W() ? (W() - w) / 2 : Math.min(0, Math.max(W() - w, tx));
      ty = h <= H() ? (H() - h) / 2 : Math.min(0, Math.max(H() - h, ty));
    }
    function apply() {
      clamp();
      const one = Math.abs(scale - 1) < 0.001;
      stage.style.transform = one ? '' : `translate(${tx}px, ${ty}px) scale(${scale})`;
      const zoomed = scale > 1.001;
      stage.classList.toggle('ipz-zoomed', zoomed);
      stage.style.touchAction = zoomed ? 'none' : 'pan-x pan-y';
      bOut.disabled = scale <= MIN + 0.001;
      bReset.disabled = one;
      bIn.disabled = scale >= MAX - 0.001;
      bLevel.textContent = Math.round(scale * 100) + '%';
    }
    // client point → position inside the stage's unscaled box
    function local(cx, cy) {
      const r = stage.getBoundingClientRect();     // includes the transform
      return { x: (cx - r.left) / scale, y: (cy - r.top) / scale };
    }
    function zoomAt(cx, cy, newScale) {
      newScale = settle(newScale);
      const box = el.getBoundingClientRect();
      if (cx == null) { cx = box.left + box.width / 2; cy = box.top + box.height / 2; }
      const p = local(cx, cy), sr = stage.getBoundingClientRect();
      const ox = sr.left - tx, oy = sr.top - ty;   // stage origin with no transform
      tx = (cx - ox) - p.x * newScale;
      ty = (cy - oy) - p.y * newScale;
      scale = newScale;
      apply();
    }
    function reset() { scale = 1; tx = ty = 0; apply(); }
    bIn.addEventListener('click', () => zoomAt(null, null, stepScale(scale, +1)));
    bOut.addEventListener('click', () => zoomAt(null, null, stepScale(scale, -1)));
    bReset.addEventListener('click', reset);

    stage.addEventListener('wheel', e => {
      if (!e.ctrlKey && Math.abs(scale - 1) < 0.001) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)));
    }, { passive: false });

    const pts = new Map();
    let dragged = false, sx = 0, sy = 0, pinch = null;
    stage.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest && e.target.closest('input, select, textarea, button, a, label')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { dragged = false; sx = e.clientX; sy = e.clientY; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: scale }; dragged = true; }
    });
    stage.addEventListener('pointermove', e => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
        return;
      }
      if (scale <= 1.001) return;
      if (!dragged && Math.hypot(cur.x - sx, cur.y - sy) < DRAG_PX) return;
      if (!dragged) { dragged = true; try { stage.setPointerCapture(e.pointerId); } catch (_) {} stage.classList.add('ipz-panning'); }
      tx += cur.x - prev.x; ty += cur.y - prev.y;
      apply();
    });
    function up(e) { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) stage.classList.remove('ipz-panning'); }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('click', e => {
      if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; }
    }, true);

    apply();
    return (el._ipz = { reset, zoomAt: s => zoomAt(null, null, s), get scale() { return scale; } });
  }

  window.InPlaceZoom = { attach, attachUnit };
})();
