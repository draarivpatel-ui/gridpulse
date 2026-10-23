import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTERY_DEFAULT_CAPACITY_KWH,
  BATTERY_RESERVE_FLOOR_PCT,
  BATTERY_INVERTER_EFFICIENCY,
  PANEL_MAX_BUS_KW,
  ERCOT_SCENARIOS,
  HOUSEHOLD_CIRCUITS,
  getScenarioById,
  getCircuitById,
  createDefaultCircuitStateMap,
  getCircuitWeatherMultiplier,
  isPeakHourForScenario,
  computeCircuitHourlyProfile,
  computeGridStrainIndex,
  classifyGridStrainBand,
  classifyGridStrainIndex,
  calculateOutageBatteryEndurance,
  simulateHouseholdGridPulse,
  buildAutoOptimizedCircuitStates,
  createInitialAppState,
  applyAppAction,
  renderOscilloscopeSvgMarkup,
  renderBreakerDirectoryMarkup,
  renderPrintScheduleRowsMarkup,
  buildUiViewState
} from '../js/gridpulse-engine.js';

describe('GridPulse ERCOT Scenarios & Circuit Catalog', () => {
  it('1. exposes exactly 4 realistic ERCOT grid weather and reserve scenarios', () => {
    assert.equal(ERCOT_SCENARIOS.length, 4);
    const ids = ERCOT_SCENARIOS.map((s) => s.id);
    assert.deepEqual(ids, [
      'ercot-summer-peak',
      'ercot-winter-freeze',
      'ercot-coastal-calm',
      'ercot-outage-island'
    ]);
  });

  it('2. exposes all 8 configurable household circuit loads with accurate kW ratings', () => {
    assert.equal(HOUSEHOLD_CIRCUITS.length, 8);
    const ratings = Object.fromEntries(HOUSEHOLD_CIRCUITS.map((c) => [c.id, c.ratedKw]));
    assert.deepEqual(ratings, {
      'hvac-central': 3.8,
      'ev-charger-l2': 9.6,
      'electric-dryer': 4.5,
      'pool-pump': 1.8,
      'water-heater': 3.5,
      'induction-oven': 3.2,
      'medical-fridge-core': 0.45,
      'lighting-it-routers': 0.35
    });
  });

  it('3. verifies every circuit has 24-hour baseline and shifted load arrays', () => {
    for (const circuit of HOUSEHOLD_CIRCUITS) {
      assert.equal(circuit.baselineHourlyFraction.length, 24);
      assert.equal(circuit.shiftedHourlyFraction.length, 24);
    }
  });

  it('4. marks exactly 6 circuits as shiftable and 2 life-safety/comms circuits as critical', () => {
    const shiftable = HOUSEHOLD_CIRCUITS.filter((c) => c.shiftable === true);
    const critical = HOUSEHOLD_CIRCUITS.filter((c) => c.critical === true);
    assert.equal(shiftable.length, 6);
    assert.equal(critical.length, 2);
    assert.deepEqual(
      critical.map((c) => c.id),
      ['medical-fridge-core', 'lighting-it-routers']
    );
  });

  it('5. exports core LFP battery and bus constants', () => {
    assert.equal(BATTERY_DEFAULT_CAPACITY_KWH, 13.5);
    assert.equal(BATTERY_RESERVE_FLOOR_PCT, 10);
    assert.equal(BATTERY_INVERTER_EFFICIENCY, 0.94);
    assert.equal(PANEL_MAX_BUS_KW, 24.0);
  });
});

