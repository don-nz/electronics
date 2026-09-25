/*
  Shared "build a step waveform" mechanic for cert_iii timing-diagram
  exercises. First used by UEEEC0069/exercises/digital_flip_flop_diagram.html
  (an SR-latch Q-output construction drill) — written as a shared file from
  the start (rather than proven page-local first, quiz-engine.js's own usual
  promotion path) because a second flip-flop/latch timing-diagram exercise
  is a known near-term follow-up.

  This is a GENUINE ALTERNATIVE to quiz-engine.js, not an addition to it:
  quiz-engine.js's whole shape is a paginated QUESTIONS[]/`cur` sequence of
  independent multi-choice-style questions. This mechanic is the opposite —
  ONE continuous, persistent, sequentially-built diagram with no "next
  question" concept at all. A page using this file has no reason to also
  load quiz-engine.js.

  What's SHARED here (generic, reusable by any future step-waveform
  exercise) vs PAGE-LOCAL (specific to one exercise's own domain logic):
  - Shared: random pulse-track generation, step-waveform SVG geometry/
    rendering, the sequential append-only piece-placement state machine,
    progress shading, per-column correctness checking, the piece palette UI.
  - Page-local: what the tracks MEAN (e.g. digital_flip_flop_diagram.html's
    own SR-latch mutual-exclusion constraint between S/R and its Set/Reset/
    Hold derivation rule for Q) — exactly the same shared-mechanic/
    page-local-content split as quiz-engine.js's `kind:'fill'` (generic
    slot-placement) vs. each file's own circuitConfig/QUESTIONS content.

  ── Geometry ──
  All tracks share one column width/row height so multiple stacked <svg>
  strips (S/R/Q) line up perfectly. A "level" is always 0 or 1 (this
  mechanic is single-bit only — no multi-level waveforms).

  ── Piece model ──
  A piece is one of:
    { type: 'flat', width: 1 | 2 | 3 }  — stays at the current level
    { type: 'rise' }                     — steps up 1 level, 1 column wide
    { type: 'fall' }                     — steps down 1 level, 1 column wide
  A "builder" is just `{ pieces: [] }` — an ORDERED, append-only list.
  Cursor position (which column/level comes next) is always DERIVED by
  replaying `pieces` from column 0/level 0, never tracked separately, so
  undo is a plain `pieces.pop()` with nothing else to reconcile.

  ── Usage sketch ──
    const builder = { pieces: [] };
    wbPlace(builder, { type: 'rise' }, totalCols);
    renderQTrackSVG(svgEl, builder, totalCols);
    ...
    const { results, allCorrect } = wbCheck(builder, correctLevels);
    renderQTrackSVG(svgEl, builder, totalCols, { results });
*/

const WB_COL_WIDTH = 30;
const WB_ROW_HEIGHT = 36;
const WB_PAD_Y = 8;

function wbLevelY(level) { return WB_PAD_Y + (1 - level) * WB_ROW_HEIGHT; }
function wbSvgHeight() { return WB_PAD_Y * 2 + WB_ROW_HEIGHT; }
function wbSvgWidth(cols, colWidth = WB_COL_WIDTH) { return cols * colWidth; }

// ── random generation ──
// Walks left to right emitting alternating random-width blocks of 0s and 1s.
// Fully generic — knows nothing about what the track represents.
function randomPulseTrack(n, opts = {}) {
  const minPulse = opts.minPulse ?? 1, maxPulse = opts.maxPulse ?? 3;
  const minGap = opts.minGap ?? 1, maxGap = opts.maxGap ?? 3;
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const levels = new Array(n).fill(0);
  let i = randInt(minGap, maxGap);
  while (i < n) {
    const pulseW = randInt(minPulse, maxPulse);
    for (let k = 0; k < pulseW && i < n; k++, i++) levels[i] = 1;
    i += randInt(minGap, maxGap);
  }
  return levels;
}

