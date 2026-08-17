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
  or `reusablePool` — see below) | 'bits'.
  `leftPanel`: unset/'circuit' (a static circuit-panel div, optionally swapped
  per-question via showCircuitRef(data.circuitId, data.circuitLabel) if the
  page has a #circuitRefUse/#circuitRefLabel to target) | 'viz' (a named
  file-specific panel div — see swapLeftPanel(), still requires the page to
  define its own #q5VizPanel-equivalent and drive it) | 'shapeGrid' | 'none'.
  Zoom modal (openModal/closeModal) and the dev xy-ruler overlay
  (buildXYRuler/setXY) are both included, both fully defensive — pages
  without a #diagramModal/#circuitSvg simply never trigger them.

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
  and set both globals accordingly).

  NOT YET included (exists in exactly one page, not needed by any file
  migrated so far — add when a truth-table file gets migrated):
  `kind:'truth'`.

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
function bitFromClicks(n) { const m = n % 3; return m === 0 ? null : m - 1; }

function isAnswerCorrect(data, st) {
  if (isBits(data)) return st.clicks.every((row, r) => row.every((n, c) => bitFromClicks(n) === st.cor[r][c]));
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
  if (!isMulti(data)) return (st.sel != null && st.opts[st.sel]) ? st.opts[st.sel].label : '—';
  const asLabel = i => data.leftPanel === 'shapeGrid' ? (i + 1) : LETTERS[i];
  return st.sel.length ? [...st.sel].sort((a, b) => a - b).map(asLabel).join(', ') : '—';
}