describe('getScenarioById & getCircuitById Resolution', () => {
  it('6. resolves known scenario IDs case-insensitively and trims whitespace', () => {
    const winter = getScenarioById('  ERCOT-WINTER-FREEZE ');
    assert.equal(winter.id, 'ercot-winter-freeze');
    assert.equal(winter.ambientPeakF, 18);
  });

  it('7. falls back to ercot-summer-peak for empty, non-string, or unknown scenario IDs', () => {
    assert.equal(getScenarioById('').id, 'ercot-summer-peak');
    assert.equal(getScenarioById('   ').id, 'ercot-summer-peak');
    assert.equal(getScenarioById(null).id, 'ercot-summer-peak');
    assert.equal(getScenarioById(undefined).id, 'ercot-summer-peak');
    assert.equal(getScenarioById('non-existent').id, 'ercot-summer-peak');
  });

  it('8. resolves known circuit IDs case-insensitively and trims whitespace', () => {
    const ev = getCircuitById('  EV-CHARGER-L2 ');
    assert.ok(ev);
    assert.equal(ev.id, 'ev-charger-l2');
    assert.equal(ev.ratedKw, 9.6);
  });

  it('9. returns null for invalid, empty, or unknown circuit IDs', () => {
    assert.equal(getCircuitById(''), null);
    assert.equal(getCircuitById('   '), null);
    assert.equal(getCircuitById(null), null);
    assert.equal(getCircuitById(42), null);
    assert.equal(getCircuitById('unknown-breaker'), null);
  });
});

describe('createDefaultCircuitStateMap & Weather Multipliers', () => {
  it('10. creates unoptimized state map with all 8 circuits enabled and none shifted', () => {
    const unopt = createDefaultCircuitStateMap('unoptimized');
    for (const c of HOUSEHOLD_CIRCUITS) {
      assert.deepEqual(unopt[c.id], { enabled: true, shifted: false });
    }
  });

  it('11. creates optimized state map with shiftable circuits shifted and critical circuits unshifted', () => {
    const opt = createDefaultCircuitStateMap('optimized');
    assert.deepEqual(opt['ev-charger-l2'], { enabled: true, shifted: true });
    assert.deepEqual(opt['hvac-central'], { enabled: true, shifted: true });
    assert.deepEqual(opt['medical-fridge-core'], { enabled: true, shifted: false });
    assert.deepEqual(opt['lighting-it-routers'], { enabled: true, shifted: false });
  });

  it('12. creates outage-critical state map shedding all 6 non-critical loads and keeping 2 critical loads on', () => {
    const island = createDefaultCircuitStateMap('outage-critical');
    assert.deepEqual(island['ev-charger-l2'], { enabled: false, shifted: true });
    assert.deepEqual(island['hvac-central'], { enabled: false, shifted: true });
    assert.deepEqual(island['medical-fridge-core'], { enabled: true, shifted: false });
    assert.deepEqual(island['lighting-it-routers'], { enabled: true, shifted: false });
  });

  it('13. returns accurate weather multipliers for HVAC, water heater, and non-weather loads', () => {
    assert.equal(getCircuitWeatherMultiplier('hvac-central', 'ercot-summer-peak'), 1.25);
    assert.equal(getCircuitWeatherMultiplier('hvac-central', 'ercot-winter-freeze'), 1.35);
    assert.equal(getCircuitWeatherMultiplier('water-heater', 'ercot-summer-peak'), 0.9);
    assert.equal(getCircuitWeatherMultiplier('water-heater', 'ercot-winter-freeze'), 1.3);
    assert.equal(getCircuitWeatherMultiplier('ev-charger-l2', 'ercot-summer-peak'), 1.0);
  });
});

