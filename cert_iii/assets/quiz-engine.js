/*
  Shared QUESTIONS[]-driven quiz engine for cert_iii quiz pages.

  Extracted from bjt_knowledge_basics.html and digital_knowledge_basics.html,
  which had independently grown apart after both being cloned from the same
  original template — this file is a genuine SYNTHESIS of the two (the union
  of every `kind`/`leftPanel` mode either one used), not a copy of either.
  See the "assets/quiz-engine.js migration assessment" — this is Phase 2:
  the two `*_basics.html` template files, proving the extraction before it's
  rolled out to the rest of cert_iii's ~27 other quiz pages.

  LOAD ORDER MATTERS: include this with a plain, non-deferred
  `<script src="path/to/quiz-engine.js"></script>` in <head> (same pattern as
  theme-init.js — NOT breadcrumb.js's `defer`, since deferred execution can
  run AFTER an inline body script that calls these functions, throwing
  "not defined"). This file only declares functions/globals at the top
  level — it never touches the DOM until one of its functions is actually
  called — so it's safe to load before <body> exists.

  Each page's own inline <script> (after this one) still needs to:
    1. Define `const QUESTIONS = [...]` (all page-specific content lives here)
    2. Define any page-specific helpers its own QUESTIONS reference
       (fmtO0/fmtA/frac-style formatters, custom visualizer widgets, etc.)
    3. Call `initQuizNav()`, then whatever produces the first render for that
       page (usually `resetQuiz()`; bjt_knowledge_basics.html instead calls
       its own `setMode('example1')`, which calls resetQuiz() internally
       after applying its own circuit-value setup), then `initQuizFromURL()`.

  SUPPORTED so far (the union of what all migrated files actually use —
  Phase 2: the two `*_basics.html` templates; Phase 3 so far:
  bjt_knowledge_ac_params_formulas.html):
  `kind`: unset (single-select) | 'multi' | 'match' (plain, `matchByLabel`,
  or `reusablePool` — see below) | 'bits' | 'truth' (see below) | 'fill'
  (see below).
  `leftPanel`: unset/'circuit' (a static circuit-panel div, optionally swapped
  per-question via showCircuitRef(data.circuitId, data.circuitLabel,
  data.circuitViewBox, data.circuitLoad, data.circuitAmmeter) if the page has
  a #circuitRefUse/#circuitRefLabel to target — see the CIRCUIT_SVG_ID/
  DEFAULT_CIRCUIT_VIEWBOX/CIRCUIT_REF_EXTRA/SUMMARY_CIRCUIT_REF globals below
  for pages whose reference circuit swaps per question rather than staying
  static) | 'viz' (a named file-specific panel div — see swapLeftPanel(),
  still requires the page to define its own #q5VizPanel-equivalent and drive
  it) | 'shapeGrid' | 'none'. Zoom modal (openModal/closeModal) and the dev
  xy-ruler overlay (buildXYRuler/setXY) are both included, both fully
  defensive — pages without a #diagramModal/CIRCUIT_SVG_ID element simply
  never trigger them.

  Per-question circuit swapping (bjt_knowledge_ac_params_ce.html and its
  whole sibling family) uses four more configurable globals, all optional:
  - `CIRCUIT_SVG_ID` (default `'circuitSvg'`) — the reference `<svg>`'s own
    id. bjt_knowledge_basics.html's single always-static circuit uses the
    default; the ac_parameters family's swappable one uses `'circuitRefSvg'`
    instead — set this before resetQuiz() if your page matches that family.
  - `DEFAULT_CIRCUIT_VIEWBOX` — fallback viewBox when a question's own
    `circuitViewBox` is unset.
  - `CIRCUIT_REF_EXTRA` — optional `(id, loadTerminal, ammeter) => void`,
    called after every circuit/viewBox swap. Each ac_parameters file's own
    ammeter-badge/load-terminal-toggle dispatch is genuinely different (one
    ammeter id vs two, gated by which circuit id is showing, a dead
    `loadTerminal` param in some files and a live one in others) — kept as a
    per-page hook rather than forced into one generic shape.
  - `SUMMARY_CIRCUIT_REF` — optional `{id, label, viewBox}`. If set,
    showSummary() calls `swapLeftPanel('circuit')` then shows this specific
    circuit instead of hiding the panel via `swapLeftPanel('none')` — for
    pages where each question shows a different circuit and there's a
    natural "default" one to settle the review page on. The explicit
    swapLeftPanel('circuit') call matters for any page that ALSO uses
    leftPanel:'shapeGrid' on some questions — otherwise the shapeGrid panel
    from the last-viewed question would stay visible on the summary page.
  - `RENDER_EXTRA` — optional `() => void`, called at the end of every
    renderQuestion(). For per-file logic that needs to run on EVERY render
    regardless of the current question — e.g. bjt_knowledge_ac_params_
    ce.html's own re′/Zb/Zin/Zout progressive-reveal badges, which persist
    once their own question is answered independent of which question is
    currently showing (a genuinely different lifecycle than
    CIRCUIT_REF_EXTRA, which only fires when the circuit itself swaps).
  - `RESET_EXTRA` — optional `() => void`, called at the very START of
    every resetQuiz() call, including "Restart" clicks, not just the first
    load. For per-file setup that must happen before the Q[] array is
    (re)built — e.g. digital_gate_identification.html's own
    `shuffle(QUESTIONS)`, which reorders the QUESTIONS array itself (each
    of the 7 gates lives in a fixed slot) rather than shuffling each
    question's own options, so every playthrough covers all 7 gates
    exactly once in a random order.

  `kind:'match'` has two duplicate-value-aware sub-modes, both opt-in per
  question (plain match — exact one-option-per-column — is still the
  default when neither flag is set):
  - `matchByLabel: true` — several pool options may share byte-identical
    text (e.g. three circuits with the same calculated value); grading
    checks the LABEL sitting in each column, not which specific option
    instance landed there, while still requiring exactly one chip per
    column (matchColumnCorrect()). See bjt_knowledge_ac_params_formulas.html
    Q5 (its own re′/RB/Zb match question) for why this was needed — the
    default exact-index check would mark a fully-correct swap of two
    identical-looking chips as wrong.
  - `reusablePool: true` — a genuinely different mechanic: ONE pool option
    can be assigned to SEVERAL columns at once, and the pool never empties.
    State moves from per-OPTION (`st.place[i] = column`) to per-COLUMN
    (`st.assign[colIdx] = option index`); `options()` gives `{label, cols:
    [colIdx, ...]}` (the columns that option validly fills) instead of a
    single `col` number. Own render path (renderMatchReusable() etc.) rather
    than branching inside the plain one — the pool-never-empties behaviour
    is different enough that merging them would hurt both. See
    bjt_knowledge_ac_params_formulas.html's own Zout question (one formula
    assigned to 3 circuits at once).

  Shape-based rendering (leftPanel:'shapeGrid' cells, match column titles,
  match:'shapeId' chips) uses two configurable globals, `SHAPE_VIEWBOX` and
  `MATCH_COL_TITLE_MAX_WIDTH` — override them in your own inline script
  BEFORE calling resetQuiz()/initQuizNav() if your file's own shapes use a
  different coordinate scale than the default (bjt_knowledge_basics.html's
  small BJT symbols / digital_knowledge_basics.html's waveforms & DIP
  packages, both on a `-32 -36 96 76` viewBox — bjt_knowledge_ac_params_
  formulas.html's own mini circuit thumbnails need `0 0 140 200` instead,
  and set both globals accordingly). For a file that mixes MULTIPLE shape
  families at once (e.g. bjt_knowledge_amp_config.html's tall circuit
  schematics alongside its own separate wide/short waveform shapes), set
  a per-question `shapeViewBox` field on the QUESTIONS[] entry instead —
  all three shape-rendering call sites (renderShapeGrid, the match
  column-title SVG, matchChipContent) check `data.shapeViewBox` first and
  fall back to the SHAPE_VIEWBOX global, so only questions that need a
  different scale from the file's own default have to say so.

  `kind:'truth'` — an interactive truth table: read-only input columns in
  natural binary-counting row order, plus one click-cyclable output column
  (blank -> 0 -> 1 -> blank per cell, via zFromClicks()/clickTruthZ() — the
  same click-cycle shape as `kind:'bits'`'s own bitFromClicks(), kept as its
  own separately-named function since the two kinds are conceptually
  different tables). `st.opts` is an array of `{ inputs: [...], z }` rows,
  built by `data.options()`. See renderTruth()'s own header comment for the
  two header shapes it supports (`data.headerGroups()` fixed grouped header
  vs `data.inputsHeading()`/`outputHeading()` plus an optional
  `data.inputCounts()` 2-or-3-input toggle) and which project files use
  which. `truthCorrectExplain(st)`/`truthMistakeLine(labels, st)` are
  shared, gate-agnostic helpers every 'truth' question's own
  correctExplain()/working() can call directly — the actual gate-logic
  data (which rows produce which Z, e.g. GATE_FN/buildTruthRows in
  digital_knowledge_logic_gates.html) stays page-local, same as
  AMP_CIRCUITS/GRID_CIRCUITS for shapeGrid — every file's own truth-table
  CONTENT is different enough (single gate vs multi-gate staged network)
  that centralising it wouldn't fit every file.

  `kind:'fill'` — a non-consuming pool of items (a chip stays pickable
  after being placed, never removed from the pool) placed onto one-or-more
  slot(s) elsewhere on the page, addressed by `data.slotIds` (an array of
  DOM element ids) and SLOT index — not by pool-item index, so a slot's
  correctness is independent of which/how-many pool items exist, and the
  same pool item can be placed into more than one slot if a question ever
  needs that. Each slot element `elId` needs a sibling text target
  `elId + 'Text'` for its rendered content, and `onclick="slotClicked(N)"`
  wired directly in the page's own markup (N = the slot's 0-based index
  within THAT question's own `slotIds` array, not a global index).
  `st.slotPlaced` is an array (one per slot) of the placed pool-item index
  or null. First (and so far only) used by
  digital_circuit_derivation_ab.html for a single persistent circuit
  diagram spanning every question, progressively revealed as fill
  questions are answered — that reveal/visibility logic
  (updateReveal()/RENDER_EXTRA) and the "always show this one circuit,
  never swapLeftPanel('none') it away" behaviour (a page-local no-op
  swapLeftPanel() override) are both page-local, since no other file
  shares that architecture yet.

  Every function that runs on EVERY render regardless of the current
  question's own kind (the qMatch/qBits/qOptions display toggles inside
  renderQuestion(), and swapLeftPanel()'s per-mode panel toggles) null-checks
  its target element first — a page that never uses 'match'/'bits'/'viz'
  doesn't need to carry those containers in its own markup just to avoid a
  crash. The kind-specific render functions themselves (renderMatch(),
  renderBits(), renderShapeGrid()) are NOT defensive — if the current
  question's own `kind` needs one of these, its container genuinely must
  exist, and a missing one is a real authoring bug worth throwing on rather
  than silently swallowing.
*/

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// Coordinate scale for shapeGrid cells / match column titles / match:shapeId
// chips — override both before calling resetQuiz() if your page's own
// shapes use a different scale (see this file's own header comment).
let SHAPE_VIEWBOX = '-32 -36 96 76';
let MATCH_COL_TITLE_MAX_WIDTH = 80;

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Generic stacked-fraction helper (numerator over denominator) — identical
// across every file that had its own copy of this; genuinely file-agnostic.
function frac(num, den) { return `<span class="working-frac"><span class="num">${num}</span><span class="den">${den}</span></span>`; }