// Fills in the fully-correct answer for a question without marking it
// answered — used by jump()/jumpToSummary() to fast-forward prior questions.
// Works across every kind.
function fillCorrectSelection(i) {
  const data = QUESTIONS[i], st = Q[i];
  if (isBits(data)) st.clicks = st.cor.map(row => row.map(bit => bit + 1)); // clicks bit+1 -> bitFromClicks() lands on 0/1 (0 would land on blank)
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
  const st = Q[cur];
  const c = document.getElementById('shapeGridCells'); c.innerHTML = '';
  st.opts.forEach((opt, i) => {
    const cell = document.createElement('div'); cell.className = 'shape-cell';
    const selected = st.sel.includes(i);
    if (st.ans) {
      if (opt.type === 'correct') cell.classList.add(selected ? 'correct' : 'missed');
      else cell.classList.add(selected ? 'wrong' : 'dimmed');
    } else {
      if (selected) cell.classList.add('selected');
      cell.addEventListener('click', () => selectOption(i));
    }
    cell.innerHTML = `<span class="shape-num">${i + 1}</span><svg viewBox="${SHAPE_VIEWBOX}"><use href="#${opt.shapeId}"/></svg>`;
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
function matchChipContent(opt, constrained) {
  if (!opt.shapeId) return opt.label;
  const svgStyle = constrained ? 'width:100%;max-width:92px;height:auto;display:block' : 'width:92px;height:auto;display:block';
  return `<svg viewBox="${SHAPE_VIEWBOX}" style="${svgStyle}"><use href="#${opt.shapeId}"/></svg>`;
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
    chip.innerHTML = matchChipContent(opt);
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
    title.innerHTML = (typeof col === 'string') ? col : `<svg viewBox="${SHAPE_VIEWBOX}" style="width:100%;max-width:${MATCH_COL_TITLE_MAX_WIDTH}px;display:block;margin:0 auto"><use href="#${col.shapeId}"/></svg>`;
    const items = document.createElement('div'); items.className = 'match-col-items';

    st.opts.forEach((opt, i) => {
      if (st.place[i] !== colIdx) return;
      const chip = document.createElement('button');
      chip.className = 'match-chip' + (opt.shapeId ? ' match-chip-shape' : '');
      chip.innerHTML = matchChipContent(opt, true);
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
    chip.innerHTML = matchChipContent(opt);
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
    title.innerHTML = (typeof col === 'string') ? col : `<svg viewBox="${SHAPE_VIEWBOX}" style="width:100%;max-width:${MATCH_COL_TITLE_MAX_WIDTH}px;display:block;margin:0 auto"><use href="#${col.shapeId}"/></svg>`;
    const items = document.createElement('div'); items.className = 'match-col-items';

    const assignedIdx = st.assign[colIdx];
    if (assignedIdx !== null) {
      const opt = st.opts[assignedIdx];
      const chip = document.createElement('button');
      chip.className = 'match-chip' + (opt.shapeId ? ' match-chip-shape' : '');
      chip.innerHTML = matchChipContent(opt, true);
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
  const qOptionsEl = document.getElementById('qOptions');
  if (qOptionsEl) qOptionsEl.style.display = (isMatch(data) || isBits(data) || data.leftPanel === 'shapeGrid') ? 'none' : '';

  if (isMatch(data)) {
    if (data.reusablePool) renderMatchReusable(); else renderMatch();
  } else if (isBits(data)) {
    renderBits();
  } else if (data.leftPanel === 'shapeGrid') {
    renderShapeGrid();
  } else {
    renderOptions();
  }

  const selList = document.getElementById('qSelectedList');
  if (multi) {
    selList.style.display = '';
    const asLabel = i => data.leftPanel === 'shapeGrid' ? (i + 1) : LETTERS[i];
    selList.textContent = st.sel.length
      ? `Selected: ${[...st.sel].sort((a, b) => a - b).map(asLabel).join(', ')}`
      : (data.leftPanel === 'shapeGrid' ? 'Click the shapes above to select your answer.' : 'Click every option that applies.');
  } else {
    selList.style.display = 'none';
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
  check.disabled = st.ans || (
    isMatch(data) ? (data.reusablePool ? !st.assign.every(a => a !== null) : !st.place.every(p => p !== null)) :
    isBits(data) ? !st.clicks.every(row => row.every(n => bitFromClicks(n) !== null)) :
    (multi ? st.sel.length === 0 : st.sel === null)
  );
  const isLast = cur === QUESTIONS.length - 1;
  document.getElementById('qNext').style.display = (st.ans && !isLast) ? 'inline-block' : 'none';
  document.getElementById('qSummary').style.display = (st.ans && isLast) ? 'inline-block' : 'none';

  swapLeftPanel(data.leftPanel || 'circuit');
  if ((data.leftPanel || 'circuit') === 'circuit') showCircuitRef(data.circuitId, data.circuitLabel);
  updateProgress();
}

function checkAnswer() {
  const st = Q[cur], data = QUESTIONS[cur];
  if (st.ans) return;
  if (isMatch(data)) {
    if (data.reusablePool) { if (!st.assign.every(a => a !== null)) return; }
    else if (!st.place.every(p => p !== null)) return;
  }
  else if (isBits(data)) { if (!st.clicks.every(row => row.every(n => bitFromClicks(n) !== null))) return; }
  else if (isMulti(data) ? st.sel.length === 0 : st.sel === null) return;
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

// For leftPanel:'circuit' questions that reference a DIFFERENT circuit per
// question (rather than always the same static one) — swaps which <use>
// target the reference SVG points at. Defensive: pages with only one
// static circuit (no per-question circuitId) simply never have anything
// call this.
function showCircuitRef(id, label) {
  const use = document.getElementById('circuitRefUse');
  if (!use) return;
  use.setAttribute('href', '#' + id);
  const labelEl = document.getElementById('circuitRefLabel');
  if (labelEl) labelEl.textContent = label || 'Reference Circuit';
}

function goToQuestion(n) { // 1-based, for URL/jump compatibility
  cur = Math.max(0, Math.min(QUESTIONS.length - 1, n - 1));
  document.getElementById('summaryPanel').style.display = 'none';
  document.getElementById('qPanel').style.display = 'flex';
  renderQuestion();
  scrollToQuestionTop();
}

function resetQuiz() {
  Q = QUESTIONS.map(data => {
    const opts = data.options();
    if (isBits(data)) {
      const cor = opts.map(row => [3, 2, 1, 0].map(shift => (row.value >> shift) & 1));
      return { ans: false, cor, opts, clicks: opts.map(() => [0, 0, 0, 0]) };
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
  swapLeftPanel('none');
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
  const src = document.getElementById('circuitSvg'), dst = document.getElementById('modalSvg');
  if (!src || !dst) return;
  dst.innerHTML = src.innerHTML; dst.setAttribute('viewBox', src.getAttribute('viewBox'));
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

/* ─── DEV: xy ruler overlay — defensive; pages without #circuitSvg/#xyRuler
   simply never call setXY(1) themselves (nothing wires it to a control). ── */
function buildXYRuler() {
  const g = document.getElementById('xyRuler');
  const circuitSvg = document.getElementById('circuitSvg');
  if (!g || !circuitSvg || g.dataset.built) return;
  g.dataset.built = '1';
  const vb = circuitSvg.viewBox.baseVal;
  const W = vb.width, H = vb.height;
  const hy = H - 10, vx = 10, col = '#ff00ff';
  let svg = `<line x1="0" y1="${hy}" x2="${W}" y2="${hy}" stroke="${col}" stroke-width="1" opacity="0.6"/>`;
  for (let x = 0; x <= W; x += 10) {
    const major = (x % 50 === 0), len = major ? 10 : 5;
    svg += `<line x1="${x}" y1="${hy - len}" x2="${x}" y2="${hy}" stroke="${col}" stroke-width="1" opacity="0.6"/>`;
    if (major) svg += `<text x="${x}" y="${hy - 13}" fill="${col}" font-size="8" text-anchor="middle">${x}</text>`;
  }
  svg += `<line x1="${vx}" y1="0" x2="${vx}" y2="${H}" stroke="${col}" stroke-width="1" opacity="0.6"/>`;
  for (let y = 0; y <= H; y += 10) {
    const major = (y % 50 === 0), len = major ? 10 : 5;
    svg += `<line x1="${vx}" y1="${y}" x2="${vx + len}" y2="${y}" stroke="${col}" stroke-width="1" opacity="0.6"/>`;
    if (major) svg += `<text x="${vx + 13}" y="${y + 3}" fill="${col}" font-size="8" text-anchor="start">${y}</text>`;
  }
  g.innerHTML = svg;
}
function setXY(on) {
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