describe('isPeakHourForScenario Boundary Checks', () => {
  it('14. identifies 16:00-19:00 as peak hours in ercot-summer-peak and rejects 15:00 and 20:00', () => {
    assert.equal(isPeakHourForScenario(15, 'ercot-summer-peak'), false);
    assert.equal(isPeakHourForScenario(16, 'ercot-summer-peak'), true);
    assert.equal(isPeakHourForScenario(19, 'ercot-summer-peak'), true);
    assert.equal(isPeakHourForScenario(20, 'ercot-summer-peak'), false);
  });

  it('15. identifies both morning (6,7,8) and evening (17,18,19,20) peaks in ercot-winter-freeze', () => {
    assert.equal(isPeakHourForScenario(5, 'ercot-winter-freeze'), false);
    assert.equal(isPeakHourForScenario(6, 'ercot-winter-freeze'), true);
    assert.equal(isPeakHourForScenario(8, 'ercot-winter-freeze'), true);
    assert.equal(isPeakHourForScenario(9, 'ercot-winter-freeze'), false);
    assert.equal(isPeakHourForScenario(17, 'ercot-winter-freeze'), true);
    assert.equal(isPeakHourForScenario(20, 'ercot-winter-freeze'), true);
  });

  it('16. rejects out-of-range or non-integer hours', () => {
    assert.equal(isPeakHourForScenario(-1, 'ercot-summer-peak'), false);
    assert.equal(isPeakHourForScenario(24, 'ercot-summer-peak'), false);
    assert.equal(isPeakHourForScenario(16.5, 'ercot-summer-peak'), false);
    assert.equal(isPeakHourForScenario(NaN, 'ercot-summer-peak'), false);
    assert.equal(isPeakHourForScenario(0, 'ercot-summer-peak'), false);
    assert.equal(isPeakHourForScenario(23, 'ercot-summer-peak'), false);
  });
});

describe('computeCircuitHourlyProfile Mechanics', () => {
  it('17. computes unshifted vs shifted EV charger profile across 24 hours', () => {
    const ev = getCircuitById('ev-charger-l2');
    const unshifted = computeCircuitHourlyProfile(ev, 'ercot-summer-peak', {
      enabled: true,
      shifted: false
    });
    const shifted = computeCircuitHourlyProfile(ev, 'ercot-summer-peak', {
      enabled: true,
      shifted: true
    });

    assert.equal(unshifted.activeHourlyKw[17], 9.6);
    assert.equal(unshifted.activeHourlyKw[1], 0);
    assert.equal(shifted.activeHourlyKw[17], 0);
    assert.equal(shifted.activeHourlyKw[1], 9.6);
  });

  it('18. zeroes activeHourlyKw when a circuit breaker is shed while retaining baselineHourlyKw', () => {
    const dryer = getCircuitById('electric-dryer');
    const shed = computeCircuitHourlyProfile(dryer, 'ercot-summer-peak', {
      enabled: false,
      shifted: false
    });
    assert.equal(shed.enabled, false);
    assert.ok(shed.baselineHourlyKw[17] > 0);
    assert.equal(shed.activeHourlyKw.every((v) => v === 0), true);
  });

  it('19. ignores shifted=true on non-shiftable critical circuits', () => {
    const med = getCircuitById('medical-fridge-core');
    const prof = computeCircuitHourlyProfile(med, 'ercot-summer-peak', {
      enabled: true,
      shifted: true
    });
    assert.equal(prof.shifted, false);
    assert.deepEqual(prof.activeHourlyKw, prof.baselineHourlyKw);
  });

  it('20. applies winter freeze morning heating ramp and pre-heat to HVAC circuit', () => {
    const hvac = getCircuitById('hvac-central');
    const winterUnopt = computeCircuitHourlyProfile(hvac, 'ercot-winter-freeze', {
      enabled: true,
      shifted: false
    });
    const winterOpt = computeCircuitHourlyProfile(hvac, 'ercot-winter-freeze', {
      enabled: true,
      shifted: true
    });

    // Hours 6..8 unshifted should be higher than shifted, and hours 4..5 shifted pre-heat should be elevated
    assert.ok(winterUnopt.activeHourlyKw[6] > winterOpt.activeHourlyKw[6]);
    assert.ok(winterUnopt.activeHourlyKw[8] > winterOpt.activeHourlyKw[8]);
    assert.ok(winterOpt.activeHourlyKw[4] > winterUnopt.activeHourlyKw[4]);
    assert.ok(winterOpt.activeHourlyKw[5] > winterUnopt.activeHourlyKw[5]);
  });
});