// ── SVG path geometry ──
// One column's path, including its entry riser if the level changed
// stepping INTO this column from the previous one (standard timing-diagram
// convention: an instant vertical edge at the column's left boundary, then
// flat across the column at the new level).
function wbColumnPathD(colIndex, prevLevel, level, colWidth = WB_COL_WIDTH) {
  const x0 = colIndex * colWidth, x1 = x0 + colWidth;
  const y1 = wbLevelY(level);
  if (prevLevel === level) return `M ${x0},${y1} L ${x1},${y1}`;
  const y0 = wbLevelY(prevLevel);
  return `M ${x0},${y0} L ${x0},${y1} L ${x1},${y1}`;
}

// Full read-only track (e.g. S/R) as one continuous path string.
function wbFullTrackPathD(levels, colWidth = WB_COL_WIDTH) {
  let d = '', prev = 0;
  levels.forEach((lvl, i) => { d += wbColumnPathD(i, prev, lvl, colWidth) + ' '; prev = lvl; });
  return d.trim();
}

// Graph-paper background shared by every track strip: a vertical line per
// column boundary plus the two level baselines.
function wbGridSVG(cols, colWidth = WB_COL_WIDTH) {
  const h = wbSvgHeight();
  let s = '';
  for (let i = 0; i <= cols; i++) {
    const x = i * colWidth;
    s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" class="wb-grid-line" />`;
  }
  s += `<line x1="0" y1="${wbLevelY(0)}" x2="${cols * colWidth}" y2="${wbLevelY(0)}" class="wb-grid-line wb-grid-baseline" />`;
  s += `<line x1="0" y1="${wbLevelY(1)}" x2="${cols * colWidth}" y2="${wbLevelY(1)}" class="wb-grid-line wb-grid-baseline" />`;
  return s;
}

// `opts.progressCols` (optional) shades [0, progressCols) the same way
// renderQTrackSVG shades the built portion of Q — used so S/R show the
// same "how far along we are" indicator as the track the student is
// actually building, even though S/R themselves are always fully drawn.
function renderReadOnlyTrackSVG(svgEl, levels, opts = {}) {
  const colWidth = opts.colWidth || WB_COL_WIDTH;
  svgEl.setAttribute('viewBox', `0 0 ${wbSvgWidth(levels.length, colWidth)} ${wbSvgHeight()}`);
  svgEl.setAttribute('preserveAspectRatio', 'none');
  const cls = opts.className || 'wb-track-path';
  let html = wbGridSVG(levels.length, colWidth);
  if (opts.progressCols > 0) {
    html += `<rect class="wb-progress-shade" x="0" y="0" width="${opts.progressCols * colWidth}" height="${wbSvgHeight()}" />`;
  }
  html += `<path class="${cls}" d="${wbFullTrackPathD(levels, colWidth)}" />`;
  svgEl.innerHTML = html;
}

// ── piece placement state ──
// Replays `builder.pieces` into one entry per PLACED column:
// { col, prevLevel, level } — the basis for both rendering and checking.
function wbBuiltColumnSegments(builder) {
  const segs = [];
  let col = 0, level = 0;
  builder.pieces.forEach(p => {
    if (p.type === 'flat') {
      for (let k = 0; k < p.width; k++) { segs.push({ col, prevLevel: level, level }); col++; }
    } else if (p.type === 'rise') {
      segs.push({ col, prevLevel: level, level: 1 }); level = 1; col++;
    } else if (p.type === 'fall') {
      segs.push({ col, prevLevel: level, level: 0 }); level = 0; col++;
    }
  });
  return segs;
}

function wbCursor(builder) {
  const segs = wbBuiltColumnSegments(builder);
  if (!segs.length) return { col: 0, level: 0 };
  const last = segs[segs.length - 1];
  return { col: last.col + 1, level: last.level };
}

// Structural guardrails only — NOT correctness. A flat piece can't overshoot
// the fixed track length; rise/fall can't go past the single-bit rail.
function wbCanPlace(builder, piece, totalCols) {
  const { col, level } = wbCursor(builder);
  const width = piece.type === 'flat' ? piece.width : 1;
  if (col + width > totalCols) return false;
  if (piece.type === 'rise' && level === 1) return false;
  if (piece.type === 'fall' && level === 0) return false;
  return true;
}

