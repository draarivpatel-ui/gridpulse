# GridPulse Design System: Dieter Rams & Swiss Industrial Sub-Panel Telemetry

## 1. Concept Card

- **Visual World:** Dieter Rams Braun Industrial Instrumentation & Swiss Grid Sub-Panel Placard
- **Design Intent:** `Operate` + `Verify` (an engineered residential demand-response and microgrid load-shedding instrument for ERCOT households)
- **Physical References:**
  1. Braun T1000 / Dietrich Lubs anodized aluminum and warm limestone instrument consoles with tactile mechanical toggle switches
  2. Square D QO / Siemens residential load-center circuit breaker directory placards and amperage schedules
  3. Tektronix dual-trace oscilloscope graticules plotting unshifted peak demand against pre-cooled and time-shifted load curves
- **Motion Verb:** *"Throw like a magnetic breaker"* - circuit breaker toggles and peak-shift relays actuate with crisp, zero-bounce mechanical precision (`cubic-bezier(0.16, 1, 0.3, 1)`).

## 2. Color Palette & Surface Tokens

Derived from powder-coated limestone electrical enclosures, recessed instrument wells, and high-legibility industrial signal pigments. Every text pairing meets or exceeds WCAG 2.1 AA contrast (`4.5:1` for body copy, `3:1` for large display numerals).

| Token | Hex | Role |
| :--- | :--- | :--- |
| `--ground` | `#F4F2EB` | Warm limestone primary enclosure canvas |
| `--surface` | `#FAF9F5` | Crisp instrument readout card surface |
| `--panel` | `#EAE6DA` | Recessed sub-panel well and breaker rail |
| `--ink` | `#11161B` | Graphite ink primary typography and structural rules |
| `--muted` | `#3E4852` | Tinted slate secondary specification copy (passes AA on `--ground` and `--panel`) |
| `--line` | `#CBC6B6` | `1px` calibrated graticule and directory hairlines |
| `--line-strong` | `#11161B` | `1.5px` structural bus-bar divider |
| `--emerald` | `#0D7A5F` | Grid-Safe Emerald (shifted off-peak load, LFP reserve healthy, optimized bus) |
| `--emerald-wash` | `#D7F2EA` | Tinted emerald badge wash |
| `--amber` | `#C8640A` | Peak-Warning Amber (ERCOT EEA watch window, moderate feeder strain) |
| `--amber-wash` | `#FCEAD2` | Tinted amber warning surface |
| `--vermilion` | `#C92A2A` | Overload Vermilion (unshifted peak demand curve, critical breaker trip warning) |
| `--vermilion-wash` | `#FDE2E2` | Tinted vermilion alert surface |

## 3. Typography & Hierarchy

- **Primary Sans (`--font-sans`):** `'Space Grotesk'`, fallback `-apple-system, BlinkMacSystemFont, sans-serif`. Used for structural headings, breaker directory labels, and scenario controls with tight tracking (`-0.03em`) and decisive weight contrast (`500` vs `700`).
- **Editorial Accent (`--font-serif`):** `'Instrument Serif'` italic, used selectively inside the primary display headline to anchor the civic and household mission.
- **Technical Monospace (`--font-mono`):** `'JetBrains Mono'`, fallback `ui-monospace, SFMono-Regular, monospace`. Reserved strictly for hourly `kW` demand arrays, `kWh` battery reserves, `$` tariff rates, `kg CO2` marginal emissions, amperage ratings (`40A`, `30A`), and ERCOT interval timestamps (`16:00 - 20:00`).
- **Numeric Discipline:** `font-variant-numeric: tabular-nums` enforced on every `kW`, `kWh`, dollar amount, `CO2` metric, percentage, and runtime hour/minute readout so live breaker actuation never causes horizontal layout jitter.

## 4. Layout Architecture & Craft Floor Guarantees

1. **Four-Corners Telemetry Frame:** Top-left anchors the `GridPulse` instrument mark and ERCOT bus specification; top-right houses the 4-scenario ERCOT condition selector (`August 104°F Peak`, `Polar Vortex Freeze`, `Coastal Wind Drop`, `Outage Island 13.5 kWh`) plus the 1-page printable Breaker Schedule trigger; bottom-left displays ERCOT marginal peaker and LFP battery physics citations; bottom-right provides deterministic audit status.
2. **24-Hour Dual-Curve SVG Oscilloscope:** Plots Hourly Baseline Load (`#C92A2A` dashed/shaded vermilion trace) against Shifted / Optimized Load (`#0D7A5F` solid emerald trace) across all 24 hours (`00:00` to `23:00`), highlighting the active ERCOT peak emergency window (`16:00 - 20:00` or dual winter peaks) and interactive hour-by-hour inspection scrubbing.
3. **8-Circuit Residential Load-Center Directory:** Tactile breaker switches for each household load (`HVAC 3.8 kW`, `Level-2 EV 9.6 kW`, `Electric Dryer 4.5 kW`, `Water Heater 3.5 kW`, `Induction Oven 3.2 kW`, `Pool Pump 1.8 kW`, `Medical & Fridge 0.45 kW`, `Lighting & Routers 0.35 kW`) with individual `ON/SHED` breaker throws and `PEAK SHIFT` time-of-use relay toggles, plus a **One-Tap Auto-Optimize Peak Shift** master actuator.
4. **LFP Outage Island Simulator:** Interactive `13.5 kWh` lithium iron phosphate (LFP) backup reserve calculator with adjustable State of Charge (`20%` to `100%`) and solar recharge offset, computing exact hours and minutes of island endurance and critical-load shedding recommendations.
5. **Anti-Slop Compliance:** Zero em-dashes or en-dashes anywhere in the repository, zero small all-caps eyebrow kickers above headings, zero emoji icons (100% custom inline SVGs with consistent `1.75px` stroke weight), zero `border-left` > `1px` stripes, and complete browser surface theming (`::selection`, `::-webkit-scrollbar`, `:focus-visible`, `@media print`, and `@media (prefers-reduced-motion: reduce)`).