describe('Grid Strain Index & Classification Bands', () => {
  it('21. computes high strain index for unshifted summer peak and low strain index when optimized', () => {
    const high = computeGridStrainIndex(19.5, 4.2, false);
    const low = computeGridStrainIndex(3.2, 4.2, false);
    assert.ok(high >= 75);
    assert.ok(low < 45);
  });

  it('22. adds outage island reserve penalty when isOutageIsland is true', () => {
    const normal = computeGridStrainIndex(6.0, 7.5, false);
    const island = computeGridStrainIndex(6.0, 7.5, true);
    assert.ok(island > normal);
  });

  it('23. classifies strain index thresholds accurately at 75 and 45 boundaries', () => {
    assert.equal(classifyGridStrainBand(75).band, 'CRITICAL');
    assert.equal(classifyGridStrainBand(74).band, 'ELEVATED');
    assert.equal(classifyGridStrainBand(45).band, 'ELEVATED');
    assert.equal(classifyGridStrainBand(44).band, 'STABLE');
    assert.equal(classifyGridStrainIndex(80).tone, 'vermilion');
    assert.equal(classifyGridStrainIndex(50).tone, 'amber');
    assert.equal(classifyGridStrainIndex(25).tone, 'emerald');
  });
});

describe('calculateOutageBatteryEndurance (13.5 kWh LFP Reserve)', () => {
  it('24. calculates extended 18h+ endurance when only critical circuits draw power', () => {
    const res = calculateOutageBatteryEndurance({
      activeCircuitsKw: 0.45,
      batteryCapacityKwh: 13.5,
      stateOfChargePct: 95,
      solarOffsetKw: 1.1
    });
    assert.equal(res.enduranceStatus, 'EXTENDED_ISLAND_SAFE');
    assert.ok(res.enduranceHoursDecimal >= 18);
    assert.ok(res.usableKwh > 10);
  });

  it('25. calculates OVERNIGHT_VIABLE (8h to <18h) under moderate island load', () => {
    const res = calculateOutageBatteryEndurance({
      activeCircuitsKw: 1.0,
      batteryCapacityKwh: 13.5,
      stateOfChargePct: 90,
      solarOffsetKw: 0
    });
    assert.equal(res.enduranceStatus, 'OVERNIGHT_VIABLE');
    assert.ok(res.enduranceHoursDecimal >= 8 && res.enduranceHoursDecimal < 18);
    assert.equal(res.hours, 10);
  });

  it('26. calculates CRITICAL_DEPLETION (<8h) when heavy 240V breakers remain closed', () => {
    const res = calculateOutageBatteryEndurance({
      activeCircuitsKw: 4.8,
      batteryCapacityKwh: 13.5,
      stateOfChargePct: 80,
      solarOffsetKw: 0
    });
    assert.equal(res.enduranceStatus, 'CRITICAL_DEPLETION');
    assert.ok(res.enduranceHoursDecimal < 8);
  });

  it('27. enforces 10% LFP reserve floor and 0.12 kW minimum inverter quiescent drain', () => {
    const lowSoc = calculateOutageBatteryEndurance({
      activeCircuitsKw: 0,
      batteryCapacityKwh: 13.5,
      stateOfChargePct: 5,
      solarOffsetKw: 0
    });
    assert.equal(lowSoc.stateOfChargePct, 10);
    assert.equal(lowSoc.usableKwh, 0);
    assert.equal(lowSoc.netDrainKw, 0.12);
    assert.equal(lowSoc.hours, 0);
    assert.equal(lowSoc.minutes, 0);
  });
});