// kind:'multi' questions allow any number of selections; kind:'match'
// questions sort every option into one of N columns; kind:'bits' fills in a
// table of binary digits by click-cycling each cell; everything else is
// single-select (A/B/C/D...). `sel`/`cor` are a single index for single-
// select, an array of indices for multi, or (for match) `cor` is an array of
// correct column-per-option and live placement lives in `st.place` (array of
// column-per-option, null = still in the pool). For bits, `cor` is a 2D
// array [row][col] of correct 0/1 values and live input lives in
// `st.clicks` (2D array of click counts — every cell starts blank, each
// click cycles it: blank -> 0 -> 1 -> blank).
function isMulti(data) { return data.kind === 'multi'; }
function isMatch(data) { return data.kind === 'match'; }
function isBits(data) { return data.kind === 'bits'; }
function isTruth(data) { return data.kind === 'truth'; }
function isFill(data) { return data.kind === 'fill'; }
function bitFromClicks(n) { const m = n % 3; return m === 0 ? null : m - 1; }
// 'truth' cells cycle the same blank→0→1→blank way as 'bits' cells — kept as
// its own identically-implemented function (not an alias) since the two
// kinds' semantics are conceptually different (a truth table's Z column vs
// a fixed bit pattern) and every prior kind in this engine gets its own
// same-shaped helper, even when the logic happens to match.
function zFromClicks(n) { const m = n % 3; return m === 0 ? null : m - 1; }
// Shared, gate-agnostic correctExplain() for any 'truth' question.
function truthCorrectExplain(st) {
  const wrongCount = st.opts.filter((o, i) => zFromClicks(st.clicks[i]) !== st.cor[i]).length;
  return wrongCount === 0 ? `All ${st.opts.length} rows correct` : `${st.opts.length - wrongCount} of ${st.opts.length} rows correct`;
}
// Shared "list the wrong rows" working() fragment — `labels` is the
// space-joined input column labels (e.g. "C B A" or "A"), supplied by the
// question since column labels/order are genuinely per-question.
function truthMistakeLine(labels, st) {
  const mistakes = st.opts
    .map((o, i) => ({ o, i }))
    .filter(({ i }) => zFromClicks(st.clicks[i]) !== st.cor[i])
    .map(({ o }) => `${labels} = ${o.inputs.join(' ')}`);
  return mistakes.length
    ? `<div class="working-step" style="margin-top:.6rem">Incorrect rows:</div><div class="working-line">${mistakes.join(', ')}</div>`
    : '';
}

