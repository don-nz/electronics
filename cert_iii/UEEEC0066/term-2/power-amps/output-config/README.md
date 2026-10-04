# Output configurations

Notes moved out of the quiz HTML so the circuit-editing comments stay in the files.

## Concepts quiz

File: `output_config_knowledge_basics.html`

### Source notes

Source material: the teacher's own "Power amplifier output configurations"
objectives page (Purpose + 8 bullet objectives), a printed Review Questions
sheet (21 questions across 6 circuits) and an answer sheet for Section 7.
Same policy as this project's other review-sheet-backed quizzes: the review
questions are REFERENCE ONLY, never copied — every question below is original.
Split into two files, following coupling/basics: this file holds the
CONCEPTS (output configurations, driver transistors, the diode and V_BE
multiplier bias, Darlington and composite pairs, crossover reduction and
faults). The DC calculations (quiescent current, DC voltages, maximum power)
live in output_config_circuit_analysis.html.
Circuits are redrawn fresh and follow the diff_amp / amp_classes diagram
standard: static <g id="fig-..."> reference circuits in <defs>, shown via the
single <use id="circuitRefUse"> in #circuitSvg and swapped per question by
quiz-engine.js's showCircuitRef() from each question's circuitId /
circuitViewBox. Lines are drawn first, then components layered on top.
Being built in one pass: 12 questions cover the 8 objectives (the
objective on verifying the operation of a circuit is laboratory work, so
it's covered by the conceptual questions only).

### Question notes

- Objective: identify the output configuration (complementary AB).
- Objective: the bias voltage between the bases.
- Objective: identify a Darlington pair.
- Objective: Darlington current gain.
- Objective: composite pair type.
- Objective: role of driver transistors.
- Objective: V_BE multiplier purpose.
- Objective: where the V_BE multiplier is physically placed.
- Objective: crossover distortion reduction methods.
- Objective: emitter resistors.
- Objective: complementary MOSFET output stage.
- Fault: open-base on the PNP output driver.

## DC analysis quiz

File: `output_config_circuit_analysis.html`

### Source notes

Source material: the teacher's own "Power amplifier output configurations"
objectives page and a printed Review Questions sheet / answer sheet for
Section 7. The review questions are REFERENCE ONLY, never copied — every
question below is original.
DC analysis for the complementary class AB output stage, split from
output_config_knowledge_basics.html in the same way coupling/basics splits
its conceptual and circuit-analysis quizzes.
The circuit is the same complementary class AB stage as the knowledge file,
drawn fresh and following the diff_amp / amp_classes diagram standard (lines
drawn first, components layered over them, shared shapes in <defs>).
Values are RANDOMISED on every resetQuiz() via RESET_EXTRA (and once at load,
so a ?q=N deep-link always has valid values — see
reset_extra_skipped_on_deep_link.md in the memory folder). The symmetric
supply means the base voltages are fixed at ±0.6V; the bias current, the
maximum power and the output-device currents all depend on the random
supply, bias resistor and load.
Each wrong option is a specific, plausible mistake: forgetting the diode drop,
using both diode drops, forgetting the square in the power formula, and
using the rail voltage instead of the peak.

### Question notes

- ── Randomised DC values ──
- Picked fresh on every resetQuiz() via RESET_EXTRA, and once at load so
- a ?q=N deep-link (which skips RESET_EXTRA) still has valid values.
- Symmetric ±VCC, equal bias resistors R1 = R2, load RL.
- Quiescent current in the output devices: I = (VCC − 0.6V)/R1.
- Maximum output power: P = VCC²/(2RL).
- Base voltage of Q1 at zero input (fixed).
- Collector voltage of Q1 (fixed relative to the supply).
- Bias current through R1, the same as the quiescent current.
