# GridPulse upgrade log

A record of what changed in this pass, why it changed, and exactly how each
change is verified. Every number quoted below comes from a command in this
repository.

## What was upgraded

### 1. A new advisor module

`js/gridpulse-advisor.js` was added. It is a pure ES module that imports the
existing simulator and answers questions the simulator alone could not:

- `enumerateMoves` lists every legal one-step breaker throw or relay arm from a
  circuit state map. Critical circuits are protected from shedding, and a shed
  circuit gains a reclose move instead of another shed.
- `scoreSchedule` runs the full 24-hour simulator on one candidate and returns
  peak reduction, daily bill saving, daily carbon avoided, battery endurance,
  strain and a weighted objective.
- `marginalCircuitContributions` scores every legal move against the current
  schedule and reports the signed delta for each objective, sorted by value.
- `optimizeSchedule` performs a greedy hill climb under a 1 to 6 move budget,
  rescoring all legal moves at each step.
- `compareSchedules` explains a state change objective by objective.
- `stressTestScenarios` scores the active schedule under all four ERCOT
  conditions and names the worst strain and the best saving.
- `buildAdvisorReport` assembles the best single move, the greedy plan and the
  stress test into one compact card.

The weighted objective includes a comfort penalty proportional to the
nameplate rating of any shed circuit. Without it the greedy search would simply
open every breaker, which is not an actionable household plan. At the default
comfort weight of 2.0 the plan prefers relay shifts.

### 2. A new interactive panel

`index.html` gained a Load-Shift Advisor section with:

- a comfort weight slider from 0 to 4,
- a plan size slider from 1 to 6 moves,
- an Apply Recommended Plan actuator,
- a marginal contributions table with positive and negative semantic classes,
- a greedy plan list with cumulative peak savings,
- a scenario stress test table and a worst case readout.

`styles.css` gained a two column responsive advisor layout with captioned
tables, tabular numerals, and a mobile breakpoint. `js/app.js` gained the
advisor renderer, the apply action, and listeners for both new sliders.

### 3. UI clarity

The advisor controls change only the recommendation until the plan is applied,
so a reader can compare options without committing. Positive and negative
deltas are colored semantically, and every figure is prefixed with an explicit
sign so a zero is never confused with a missing value.

## Test coverage added

| Suite | Focus |
| --- | --- |
| `tests/advisor.test.js` | 33 tests over move enumeration, exact score agreement with the simulator, the comfort penalty, marginal deltas checked against independent simulations, greedy improvement invariants, the exact default four move plan, comparison deltas, stress test bounds and report assembly |
| `tests/advisor-dom.test.js` | 26 tests over static compliance, unique ids, resolved labels, captions, CSS, DOM bindings, plus live execution of every button, slider and scenario tab against the real modules |
| `tests/helpers/dom.js` | a zero dependency DOM shim with static module linking so `js/app.js` runs under `node:test` |

The compliance test walks every text file in the repository and rejects two
dash characters and a list of vendor model names assembled from fragments. The
test source itself contains no banned literal strings.

Representative assertions: 12 legal one-step moves from the baseline, the best
single move is the EV charger relay at +9.60 kW peak, the default four move
plan is all shifts, applying the plan changes the live peak readout, and every
scenario tab updates the title and the stress table.

## Verification commands

```sh
cd gridpulse
npm test
node --experimental-vm-modules --test tests/gridpulse.test.js tests/dom-smoke.test.js tests/advisor.test.js tests/advisor-dom.test.js tests/lab.test.js tests/lab-dom.test.js
```

`npm test` is canonical, and all test suites must pass with zero failures.

## Honest scope

All scenarios, tariff rates, weather multipliers, circuit profiles and battery
constants are illustrative planning values authored for this simulator, not
metered data from a real home or a published settlement feed. The advisor
optimizes the numbers in this model. The new analysis is deterministic and
pure: no state is mutated by a search, no network call is made, and no new
dependency was introduced.

## Local audit correction

The unsupported sensor-accuracy caption was removed and the controller image
is labeled as an illustrative concept. External font links were removed in
favor of system fonts. The print view and README describe a simulation
worksheet. No household, field pilot, hardware validation or measured savings
is claimed.

## November 16 local verification

127 Node tests passed, 0 failed, 0 skipped, 0 cancelled.

`npm test` runs all four existing test files with
`node --experimental-vm-modules --test`. Inputs and results are illustrative
simulation values. External font requests and the unmeasured sensor-accuracy
claim were removed.

Verification environment. Node v24.16.0 and Python 3.9.6, with pytest 8.4.2
for Python test files where present. No browser or physical hardware session
was run.

The footer no longer claims calibration to 15-minute settlement intervals.
The implemented model uses hourly samples. The page identifies reserve,
weather and tariff values as synthetic, removes a fixed battery-runtime
promise, and updates the visible test count from 68 to 127.