function isAnswerCorrect(data, st) {
  if (isBits(data)) return st.clicks.every((row, r) => row.every((n, c) => bitFromClicks(n) === st.cor[r][c]));
  if (isTruth(data)) return st.clicks.every((n, r) => zFromClicks(n) === st.cor[r]);
  if (isFill(data)) return st.slotPlaced.every((p, slot) => p === st.cor[slot]);
  if (isMatch(data)) {
    if (data.reusablePool) return st.assign.every((_, c) => isColumnCorrectReusable(st, c));
    if (data.matchByLabel) return st.corLabel.every((_, c) => matchColumnCorrect(st, c));
    return st.place.every((p, i) => p === st.cor[i]);
  }
  if (!isMulti(data)) return st.sel === st.cor;
  const a = [...st.sel].sort((x, y) => x - y), b = [...st.cor].sort((x, y) => x - y);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function selectedLabel(data, st) {
  if (isBits(data)) {
    let correct = 0, total = 0;
    st.clicks.forEach((row, r) => row.forEach((n, c) => { total++; if (bitFromClicks(n) === st.cor[r][c]) correct++; }));
    return `${correct} / ${total} bits correct`;
  }
  if (isTruth(data)) {
    const correct = st.clicks.filter((n, r) => zFromClicks(n) === st.cor[r]).length;
    return `${correct} / ${st.opts.length} rows correct`;
  }
  if (isFill(data)) {
    const correctCount = st.slotPlaced.filter((p, slot) => p === st.cor[slot]).length;
    return `${correctCount} / ${st.slotPlaced.length} correctly placed`;
  }
  if (isMatch(data)) {
    if (data.reusablePool) {
      const correctCount = st.assign.filter((_, c) => isColumnCorrectReusable(st, c)).length;
      return `${correctCount} / ${st.assign.length} correctly placed`;
    }
    if (data.matchByLabel) {
      const correctCount = st.corLabel.filter((_, c) => matchColumnCorrect(st, c)).length;
      return `${correctCount} / ${st.corLabel.length} correctly placed`;
    }
    const correctCount = st.place.filter((p, i) => p === st.cor[i]).length;
    return `${correctCount} / ${st.opts.length} correctly sorted`;
  }
  const asLabel = i => data.leftPanel === 'shapeGrid' ? (i + 1) : LETTERS[i];
  if (!isMulti(data)) {
    if (st.sel == null || !st.opts[st.sel]) return '—';
    return data.leftPanel === 'shapeGrid' ? `Circuit ${asLabel(st.sel)}` : st.opts[st.sel].label;
  }
  return st.sel.length ? [...st.sel].sort((a, b) => a - b).map(asLabel).join(', ') : '—';
}

// Fills in the fully-correct answer for a question without marking it
// answered — used by jump()/jumpToSummary() to fast-forward prior questions.
// Works across every kind.
function fillCorrectSelection(i) {
  const data = QUESTIONS[i], st = Q[i];
  if (isBits(data)) st.clicks = st.cor.map(row => row.map(bit => bit + 1)); // clicks bit+1 -> bitFromClicks() lands on 0/1 (0 would land on blank)
  else if (isTruth(data)) st.clicks = st.cor.map(z => z + 1); // same +1 trick as bits: zFromClicks(z+1) lands back on z
  else if (isFill(data)) st.slotPlaced = st.cor.slice();
  else if (isMatch(data)) {
    if (data.reusablePool) st.assign = st.assign.map((_, c) => st.opts.findIndex(o => o.cols.includes(c)));
    else st.place = st.cor.slice();
  }
  else if (isMulti(data)) st.sel = [...st.cor];
  else st.sel = st.cor;
}

let Q = [];   // per-question live state: { sel, ans, cor, opts, place?, clicks? }
let cur = 0;  // 0-based index into QUESTIONS

function buildProgressDots() {
  document.getElementById('progressDots').innerHTML =
    QUESTIONS.map((_, i) => `<div class="progress-dot" id="dot-${i}"></div>`).join('');
}

function updateProgress() {
  QUESTIONS.forEach((_, i) => {
    const d = document.getElementById('dot-' + i);
    d.className = 'progress-dot';
    if (i === cur) d.classList.add('active'); else if (Q[i].ans) d.classList.add('done');
  });
  document.getElementById('progressLabel').textContent = (cur + 1) + ' / ' + QUESTIONS.length;
}

// ── leftPanel:'shapeGrid' ──
function renderShapeGrid() {
  const st = Q[cur], data = QUESTIONS[cur], multi = isMulti(data);
  const c = document.getElementById('shapeGridCells'); c.innerHTML = '';
  st.opts.forEach((opt, i) => {
    const cell = document.createElement('div'); cell.className = 'shape-cell';
    const selected = multi ? st.sel.includes(i) : i === st.sel;
    if (st.ans) {
      if (opt.type === 'correct') {
        // Single-select: the correct circuit is always shown correct/green
        // regardless of pick, matching renderOptions()'s convention. Multi:
        // a correct one the student didn't pick is "missed" (amber).
        const missed = multi && !selected;
        cell.classList.add(missed ? 'missed' : 'correct');
      }
      else cell.classList.add(selected ? 'wrong' : 'dimmed');
    } else {
      if (selected) cell.classList.add('selected');
      cell.addEventListener('click', () => selectOption(i));
    }
    const content = opt.shapeId
      ? `<svg viewBox="${data.shapeViewBox || SHAPE_VIEWBOX}"><use href="#${opt.shapeId}"/></svg>`
      : `<div class="shape-cell-text">${opt.label}</div>`;
    cell.innerHTML = `<span class="shape-num">${i + 1}</span>${content}`;
    c.appendChild(cell);
  });
}

function renderOptions() {
  const st = Q[cur], data = QUESTIONS[cur], multi = isMulti(data);
  const c = document.getElementById('qOptions'); c.innerHTML = '';
  st.opts.forEach((opt, i) => {
    const btn = document.createElement('button'); btn.className = 'option-btn';
    const selected = multi ? st.sel.includes(i) : i === st.sel;
    btn.innerHTML = `<span class="option-letter">${LETTERS[i]}</span><span>${opt.label}</span>`;
    if (st.ans) {
      btn.disabled = true;
      if (opt.type === 'correct') {
        // The correct answer is always shown correct/green — whether or not
        // it was selected — matching the single-select convention. For
        // multi-select, a correct option the student didn't pick is
        // "missed" (amber) rather than plain wrong (red).
        const missed = multi && !selected;
        btn.classList.add(missed ? 'missed' : 'correct');
        btn.innerHTML += `<span class="result-icon">${missed ? '○' : '✓'}</span>`;
      } else if (selected) { btn.classList.add('wrong'); btn.innerHTML += `<span class="result-icon">✗</span>`; }
      else btn.classList.add('dimmed');
    } else {
      if (selected) btn.classList.add('selected');
      btn.addEventListener('click', () => selectOption(i));
    }
    c.appendChild(btn);
  });
}

function selectOption(i) {
  const st = Q[cur], data = QUESTIONS[cur];
  if (st.ans) return;
  if (isMulti(data)) {
    const pos = st.sel.indexOf(i);
    if (pos >= 0) st.sel.splice(pos, 1); else st.sel.push(i);
  } else {
    st.sel = i;
  }
  renderQuestion();
}

// ── kind:'match' — click a pool chip to "pick it up" (st.sel = its index),
// then click a column to drop it there. Click a placed chip to send it back
// to the pool. No drag events at all, so it behaves identically on mouse,
// touch and keyboard. columns() may return any number of targets, each
// either a plain string (a text pill) or `{ shapeId }` (rendered as an SVG
// shape via matchChipContent() instead). Pool/placed chips work the same
// way via opt.shapeId.
function matchChipContent(opt, constrained, viewBox) {
  if (!opt.shapeId) return opt.label;
  const svgStyle = constrained ? 'width:100%;max-width:92px;height:auto;display:block' : 'width:92px;height:auto;display:block';
  return `<svg viewBox="${viewBox || SHAPE_VIEWBOX}" style="${svgStyle}"><use href="#${opt.shapeId}"/></svg>`;
}

function renderMatch() {
  const st = Q[cur], data = QUESTIONS[cur];
  const cols = data.columns();

  const picking = st.sel !== null;
  const poolHasItems = st.opts.some((_, i) => st.place[i] === null);
  // When nothing is picked yet (and the pool isn't empty), flash the pool
  // itself to prompt the student to pick a word — the mirror image of the
  // column glow that prompts them to place one once it's picked.
  const needsPick = !st.ans && !picking && poolHasItems;
  document.getElementById('matchPoolRow').classList.toggle('needs-pick', needsPick);
  document.getElementById('matchPool').classList.toggle('needs-pick', needsPick);

  const pool = document.getElementById('matchPool');
  pool.innerHTML = '';
  st.opts.forEach((opt, i) => {
    if (st.place[i] !== null) return;
    const chip = document.createElement('button');
    const isPicked = st.sel === i;
    chip.className = 'match-chip' + (isPicked ? ' picked' : '') + (opt.shapeId ? ' match-chip-shape' : '');
    chip.innerHTML = matchChipContent(opt, false, data.shapeViewBox);
    chip.disabled = st.ans || (picking && !isPicked);
    if (!chip.disabled) chip.addEventListener('click', (e) => { e.stopPropagation(); selectPoolItem(i); });
    pool.appendChild(chip);
  });

  const colsEl = document.getElementById('matchColumns');
  colsEl.innerHTML = '';
  const maxCols = window.innerWidth < 500 ? 2 : 4;
  colsEl.style.gridTemplateColumns = `repeat(${Math.min(cols.length, maxCols)}, 1fr)`;
  cols.forEach((col, colIdx) => {
    const colDiv = document.createElement('div');
    colDiv.className = 'match-column';
    colDiv.addEventListener('click', () => assignToColumn(colIdx));

    const arrow = document.createElement('div'); arrow.className = 'match-col-arrow'; arrow.textContent = '▼';
    const title = document.createElement('div'); title.className = 'match-col-title';
    title.innerHTML = (typeof col === 'string') ? col : `<svg viewBox="${data.shapeViewBox || SHAPE_VIEWBOX}" style="width:100%;max-width:${MATCH_COL_TITLE_MAX_WIDTH}px;display:block;margin:0 auto"><use href="#${col.shapeId}"/></svg>`;
    const items = document.createElement('div'); items.className = 'match-col-items';

    st.opts.forEach((opt, i) => {
      if (st.place[i] !== colIdx) return;
      const chip = document.createElement('button');
      chip.className = 'match-chip' + (opt.shapeId ? ' match-chip-shape' : '');
      chip.innerHTML = matchChipContent(opt, true, data.shapeViewBox);
      if (st.ans) {
        chip.disabled = true;
        chip.classList.add(st.place[i] === st.cor[i] ? 'correct' : 'wrong');
      } else {
        chip.disabled = picking;
        if (!chip.disabled) chip.addEventListener('click', (e) => { e.stopPropagation(); unassignItem(i); });
      }
      items.appendChild(chip);
    });

    colDiv.append(arrow, title, items);
    colDiv.classList.toggle('droppable', !st.ans && picking);
    colsEl.appendChild(colDiv);
  });
}

function selectPoolItem(i) {
  const st = Q[cur];
  if (st.ans) return;
  st.sel = (st.sel === i) ? null : i;
  renderQuestion();
}

function assignToColumn(colIdx) {
  const st = Q[cur];
  if (st.ans || st.sel === null) return;
  st.place[st.sel] = colIdx;
  st.sel = null;
  renderQuestion();
}

function unassignItem(i) {
  const st = Q[cur];
  if (st.ans) return;
  st.place[i] = null;
  renderQuestion();
}

// matchColumnCorrect(st, c) — is exactly one item sitting under column c,
// and does its LABEL (not its specific option identity) match what that
// column expects? Used instead of the default exact place[i]===cor[i]
// check for `matchByLabel` questions, where several pool options can share
// byte-identical text — any one of those interchangeable chips is a valid
// fill for any of their shared columns, not just the one it happened to
// start out mapped to before shuffle. Still requires exactly ONE chip per
// column, so stacking two chips onto one column and leaving another empty
// is correctly marked wrong, not accidentally rewarded.
function matchColumnCorrect(st, c) {
  const placedHere = st.opts.filter((o, i) => st.place[i] === c);
  return placedHere.length === 1 && placedHere[0].label === st.corLabel[c];
}

// ── kind:'match', reusablePool:true — a genuinely different mechanic from
// the standard one-option-per-column match above: the pool never empties
// (an option can be assigned to several columns at once), so state is keyed
// per COLUMN (st.assign[colIdx] = option index or null) instead of per
// OPTION (st.place[i] = column index). options() gives {label, cols:
// [colIdx, ...]} — the list of columns that option is a correct fill for.
function isColumnCorrectReusable(st, c) {
  const optIdx = st.assign[c];
  return optIdx !== null && st.opts[optIdx].cols.includes(c);
}
function renderMatchReusable() {
  const st = Q[cur], data = QUESTIONS[cur];
  const cols = data.columns();

  const picking = st.sel !== null;
  const needsPick = !st.ans && !picking;
  document.getElementById('matchPoolRow').classList.toggle('needs-pick', needsPick);
  document.getElementById('matchPool').classList.toggle('needs-pick', needsPick);

  const pool = document.getElementById('matchPool');
  pool.innerHTML = '';
  st.opts.forEach((opt, i) => {
    const chip = document.createElement('button');
    const isPicked = st.sel === i;
    chip.className = 'match-chip' + (isPicked ? ' picked' : '') + (opt.shapeId ? ' match-chip-shape' : '');
    chip.innerHTML = matchChipContent(opt, false, data.shapeViewBox);
    chip.disabled = st.ans || (picking && !isPicked);
    if (!chip.disabled) chip.addEventListener('click', (e) => { e.stopPropagation(); selectPoolItemReusable(i); });
    pool.appendChild(chip);
  });

  const colsEl = document.getElementById('matchColumns');
  colsEl.innerHTML = '';
  const maxCols = window.innerWidth < 500 ? 2 : 4;
  colsEl.style.gridTemplateColumns = `repeat(${Math.min(cols.length, maxCols)}, 1fr)`;
  cols.forEach((col, colIdx) => {
    const colDiv = document.createElement('div');
    colDiv.className = 'match-column';
    colDiv.addEventListener('click', () => assignToColumnReusable(colIdx));

    const arrow = document.createElement('div'); arrow.className = 'match-col-arrow'; arrow.textContent = '▼';
    const title = document.createElement('div'); title.className = 'match-col-title';
    title.innerHTML = (typeof col === 'string') ? col : `<svg viewBox="${data.shapeViewBox || SHAPE_VIEWBOX}" style="width:100%;max-width:${MATCH_COL_TITLE_MAX_WIDTH}px;display:block;margin:0 auto"><use href="#${col.shapeId}"/></svg>`;
    const items = document.createElement('div'); items.className = 'match-col-items';

    const assignedIdx = st.assign[colIdx];
    if (assignedIdx !== null) {
      const opt = st.opts[assignedIdx];
      const chip = document.createElement('button');
      chip.className = 'match-chip' + (opt.shapeId ? ' match-chip-shape' : '');
      chip.innerHTML = matchChipContent(opt, true, data.shapeViewBox);
      if (st.ans) {
        chip.disabled = true;
        chip.classList.add(opt.cols.includes(colIdx) ? 'correct' : 'wrong');
      } else {
        chip.disabled = picking;
        if (!chip.disabled) chip.addEventListener('click', (e) => { e.stopPropagation(); unassignColumnReusable(colIdx); });
      }
      items.appendChild(chip);
    }

    colDiv.append(arrow, title, items);
    colDiv.classList.toggle('droppable', !st.ans && picking);
    colsEl.appendChild(colDiv);
  });
}
function selectPoolItemReusable(i) {
  const st = Q[cur];
  if (st.ans) return;
  st.sel = (st.sel === i) ? null : i;
  renderQuestion();
}
function assignToColumnReusable(colIdx) {
  const st = Q[cur];
  if (st.ans || st.sel === null) return;
  st.assign[colIdx] = st.sel;
  st.sel = null;
  renderQuestion();
}
function unassignColumnReusable(colIdx) {
  const st = Q[cur];
  if (st.ans) return;
  st.assign[colIdx] = null;
  renderQuestion();
}

// ── kind:'bits' — a fixed 4-bit-wide binary entry table (the only shape
// needed so far — see digital_knowledge_basics.html). Every cell starts
// blank; each click cycles blank -> 0 -> 1 -> blank.
function renderBits() {
  const st = Q[cur];
  const body = document.getElementById('bitsBody');
  body.innerHTML = '';
  st.opts.forEach((row, r) => {
    const tr = document.createElement('tr');
    const valTd = document.createElement('td');
    valTd.textContent = row.value;
    tr.appendChild(valTd);
    for (let c = 0; c < 4; c++) {
      const td = document.createElement('td');
      const bit = bitFromClicks(st.clicks[r][c]);
      td.textContent = bit === null ? '' : String(bit);
      if (st.ans) {
        td.className = 'bits-cell ' + (bit === st.cor[r][c] ? 'correct' : 'wrong');
      } else {
        td.className = 'bits-cell';
        td.addEventListener('click', () => clickBit(r, c));
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  });
}

function clickBit(r, c) {
  const st = Q[cur];
  if (st.ans) return;
  st.clicks[r][c]++;
  renderQuestion();
}

// ── kind:'truth' — a staged/interactive truth table: read-only input
// columns (natural binary-counting row order — a truth table shouldn't
// shuffle) plus one click-cyclable output column (blank -> 0 -> 1 -> blank
// per cell, via zFromClicks/clickTruthZ). st.opts is an array of
// { inputs: [...], z } rows; data.options() (or data.options(n) — see
// below) builds them.
//
// Two header shapes exist across the project's truth-table files, and this
// function supports BOTH, branching on which fields a question provides:
//   - data.headerGroups() -> [{label, span}, ...] fixed grouped header row
//     (targets #truthGroupHeads) — the more common shape (boolean_algebra/
//     logic_combos/truth_tables.html), for staged/multi-gate build-ups
//     where the columns naturally fall into named groups ("Inputs",
//     "Stage 1", "Output", etc).
//   - data.inputsHeading()/data.outputHeading() -> single "Inputs"/"Output"
//     header cells (targets #truthInputHead/#truthOutputHead), optionally
//     paired with data.inputCounts()/data.defaultInputCount()/a 2-or-3-input
//     TOGGLE (targets #truthToggle) — digital_knowledge_logic_gates.html's
//     own single-gate-at-a-time shape, where inputLabels()/options() take
//     the current input count `n` as an argument instead of being called
//     plain (every other 'truth' field is called the same way as other
//     kinds' fields; only these two differ, and only for this shape).
// Either way, data.inputLabels() (or data.inputLabels(n)) and
// data.outputLabel() feed the shared #truthColLabels row, and the row body
// itself (targets #truthBody) is rendered identically regardless of shape.
function renderTruth() {
  const st = Q[cur], data = QUESTIONS[cur];
  const inputLabels = data.inputCounts ? data.inputLabels(st.n) : data.inputLabels();

  // Staged/multi-gate build-ups (digital_knowledge_logic_combos.html,
  // digital_truth_tables.html) optionally dim already-irrelevant columns
  // and draw a double-line divider between column groups (raw inputs |
  // staged outputs | final output), and/or show extra read-only reference
  // columns AFTER the fillable Z column (e.g. previewing a later stage's
  // own output ahead of time). All three are optional per question — a
  // single-pass 'truth' question (no staging) simply omits them and
  // nothing is highlighted/dimmed/trailing.
  const highlight = data.highlightLabels ? data.highlightLabels() : [];
  const breaks = data.groupBreakAfter ? data.groupBreakAfter() : [];
  const trailingLabels = data.trailingLabels ? data.trailingLabels() : [];
  const colClass = i => (highlight.length && !highlight.includes(inputLabels[i]) ? ' truth-dim' : '') + (breaks.includes(i) ? ' truth-group-end' : '');
  const trailingClass = highlight.length ? ' truth-dim' : '';

  if (data.headerGroups) {
    const groupHeadsEl = document.getElementById('truthGroupHeads');
    if (groupHeadsEl) groupHeadsEl.innerHTML = data.headerGroups().map(g => `<th colspan="${g.span}">${g.label}</th>`).join('');
  } else {
    const inputHeadEl = document.getElementById('truthInputHead');
    if (inputHeadEl) { inputHeadEl.colSpan = inputLabels.length; inputHeadEl.innerHTML = data.inputsHeading(); }
    const outputHeadEl = document.getElementById('truthOutputHead');
    if (outputHeadEl) outputHeadEl.textContent = data.outputHeading();
    const toggle = document.getElementById('truthToggle');
    if (toggle) {
      if (data.inputCounts) {
        toggle.style.display = 'flex';
        toggle.innerHTML = '';
        data.inputCounts().forEach(n => {
          const btn = document.createElement('button');
          btn.className = 'truth-toggle-btn' + (st.n === n ? ' active' : '');
          btn.textContent = n + '-input';
          btn.addEventListener('click', () => setTruthInputCount(n));
          toggle.appendChild(btn);
        });
      } else {
        toggle.style.display = 'none';
      }
    }
  }

  const colLabelsEl = document.getElementById('truthColLabels');
  if (colLabelsEl) {
    colLabelsEl.innerHTML = inputLabels.map((l, i) => `<th class="${colClass(i)}">${l}</th>`).join('') +
      `<th>${data.outputLabel()}</th>` +
      trailingLabels.map(l => `<th class="${trailingClass}">${l}</th>`).join('');
  }

  const body = document.getElementById('truthBody');
  body.innerHTML = '';
  st.opts.forEach((row, r) => {
    const tr = document.createElement('tr');
    row.inputs.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = String(v);
      td.className = 'truth-input-cell' + colClass(i);
      tr.appendChild(td);
    });
    const zTd = document.createElement('td');
    const z = zFromClicks(st.clicks[r]);
    zTd.textContent = z === null ? '' : String(z);
    if (st.ans) {
      zTd.className = 'bits-cell' + (z === st.cor[r] ? ' correct' : ' wrong');
    } else {
      zTd.className = 'bits-cell';
      zTd.addEventListener('click', () => clickTruthZ(r));
    }
    tr.appendChild(zTd);
    (row.trailing || []).forEach(v => {
      const td = document.createElement('td');
      td.textContent = v === null ? '' : String(v);
      td.className = 'truth-input-cell' + trailingClass;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function clickTruthZ(r) {
  const st = Q[cur];
  if (st.ans) return;
  st.clicks[r]++;
  renderQuestion();
}

// Only relevant for questions with data.inputCounts (the 2/3-input toggle
// shape) — switching input count rebuilds the table from scratch for the
// new n and clears any existing answer, since the previous table's clicks
// don't mean anything once the row count itself has changed.
function setTruthInputCount(n) {
  const st = Q[cur], data = QUESTIONS[cur];
  if (st.n === n) return;
  st.n = n;
  st.opts = data.options(n);
  st.cor = st.opts.map(row => row.z);
  st.clicks = st.opts.map(() => 0);
  st.ans = false;
  renderQuestion();
}

// ── kind:'fill' — a non-consuming pool of items (a chip stays pickable
// after being placed) placed onto one-or-more slot(s) elsewhere on the
// page, addressed by `data.slotIds` (an array of DOM element ids) and SLOT
// index — not by pool-item index, so a slot's correctness is independent
// of which/how-many pool items exist, and the same pool item can be
// placed into more than one slot if a question ever needs that. Each slot
// element `elId` needs a sibling text target `elId + 'Text'` for its
// rendered content. `st.slotPlaced` is an array (one per slot) of the
// placed pool-item index or null. First (and so far only) used by
// digital_circuit_derivation_ab.html — a single persistent circuit
// diagram, progressively revealed as fill questions are answered; that
// reveal logic is entirely page-local (see its own updateReveal(), called
// via RENDER_EXTRA) since no other file shares this "one diagram spans
// every question" architecture yet. The needs-pick pulse styling targets
// (`circuitPanel`/`circuitArrow`) are page-specific-sounding ids, kept
// null-checked/defensive; `fillPool`/`fillPoolRow` are core to the
// mechanic itself, same non-defensive convention as `matchPool`.
function renderFill() {
  const st = Q[cur], data = QUESTIONS[cur];
  const picking = st.sel !== null;
  const needsPick = !st.ans && !picking && st.slotPlaced.some(p => p === null);
  const circuitNeedsPick = !st.ans && picking;
  const poolRowEl = document.getElementById('fillPoolRow');
  if (poolRowEl) poolRowEl.classList.toggle('needs-pick', needsPick);
  const circuitPanelEl = document.getElementById('circuitPanel');
  if (circuitPanelEl) circuitPanelEl.classList.toggle('needs-pick', circuitNeedsPick);
  const circuitArrowEl = document.getElementById('circuitArrow');
  if (circuitArrowEl) circuitArrowEl.classList.toggle('needs-pick', circuitNeedsPick);

  const pool = document.getElementById('fillPool');
  pool.classList.toggle('needs-pick', needsPick);
  pool.innerHTML = '';
  st.opts.forEach((opt, i) => {
    const chip = document.createElement('button');
    const isPicked = st.sel === i;
    chip.className = 'match-chip' + (isPicked ? ' picked' : '');
    chip.innerHTML = opt.poolHtml;
    chip.disabled = st.ans || (picking && !isPicked);
    if (!chip.disabled) chip.addEventListener('click', (e) => { e.stopPropagation(); selectFillItem(i); });
    pool.appendChild(chip);
  });

  data.slotIds.forEach((elId, slot) => {
    const box = document.getElementById(elId);
    const txt = document.getElementById(elId + 'Text');
    const placedIdx = st.slotPlaced[slot];
    box.classList.remove('filled', 'correct', 'wrong', 'plain');
    if (placedIdx === null) {
      txt.innerHTML = '';
    } else {
      txt.innerHTML = st.opts[placedIdx].poolHtml;
      box.classList.add('filled');
      if (st.ans) box.classList.add(placedIdx === st.cor[slot] ? 'correct' : 'wrong');
    }
    txt.classList.toggle('correct', st.ans && placedIdx !== null && placedIdx === st.cor[slot]);
    txt.classList.toggle('wrong', st.ans && placedIdx !== null && placedIdx !== st.cor[slot]);
  });
}
function selectFillItem(i) {
  const st = Q[cur];
  if (st.ans) return;
  st.sel = (st.sel === i) ? null : i;
  renderQuestion();
}
function slotClicked(slot) {
  const st = Q[cur], data = QUESTIONS[cur];
  if (!isFill(data) || st.ans) return;
  if (st.sel === null) {
    if (st.slotPlaced[slot] !== null) { st.slotPlaced[slot] = null; renderQuestion(); }
    return;
  }
  st.slotPlaced[slot] = st.sel;
  st.sel = null;
  renderQuestion();
}
window.slotClicked = slotClicked;

function renderQuestion() {
  const data = QUESTIONS[cur], st = Q[cur];
  const multi = isMulti(data);

  document.getElementById('qNum').textContent = 'Q' + (cur + 1);
  document.getElementById('qText').innerHTML = data.text(st);
  document.getElementById('qHint').innerHTML = data.hint(st);

  const qMatchEl = document.getElementById('qMatch');
  if (qMatchEl) qMatchEl.style.display = isMatch(data) ? 'flex' : 'none';
  const qBitsEl = document.getElementById('qBits');
  if (qBitsEl) qBitsEl.style.display = isBits(data) ? 'block' : 'none';
  const qTruthEl = document.getElementById('qTruth');
  if (qTruthEl) qTruthEl.style.display = isTruth(data) ? 'block' : 'none';
  const qOptionsEl = document.getElementById('qOptions');
  if (qOptionsEl) qOptionsEl.style.display = (isMatch(data) || isBits(data) || isTruth(data) || isFill(data) || data.leftPanel === 'shapeGrid') ? 'none' : '';
  const qOptionsBoxEl = document.getElementById('qOptionsBox');
  if (qOptionsBoxEl) qOptionsBoxEl.style.display = (isFill(data) || isTruth(data)) ? 'none' : '';

  if (isMatch(data)) {
    if (data.reusablePool) renderMatchReusable(); else renderMatch();
  } else if (isBits(data)) {
    renderBits();
  } else if (isTruth(data)) {
    renderTruth();
  } else if (isFill(data)) {
    renderFill();
  } else if (data.leftPanel === 'shapeGrid') {
    renderShapeGrid();
  } else {
    renderOptions();
  }

  const selList = document.getElementById('qSelectedList');
  if (selList) {
    if (multi) {
      selList.style.display = '';
      const asLabel = i => data.leftPanel === 'shapeGrid' ? (i + 1) : LETTERS[i];
      selList.textContent = st.sel.length
        ? `Selected: ${[...st.sel].sort((a, b) => a - b).map(asLabel).join(', ')}`
        : (data.leftPanel === 'shapeGrid' ? 'Click the shapes above to select your answer.' : 'Click every option that applies.');
    } else {
      selList.style.display = 'none';
    }
  }

  const banner = document.getElementById('qBanner');
  if (st.ans) {
    const ok = isAnswerCorrect(data, st);
    banner.className = 'result-banner ' + (ok ? 'correct' : 'wrong');
    document.getElementById('qIcon').textContent = ok ? '✓' : '✗';
    document.getElementById('qBannerText').innerHTML = ok ? `Correct! ${data.correctExplain(st)}` : `The correct answer is ${data.correctExplain(st)}`;
  } else {
    banner.className = 'result-banner';
  }

  const working = document.getElementById('qWorking');
  working.className = 'working-box' + (st.ans ? ' visible' : '');
  document.getElementById('qWorkingContent').innerHTML = st.ans ? data.working(st) : '';

  document.getElementById('qBack').style.display = cur > 0 ? 'inline-block' : 'none';
  const check = document.getElementById('qCheck');
  check.style.display = st.ans ? 'none' : 'inline-block';
  // Check is always clickable once a question is on screen — it no longer
  // waits for a complete answer. checkAnswer() itself substitutes the
  // correct answer for anything left unanswered/incomplete, so Check also
  // works as an explicit "show me" for this self-study revision tool,
  // without needing the ?q=n&ans=1 URL override (fiddly to type on a
  // phone). Nothing graded here rides on the student's result, so there's
  // no reason to gate the button on completeness.
  check.disabled = st.ans;
  const isLast = cur === QUESTIONS.length - 1;
  document.getElementById('qNext').style.display = (st.ans && !isLast) ? 'inline-block' : 'none';
  document.getElementById('qSummary').style.display = (st.ans && isLast) ? 'inline-block' : 'none';

  // Default to 'circuit' only when the question actually carries a
  // circuitId — most files always set leftPanel explicitly whenever a
  // circuit shows (so this never mattered before), but some files (e.g.
  // digital_knowledge_boolean_algebra.html) mix circuit and non-circuit
  // questions and only set circuitId, never leftPanel, on the ones that
  // need it — defaulting bare to 'circuit' would show an empty circuit
  // panel on every OTHER question in that file.
  const panelMode = data.leftPanel || (data.circuitId ? 'circuit' : 'none');
  swapLeftPanel(panelMode);
  if (panelMode === 'circuit') showCircuitRef(data.circuitId, data.circuitLabel, data.circuitViewBox, data.circuitLoad, data.circuitAmmeter);
  if (RENDER_EXTRA) RENDER_EXTRA();
  updateProgress();
}

function checkAnswer() {
  const st = Q[cur], data = QUESTIONS[cur];
  if (st.ans) return;
  // An unanswered or partially-answered question no longer blocks Check —
  // it substitutes the fully-correct answer (same fillCorrectSelection()
  // jump()/?ans=1 already use) and shows it like any other checked
  // question, so Check doubles as an explicit "show me" for revision.
  // Whatever the student HAD selected is discarded in that case, same as
  // fillCorrectSelection() always does — there's no "grade what they got
  // so far" middle ground.
  const complete =
    isMatch(data) ? (data.reusablePool ? st.assign.every(a => a !== null) : st.opts.every((o, i) => o.col === null || st.place[i] !== null)) :
    isBits(data) ? st.clicks.every(row => row.every(n => bitFromClicks(n) !== null)) :
    isTruth(data) ? st.clicks.every(n => zFromClicks(n) !== null) :
    isFill(data) ? st.slotPlaced.every(p => p !== null) :
    (isMulti(data) ? st.sel.length > 0 : st.sel !== null);
  if (!complete) fillCorrectSelection(cur);
  st.ans = true;
  renderQuestion();
  document.getElementById('qBanner').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollToQuestionTop() {
  document.getElementById('qPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function nextQuestion() { if (cur < QUESTIONS.length - 1) { cur++; renderQuestion(); scrollToQuestionTop(); } }

// Going back re-opens the previous question for a fresh answer — so it and
// every question after it (all now "ahead" of where the student is) are
// cleared back to unanswered, rather than staying locked from before.
function backQuestion() {
  if (cur <= 0) return;
  cur--;
  for (let i = cur; i < QUESTIONS.length; i++) {
    const data = QUESTIONS[i];
    Q[i].ans = false;
    if (isMatch(data)) {
      if (data.reusablePool) Q[i].assign = Q[i].assign.map(() => null);
      else Q[i].place = Q[i].opts.map(() => null);
      Q[i].sel = null;
    }
    else if (isBits(data)) { Q[i].clicks = Q[i].opts.map(() => [0, 0, 0, 0]); }
    else if (isTruth(data)) { Q[i].clicks = Q[i].opts.map(() => 0); }
    else if (isFill(data)) { Q[i].slotPlaced = Q[i].cor.map(() => null); Q[i].sel = null; }
    else Q[i].sel = isMulti(data) ? [] : null;
  }
  renderQuestion();
  scrollToQuestionTop();
}

// mode: 'circuit' (default, a static .circuit-panel) | 'viz' (a page-defined
// #q5VizPanel-style widget) | 'shapeGrid' | 'none' (collapses the whole
// layout to a single centred column via .quiz-wrap.single-col). Every
// target is null-checked — a page only needs to carry the containers for
// the modes it actually uses.
function swapLeftPanel(mode) {
  const circuitPanel = document.querySelector('.circuit-panel');
  if (circuitPanel) circuitPanel.style.display = mode === 'circuit' ? '' : 'none';
  const vizPanel = document.getElementById('q5VizPanel');
  if (vizPanel) vizPanel.style.display = mode === 'viz' ? 'block' : 'none';
  const shapeGridPanel = document.getElementById('qShapeGridPanel');
  if (shapeGridPanel) shapeGridPanel.style.display = mode === 'shapeGrid' ? 'block' : 'none';
  const circuitCol = document.querySelector('.circuit-col');
  if (circuitCol) circuitCol.style.display = mode === 'none' ? 'none' : '';
  const quizWrap = document.getElementById('quizWrap');
  if (quizWrap) quizWrap.classList.toggle('single-col', mode === 'none');
}

// Circuit-reference config for pages whose reference SVG swaps to a
// different viewBox per question (rather than a single always-the-same
// static one) and/or reveals extra per-question badges (ammeter/load-
// terminal toggles) alongside the circuit swap — override before calling
// resetQuiz() if your page needs them.
let CIRCUIT_SVG_ID = 'circuitSvg';    // the reference <svg>'s own id — bjt_knowledge_basics.html's default; the ac_parameters family uses 'circuitRefSvg' instead
let DEFAULT_CIRCUIT_VIEWBOX = null;   // fallback viewBox when a question doesn't specify its own
let CIRCUIT_REF_EXTRA = null;         // optional (id, loadTerminal, ammeter) => void, called after the base circuit/viewBox swap — for pages with their own ammeter/load-terminal badges (each file's own dispatch is genuinely different, so this stays a per-page hook rather than a generic config shape)
let SUMMARY_CIRCUIT_REF = null;       // optional { id, label, viewBox } — if set, showSummary() shows this specific circuit instead of hiding the panel via swapLeftPanel('none')
let RENDER_EXTRA = null;              // optional () => void, called at the end of every renderQuestion() — for per-file "runs on every render" logic quiz-engine.js can't know about, e.g. progressive-reveal value badges (re′/Zb/Zin/Zout) that persist once their own question is answered, independent of which question is currently on screen
let RESET_EXTRA = null;               // optional () => void, called at the very START of every resetQuiz() (including on "Restart" clicks, not just the first load) — e.g. digital_gate_identification.html's own `shuffle(QUESTIONS)`, which shuffles the QUESTIONS array's ORDER itself (each of the 7 gates appears in a fixed slot, one per gate) rather than each question's own options, so every playthrough covers all 7 exactly once in a random order

// For leftPanel:'circuit' questions that reference a DIFFERENT circuit per
// question (rather than always the same static one) — swaps which <use>
// target the reference SVG points at, and its viewBox if the page uses
// CIRCUIT_SVG_ID/DEFAULT_CIRCUIT_VIEWBOX. Defensive: pages with only one
// static circuit (no per-question circuitId) simply never have anything
// call this.
function showCircuitRef(id, label, viewBox, loadTerminal, ammeter) {
  const use = document.getElementById('circuitRefUse');
  if (!use) return;
  use.setAttribute('href', '#' + id);
  const labelEl = document.getElementById('circuitRefLabel');
  if (labelEl) labelEl.textContent = label || 'Reference Circuit';
  const svgEl = document.getElementById(CIRCUIT_SVG_ID);
  if (svgEl) svgEl.setAttribute('viewBox', viewBox || DEFAULT_CIRCUIT_VIEWBOX || svgEl.getAttribute('viewBox'));
  if (CIRCUIT_REF_EXTRA) CIRCUIT_REF_EXTRA(id, loadTerminal, ammeter);
  if (xyOn) buildXYRuler();
}

function goToQuestion(n) { // 1-based, for URL/jump compatibility
  cur = Math.max(0, Math.min(QUESTIONS.length - 1, n - 1));
  document.getElementById('summaryPanel').style.display = 'none';
  document.getElementById('qPanel').style.display = 'flex';
  renderQuestion();
  scrollToQuestionTop();
}

function resetQuiz() {
  if (RESET_EXTRA) RESET_EXTRA();
  Q = QUESTIONS.map(data => {
    if (isTruth(data)) {
      // 'truth' questions may offer an input-count toggle (see
      // data.inputCounts) — if so, options() takes the current count as an
      // argument instead of being called plain, since the rows themselves
      // depend on it. Checked BEFORE the generic `data.options()` call
      // below, since calling it plain here would pass undefined as `n`.
      const n = data.inputCounts ? data.defaultInputCount() : undefined;
      const opts = data.inputCounts ? data.options(n) : data.options();
      const cor = opts.map(row => row.z);
      return { ans: false, cor, opts, clicks: opts.map(() => 0), n };
    }
    const opts = data.options();
    if (isBits(data)) {
      const cor = opts.map(row => [3, 2, 1, 0].map(shift => (row.value >> shift) & 1));
      return { ans: false, cor, opts, clicks: opts.map(() => [0, 0, 0, 0]) };
    }
    if (isFill(data)) {
      const cor = data.slotIds.map((_, slotIdx) => opts.findIndex(o => o.col === slotIdx));
      return { sel: null, ans: false, cor, opts, slotPlaced: cor.map(() => null) };
    }
    if (isMatch(data)) {
      if (data.reusablePool) {
        const cols = data.columns();
        return { sel: null, ans: false, opts, assign: cols.map(() => null) };
      }
      const cor = opts.map(o => o.col);
      const corLabel = [];
      opts.forEach(o => { corLabel[o.col] = o.label; });
      return { sel: null, ans: false, cor, corLabel, opts, place: opts.map(() => null) };
    }
    if (isMulti(data)) {
      const cor = opts.map((o, i) => o.type === 'correct' ? i : -1).filter(i => i >= 0);
      return { sel: [], ans: false, cor, opts };
    }
    return { sel: null, ans: false, cor: opts.findIndex(o => o.type === 'correct'), opts };
  });
  cur = 0;
  document.getElementById('summaryPanel').style.display = 'none';
  document.getElementById('qPanel').style.display = 'flex';
  renderQuestion();
}

function showSummary() {
  document.getElementById('qPanel').style.display = 'none';
  document.getElementById('summaryPanel').style.display = 'block';
  if (SUMMARY_CIRCUIT_REF) { swapLeftPanel('circuit'); showCircuitRef(SUMMARY_CIRCUIT_REF.id, SUMMARY_CIRCUIT_REF.label, SUMMARY_CIRCUIT_REF.viewBox); }
  else swapLeftPanel('none');
  const items = QUESTIONS.map((data, i) => {
    const st = Q[i];
    const ans = selectedLabel(data, st);
    const ok = isAnswerCorrect(data, st);
    const colour = ok ? 'var(--colour-ui-correct)' : '#ff3366';
    const mark = ok ? '✓' : '✗';
    return `<div class="summary-item">
      <div class="summary-item-head"><span class="summary-qnum">Q${i + 1}</span><span class="summary-question">${data.text(st)}</span></div>
      <div class="summary-answer" style="color:${colour}">You answered: ${ans} &nbsp; ${mark}</div>
      <div class="working-box visible">${st.ans ? data.working(st) : ''}</div>
    </div>`;
  }).join('');
  document.getElementById('summaryContent').innerHTML = items;
  QUESTIONS.forEach((_, i) => { const d = document.getElementById('dot-' + i); if (d) d.className = 'progress-dot done'; });
  document.getElementById('progressLabel').textContent = 'Complete';
}

// ── zoom modal — fully defensive; pages without a #diagramModal simply
// never have anything call these (no onclick="openModal()" exists there).
function openModal() {
  const src = document.getElementById(CIRCUIT_SVG_ID), dst = document.getElementById('modalSvg');
  if (!src || !dst) return;
  dst.innerHTML = src.innerHTML; dst.setAttribute('viewBox', src.getAttribute('viewBox'));
  // Pages whose reference circuit swaps per question (CIRCUIT_SVG_ID ===
  // 'circuitRefSvg') also sync the modal's own title from circuitRefLabel;
  // pages with a single static circuit (and their own #modalVoltLabel-style
  // title, updated elsewhere) simply don't have a #modalTitle to find.
  const modalTitle = document.getElementById('modalTitle'), refLabel = document.getElementById('circuitRefLabel');
  if (modalTitle && refLabel) modalTitle.textContent = refLabel.textContent;
  document.getElementById('diagramModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  const modal = document.getElementById('diagramModal');
  if (!modal) return;
  modal.classList.remove('open');
  const dst = document.getElementById('modalSvg');
  if (dst) dst.innerHTML = '';
  document.body.style.overflow = '';
}
function handleModalClick(e) { if (e.target.closest('.modal-close')) return; closeModal(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function goBack(e) { e.preventDefault(); history.back(); }

function jump(n, answered) {
  if (n < 1 || n > QUESTIONS.length) { console.warn('jump: no question', n); return; }
  // Default every question before the target to correctly-answered, so
  // progress dots and back-navigation see a consistent, completed history.
  for (let i = 0; i < n - 1; i++) { fillCorrectSelection(i); Q[i].ans = true; }
  goToQuestion(n);
  if (answered) { fillCorrectSelection(cur); checkAnswer(); }
}
window.jump = jump;

function jumpToSummary() {
  QUESTIONS.forEach((_, i) => {
    if (Q[i].ans) return;
    fillCorrectSelection(i);
    Q[i].ans = true;
  });
  showSummary();
}
window.jumpToSummary = jumpToSummary;

/* ─── DEV: xy ruler overlay — defensive; pages without #xyRuler/CIRCUIT_SVG_ID
   simply never call setXY(1) themselves (nothing wires it to a control).
   Rebuilt on every call (no build-once cache) rather than cached after the
   first build — pages whose reference circuit swaps viewBox per question
   (see showCircuitRef's own `if (xyOn) buildXYRuler()`) need a fresh ruler
   each time or it drifts out of alignment; a cache would only ever be a
   micro-optimisation for a rarely-used dev-only overlay, not worth the
   staleness risk. Offset-aware (vb.x/vb.y) so it works identically whether
   CIRCUIT_SVG_ID's viewBox starts at 0,0 or not. ── */
let xyOn = false;
function buildXYRuler() {
  const g = document.getElementById('xyRuler');
  const svgEl = document.getElementById(CIRCUIT_SVG_ID);
  if (!g || !svgEl) return;
  const vb = svgEl.viewBox.baseVal;
  const offX = vb.x, offY = vb.y, W = vb.width, H = vb.height;
  const hy = offY + H - 10, vx = offX + 10, col = '#ff00ff';
  let svg = `<line x1="${offX}" y1="${hy}" x2="${offX + W}" y2="${hy}" stroke="${col}" stroke-width="1" opacity="0.6"/>`;
  for (let x = 0; x <= W; x += 10) {
    const gx = offX + x, major = (Math.round(gx) % 50 === 0), len = major ? 10 : 5;
    svg += `<line x1="${gx}" y1="${hy - len}" x2="${gx}" y2="${hy}" stroke="${col}" stroke-width="1" opacity="0.6"/>`;
    if (major) svg += `<text x="${gx}" y="${hy - 13}" fill="${col}" font-size="8" text-anchor="middle">${Math.round(gx)}</text>`;
  }
  svg += `<line x1="${vx}" y1="${offY}" x2="${vx}" y2="${offY + H}" stroke="${col}" stroke-width="1" opacity="0.6"/>`;
  for (let y = 0; y <= H; y += 10) {
    const gy = offY + y, major = (Math.round(gy) % 50 === 0), len = major ? 10 : 5;
    svg += `<line x1="${vx}" y1="${gy}" x2="${vx + len}" y2="${gy}" stroke="${col}" stroke-width="1" opacity="0.6"/>`;
    if (major) svg += `<text x="${vx + 13}" y="${gy + 3}" fill="${col}" font-size="8" text-anchor="start">${Math.round(gy)}</text>`;
  }
  g.innerHTML = svg;
}
function setXY(on) {
  xyOn = on;
  const g = document.getElementById('xyRuler');
  if (!g) return;
  if (on) buildXYRuler();
  g.setAttribute('display', on ? 'inline' : 'none');
}
window.setXY = setXY;

// ── Bootstrap helpers — call explicitly from each page's own inline script,
// AFTER its own QUESTIONS[] (and any page-specific setup, e.g.
// bjt_knowledge_basics.html's setMode()) has run. Split into two calls
// (rather than one auto-running initQuiz()) because some pages need their
// own setup to happen BETWEEN "build the progress dots" and "do the first
// render" — see this file's own header comment for the exact call shape
// each page needs. ──
function initQuizNav() {
  buildProgressDots();
  // Only show the back link if there's actually somewhere to go back to —
  // history.length is 1 when this page was opened directly (new tab,
  // bookmark, double-click) rather than reached by clicking a link from a
  // menu page.
  if (history.length > 1) {
    const menuLink = document.getElementById('menuLink');
    if (menuLink) menuLink.style.display = '';
  }
}
function initQuizFromURL() {
  const p = new URLSearchParams(location.search);
  if (p.has('q')) { if (p.get('q') === 's') jumpToSummary(); else jump(+p.get('q'), p.has('ans')); }
  if (p.has('xy')) setXY(+p.get('xy') === 1);
}
