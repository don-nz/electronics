/* ══════════════════════════════════════════════════════════════════════
   Cert III — interactive circuit layer for fault-finding quizzes.

   Used by the "click the meters/components on the circuit" quizzes
   (bjt_fault_interactive_internal / _resistor and the jfet equivalents).
   It sits ON TOP of quiz-engine.js: the engine owns the question flow
   (options, Check, Next, summary, deep links); this file owns everything
   that happens on the circuit diagram itself.

   Page contract
   -------------
     <script src="…/assets/quiz-engine.js"></script>
     <script src="…/assets/interactive-circuit.js"></script>
     …
     const QUESTIONS = [ …questions… ];
     InteractiveCircuit.setup({ keys, targetGroupId, healthyMeters, meterTextId, … });
     initQuizNav(); resetQuiz(); initQuizFromURL();

   setup() config
     keys           array of clickable ids, e.g. ['C1','R1','VB','IC','SCOPE_OUT']
     targetGroupId  { key: id of the SVG <g> that is the click target }
                    (also used as the base id for a meter's "<id>Ghost" group)
     viewBox        default viewBox of the inline circuit svg (#circuitRefSvg)
     summaryLabel   panel label shown on the summary page
     healthyMeters  { VB:{value,unit}, … }        } optional — meters
     meterTextId    { VB:[valueId, unitId], … }   }
     healthyScopes  { SCOPE_IN: shapeId, … }      } optional — scopes
     scopeShapeId   { SCOPE_IN: <use> id, … }     }
     leadIds, leadHealthyStroke                   optional — internal lead faults
     shortPathId    { BE:id, CB:id, CE:id }       optional — internal short arcs
     resistorKeys   ['R1','R2','RC','RE']         optional — open/high markers
     selectHint     text under the question before anything is selected
     summaryLabel   panel label on the summary page

   Question fields it understands
     interactiveCircuit: true     the circuit is the click surface (no option list)
     options()                    [{key, label, type:'correct'|'wrong'}, …] (kind:'multi')
     circuitLabel / circuitViewBox
     meterOverride(answered, st)  { VB:{value,unit,up?,delta?}, … }
     scopeOverride(answered)      { SCOPE_OUT:'scope-ch2-only', … }
     faultedLeads: ['bjt-base', …]    shortedPair: 'BE'|'CB'|'CE'
     openResistor: 'R1'               highResistor: 'RE'

   Nothing here touches the DOM until setup() runs, so load order is free.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  let C = null;

  // ── clicking a component/meter on the diagram toggles it as an answer ──
  function wireComponentClicks() {
    C.keys.forEach(key => {
      const g = document.getElementById(C.targetGroupId[key]);
      if (!g) return;
      g.addEventListener('click', () => {
        const data = QUESTIONS[cur], st = Q[cur];
        if (!data.interactiveCircuit || st.ans) return;
        const idx = st.opts.findIndex(o => o.key === key);
        if (idx >= 0) selectOption(idx);
      });
    });
  }

  // Highlight frame + badge for one target: selection-pending (blue) before
  // the answer is checked, then correct / wrong / missed afterwards.
  function paintComponent(key, idx, st, answered) {
    const hl = document.getElementById('hl-' + key), badge = document.getElementById('badge-' + key);
    if (!hl || !badge) return;
    const selected = st.sel.includes(idx);
    const isCorrect = st.opts[idx].type === 'correct';
    if (!answered) {
      hl.setAttribute('stroke', selected ? 'var(--colour-ui-primary)' : 'transparent');
      hl.setAttribute('fill', selected ? 'rgba(var(--colour-ui-primary-rgb),.1)' : 'none');
      badge.textContent = selected ? '✓' : '';
      badge.setAttribute('fill', 'var(--colour-ui-primary)');
    } else if (isCorrect) {
      hl.setAttribute('stroke', selected ? 'var(--colour-ui-correct)' : 'var(--colour-ui-restart)');
      hl.setAttribute('stroke-dasharray', selected ? 'none' : '4,3');   // dashed = missed
      hl.setAttribute('fill', selected ? 'rgba(var(--colour-ui-correct-rgb),.12)' : 'none');
      badge.textContent = selected ? '✓' : '?';
      badge.setAttribute('fill', selected ? 'var(--colour-ui-correct)' : 'var(--colour-ui-restart)');
    } else {
      hl.setAttribute('stroke', selected ? 'var(--colour-ui-wrong)' : 'transparent');
      hl.setAttribute('stroke-dasharray', 'none');
      hl.setAttribute('fill', selected ? 'rgba(var(--colour-ui-wrong-rgb),.12)' : 'none');
      badge.textContent = selected ? '✗' : '';
      badge.setAttribute('fill', 'var(--colour-ui-wrong)');
    }
    if (!answered || isCorrect) hl.removeAttribute('stroke-dasharray');
  }

  // One pass over the WHOLE interactive universe on every render: paint each
  // key that is one of the CURRENT question's options, blank the rest.
  function syncInteractiveVisuals(data, st) {
    C.keys.forEach(key => {
      const g = document.getElementById(C.targetGroupId[key]);
      const idx = (data.interactiveCircuit && st.opts) ? st.opts.findIndex(o => o.key === key) : -1;
      if (g) g.classList.toggle('comp-interactive', idx >= 0);
      if (idx >= 0) {
        paintComponent(key, idx, st, st.ans);
      } else {
        const hl = document.getElementById('hl-' + key), badge = document.getElementById('badge-' + key);
        if (hl) { hl.setAttribute('stroke', 'transparent'); hl.setAttribute('fill', 'none'); hl.removeAttribute('stroke-dasharray'); }
        if (badge) badge.textContent = '';
      }
    });
  }

  // ── meters: "?" until answered, then the real reading + up/down ghost ──
  function addGhost(groupId, wentUp, deltaStr) {
    const g = document.getElementById(groupId + 'Ghost'); if (!g) return;
    const clr = wentUp ? 'var(--colour-up)' : 'var(--colour-down)';
    document.getElementById(groupId + 'GhostText').setAttribute('fill', clr);
    document.getElementById(groupId + 'GhostArrow').textContent = wentUp ? '⬆' : '⬇';
    document.getElementById(groupId + 'GhostDelta').textContent = deltaStr;
    g.setAttribute('display', 'inline');
  }
  function removeGhost(groupId) {
    const g = document.getElementById(groupId + 'Ghost'); if (g) g.setAttribute('display', 'none');
  }
  function syncMeterValues(data, st) {
    if (!C.meterTextId) return;
    const override = data.meterOverride ? data.meterOverride(st.ans, st) : null;
    Object.keys(C.meterTextId).forEach(key => {
      const state = (override && override[key]) ? override[key] : C.healthyMeters[key];
      const [valId, unitId] = C.meterTextId[key];
      const valEl = document.getElementById(valId), unitEl = document.getElementById(unitId);
      if (valEl) valEl.textContent = state.value;
      if (unitEl) unitEl.textContent = state.unit;
      if (state.up !== undefined) addGhost(C.targetGroupId[key], state.up, state.delta);
      else removeGhost(C.targetGroupId[key]);
    });
  }

  // ── scopes: neutral shape until answered, then the fault-accurate one ──
  function syncScopeShapes(data, st) {
    if (!C.scopeShapeId) return;
    const override = data.scopeOverride ? data.scopeOverride(st.ans) : null;
    Object.keys(C.scopeShapeId).forEach(key => {
      const shapeId = (override && override[key]) ? override[key] : C.healthyScopes[key];
      const el = document.getElementById(C.scopeShapeId[key]);
      if (el) el.setAttribute('href', '#' + shapeId);
    });
  }

  // ── internal lead faults / shorts (visual only) ──
  // .style, not setAttribute: the lead's healthy colour is an inline style in
  // the defs, and a presentation attribute would lose to it in the cascade.
  // 'inline', not '': clearing would fall back to the markup's display="none".
  function syncLeadFaults(data) {
    if (!C.leadIds) return;
    const faulted = data.faultedLeads || [];
    C.leadIds.forEach(id => {
      const lead = document.getElementById(id);
      const mark = document.getElementById('fault-x-' + id);
      const isFaulted = faulted.includes(id);
      if (lead) lead.style.stroke = isFaulted ? 'var(--colour-ui-wrong)' : C.leadHealthyStroke;
      if (mark) mark.style.display = isFaulted ? 'inline' : 'none';
    });
  }
  function syncInternalShort(data) {
    if (!C.shortPathId) return;
    Object.keys(C.shortPathId).forEach(key => {
      const el = document.getElementById(C.shortPathId[key]);
      if (el) el.style.display = (data.shortedPair === key) ? 'inline' : 'none';
    });
  }

  // ── resistor faults: OPEN = X marker, HIGH = up-arrow marker ──
  function syncResistorFaults(data) {
    if (!C.resistorKeys) return;
    C.resistorKeys.forEach(key => {
      const xMark = document.getElementById('fault-x-' + key);
      if (xMark) xMark.style.display = (data.openResistor === key) ? 'inline' : 'none';
      const highMark = document.getElementById('fault-high-' + key);
      if (highMark) highMark.style.display = (data.highResistor === key) ? 'inline' : 'none';
    });
  }

  function setCircuitLabel(label, viewBox) {
    const labelEl = document.getElementById('circuitRefLabel');
    if (labelEl) labelEl.textContent = label || 'Reference Circuit';
    const svgEl = document.getElementById('circuitRefSvg');
    if (svgEl) svgEl.setAttribute('viewBox', viewBox || C.viewBox);
    if (typeof xyOn !== 'undefined' && xyOn) buildXYRuler();
  }

  // Runs after the engine's own renderQuestion() work (RENDER_EXTRA).
  function render() {
    const data = QUESTIONS[cur], st = Q[cur];
    // The circuit itself is the click surface: no separate option list.
    const optionsEl = document.getElementById('qOptions');
    if (optionsEl && data.interactiveCircuit) optionsEl.style.display = 'none';
    const selList = document.getElementById('qSelectedList');
    if (selList && isMulti(data) && data.interactiveCircuit) {
      selList.style.display = '';
      const names = [...st.sel].sort((a, b) => a - b).map(i => st.opts[i].key);
      selList.textContent = st.sel.length
        ? `Selected: ${names.join(', ')}`
        : (st.ans ? 'Selected: (none)' : C.selectHint);
    }
    syncInteractiveVisuals(data, st);
    syncMeterValues(data, st);
    syncScopeShapes(data, st);
    syncLeadFaults(data);
    syncInternalShort(data);
    syncResistorFaults(data);
    setCircuitLabel(data.circuitLabel, data.circuitViewBox);
  }

  window.InteractiveCircuit = {
    setup(cfg) {
      C = Object.assign({
        viewBox: '-10 -10 300 200',
        summaryLabel: 'Reference Circuit',
        leadHealthyStroke: 'var(--colour-bjt)',
        selectHint: 'Click the meters on the circuit to select your answer (look for ?).',
      }, cfg);
      // These pages show the one inline circuit on every question.
      QUESTIONS.forEach(q => { if (!q.leftPanel) q.leftPanel = 'circuit'; });
      RENDER_EXTRA = render;
      // keep the circuit panel on the summary page (showSummary() hides it unless this is set)
      SUMMARY_CIRCUIT_REF = { id: null, label: C.summaryLabel, viewBox: C.viewBox };
      SUMMARY_EXTRA = () => setCircuitLabel(C.summaryLabel);
      wireComponentClicks();
    },
  };
})();
