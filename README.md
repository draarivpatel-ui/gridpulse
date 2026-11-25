# GridPulse

Live app: https://aariv.me/gridpulse/
Source code: https://github.com/draarivpatel-ui/gridpulse

GridPulse models household breaker-level electricity demand and battery backup
runtime during Texas (ERCOT) grid emergencies. Instead of guessing which
appliances to turn off during a summer conservation appeal or a winter freeze
outage, you can toggle 8 residential sub-panel circuits and watch how shifting
each load changes your 24-hour demand curve, electricity bill, marginal carbon
emissions, and 13.5 kWh LFP battery reserve.

A second layer, the Load-Shift Advisor, scores every legal one-step breaker or
relay change by running the full simulator, then greedily builds a plan under a
budget of moves. It also stress tests the active schedule under all four shipped
grid conditions.

## What It Does

- Simulates 4 ERCOT grid conditions (August 104F thermal peak, February polar
  vortex freeze, Gulf Coast wind drop during solar sunset, and an islanded
  outage running on a 13.5 kWh LFP home battery).
- Lets you toggle and time-shift 8 household breaker circuits (4-ton HVAC
  compressor, Level-2 EV charger, electric dryer, pool pump, heat-pump water
  heater, induction range, medical CPAP and fridge bus, and fiber/lighting bus).
- Draws a dual-trace 24-hour SVG load curve comparing unshifted baseline demand
  against your shifted schedule hour by hour, with a scrubber for every
  interval's baseline, active bus, delta and tariff.
- Ranks all 12 legal one-step moves by their marginal effect on peak kW, daily
  bill, daily carbon and battery endurance, with a comfort weight that prices
  the loss of service when a breaker is opened.
- Builds a greedy plan of 1 to 6 moves and applies it to the live schedule with
  one click.
- Scores the active schedule under all four scenarios and names the worst
  feeder strain and the best bill saving.
- Prints a one-page simulation worksheet (`Cmd+P` / `Ctrl+P`) with the model's
  breaker directory and calculated schedule.
- Compares 5 deterministic outage and tariff policies (unshifted baseline, TOU
  delay shift, comfort-safe advisor, battery peak shave and critical island
  survival) under all 4 shipped ERCOT conditions, computing peak kW, daily
  kWh, bill, carbon and island endurance for every cell and proving the
  critical buses are never shed.
- Sweeps the LFP pack from 6.75 to 40.5 kWh at a 10 or 20 percent reserve
  floor and reports the smallest capacity that clears a 24h or 48h island
  outage for each policy, with focusable SVG charts.
- Exports a SHA-256 stamped resilience brief as JSON, formula-safe CSV and
  Markdown. One cached stamped payload feeds the on-page fingerprint and all
  three exports, so a tamper in any field breaks verification.
- Restores the full lab state from a strict `#gp=` bookmark hash and runs 14
  deterministic self-tests inside the page.

## How the advisor works

Each candidate move is a real circuit state map. The advisor calls
`simulateHouseholdGridPulse` on it and reads the resulting metrics, so a
recommendation can never claim a saving the engine does not produce. The
weighted objective combines peak reduction, bill saving, carbon avoided and
island endurance, minus a comfort penalty proportional to the nameplate rating
of any shed circuit. Critical circuits are never offered for shedding. The
search rescores every legal move at every step, so it is deterministic and
independent of iteration order.

## How the policy lab works

Every lab policy is also a real circuit state map. The comparator calls the
same `simulateHouseholdGridPulse` on each of the 5 policies under each of the
4 conditions, so no cell can report a figure the engine does not produce. The
endurance math is the engine's outage formula with the reserve floor exposed
as a parameter; at the shipped 10 percent floor the lab result is identical
to the engine call. The SHA-256 implementation is a self-contained FIPS 180-4
digest verified against known-answer vectors and `node:crypto` in the test
suite. The export digest covers one canonical JSON payload cached per state
key, so the page line, the JSON, the CSV header and the Markdown footer all
carry the same fingerprint. The `#gp=` codec accepts only a fixed lowercase
field grammar and clamps every number back into the shipped ranges, so a
malformed or hostile hash can never install unsafe state.

