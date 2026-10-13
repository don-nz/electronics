# Quiz framework — how the pieces fit

Shared files live in `cert_iii/assets/` and are used by both UEEEC0066 (analogue) and UEEEC0069 (digital). Pages are plain HTML that open from `file://`, so there is no build step at runtime and no cross-file `fetch()` or SVG `<use>`.

## Files

| File | Job |
|---|---|
| `theme-init.js` | Light/dark theme, theme toggle, copyright footer. Load first, in `<head>`, non-deferred. |
| `nav-common.css`, `quiz-common.css` | All shared styling. Colours are tokens on `:root` (`--colour-*`); pages never hard-code a palette. |
| `quiz-engine.js` | `QUESTIONS[]`-driven quiz: rendering, marking, summary, deep links. The header comment lists every `kind`, `leftPanel` and hook. |
| `interactive-circuit.js` | Fault-finding layer on top of the engine: click a component to fault it, meters/scopes follow. |
| `shapes.js` | **Generated.** Shared SVG symbols, injected into a hidden `<svg>` on load. |
| `shapes/*.html` | Masters for `shapes.js` — edit these, never `shapes.js`. |
| `waveform-builder.js` | Draw-the-trace widget for timing-diagram exercises. |
| `breadcrumb.js` | Navigation trail (deferred). |

## A quiz page, in order

1. `theme-init.js`, `shapes.js`, `quiz-engine.js` (plain `<script src>`, in `<head>`).
2. `<link>` to `quiz-common.css`.
3. Body markup, then `<script>Shapes.use('set', …)</script>` **before the first other inline script**, so page-local defs win over library ones.
4. The page's own script: `const QUESTIONS = [...]`, helpers, optional hooks, then `initQuizNav()`, `resetQuiz()`, `initQuizFromURL()`.

Question fields are functions where the content depends on state (Example 1/2/3/Randomise), which is why `RESET_EXTRA` exists: if it generates values, it must also run once at load or `?q=N` deep links crash.

Hooks (all optional globals): `RENDER_EXTRA`, `RESET_EXTRA`, `SUMMARY_EXTRA`, `SUMMARY_CIRCUIT_REF`, `CIRCUIT_REF_EXTRA`, `CIRCUIT_SVG_ID`, `DEFAULT_CIRCUIT_VIEWBOX`.

Deep links: `?q=N` opens question N, `?q=N&ans=1` shows it answered, `?q=s` the summary.

## Shapes

```html
<script src="…/assets/shapes.js"></script>
…
<script>Shapes.use('logic-gates', 'flip-flops', { transform: { '*-trad': 'scale(1.5)' } });</script>
```

- A master is `assets/shapes/<set>.html`; each becomes one named set.
- After editing a master: `python3 tools/build_shapes.py` (`--check` exits 1 if `shapes.js` is stale).
- Ids already in the document are skipped, so a page can keep a deliberate local variant (e.g. the flipped PNP). Intentional variants are listed in `tools/shapes_intentional.txt`.
- Ids that appear in two masters must have identical markup or the build fails.
- Gotcha: ids that JS looks up with `getElementById` must be in the visible tree, not behind a `<use>` of a defs group.

## Fault-finding pages

```js
InteractiveCircuit.setup({
  keys, targetGroupId, healthyMeters, meterTextId, healthyScopes,
  scopeShapeId, leadIds, leadHealthyStroke, shortPathId,
  resistorKeys, viewBox, summaryLabel, selectHint
});
```

Call it after `QUESTIONS` is defined. It installs `RENDER_EXTRA`, `SUMMARY_CIRCUIT_REF` and `SUMMARY_EXTRA` and sets every question's `leftPanel` to `'circuit'`. Pages supply only data: which component keys exist, what each meter reads when healthy, and which lead ids can fault.

## Tools (`tools/`)

| Command | Use |
|---|---|
| `python3 tools/smoke.py [paths…]` | Load pages headless; fails on JS errors or missing local links. `--deeplinks` also opens `?q=N`. |
| `python3 tools/shots.py …` | Capture and diff screenshots (seeded `Math.random`, `--quick`, `--crop`). Stored in `~/.cache/tafe-shots/<label>`. Use before/after any shared-asset change. |
| `python3 tools/build_shapes.py` | Regenerate `shapes.js`. |
| `python3 tools/migrate_shapes.py` | Find pages holding pasted copies of library shapes (`--list/--dry/--apply/--adopt`). |
| `python3 tools/build_college.py PAGE…` | Make self-contained single-file copies (assets inlined, shapes trimmed) into `build/college/`. |

## Conventions

- `week_NN` folders are Don's own sequence; "Sections" are the teacher's numbering.
- Teacher files are reference only — never reproduce their questions or answers.
- Show the device symbol with every behaviour/usage question; add CLK/D/Q-style traces where behaviour is over time.
- Setup/hold rule: no D/J/K/data change on an active clock edge; no preset/clear asserted on or just before it.
- Teacher-facing `*_college.html` live only in `cert_iii/UEEEC0069/college/` and must be self-contained.
- Legacy folders (`quiz/`, `filter/`, `simulator/`) predate the framework and are migrated later.

## Changing shared files safely

1. `python3 tools/shots.py` a baseline, make the change, capture again and diff.
2. `python3 tools/smoke.py` over everything (about 205 pages, a few minutes).
3. If you touched a shape master, run `build_shapes.py` and commit `shapes.js` with it.