describe('simulateHouseholdGridPulse End-to-End Telemetry', () => {
  it('28. computes substantial peak kW reduction, bill savings, and CO2 savings in summer peak', () => {
    const unopt = simulateHouseholdGridPulse({
      scenarioId: 'ercot-summer-peak',
      circuitStates: createDefaultCircuitStateMap('unoptimized')
    });
    const opt = simulateHouseholdGridPulse({
      scenarioId: 'ercot-summer-peak',
      circuitStates: createDefaultCircuitStateMap('optimized')
    });

    assert.equal(unopt.metrics.peakKwReduction, 0);
    assert.ok(opt.metrics.peakKwReduction > 15.0);
    assert.ok(opt.metrics.peakReductionPct > 70.0);
    assert.ok(opt.metrics.dailySavingsUsd > 4.0);
    assert.ok(opt.metrics.monthlySavingsUsd > 120.0);
    assert.ok(opt.metrics.dailyCarbonAvoidedKg > 8.0);
    assert.ok(opt.metrics.optimizedStrainIndex < unopt.metrics.baselineStrainIndex);
    assert.equal(opt.metrics.shiftedCount, 6);
    assert.equal(opt.metrics.activeCount, 8);
    assert.equal(opt.metrics.shedCount, 0);
  });

  it('29. computes dual-peak winter freeze savings and lower peak demand when optimized', () => {
    const opt = simulateHouseholdGridPulse({
      scenarioId: 'ercot-winter-freeze',
      circuitStates: createDefaultCircuitStateMap('optimized')
    });
    assert.equal(opt.scenario.id, 'ercot-winter-freeze');
    assert.ok(opt.metrics.peakKwReduction > 14.0);
    assert.ok(opt.metrics.dailySavingsUsd > 5.0);
    assert.ok(opt.metrics.dailyCarbonAvoidedKg > 9.0);
  });

  it('30. computes coastal calm wind drop duck-curve ramp metrics accurately', () => {
    const opt = simulateHouseholdGridPulse({
      scenarioId: 'ercot-coastal-calm',
      circuitStates: createDefaultCircuitStateMap('optimized')
    });
    assert.equal(opt.scenario.id, 'ercot-coastal-calm');
    assert.ok(opt.metrics.peakKwReduction > 14.0);
    assert.ok(opt.metrics.dailySavingsUsd > 3.5);
  });

  it('31. computes outage island critical-only shedding with 6 circuits shed and 2 active', () => {
    const island = simulateHouseholdGridPulse({
      scenarioId: 'ercot-outage-island',
      circuitStates: buildAutoOptimizedCircuitStates('ercot-outage-island'),
      batterySocPct: 90,
      solarOffsetEnabled: true
    });
    assert.equal(island.scenario.isOutageIsland, true);
    assert.equal(island.metrics.activeCount, 2);
    assert.equal(island.metrics.shedCount, 6);
    assert.equal(island.outageEndurance.enduranceStatus, 'EXTENDED_ISLAND_SAFE');
  });

  it('32. validates inspectedHour clamping and tariff resolution', () => {
    const peakInspect = simulateHouseholdGridPulse({
      scenarioId: 'ercot-summer-peak',
      circuitStates: createDefaultCircuitStateMap('optimized'),
      inspectedHour: 18
    });
    assert.equal(peakInspect.inspected.hour, 18);
    assert.equal(peakInspect.inspected.isPeak, true);
    assert.equal(peakInspect.inspected.tariffPerKwh, 0.32);

    const offPeakInspect = simulateHouseholdGridPulse({
      scenarioId: 'ercot-summer-peak',
      circuitStates: createDefaultCircuitStateMap('optimized'),
      inspectedHour: 3
    });
    assert.equal(offPeakInspect.inspected.hour, 3);
    assert.equal(offPeakInspect.inspected.isPeak, false);
    assert.equal(offPeakInspect.inspected.tariffPerKwh, 0.09);

    const invalidInspect = simulateHouseholdGridPulse({
      scenarioId: 'ercot-summer-peak',
      inspectedHour: 99
    });
    assert.equal(invalidInspect.inspected.hour, 18);
  });
});

