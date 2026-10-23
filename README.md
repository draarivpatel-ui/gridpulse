# GridPulse: ERCOT Peak-Load Shift Optimizer, Sub-Panel Telemetry & LFP Outage Island Simulator

**Live Demo:** [https://aariv.me/gridpulse/](https://aariv.me/gridpulse/)  
**Repository:** [https://github.com/draarivpatel-ui/gridpulse](https://github.com/draarivpatel-ui/gridpulse)

GridPulse is a zero-dependency residential demand-response console and microgrid load-shedding instrument engineered for households on the Electric Reliability Council of Texas (ERCOT) grid. Built with a Dieter Rams / Swiss industrial telemetry aesthetic, GridPulse models 24-hour circuit-level load curves across 8 residential breaker circuits and 4 ERCOT weather and reserve emergencies.

## Core Capabilities

1. **4 Realistic ERCOT Grid Weather & Reserve Scenarios:**
   - **August 104°F Thermal Peak (`ercot-summer-peak`):** `16:00 - 20:00` ERCOT Energy Emergency Alert (EEA-1) watch window, `$0.32/kWh` peak tariff vs. `$0.09/kWh` off-peak, and `0.62 kg CO2/kWh` marginal simple-cycle gas peaker intensity.
   - **February Polar Vortex Freeze (`ercot-winter-freeze`):** Dual morning (`06:00 - 09:00`) and evening (`17:00 - 21:00`) electric heating and auxiliary heat-strip peaks at `18°F` ambient trough (`$0.36/kWh` peak tariff, `0.68 kg CO2/kWh`).
   - **Coastal Wind Drop & Solar Ramp (`ercot-coastal-calm`):** Late-afternoon Gulf Coast wind lull coinciding with West Texas solar sunset (`17:00 - 20:00` net load duck-curve ramp).
   - **Outage Microgrid Island (`ercot-outage-island`):** Distribution feeder open-relay simulation transferring the household bus to a `13.5 kWh` lithium iron phosphate (LFP) battery reserve (`94%` round-trip inverter efficiency, `10%` reserve floor).

2. **8 Configurable Household Sub-Panel Circuits:**
   - `B1/B3` **Central HVAC Compressor (4-Ton):** `3.8 kW` (`30A / 240V`), thermal pre-cooling shiftable.
   - `B2/B4` **Level-2 EV Supply Equipment:** `9.6 kW` (`50A / 240V`), overnight `01:00 - 04:00` wind surplus shiftable.
   - `B5/B7` **Electric Resistance Tumble Dryer:** `4.5 kW` (`30A / 240V`), post-peak `21:00 - 23:00` shiftable.
   - `B6/B8` **Variable-Speed Pool Filtration Pump:** `1.8 kW` (`20A / 240V`), midday `09:00 - 14:00` solar shiftable.
   - `B9/B11` **Heat-Pump / Hybrid Water Heater (50 Gal):** `3.5 kW` (`30A / 240V`), thermal pre-charge shiftable.
   - `B10/B12` **Induction Range & Convection Oven:** `3.2 kW` (`40A / 240V`), post-peak culinary shiftable.
   - `A1` **Medical CPAP & Kitchen Refrigeration:** `0.45 kW` (`20A / 120V`), protected critical 24-hour life-safety bus.
   - `A2` **LED Lighting, Fiber ONT & Telemetry:** `0.35 kW` (`15A / 120V`), protected critical 24-hour communications bus.

3. **Interactive 24-Hour Dual-Trace SVG Oscilloscope:**
   - Plots unshifted baseline demand (`#C92A2A` dashed vermilion curve) against the active load-shifted breaker schedule (`#0D7A5F` solid emerald curve) with an interactive hour-by-hour inspection cursor (`00:00` to `23:00`).

4. **1-Page Printable Sub-Panel Placard (`@media print`):**
   - Formats a single-page landscape load-center breaker directory and peak-shift schedule ready to post inside a residential electrical panel door.

## Verification & Quality Gates

Run the automated 48-test unit suite and the Hark planted-defect mutation harness:

```bash
npm test
python3 ../../hark_honesty_and_defect_harness.py --audit . --planted-defects . --count 20
```

## License

MIT License. See [LICENSE](./LICENSE).
