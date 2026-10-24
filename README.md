# GridPulse

Live app: https://aariv.me/gridpulse/
Source code: https://github.com/draarivpatel-ui/gridpulse

I built GridPulse to model household breaker-level electricity demand and battery backup runtime during Texas (ERCOT) grid emergencies. Instead of guessing which appliances to turn off during a summer conservation appeal or a winter freeze outage, you can toggle 8 residential sub-panel circuits and watch how shifting each load changes your 24-hour demand curve, electricity bill, marginal carbon emissions, and 13.5 kWh LFP battery reserve.

## What It Does

- Simulates 4 ERCOT grid conditions (August 104F thermal peak, February polar vortex freeze, Gulf Coast wind drop during solar sunset, and an islanded outage running on a 13.5 kWh LFP home battery).
- Lets you toggle and time-shift 8 household breaker circuits (4-ton HVAC compressor, Level-2 EV charger, electric dryer, pool pump, heat-pump water heater, induction range, medical CPAP and fridge bus, and fiber/lighting bus).
- Draws a dual-trace 24-hour SVG load curve comparing unshifted baseline demand against your shifted schedule hour by hour.
- Prints a one-page breaker panel directory card (`Cmd+P` / `Ctrl+P`) to tape inside a sub-panel door.

## How to Run Locally

GridPulse is written in plain HTML, CSS, and vanilla JavaScript with no build step required.

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

To run the unit tests for the load-shifting and battery runtime math:
```bash
npm test
```

## License

MIT