describe('State Reducer (createInitialAppState & applyAppAction)', () => {
  it('33. initializes default state in ercot-summer-peak at 90% SoC and hour 18', () => {
    const init = createInitialAppState();
    assert.equal(init.scenarioId, 'ercot-summer-peak');
    assert.equal(init.batterySocPct, 90);
    assert.equal(init.solarOffsetEnabled, true);
    assert.equal(init.inspectedHour, 18);
  });

  it('34. handles SELECT_SCENARIO and automatically sheds non-critical loads in ercot-outage-island', () => {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'SELECT_SCENARIO', scenarioId: 'ercot-outage-island' });
    assert.equal(state.scenarioId, 'ercot-outage-island');
    assert.equal(state.circuitStates['ev-charger-l2'].enabled, false);
    assert.equal(state.circuitStates['medical-fridge-core'].enabled, true);
  });

  it('35. handles AUTO_OPTIMIZE and RESET_BASELINE actions', () => {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'AUTO_OPTIMIZE' });
    assert.equal(state.circuitStates['ev-charger-l2'].shifted, true);
    assert.equal(state.circuitStates['electric-dryer'].shifted, true);

    state = applyAppAction(state, { type: 'RESET_BASELINE' });
    assert.equal(state.circuitStates['ev-charger-l2'].shifted, false);
    assert.equal(state.circuitStates['electric-dryer'].shifted, false);
  });

  it('36. handles ISLAND_CRITICAL_ONLY action', () => {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'ISLAND_CRITICAL_ONLY' });
    assert.equal(state.circuitStates['pool-pump'].enabled, false);
    assert.equal(state.circuitStates['lighting-it-routers'].enabled, true);
  });

  it('37. handles TOGGLE_BREAKER and ignores unknown circuit IDs', () => {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'TOGGLE_BREAKER', circuitId: 'ev-charger-l2' });
    assert.equal(state.circuitStates['ev-charger-l2'].enabled, false);
    state = applyAppAction(state, { type: 'TOGGLE_BREAKER', circuitId: 'ev-charger-l2' });
    assert.equal(state.circuitStates['ev-charger-l2'].enabled, true);

    const unchanged = applyAppAction(state, { type: 'TOGGLE_BREAKER', circuitId: 'bad-id' });
    assert.deepEqual(unchanged, state);
  });

  it('38. handles TOGGLE_SHIFT on shiftable loads and prevents shifting critical loads', () => {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'TOGGLE_SHIFT', circuitId: 'water-heater' });
    assert.equal(state.circuitStates['water-heater'].shifted, true);

    state = applyAppAction(state, { type: 'TOGGLE_SHIFT', circuitId: 'medical-fridge-core' });
    assert.equal(state.circuitStates['medical-fridge-core'].shifted, false);
  });

  it('39. clamps SET_BATTERY_SOC between 20 and 100 and toggles solar offset', () => {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'SET_BATTERY_SOC', value: 5 });
    assert.equal(state.batterySocPct, 20);
    state = applyAppAction(state, { type: 'SET_BATTERY_SOC', value: 120 });
    assert.equal(state.batterySocPct, 100);
    state = applyAppAction(state, { type: 'SET_BATTERY_SOC', value: 65 });
    assert.equal(state.batterySocPct, 65);

    state = applyAppAction(state, { type: 'TOGGLE_SOLAR_OFFSET' });
    assert.equal(state.solarOffsetEnabled, false);
    state = applyAppAction(state, { type: 'TOGGLE_SOLAR_OFFSET' });
    assert.equal(state.solarOffsetEnabled, true);
  });

  it('40. updates SET_INSPECTED_HOUR for valid hours 0..23 and ignores out-of-range values', () => {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'SET_INSPECTED_HOUR', hour: 0 });
    assert.equal(state.inspectedHour, 0);
    state = applyAppAction(state, { type: 'SET_INSPECTED_HOUR', hour: 23 });
    assert.equal(state.inspectedHour, 23);
    state = applyAppAction(state, { type: 'SET_INSPECTED_HOUR', hour: 24 });
    assert.equal(state.inspectedHour, 23);
    state = applyAppAction(state, { type: 'SET_INSPECTED_HOUR', hour: -1 });
    assert.equal(state.inspectedHour, 23);
  });

  it('41. returns cloned state safely when action is null or unknown', () => {
    const state = createInitialAppState();
    assert.deepEqual(applyAppAction(state, null), state);
    assert.deepEqual(applyAppAction(state, { type: 'UNKNOWN' }), state);
  });
});