function wbPlace(builder, piece, totalCols) {
  if (!wbCanPlace(builder, piece, totalCols)) return false;
  builder.pieces.push(piece);
  return true;
}

function wbUndo(builder) { builder.pieces.pop(); }
function wbResetBuilder(builder) { builder.pieces.length = 0; }

// Per-column correctness against a target level array (only ever called
// once the builder is fully filled — this mechanic checks at the end).
function wbCheck(builder, correctLevels) {
  const segs = wbBuiltColumnSegments(builder);
  const results = segs.map(s => s.level === correctLevels[s.col]);
  return {
    results,
    allCorrect: results.length === correctLevels.length && results.every(Boolean),
    correctCount: results.filter(Boolean).length,
    total: correctLevels.length,
  };
}

// ── rendering the buildable track ──
// `opts.results` (from wbCheck) recolours each placed column correct/wrong;
// omitted, every placed column renders in the neutral "still building"
// colour. Always draws the full-width grid so the student can see how much
// track remains regardless of how much is placed so far.
function renderQTrackSVG(svgEl, builder, totalCols, opts = {}) {
  const colWidth = opts.colWidth || WB_COL_WIDTH;
  const segs = wbBuiltColumnSegments(builder);
  const cursorCol = segs.length;
  svgEl.setAttribute('viewBox', `0 0 ${wbSvgWidth(totalCols, colWidth)} ${wbSvgHeight()}`);
  svgEl.setAttribute('preserveAspectRatio', 'none');
  let html = wbGridSVG(totalCols, colWidth);
  if (cursorCol > 0) {
    html += `<rect class="wb-progress-shade" x="0" y="0" width="${cursorCol * colWidth}" height="${wbSvgHeight()}" />`;
  }
  segs.forEach(s => {
    const cls = opts.results ? (opts.results[s.col] ? 'wb-col-correct' : 'wb-col-wrong') : 'wb-col-building';
    html += `<path class="wb-q-path ${cls}" d="${wbColumnPathD(s.col, s.prevLevel, s.level, colWidth)}" />`;
  });
  svgEl.innerHTML = html;
}

// ── piece palette UI ──
function wbPieceLabel(piece) {
  if (piece.type === 'flat') return piece.width === 1 ? '1 col' : piece.width + ' cols';
  if (piece.type === 'rise') return 'Rise';
  if (piece.type === 'fall') return 'Fall';
  return '';
}

function wbPieceIconSVG(piece) {
  const iw = 40, ih = 28, pad = 5;
  if (piece.type === 'flat') {
    const w = pad + 8 + (iw - pad * 2 - 8) * (piece.width / 3);
    const y = ih / 2;
    return `<svg viewBox="0 0 ${iw} ${ih}" class="wb-piece-icon"><line x1="${pad}" y1="${y}" x2="${w}" y2="${y}" /></svg>`;
  }
  if (piece.type === 'rise') {
    return `<svg viewBox="0 0 ${iw} ${ih}" class="wb-piece-icon"><polyline points="${pad},${ih - pad} ${pad},${pad} ${iw - pad},${pad}" /></svg>`;
  }
  if (piece.type === 'fall') {
    return `<svg viewBox="0 0 ${iw} ${ih}" class="wb-piece-icon"><polyline points="${pad},${pad} ${pad},${ih - pad} ${iw - pad},${ih - pad}" /></svg>`;
  }
  return '';
}

// `pieces`: the fixed palette (order = display order). `onPick(piece)` fires
// on click. `isDisabled(piece)` decides per-button disabled state — the
// caller re-derives this from wbCanPlace() on every render.
function renderPiecePalette(container, { pieces, onPick, isDisabled }) {
  container.innerHTML = '';
  pieces.forEach(piece => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-piece-btn';
    btn.innerHTML = wbPieceIconSVG(piece) + `<span class="wb-piece-label">${wbPieceLabel(piece)}</span>`;
    const disabled = isDisabled(piece);
    btn.disabled = disabled;
    if (!disabled) btn.addEventListener('click', () => onPick(piece));
    container.appendChild(btn);
  });
}
