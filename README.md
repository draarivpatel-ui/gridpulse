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

## How the advisor works

Each candidate move is a real circuit state map. The advisor calls
`simulateHouseholdGridPulse` on it and reads the resulting metrics, so a
recommendation can never claim a saving the engine does not produce. The
weighted objective combines peak reduction, bill saving, carbon avoided and
island endurance, minus a comfort penalty proportional to the nameplate rating
of any shed circuit. Critical circuits are never offered for shedding. The
search rescores every legal move at every step, so it is deterministic and
independent of iteration order.

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

The canonical command is:

```bash
node --experimental-vm-modules --test tests/gridpulse.test.js tests/dom-smoke.test.js tests/advisor.test.js tests/advisor-dom.test.js
```

The VM module flag is needed by one test helper that runs `js/app.js` against a
zero dependency DOM shim, with the real engine and advisor modules linked in.

## Layout

```
index.html                    the whole app and the advisor panel
styles.css                    the design system and advisor layout
js/gridpulse-engine.js        scenarios, circuits, simulator, SVG, view state
js/gridpulse-advisor.js       move enumeration, scoring, greedy plan, stress test
js/app.js                     panel rendering and all interactive wiring
tests/                        engine, DOM smoke, advisor unit and live UI suites
tests/helpers/dom.js          the DOM shim that executes app.js under node:test
DESIGN.md                     the industrial instrument design system
DEVPOST_UPGRADE.md            the upgrade log and exact verification commands
```

## Verification

The suite covers the scenario catalog, the circuit profiles, the 24-hour
simulator, the battery endurance math, the state reducer, the SVG oscilloscope,
the breaker directory, the printable placard, the advisor's move enumeration,
the marginal contributions, the greedy plan, the comparison and the stress
test, plus live execution of every button, slider and scenario tab. Compliance
tests scan every text file in the repository for two dash characters and vendor
model names, and check that every label and DOM binding resolves.

## Honest scope

All scenarios, tariff rates, weather multipliers, circuit profiles and battery
constants are illustrative planning values authored for this simulator, not
metered data from a real home or a published ERCOT settlement feed. The advisor
optimizes the numbers in this model, not a real utility bill. Nothing here is a
claim about a real installation, a utility program or a hardware vendor.

## License

MIT

## November 16 local verification

139 Node tests passed, 0 failed, 0 skipped, 0 cancelled.

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
promise, and updates the visible test count from 68 to 139.