describe('SVG Oscilloscope, Breaker Directory & Print Schedule Markup', () => {
  it('42. renders valid 24-hour dual-curve SVG oscilloscope with polylines and cursor', () => {
    const sim = simulateHouseholdGridPulse({
      scenarioId: 'ercot-summer-peak',
      circuitStates: createDefaultCircuitStateMap('optimized'),
      inspectedHour: 18
    });
    const svg = renderOscilloscopeSvgMarkup(sim);
    assert.ok(svg.includes('<svg class="oscilloscope-svg"'));
    assert.ok(svg.includes('<polyline'));
    assert.ok(svg.includes('20kW'));
    assert.ok(svg.includes('16:00'));
  });

  it('43. renders all 8 circuit rows in breaker directory markup with accurate status badges', () => {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'AUTO_OPTIMIZE' });
    state = applyAppAction(state, { type: 'TOGGLE_BREAKER', circuitId: 'pool-pump' });
    const sim = simulateHouseholdGridPulse(state);
    const html = renderBreakerDirectoryMarkup(sim);

    assert.ok(html.includes('PEAK-SHIFT RELAY ARMED'));
    assert.ok(html.includes('BREAKER OPEN (SHED)'));
    assert.ok(html.includes('PROTECTED CRITICAL BUS'));
    assert.ok(html.includes('data-circuit-card="ev-charger-l2"'));
  });

  it('44. renders printable 1-page schedule table rows for all 8 circuits', () => {
    const sim = simulateHouseholdGridPulse({
      scenarioId: 'ercot-summer-peak',
      circuitStates: createDefaultCircuitStateMap('optimized')
    });
    const rows = renderPrintScheduleRowsMarkup(sim);
    assert.ok(rows.includes('B2/B4 (50A)'));
    assert.ok(rows.includes('SHIFT TO: 01:00 - 04:00 Nocturnal Wind Surplus'));
    assert.ok(rows.includes('KEEP CLOSED (CRITICAL 24H)'));
  });

  it('45. builds complete UI view state across unoptimized, optimized, and off-peak states', () => {
    let state = createInitialAppState();
    const unoptView = buildUiViewState(state);
    assert.equal(unoptView.inspectedWindowTag, 'ERCOT PEAK INTERVAL');
    assert.equal(unoptView.solarPressedAttr, 'true');

    state = applyAppAction(state, { type: 'AUTO_OPTIMIZE' });
    state = applyAppAction(state, { type: 'SET_INSPECTED_HOUR', hour: 2 });
    state = applyAppAction(state, { type: 'TOGGLE_SOLAR_OFFSET' });
    const optView = buildUiViewState(state);
    assert.equal(optView.inspectedWindowTag, 'OFF-PEAK INTERVAL');
    assert.equal(optView.solarPressedAttr, 'false');
    assert.ok(optView.inspectedDeltaText.startsWith('+'));
    assert.equal(optView.outageStatusLabel, 'High Drain Warning (<8h Backup)');
  });

  it('46. builds UI view state for overnight viable and extended island safe battery modes', () => {
    let islandState = createInitialAppState();
    islandState = applyAppAction(islandState, {
      type: 'SELECT_SCENARIO',
      scenarioId: 'ercot-outage-island'
    });
    const safeView = buildUiViewState(islandState);
    assert.equal(safeView.outageStatusLabel, 'Extended Island Endurance (18h+)');

    islandState = applyAppAction(islandState, {
      type: 'SET_BATTERY_SOC',
      value: 50
    });
    islandState = applyAppAction(islandState, { type: 'TOGGLE_SOLAR_OFFSET' });
    const overnightView = buildUiViewState(islandState);
    assert.equal(overnightView.outageStatusLabel, 'Overnight Backup Viable (8h - 18h)');
  });

  it('47. handles string vs object scenario argument in helper functions', () => {
    const winterObj = getScenarioById('ercot-winter-freeze');
    assert.equal(getCircuitWeatherMultiplier('hvac-central', winterObj), 1.35);
    assert.equal(isPeakHourForScenario(7, winterObj), true);
  });

  it('48. verifies print schedule directive text when a circuit is shed', () => {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'TOGGLE_BREAKER', circuitId: 'ev-charger-l2' });
    const sim = simulateHouseholdGridPulse(state);
    const rows = renderPrintScheduleRowsMarkup(sim);
    assert.ok(rows.includes('OPEN BREAKER (SHED)'));
  });
});