At the default comfort weight of 2.0, the four move plan from the unoptimized
baseline is to arm the EV charger, HVAC, dryer and water heater relays; no
breaker is opened. Lowering the comfort weight to zero makes shedding the EV
charger the best single move. The slider exposes that tradeoff rather than
hiding it.

## How to Run Locally

GridPulse is written in plain HTML, CSS, and vanilla JavaScript with no build
step required. The page uses local assets and system fonts, with no external
font requests.

1. Clone the repository:
   ```bash
   git clone https://github.com/draarivpatel-ui/gridpulse.git
   cd gridpulse
   ```
2. Start any static file server:
   ```bash
   python3 -m http.server 8000
   ```
3. Open `http://localhost:8000` in your browser.

To run the test suite (Node 18 or newer, no packages to install):

```bash
npm test
```

The underlying command is:

```bash
node --experimental-vm-modules --test tests/gridpulse.test.js tests/dom-smoke.test.js tests/advisor.test.js tests/advisor-dom.test.js tests/lab.test.js tests/lab-dom.test.js
```

The VM module flag is needed by one test helper that runs `js/app.js` against a
zero dependency DOM shim, with the real engine and advisor modules linked in.

## Layout

```
index.html                    the whole app and the advisor panel
styles.css                    the design system and advisor layout
js/gridpulse-engine.js        scenarios, circuits, simulator, SVG, view state
js/gridpulse-advisor.js       move enumeration, scoring, greedy plan, stress test
js/gridpulse-lab.js           5-policy comparator, battery sweep, SHA-256 export,
                              #gp= bookmark codec, self-tests, SVG charts
js/app.js                     panel rendering and all interactive wiring
tests/                        engine, DOM smoke, advisor and lab unit and live
                              UI suites
tests/helpers/dom.js          the DOM shim that executes app.js under node:test
DESIGN.md                     the industrial instrument design system
DEVPOST_UPGRADE.md            the upgrade log and exact verification commands
```

## Verification

The suite covers the scenario catalog, the circuit profiles, the 24-hour
simulator, the battery endurance math, the state reducer, the SVG oscilloscope,
the breaker directory, the printable placard, the advisor's move enumeration,
the marginal contributions, the greedy plan, the comparison and the stress
test, plus live execution of every button, slider, scenario tab, policy row,
chart point, export, verify/tamper demo and self-test runner. The lab suites
assert per-cell parity with direct simulator calls, the non-shedding
invariant in all 20 cells, SHA-256 parity across the page and all three
exports, and fail-closed decoding of malformed and hostile `#gp=` hashes.
Compliance tests scan every text file in the repository for two dash
characters and vendor model names, and check that every label and DOM binding
resolves.

## Honest scope

All scenarios, tariff rates, weather multipliers, circuit profiles and battery
constants are illustrative planning values authored for this simulator, not
metered data from a real home or a published ERCOT settlement feed. The advisor
optimizes the numbers in this model, not a real utility bill. The policy lab
compares the same deterministic reference model across policies; its sizing
curve is a model output, not a sizing recommendation for a real installation.
The SHA-256 digest is unkeyed tamper detection, not a signature or a promise
of correctness. Nothing here is a claim about a real installation, a utility
program or a hardware vendor, and nothing is electrical advice.

## License

MIT

## Latest local verification

402 Node tests passed, 0 failed, 0 skipped, 0 cancelled.

`npm test` runs all six test files with
`node --experimental-vm-modules --test`. Inputs and results are illustrative
simulation values. The Policy & Outage-Survival Lab was added: a 5-policy x
4-condition comparator, a 6.75 to 40.5 kWh battery sizing sweep, a SHA-256
audited JSON/CSV/Markdown brief exporter, a strict `#gp=` bookmark codec and
a 14-check in-page self-test runner.

Verification environment. Node v24.16.0 and Python 3.9.6, with pytest 8.4.2
for Python test files where present. Headless Chromium checks at 1440x900 and
390x844 verified zero console errors, zero page exceptions, zero external
requests and zero horizontal overflow, with real pointer clicks on the lab
controls and a `#gp=` reload restore of every encoded field.

The footer no longer claims calibration to 15-minute settlement intervals.
The implemented model uses hourly samples. The page identifies reserve,
weather and tariff values as synthetic, removes a fixed battery-runtime
promise, and updates the visible test count from 139 to 402.
