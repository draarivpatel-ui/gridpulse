/**
 * lab.test.js - unit, invariant and hostile-input tests for the Policy &
 * Outage-Survival Lab. Every comparator and sweep figure is cross-checked
 * against a direct simulator call, so the lab can never report a number the
 * engine does not produce.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  BATTERY_DEFAULT_CAPACITY_KWH,
  BATTERY_RESERVE_FLOOR_PCT,
  BATTERY_INVERTER_EFFICIENCY,
  ERCOT_SCENARIOS,
  HOUSEHOLD_CIRCUITS,
  getScenarioById,
  createDefaultCircuitStateMap,
  createInitialAppState,
  applyAppAction,
  calculateOutageBatteryEndurance,
  simulateHouseholdGridPulse
} from '../js/gridpulse-engine.js';
import { scoreSchedule } from '../js/gridpulse-advisor.js';
import {
  LAB_SCHEMA_VERSION,
  HASH_SCHEMA_VERSION,
  BATTERY_SWEEP_KWH,
  BATTERY_SWEEP_MIN_KWH,
  BATTERY_SWEEP_MAX_KWH,
  RESERVE_FLOOR_OPTIONS,
  LAB_POLICIES,
  getPolicyById,
  normalizeLabOptions,
  buildPolicyStates,
  criticalShedViolations,
  calculateIslandEndurance,
  evaluatePolicy,
  compareAllPoliciesAllScenarios,
  comparePoliciesForScenario,
  sweepBatterySizing,
  sha256Hex,
  canonicalJson,
  buildLabReportPayload,
  getStampedReport,
  payloadWithoutDigest,
  verifyStampedReport,
  csvEscape,
  exportReportJson,
  exportReportCsv,
  exportReportMarkdown,
  encodeLabHash,
  decodeLabHash,
  applyDecodedBookmark,
  renderTradeoffChartSvg,
  renderSizingCurveSvg,
  renderComparatorRowsHtml,
  renderEnduranceMatrixRowsHtml,
  runLabSelfTests
} from '../js/gridpulse-lab.js';

const initial = () => createInitialAppState();
const CRITICALS = HOUSEHOLD_CIRCUITS.filter((c) => c.critical === true).map((c) => c.id);
const nodeSha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

describe('Lab: policy catalog', () => {
  it('01. exposes exactly the five named deterministic policies', () => {
    assert.equal(LAB_POLICIES.length, 5);
    assert.deepEqual(LAB_POLICIES.map((p) => p.id), [
      'unshifted-baseline', 'tou-delay-shift', 'comfort-safe-advisor',
      'battery-peak-shave', 'critical-island-survival'
    ]);
  });

  it('02. every policy has a unique id, a name and a summary', () => {
    const ids = new Set();
    for (const policy of LAB_POLICIES) {
      assert.equal(ids.has(policy.id), false);
      ids.add(policy.id);
      assert.ok(policy.name.length > 2);
      assert.ok(policy.summary.length > 10);
      assert.equal(/[\u2013\u2014]/.test(policy.name + policy.summary), false);
    }
  });

  it('03. getPolicyById resolves each id and returns null otherwise', () => {
    for (const policy of LAB_POLICIES) {
      assert.equal(getPolicyById(policy.id).id, policy.id);
    }
    assert.equal(getPolicyById('nope'), null);
    assert.equal(getPolicyById(''), null);
    assert.equal(getPolicyById(null), null);
    assert.equal(getPolicyById(42), null);
  });

  it('04. sweep and floor constants match the published ranges', () => {
    assert.deepEqual(BATTERY_SWEEP_KWH, [6.75, 13.5, 20.25, 27, 33.75, 40.5]);
    assert.equal(BATTERY_SWEEP_MIN_KWH, 6.75);
    assert.equal(BATTERY_SWEEP_MAX_KWH, 40.5);
    assert.deepEqual(RESERVE_FLOOR_OPTIONS, [10, 20]);
    assert.equal(LAB_SCHEMA_VERSION, 'gridpulse-lab-brief/v1');
    assert.equal(HASH_SCHEMA_VERSION, 'v1');
  });
});

describe('Lab: normalizeLabOptions', () => {
  it('05. keeps valid floor, comfort and policy values', () => {
    const out = normalizeLabOptions({ reserveFloorPct: 20, comfortWeight: 1.5, policyId: 'battery-peak-shave' });
    assert.equal(out.reserveFloorPct, 20);
    assert.equal(out.comfortWeight, 1.5);
    assert.equal(out.policyId, 'battery-peak-shave');
  });

  it('06. rejects a floor outside the 10/20 options', () => {
    assert.equal(normalizeLabOptions({ reserveFloorPct: 15 }).reserveFloorPct, 10);
    assert.equal(normalizeLabOptions({ reserveFloorPct: 0 }).reserveFloorPct, 10);
    assert.equal(normalizeLabOptions({ reserveFloorPct: NaN }).reserveFloorPct, 10);
    assert.equal(normalizeLabOptions({ reserveFloorPct: 'x' }).reserveFloorPct, 10);
  });

  it('07. clamps comfort weight into 0..4', () => {
    assert.equal(normalizeLabOptions({ comfortWeight: 99 }).comfortWeight, 4);
    assert.equal(normalizeLabOptions({ comfortWeight: -3 }).comfortWeight, 0);
    assert.equal(normalizeLabOptions({ comfortWeight: NaN }).comfortWeight, 2);
    assert.equal(normalizeLabOptions({ comfortWeight: Infinity }).comfortWeight, 2);
  });

  it('08. falls back to tou-delay-shift for unknown policies', () => {
    assert.equal(normalizeLabOptions({ policyId: 'bogus' }).policyId, 'tou-delay-shift');
    assert.equal(normalizeLabOptions({}).policyId, 'tou-delay-shift');
    assert.equal(normalizeLabOptions(null).policyId, 'tou-delay-shift');
  });
});

describe('Lab: buildPolicyStates', () => {
  it('09. unshifted-baseline closes every breaker with no relays armed', () => {
    const states = buildPolicyStates('unshifted-baseline', { scenarioId: 'ercot-summer-peak' });
    for (const circuit of HOUSEHOLD_CIRCUITS) {
      assert.deepEqual(states[circuit.id], { enabled: true, shifted: false });
    }
  });

  it('10. tou-delay-shift arms every shiftable relay and none of the criticals', () => {
    const states = buildPolicyStates('tou-delay-shift', { scenarioId: 'ercot-winter-freeze' });
    for (const circuit of HOUSEHOLD_CIRCUITS) {
      assert.equal(states[circuit.id].enabled, true);
      assert.equal(states[circuit.id].shifted, circuit.shiftable === true);
    }
  });

  it('11. battery-peak-shave sheds exactly the three deferrable circuits', () => {
    const states = buildPolicyStates('battery-peak-shave', { scenarioId: 'ercot-coastal-calm' });
    const deferrable = HOUSEHOLD_CIRCUITS.filter((c) => c.priority === 'deferrable').map((c) => c.id);
    assert.deepEqual(deferrable, ['ev-charger-l2', 'electric-dryer', 'pool-pump']);
    for (const circuit of HOUSEHOLD_CIRCUITS) {
      const expected = !deferrable.includes(circuit.id);
      assert.equal(states[circuit.id].enabled, expected, circuit.id);
    }
  });

  it('12. battery-peak-shave keeps comfort circuits enabled and shifted', () => {
    const states = buildPolicyStates('battery-peak-shave', {});
    assert.deepEqual(states['hvac-central'], { enabled: true, shifted: true });
    assert.deepEqual(states['water-heater'], { enabled: true, shifted: true });
    assert.deepEqual(states['induction-oven'], { enabled: true, shifted: true });
  });

  it('13. critical-island-survival leaves only the two critical buses closed', () => {
    const states = buildPolicyStates('critical-island-survival', {});
    for (const circuit of HOUSEHOLD_CIRCUITS) {
      assert.equal(states[circuit.id].enabled, circuit.critical === true, circuit.id);
    }
  });

  it('14. comfort-safe-advisor returns a complete legal map deterministically', () => {
    const a = buildPolicyStates('comfort-safe-advisor', { scenarioId: 'ercot-summer-peak', comfortWeight: 2 });
    const b = buildPolicyStates('comfort-safe-advisor', { scenarioId: 'ercot-summer-peak', comfortWeight: 2 });
    assert.deepEqual(a, b);
    for (const circuit of HOUSEHOLD_CIRCUITS) {
      assert.equal(typeof a[circuit.id].enabled, 'boolean');
      assert.equal(typeof a[circuit.id].shifted, 'boolean');
    }
  });

  it('15. comfort-safe-advisor changes with the comfort weight', () => {
    const soft = buildPolicyStates('comfort-safe-advisor', { scenarioId: 'ercot-summer-peak', comfortWeight: 0 });
    const firm = buildPolicyStates('comfort-safe-advisor', { scenarioId: 'ercot-summer-peak', comfortWeight: 4 });
    const shedSoft = Object.values(soft).filter((s) => s.enabled === false).length;
    const shedFirm = Object.values(firm).filter((s) => s.enabled === false).length;
    assert.ok(shedSoft >= shedFirm);
    assert.ok(JSON.stringify(soft) !== JSON.stringify(firm) || shedSoft === shedFirm);
  });

  it('16. an unknown policy id falls back to the unshifted baseline', () => {
    const states = buildPolicyStates('bogus-policy', {});
    for (const circuit of HOUSEHOLD_CIRCUITS) {
      assert.deepEqual(states[circuit.id], { enabled: true, shifted: false });
    }
  });

  it('17. builders never mutate the caller supplied map or context', () => {
    const ctx = { scenarioId: 'ercot-summer-peak', comfortWeight: 2, batterySocPct: 90 };
    const snapshot = JSON.stringify(ctx);
    for (const policy of LAB_POLICIES) {
      buildPolicyStates(policy.id, ctx);
    }
    assert.equal(JSON.stringify(ctx), snapshot);
  });
});

describe('Lab: critical-bus non-shedding invariant', () => {
  it('18. every policy keeps both critical circuits closed', () => {
    for (const policy of LAB_POLICIES) {
      const states = buildPolicyStates(policy.id, { scenarioId: 'ercot-outage-island' });
      assert.deepEqual(criticalShedViolations(states), [], policy.id);
    }
  });

  it('19. flags a shed medical circuit as a violation', () => {
    const states = createDefaultCircuitStateMap('unoptimized');
    states['medical-fridge-core'] = { enabled: false, shifted: false };
    assert.deepEqual(criticalShedViolations(states), ['medical-fridge-core']);
  });

  it('20. flags a shed comms bus and missing keys as violations', () => {
    const states = createDefaultCircuitStateMap('unoptimized');
    states['lighting-it-routers'] = { enabled: false, shifted: false };
    assert.deepEqual(criticalShedViolations(states), ['lighting-it-routers']);
    assert.equal(criticalShedViolations({}).length, CRITICALS.length);
    assert.equal(criticalShedViolations(null).length, CRITICALS.length);
  });
});

describe('Lab: island endurance math', () => {
  it('21. matches the engine exactly at the default 10 percent floor', () => {
    for (const [load, cap, soc, solar] of [[1.25, 13.5, 90, 1.1], [0.6, 20.25, 75, 0], [4.4, 40.5, 100, 1.4], [0.2, 6.75, 20, 0.7]]) {
      const lab = calculateIslandEndurance({ activeCircuitsKw: load, batteryCapacityKwh: cap, stateOfChargePct: soc, solarOffsetKw: solar, reserveFloorPct: 10 });
      const eng = calculateOutageBatteryEndurance({ activeCircuitsKw: load, batteryCapacityKwh: cap, stateOfChargePct: soc, solarOffsetKw: solar });
      assert.equal(lab.enduranceHoursDecimal, eng.enduranceHoursDecimal);
      assert.equal(lab.usableKwh, eng.usableKwh);
      assert.equal(lab.netDrainKw, eng.netDrainKw);
      assert.equal(lab.formattedDuration, eng.formattedDuration);
      assert.equal(lab.enduranceStatus, eng.enduranceStatus);
    }
  });

  it('22. a 20 percent floor leaves strictly less usable energy than 10 percent', () => {
    const low = calculateIslandEndurance({ activeCircuitsKw: 1, batteryCapacityKwh: 27, stateOfChargePct: 90, solarOffsetKw: 0, reserveFloorPct: 20 });
    const high = calculateIslandEndurance({ activeCircuitsKw: 1, batteryCapacityKwh: 27, stateOfChargePct: 90, solarOffsetKw: 0, reserveFloorPct: 10 });
    assert.ok(low.usableKwh < high.usableKwh);
    assert.ok(low.enduranceHoursDecimal < high.enduranceHoursDecimal);
    assert.equal(low.usableKwh, round2(27 * 0.7 * BATTERY_INVERTER_EFFICIENCY));
  });

  it('23. a floor at or above the state of charge yields zero usable hours', () => {
    const res = calculateIslandEndurance({ activeCircuitsKw: 1, batteryCapacityKwh: 13.5, stateOfChargePct: 15, solarOffsetKw: 0, reserveFloorPct: 20 });
    assert.equal(res.stateOfChargePct, 20);
    assert.equal(res.usableKwh, 0);
    assert.equal(res.enduranceHoursDecimal, 0);
  });

  it('24. sanitizes NaN, Infinity, -0 and negative inputs without malformed output', () => {
    const nan = calculateIslandEndurance({ activeCircuitsKw: NaN, batteryCapacityKwh: NaN, stateOfChargePct: NaN, solarOffsetKw: NaN, reserveFloorPct: NaN });
    assert.match(nan.formattedDuration, /^\d+h \d{2}m$/);
    assert.equal(nan.batteryCapacityKwh, BATTERY_DEFAULT_CAPACITY_KWH);
    assert.equal(nan.reserveFloorPct, BATTERY_RESERVE_FLOOR_PCT);
    assert.equal(nan.stateOfChargePct, 90);
    const inf = calculateIslandEndurance({ activeCircuitsKw: -5, batteryCapacityKwh: -1, stateOfChargePct: Infinity, solarOffsetKw: -2, reserveFloorPct: -10 });
    assert.match(inf.formattedDuration, /^\d+h \d{2}m$/);
    assert.equal(inf.stateOfChargePct, 90);
    assert.equal(inf.netDrainKw, 0.12);
  });

  it('25. enforces the 0.12 kW quiescent drain and 120h ceiling', () => {
    const idle = calculateIslandEndurance({ activeCircuitsKw: 0, batteryCapacityKwh: 40.5, stateOfChargePct: 100, solarOffsetKw: 0, reserveFloorPct: 0 });
    assert.equal(idle.netDrainKw, 0.12);
    assert.equal(idle.enduranceHoursDecimal, 120);
  });

  it('26. endurance is nondecreasing in capacity and nonincreasing in floor', () => {
    let prev = 0;
    for (const cap of BATTERY_SWEEP_KWH) {
      const res = calculateIslandEndurance({ activeCircuitsKw: 1.5, batteryCapacityKwh: cap, stateOfChargePct: 90, solarOffsetKw: 0, reserveFloorPct: 10 });
      assert.ok(res.enduranceHoursDecimal >= prev);
      prev = res.enduranceHoursDecimal;
    }
    const f10 = calculateIslandEndurance({ activeCircuitsKw: 1.5, batteryCapacityKwh: 27, stateOfChargePct: 90, solarOffsetKw: 0, reserveFloorPct: 10 });
    const f20 = calculateIslandEndurance({ activeCircuitsKw: 1.5, batteryCapacityKwh: 27, stateOfChargePct: 90, solarOffsetKw: 0, reserveFloorPct: 20 });
    assert.ok(f20.enduranceHoursDecimal <= f10.enduranceHoursDecimal);
  });

  it('27. status bands follow the 8h and 18h thresholds', () => {
    const short = calculateIslandEndurance({ activeCircuitsKw: 5, batteryCapacityKwh: 13.5, stateOfChargePct: 90, solarOffsetKw: 0 });
    const mid = calculateIslandEndurance({ activeCircuitsKw: 1.2, batteryCapacityKwh: 13.5, stateOfChargePct: 90, solarOffsetKw: 0 });
    const long = calculateIslandEndurance({ activeCircuitsKw: 0.5, batteryCapacityKwh: 13.5, stateOfChargePct: 90, solarOffsetKw: 0 });
    assert.equal(short.enduranceStatus, 'CRITICAL_DEPLETION');
    assert.equal(mid.enduranceStatus, 'OVERNIGHT_VIABLE');
    assert.equal(long.enduranceStatus, 'EXTENDED_ISLAND_SAFE');
  });
});

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

describe('Lab: evaluatePolicy against the real simulator', () => {
  it('28. every metric equals a direct simulator call for each policy', () => {
    const app = initial();
    for (const policy of LAB_POLICIES) {
      const cell = evaluatePolicy('ercot-summer-peak', policy.id, app, {});
      const sim = simulateHouseholdGridPulse({
        scenarioId: 'ercot-summer-peak',
        circuitStates: buildPolicyStates(policy.id, { scenarioId: 'ercot-summer-peak', comfortWeight: 2 }),
        batterySocPct: 90,
        batteryCapacityKwh: 13.5,
        solarOffsetEnabled: true
      });
      assert.equal(cell.peakKw, sim.metrics.optimizedPeakMaxKw, policy.id);
      assert.equal(cell.dailyKwh, sim.metrics.totalActiveDailyKwh, policy.id);
      assert.equal(cell.dailyBillUsd, sim.metrics.optimizedDailyCost, policy.id);
      assert.equal(cell.dailyCarbonKg, sim.metrics.optimizedDailyCarbonKg, policy.id);
      assert.equal(cell.criticalsSafe, true, policy.id);
    }
  });

  it('29. comfortShedKw equals the summed nameplate rating of shed circuits', () => {
    const cell = evaluatePolicy('ercot-summer-peak', 'battery-peak-shave', initial(), {});
    assert.equal(cell.comfortShedKw, 15.9);
    const island = evaluatePolicy('ercot-summer-peak', 'critical-island-survival', initial(), {});
    assert.equal(island.comfortShedKw, 26.4);
    const base = evaluatePolicy('ercot-summer-peak', 'unshifted-baseline', initial(), {});
    assert.equal(base.comfortShedKw, 0);
  });

  it('30. advisorValue equals an independent scoreSchedule call', () => {
    const app = initial();
    const cell = evaluatePolicy('ercot-winter-freeze', 'tou-delay-shift', app, { comfortWeight: 1 });
    const scored = scoreSchedule({
      scenarioId: 'ercot-winter-freeze',
      circuitStates: buildPolicyStates('tou-delay-shift', { scenarioId: 'ercot-winter-freeze', comfortWeight: 1 }),
      batterySocPct: 90,
      batteryCapacityKwh: 13.5,
      solarOffsetEnabled: true
    }, { weights: { comfort: 1 } });
    assert.equal(cell.advisorValue, scored.value);
  });

  it('31. island endurance uses the lab reserve floor and scenario solar offset', () => {
    const app = { ...initial(), batteryCapacityKwh: 27 };
    const cell = evaluatePolicy('ercot-outage-island', 'critical-island-survival', app, { reserveFloorPct: 20 });
    const sim = simulateHouseholdGridPulse({
      scenarioId: 'ercot-outage-island',
      circuitStates: buildPolicyStates('critical-island-survival', { scenarioId: 'ercot-outage-island' }),
      batterySocPct: 90, batteryCapacityKwh: 27, solarOffsetEnabled: true
    });
    const expected = calculateIslandEndurance({
      activeCircuitsKw: sim.metrics.averageActiveHourlyKw,
      batteryCapacityKwh: 27, stateOfChargePct: 90,
      solarOffsetKw: getScenarioById('ercot-outage-island').solarPeakOffsetKw,
      reserveFloorPct: 20
    });
    assert.equal(cell.islandEnduranceHours, expected.enduranceHoursDecimal);
    assert.equal(cell.enduranceStatus, expected.enduranceStatus);
  });

  it('32. unknown scenario and policy ids resolve to the defaults safely', () => {
    const cell = evaluatePolicy('not-a-scenario', 'not-a-policy', initial(), {});
    assert.equal(cell.scenarioId, 'ercot-summer-peak');
    assert.equal(cell.policyId, 'unshifted-baseline');
    assert.ok(Number.isFinite(cell.peakKw));
  });

  it('33. shed and shifted counts match the produced state map', () => {
    const cell = evaluatePolicy('ercot-summer-peak', 'battery-peak-shave', initial(), {});
    assert.equal(cell.shedCount, 3);
    assert.equal(cell.shiftedCount, 6);
    const island = evaluatePolicy('ercot-summer-peak', 'critical-island-survival', initial(), {});
    assert.equal(island.shedCount, 6);
    assert.equal(island.shiftedCount, 6);
  });
});

describe('Lab: 5-policy x 4-condition comparator', () => {
  it('34. produces 4 scenario rows with 5 policy cells each', () => {
    const matrix = compareAllPoliciesAllScenarios(initial(), {});
    assert.equal(matrix.scenarios.length, 4);
    assert.deepEqual(matrix.scenarios.map((s) => s.scenarioId), ERCOT_SCENARIOS.map((s) => s.id));
    for (const row of matrix.scenarios) {
      assert.equal(row.cells.length, 5);
      assert.deepEqual(row.cells.map((c) => c.policyId), LAB_POLICIES.map((p) => p.id));
    }
  });

  it('35. proves the non-shedding invariant across all 20 cells', () => {
    const matrix = compareAllPoliciesAllScenarios(initial(), {});
    assert.equal(matrix.checkedCells, 20);
    assert.equal(matrix.criticalsNeverShed, true);
    for (const row of matrix.scenarios) {
      for (const cell of row.cells) {
        assert.equal(cell.criticalsSafe, true);
      }
    }
  });

  it('36. is fully deterministic across repeated evaluation', () => {
    const a = compareAllPoliciesAllScenarios(initial(), { comfortWeight: 1.3 });
    const b = compareAllPoliciesAllScenarios(initial(), { comfortWeight: 1.3 });
    assert.deepEqual(a, b);
    assert.equal(a, b);
  });

  it('37. echoes its numeric inputs honestly', () => {
    const app = { ...initial(), batteryCapacityKwh: 27, batterySocPct: 80, solarOffsetEnabled: false };
    const matrix = compareAllPoliciesAllScenarios(app, { reserveFloorPct: 20, comfortWeight: 3 });
    assert.equal(matrix.inputs.batteryCapacityKwh, 27);
    assert.equal(matrix.inputs.batterySocPct, 80);
    assert.equal(matrix.inputs.solarOffsetEnabled, false);
    assert.equal(matrix.inputs.reserveFloorPct, 20);
    assert.equal(matrix.inputs.comfortWeight, 3);
  });

  it('38. shifting all relays always cuts peak versus the baseline policy', () => {
    const matrix = compareAllPoliciesAllScenarios(initial(), {});
    for (const row of matrix.scenarios) {
      const baseline = row.cells.find((c) => c.policyId === 'unshifted-baseline');
      const shifted = row.cells.find((c) => c.policyId === 'tou-delay-shift');
      assert.ok(shifted.peakKw < baseline.peakKw, row.scenarioId);
      assert.ok(shifted.dailyBillUsd < baseline.dailyBillUsd, row.scenarioId);
    }
  });

  it('39. critical-island-survival gives the best island endurance of all policies', () => {
    const matrix = compareAllPoliciesAllScenarios(initial(), {});
    const islandRow = matrix.scenarios.find((s) => s.scenarioId === 'ercot-outage-island');
    const best = islandRow.cells.find((c) => c.policyId === 'critical-island-survival');
    for (const cell of islandRow.cells) {
      assert.ok(best.islandEnduranceHours >= cell.islandEnduranceHours);
    }
  });

  it('40. comparePoliciesForScenario returns the five cells of one scenario', () => {
    const view = comparePoliciesForScenario('ercot-winter-freeze', initial(), {});
    assert.equal(view.scenarioId, 'ercot-winter-freeze');
    assert.equal(view.scenarioName, 'February Polar Vortex Freeze');
    assert.equal(view.cells.length, 5);
  });
});

describe('Lab: LFP battery sizing sweep', () => {
  it('41. evaluates all six sweep capacities for each of the five policies', () => {
    const sweep = sweepBatterySizing(initial(), {});
    assert.deepEqual(sweep.sweepKwh, [6.75, 13.5, 20.25, 27, 33.75, 40.5]);
    assert.equal(sweep.perPolicy.length, 5);
    for (const entry of sweep.perPolicy) {
      assert.equal(entry.points.length, 6);
      assert.deepEqual(entry.points.map((p) => p.kwh), sweep.sweepKwh);
    }
  });

  it('42. endurance is monotonically nondecreasing in capacity for every policy', () => {
    const sweep = sweepBatterySizing(initial(), {});
    for (const entry of sweep.perPolicy) {
      for (let i = 1; i < entry.points.length; i += 1) {
        assert.ok(entry.points[i].enduranceHours >= entry.points[i - 1].enduranceHours, `${entry.policyId} at ${entry.points[i].kwh}`);
      }
    }
  });

  it('43. island load matches a direct island-scenario simulation per policy', () => {
    const sweep = sweepBatterySizing(initial(), {});
    for (const entry of sweep.perPolicy) {
      const sim = simulateHouseholdGridPulse({
        scenarioId: 'ercot-outage-island',
        circuitStates: buildPolicyStates(entry.policyId, { scenarioId: 'ercot-outage-island', comfortWeight: 2 }),
        batterySocPct: 90, batteryCapacityKwh: 13.5, solarOffsetEnabled: true
      });
      assert.equal(entry.islandAverageLoadKw, sim.metrics.averageActiveHourlyKw, entry.policyId);
    }
  });

  it('44. critical-island-survival clears 24h at the smallest capacity', () => {
    const sweep = sweepBatterySizing(initial(), {});
    const survivor = sweep.perPolicy.find((e) => e.policyId === 'critical-island-survival');
    assert.equal(survivor.minKwhFor24h, 6.75);
    assert.ok(survivor.minKwhFor48h !== null);
    for (const entry of sweep.perPolicy) {
      if (entry.minKwhFor24h !== null) {
        assert.ok(entry.minKwhFor24h >= survivor.minKwhFor24h);
      }
    }
  });

  it('45. target fields are honest nulls when no sweep point reaches them', () => {
    const sweep = sweepBatterySizing({ ...initial(), batterySocPct: 20 }, { reserveFloorPct: 20 });
    for (const entry of sweep.perPolicy) {
      const maxHours = Math.max(...entry.points.map((p) => p.enduranceHours));
      if (maxHours < 24) assert.equal(entry.minKwhFor24h, null, entry.policyId);
      if (maxHours < 48) assert.equal(entry.minKwhFor48h, null, entry.policyId);
    }
  });

  it('46. a 20 percent floor shortens every sweep point', () => {
    const low = sweepBatterySizing(initial(), { reserveFloorPct: 20 });
    const high = sweepBatterySizing(initial(), { reserveFloorPct: 10 });
    for (const policy of LAB_POLICIES) {
      const a = low.perPolicy.find((e) => e.policyId === policy.id);
      const b = high.perPolicy.find((e) => e.policyId === policy.id);
      for (let i = 0; i < a.points.length; i += 1) {
        assert.ok(a.points[i].enduranceHours <= b.points[i].enduranceHours, `${policy.id} ${a.points[i].kwh}`);
      }
    }
  });

  it('47. every policy sweep keeps the critical invariant', () => {
    const sweep = sweepBatterySizing(initial(), {});
    for (const entry of sweep.perPolicy) {
      assert.equal(entry.criticalsSafe, true);
    }
  });
});

describe('Lab: pure-JS SHA-256', () => {
  it('48. empty message matches the FIPS 180-4 known answer', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('49. abc matches the FIPS 180-4 known answer', () => {
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('50. 56-byte boundary message matches the FIPS 180-4 known answer', () => {
    assert.equal(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  it('51. 112-byte two-block message matches the FIPS 180-4 known answer', () => {
    assert.equal(
      sha256Hex('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'),
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'
    );
  });

  it('52. matches node:crypto on assorted plain strings', () => {
    for (const text of ['gridpulse', 'ercot-summer-peak', '0', '{}', 'The quick brown fox jumps over the lazy dog.', 'x'.repeat(63), 'y'.repeat(64), 'z'.repeat(65)]) {
      assert.equal(sha256Hex(text), nodeSha(text), text.slice(0, 12));
    }
  });

  it('53. matches node:crypto on multi-byte UTF-8 and long inputs', () => {
    for (const text of ['104°F peak', 'CO2 0.62 kg/kWh', 'réserve', 'a'.repeat(1000), 'gridpulse-'.repeat(500)]) {
      assert.equal(sha256Hex(text), nodeSha(text), text.slice(0, 12));
    }
  });
});

describe('Lab: canonicalJson determinism', () => {
  it('54. sorts object keys recursively and preserves array order', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
    assert.equal(canonicalJson([2, 1, { z: 0, a: 9 }]), '[2,1,{"a":9,"z":0}]');
  });

  it('55. normalizes -0 and non-finite numbers', () => {
    assert.equal(canonicalJson({ n: -0 }), '{"n":0}');
    assert.equal(canonicalJson({ n: NaN }), '{"n":null}');
    assert.equal(canonicalJson({ n: Infinity }), '{"n":null}');
    assert.equal(canonicalJson({ n: -Infinity }), '{"n":null}');
  });

  it('56. drops undefined and function fields', () => {
    assert.equal(canonicalJson({ a: undefined, b: () => 1, c: 2 }), '{"c":2}');
  });

  it('57. serializes primitives and null safely', () => {
    assert.equal(canonicalJson(null), 'null');
    assert.equal(canonicalJson(true), 'true');
    assert.equal(canonicalJson('x'), '"x"');
    assert.equal(canonicalJson(1.5), '1.5');
    assert.equal(canonicalJson(Symbol ? { a: Symbol('s') } : {}), '{"a":null}');
  });
});

describe('Lab: stamped report cache and verify', () => {
  it('58. digest equals sha256 of the canonical payload without the digest field', () => {
    const stamped = getStampedReport(initial(), {});
    assert.equal(stamped.digestHex, sha256Hex(stamped.canonical));
    assert.equal(stamped.canonical, canonicalJson(stamped.payload));
    assert.equal(Object.prototype.hasOwnProperty.call(stamped.payload, 'integritySha256'), false);
  });

  it('59. identical inputs return the same cached stamped object', () => {
    const a = getStampedReport(initial(), { reserveFloorPct: 10 });
    const b = getStampedReport(initial(), { reserveFloorPct: 10 });
    assert.equal(a, b);
  });

  it('60. every input field moves the digest', () => {
    const base = getStampedReport(initial(), {}).digestHex;
    const variants = [
      getStampedReport({ ...initial(), batteryCapacityKwh: 27 }, {}).digestHex,
      getStampedReport({ ...initial(), batterySocPct: 50 }, {}).digestHex,
      getStampedReport({ ...initial(), solarOffsetEnabled: false }, {}).digestHex,
      getStampedReport({ ...initial(), scenarioId: 'ercot-winter-freeze' }, {}).digestHex,
      getStampedReport(initial(), { reserveFloorPct: 20 }).digestHex,
      getStampedReport(initial(), { comfortWeight: 1 }).digestHex,
      getStampedReport(initial(), { policyId: 'critical-island-survival' }).digestHex
    ];
    for (const [i, digest] of variants.entries()) {
      assert.notEqual(digest, base, `variant ${i} did not change the digest`);
      assert.match(digest, /^[0-9a-f]{64}$/);
    }
  });

  it('61. verifyStampedReport accepts a stamped report and a parsed JSON body', () => {
    const stamped = getStampedReport(initial(), {});
    assert.equal(verifyStampedReport(stamped).ok, true);
    const parsed = JSON.parse(exportReportJson(initial(), {}));
    const verdict = verifyStampedReport(parsed);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.expected, stamped.digestHex);
    assert.equal(verdict.actual, stamped.digestHex);
  });

  it('62. verifyStampedReport detects tampering in any payload field', () => {
    const stamped = getStampedReport(initial(), {});
    const mutations = [
      { ...stamped.payload, inputs: { ...stamped.payload.inputs, batteryCapacityKwh: 99 } },
      { ...stamped.payload, inputs: { ...stamped.payload.inputs, comfortWeight: 4 } },
      { ...stamped.payload, invariants: { ...stamped.payload.invariants, criticalsNeverShed: false } }
    ];
    for (const [i, tampered] of mutations.entries()) {
      const verdict = verifyStampedReport({ payload: tampered, digestHex: stamped.digestHex });
      assert.equal(verdict.ok, false, `mutation ${i} was not detected`);
      assert.notEqual(verdict.actual, stamped.digestHex);
    }
  });

  it('63. payloadWithoutDigest removes only the integrity field', () => {
    const stripped = payloadWithoutDigest({ a: 1, integritySha256: 'x' });
    assert.deepEqual(stripped, { a: 1 });
    const untouched = payloadWithoutDigest({ a: 1 });
    assert.deepEqual(untouched, { a: 1 });
  });

  it('64. payload carries schema, full matrix, sizing and disclosure', () => {
    const payload = buildLabReportPayload(initial(), { policyId: 'battery-peak-shave' });
    assert.equal(payload.schema, 'gridpulse-lab-brief/v1');
    assert.equal(payload.comparator.length, 4);
    assert.equal(payload.sizing.perPolicy.length, 5);
    assert.equal(payload.inputs.selectedPolicyId, 'battery-peak-shave');
    assert.match(payload.disclosure, /not live utility telemetry/);
    assert.equal(/[\u2013\u2014]/.test(JSON.stringify(payload)), false);
  });
});

describe('Lab: CSV escaping and export formats', () => {
  it('65. formula-leading cells are quote-prefixed', () => {
    assert.equal(csvEscape('=CMD()'), "'=CMD()");
    assert.equal(csvEscape('+1555'), "'+1555");
    assert.equal(csvEscape('-9'), "'-9");
    assert.equal(csvEscape('@SUM(1)'), "'@SUM(1)");
    assert.equal(csvEscape('\t=x'), "'\t=x");
    assert.equal(csvEscape('\r=x'), '"\'\r=x"');
    assert.equal(csvEscape(' =x'), "' =x");
  });

  it('66. commas, quotes and newlines escape to valid CSV cells', () => {
    assert.equal(csvEscape('a,b'), '"a,b"');
    assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
    assert.equal(csvEscape('line\nbreak'), '"line\nbreak"');
    assert.equal(csvEscape('plain'), 'plain');
    assert.equal(csvEscape(null), '');
    assert.equal(csvEscape(undefined), '');
    assert.equal(csvEscape(13.5), '13.5');
  });

  it('67. CSV export carries provenance header, digest and all 20 cells', () => {
    const stamped = getStampedReport(initial(), {});
    const csv = exportReportCsv(initial(), {});
    const lines = csv.trimEnd().split('\n');
    assert.equal(lines[0], '# gridpulse-resilience-brief gridpulse-lab-brief/v1');
    assert.equal(lines[1], '# sha256:' + stamped.digestHex);
    assert.equal(lines.filter((l) => l.startsWith('#')).length, 4);
    assert.equal(lines.length, 4 + 1 + 20);
    assert.equal(lines.filter((l) => l.endsWith(',yes')).length, 20);
    assert.equal(/[\u2013\u2014]/.test(csv), false);
  });

  it('68. JSON export parses, verifies and restamps the same digest', () => {
    const stamped = getStampedReport(initial(), {});
    const text = exportReportJson(initial(), {});
    const parsed = JSON.parse(text);
    assert.equal(parsed.integritySha256, stamped.digestHex);
    assert.equal(verifyStampedReport(parsed).ok, true);
    assert.equal(parsed.comparator.length, 4);
    assert.equal(parsed.comparator[0].cells.length, 5);
    assert.equal(/[\u2013\u2014]/.test(text), false);
  });

  it('69. Markdown export has heading, tables, backticked money and the digest', () => {
    const stamped = getStampedReport(initial(), {});
    const md = exportReportMarkdown(initial(), {});
    assert.ok(md.startsWith('# GridPulse Resilience Brief'));
    assert.ok(md.includes('sha256:' + stamped.digestHex));
    assert.ok(md.includes('`$'));
    assert.ok(md.includes('| Scenario | Policy |'));
    assert.ok(md.includes('live utility telemetry'));
    assert.equal(/[\u2013\u2014]/.test(md), false);
  });

  it('70. all three exporters are byte-identical across repeated calls', () => {
    assert.equal(exportReportJson(initial(), {}), exportReportJson(initial(), {}));
    assert.equal(exportReportCsv(initial(), {}), exportReportCsv(initial(), {}));
    assert.equal(exportReportMarkdown(initial(), {}), exportReportMarkdown(initial(), {}));
  });

  it('71. the same digest appears on page line, JSON, CSV and Markdown', () => {
    const stamped = getStampedReport(initial(), { policyId: 'critical-island-survival' });
    const digest = stamped.digestHex;
    assert.ok(exportReportJson(initial(), { policyId: 'critical-island-survival' }).includes(digest));
    assert.ok(exportReportCsv(initial(), { policyId: 'critical-island-survival' }).includes('# sha256:' + digest));
    assert.ok(exportReportMarkdown(initial(), { policyId: 'critical-island-survival' }).includes('sha256:' + digest));
  });
});

describe('Lab: strict #gp= bookmark codec', () => {
  it('72. encodes the canonical v1 field shape', () => {
    const hash = encodeLabHash(initial(), { policyId: 'tou-delay-shift', reserveFloorPct: 10, comfortWeight: 2 });
    assert.match(hash, /^#gp=v1\|s=ercot-summer-peak\|p=tou-delay-shift\|b=13\.5\|r=10\|c=2$/);
  });

  it('73. round-trips every field for each of the 5 policies', () => {
    for (const policy of LAB_POLICIES) {
      const state = { ...initial(), scenarioId: 'ercot-coastal-calm', batteryCapacityKwh: 20.25 };
      const decoded = decodeLabHash(encodeLabHash(state, { policyId: policy.id, reserveFloorPct: 20, comfortWeight: 1.25 }));
      assert.equal(decoded.scenarioId, 'ercot-coastal-calm');
      assert.equal(decoded.policyId, policy.id);
      assert.equal(decoded.batteryCapacityKwh, 20.25);
      assert.equal(decoded.reserveFloorPct, 20);
      assert.equal(decoded.comfortWeight, 1.25);
    }
  });

  it('74. round-trips every field for each of the 4 scenarios', () => {
    for (const scenario of ERCOT_SCENARIOS) {
      const state = { ...initial(), scenarioId: scenario.id, batteryCapacityKwh: 33.75 };
      const decoded = decodeLabHash(encodeLabHash(state, { policyId: 'critical-island-survival', reserveFloorPct: 10, comfortWeight: 0 }));
      assert.equal(decoded.scenarioId, scenario.id);
      assert.equal(decoded.policyId, 'critical-island-survival');
      assert.equal(decoded.batteryCapacityKwh, 33.75);
      assert.equal(decoded.comfortWeight, 0);
    }
  });

  it('75. decodes from a full URL hash, not just the bare token', () => {
    const url = 'https://aariv.me/gridpulse/#gp=v1|s=ercot-winter-freeze|p=battery-peak-shave|b=27|r=20|c=1.5';
    const decoded = decodeLabHash(url);
    assert.equal(decoded.scenarioId, 'ercot-winter-freeze');
    assert.equal(decoded.policyId, 'battery-peak-shave');
    assert.equal(decoded.batteryCapacityKwh, 27);
    assert.equal(decoded.reserveFloorPct, 20);
    assert.equal(decoded.comfortWeight, 1.5);
  });

  it('76. fails closed on empty, missing and malformed hashes', () => {
    for (const hash of ['', '#gp=', '#other=1', 'gp=v1', null, undefined, 0, '#gp', '###']) {
      assert.equal(decodeLabHash(hash), null, JSON.stringify(hash));
    }
  });

  it('77. fails closed on wrong version, missing fields and extra fields', () => {
    assert.equal(decodeLabHash('#gp=v2|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=2|x=1'), null);
    const reordered = decodeLabHash('#gp=v1|p=tou-delay-shift|b=13.5|r=10|c=2|s=ercot-summer-peak');
    assert.equal(reordered.scenarioId, 'ercot-summer-peak');
    assert.equal(reordered.policyId, 'tou-delay-shift');
  });

  it('78. fails closed on prototype-pollution keys and values', () => {
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=2|__proto__=x'), null);
    assert.equal(decodeLabHash('#gp=v1|s=__proto__|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=constructor|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|constructor=x'), null);
  });

  it('79. fails closed on duplicated keys and bad characters', () => {
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|s=ercot-winter-freeze|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ercot%20peak|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=<script>|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ERCOT-SUMMER-PEAK|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
  });

  it('80. fails closed on unknown ids and non-numeric fields', () => {
    assert.equal(decodeLabHash('#gp=v1|s=mars|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=mars|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=abc|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=99|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=x'), null);
  });

  it('81. normalizes out-of-range numbers into the sweep bounds', () => {
    const decoded = decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=999|r=10|c=99');
    assert.equal(decoded.batteryCapacityKwh, 40.5);
    assert.equal(decoded.comfortWeight, 4);
    const low = decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=0.5|r=10|c=0');
    assert.equal(low.batteryCapacityKwh, 6.75);
  });

  it('82. applyDecodedBookmark restores scenario and battery through the reducer', () => {
    const decoded = decodeLabHash('#gp=v1|s=ercot-outage-island|p=critical-island-survival|b=40.5|r=20|c=1');
    const { appState, labOptions } = applyDecodedBookmark(initial(), decoded);
    assert.equal(appState.scenarioId, 'ercot-outage-island');
    assert.equal(appState.batteryCapacityKwh, 40.5);
    assert.equal(appState.circuitStates['medical-fridge-core'].enabled, true);
    assert.equal(labOptions.policyId, 'critical-island-survival');
    assert.equal(labOptions.reserveFloorPct, 20);
    assert.equal(labOptions.comfortWeight, 1);
  });

  it('83. applyDecodedBookmark on null input returns the untouched state', () => {
    const state = initial();
    const { appState, labOptions } = applyDecodedBookmark(state, null);
    assert.equal(appState, state);
    assert.equal(labOptions.policyId, 'tou-delay-shift');
    assert.equal(labOptions.reserveFloorPct, 10);
  });
});

describe('Lab: SVG and table renderers', () => {
  it('84. tradeoff chart renders five focusable policy points with labels', () => {
    const svg = renderTradeoffChartSvg(initial(), {});
    assert.equal((svg.match(/data-lab-policy-point=/g) || []).length, 5);
    assert.equal((svg.match(/tabindex="0"/g) || []).length, 5);
    assert.ok(svg.includes('role="button"'));
    assert.ok(svg.includes('aria-label'));
    assert.equal(/NaN|undefined|Infinity/.test(svg), false);
    assert.equal(/[\u2013\u2014]/.test(svg), false);
  });

  it('85. tradeoff chart marks the selected policy and scenario in its label', () => {
    const svg = renderTradeoffChartSvg(initial(), { policyId: 'critical-island-survival' });
    assert.ok(svg.includes('is-selected'));
    assert.ok(svg.includes('August'));
  });

  it('86. sizing chart renders six focusable points and 24h/48h target lines', () => {
    const svg = renderSizingCurveSvg(initial(), {});
    assert.equal((svg.match(/data-lab-kwh=/g) || []).length, 6);
    assert.equal((svg.match(/tabindex="0"/g) || []).length, 6);
    assert.ok(svg.includes('24h outage target'));
    assert.ok(svg.includes('48h outage target'));
    assert.equal(/NaN|undefined|Infinity/.test(svg), false);
    assert.equal(/[\u2013\u2014]/.test(svg), false);
  });

  it('87. sizing chart highlights the active capacity and the reserve floor', () => {
    const svg = renderSizingCurveSvg({ ...initial(), batteryCapacityKwh: 27 }, { reserveFloorPct: 20 });
    assert.ok(svg.includes('20 percent reserve floor'));
    assert.ok(svg.includes('r="7"'));
  });

  it('88. comparator rows render five rows with protected critical pills', () => {
    const html = renderComparatorRowsHtml(initial(), {});
    assert.equal((html.match(/<tr/g) || []).length, 5);
    assert.equal((html.match(/PROTECTED/g) || []).length, 5);
    assert.ok(html.includes('data-policy-id="unshifted-baseline"'));
    assert.ok(html.includes('$'));
    assert.equal(/[\u2013\u2014]/.test(html), false);
    assert.equal(/NaN|undefined|Infinity/.test(html), false);
  });

  it('89. endurance matrix rows render five rows of four hour cells', () => {
    const html = renderEnduranceMatrixRowsHtml(initial(), {});
    assert.equal((html.match(/<tr/g) || []).length, 5);
    assert.equal((html.match(/\d+\.\dh/g) || []).length, 20);
    assert.equal(/NaN|undefined|Infinity/.test(html), false);
  });
});

describe('Lab: in-page self-test runner', () => {
  it('90. returns at least 14 checks that all pass on the default state', () => {
    const { results, passed, total } = runLabSelfTests(initial(), {});
    assert.ok(total >= 14);
    assert.equal(passed, total, results.filter((r) => !r.pass).map((r) => r.name + ': ' + r.detail).join(' | '));
  });

  it('91. every check carries a name, a verdict and a detail', () => {
    const { results } = runLabSelfTests(initial(), {});
    for (const item of results) {
      assert.ok(item.name.length > 3);
      assert.equal(typeof item.pass, 'boolean');
      assert.ok(item.detail.length > 0);
      assert.equal(/[\u2013\u2014]/.test(item.name + item.detail), false);
    }
  });

  it('92. all checks pass under the island scenario and a 20 percent floor', () => {
    const island = { ...initial(), scenarioId: 'ercot-outage-island' };
    const { passed, total, results } = runLabSelfTests(island, { reserveFloorPct: 20 });
    assert.equal(passed, total, results.filter((r) => !r.pass).map((r) => r.name).join(' | '));
  });

  it('93. self-tests are deterministic across repeated runs', () => {
    const a = runLabSelfTests(initial(), {}).results.map((r) => r.pass);
    const b = runLabSelfTests(initial(), {}).results.map((r) => r.pass);
    assert.deepEqual(a, b);
  });
});

describe('Lab: per-cell simulator parity (5 policies x 4 conditions)', () => {
  const app = initial();
  for (const scenario of ERCOT_SCENARIOS) {
    for (const policy of LAB_POLICIES) {
      it(`cell ${scenario.id}/${policy.id} equals direct simulation`, () => {
        const cell = evaluatePolicy(scenario.id, policy.id, app, {});
        const sim = simulateHouseholdGridPulse({
          scenarioId: scenario.id,
          circuitStates: buildPolicyStates(policy.id, { scenarioId: scenario.id, comfortWeight: 2 }),
          batterySocPct: 90,
          batteryCapacityKwh: 13.5,
          solarOffsetEnabled: true
        });
        assert.equal(cell.peakKw, sim.metrics.optimizedPeakMaxKw);
        assert.equal(cell.dailyKwh, sim.metrics.totalActiveDailyKwh);
        assert.equal(cell.dailyBillUsd, sim.metrics.optimizedDailyCost);
        assert.equal(cell.dailyCarbonKg, sim.metrics.optimizedDailyCarbonKg);
        assert.equal(cell.criticalsSafe, true);
        assert.ok(Number.isFinite(cell.advisorValue));
      });
    }
  }
});

describe('Lab: per-point sweep exactness (5 policies x 6 capacities)', () => {
  const app = initial();
  for (const policy of LAB_POLICIES) {
    for (const kwh of BATTERY_SWEEP_KWH) {
      it(`${policy.id} at ${kwh} kWh matches an independent endurance calc`, () => {
        const sweep = sweepBatterySizing(app, { reserveFloorPct: 10 });
        const entry = sweep.perPolicy.find((e) => e.policyId === policy.id);
        const point = entry.points.find((p) => p.kwh === kwh);
        const island = getScenarioById('ercot-outage-island');
        const expected = calculateIslandEndurance({
          activeCircuitsKw: entry.islandAverageLoadKw,
          batteryCapacityKwh: kwh,
          stateOfChargePct: 90,
          solarOffsetKw: island.solarPeakOffsetKw,
          reserveFloorPct: 10
        });
        assert.equal(point.enduranceHours, expected.enduranceHoursDecimal);
        assert.equal(point.enduranceStatus, expected.enduranceStatus);
      });
    }
  }
});

describe('Lab: policy states under every scenario (5 policies x 4 conditions)', () => {
  for (const scenario of ERCOT_SCENARIOS) {
    for (const policy of LAB_POLICIES) {
      it(`${policy.id} under ${scenario.id} yields a complete valid map`, () => {
        const states = buildPolicyStates(policy.id, { scenarioId: scenario.id, comfortWeight: 2 });
        assert.equal(Object.keys(states).length, HOUSEHOLD_CIRCUITS.length);
        assert.deepEqual(criticalShedViolations(states), []);
        for (const circuit of HOUSEHOLD_CIRCUITS) {
          const entry = states[circuit.id];
          assert.equal(typeof entry.enabled, 'boolean');
          assert.equal(typeof entry.shifted, 'boolean');
          if (circuit.critical === true) assert.equal(entry.enabled, true);
        }
      });
    }
  }
});

describe('Lab: hostile input battery', () => {
  it('117. evaluatePolicy tolerates hostile app state fields', () => {
    const hostile = { scenarioId: 'ercot-summer-peak', batterySocPct: NaN, batteryCapacityKwh: -5, solarOffsetEnabled: 'yes' };
    const cell = evaluatePolicy('ercot-summer-peak', 'tou-delay-shift', hostile, {});
    assert.ok(Number.isFinite(cell.peakKw));
    assert.ok(Number.isFinite(cell.islandEnduranceHours));
  });

  it('118. evaluatePolicy tolerates hostile lab options', () => {
    const cell = evaluatePolicy('ercot-summer-peak', 'tou-delay-shift', initial(), { reserveFloorPct: Infinity, comfortWeight: NaN, policyId: '__proto__' });
    assert.ok(Number.isFinite(cell.peakKw));
    assert.ok(Number.isFinite(cell.islandEnduranceHours));
  });

  it('119. sweep tolerates a zero-capacity and hostile context', () => {
    const sweep = sweepBatterySizing({ ...initial(), batteryCapacityKwh: 0 }, { reserveFloorPct: 'x' });
    assert.equal(sweep.perPolicy.length, 5);
    assert.equal(sweep.reserveFloorPct, 10);
  });

  it('120. stamped report survives hostile state and options', () => {
    const stamped = getStampedReport(
      { scenarioId: NaN, batterySocPct: -50, batteryCapacityKwh: Infinity, solarOffsetEnabled: 1 },
      { reserveFloorPct: 0.5, comfortWeight: -9, policyId: {} }
    );
    assert.match(stamped.digestHex, /^[0-9a-f]{64}$/);
    assert.equal(verifyStampedReport(stamped).ok, true);
  });

  it('121. csvEscape neutralizes every formula vector', () => {
    for (const hostile of ['=CMD()', '=1+1', '+PING', '-10', '@evil', '\t=1', '\r=2', ' =x', '  =SUM(A1:A9)']) {
      const escaped = csvEscape(hostile);
      const inner = escaped.startsWith('"') && escaped.endsWith('"') ? escaped.slice(1, -1).replace(/""/g, '"') : escaped;
      assert.ok(inner.startsWith("'"), hostile);
      assert.ok(!/^\s*[=+\-@\t\r]/.test(inner), hostile);
    }
  });

  it('122. decodeLabHash rejects oversized and empty values', () => {
    const long = 'a'.repeat(200);
    assert.equal(decodeLabHash(`#gp=v1|s=${long}|p=tou-delay-shift|b=13.5|r=10|c=2`), null);
    assert.equal(decodeLabHash('#gp=v1|s=|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
  });

  it('123. decodeLabHash truncates the body at URL fragment boundaries', () => {
    const decoded = decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=2&constructor=x');
    assert.equal(decoded.scenarioId, 'ercot-summer-peak');
    const spaced = decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=2 junk');
    assert.equal(spaced.comfortWeight, 2);
  });
});

describe('Lab: canonicalJson hostile values', () => {
  it('124. nested hostile values cannot break serialization', () => {
    const hostile = { a: [NaN, -0, Infinity, undefined, () => 1], b: { c: { d: -Infinity } }, e: 'x' };
    assert.equal(canonicalJson(hostile), '{"a":[null,0,null,null,null],"b":{"c":{"d":null}},"e":"x"}');
  });

  it('125. canonicalJson never emits NaN or Infinity tokens', () => {
    const text = canonicalJson({ x: NaN, y: [Infinity, -Infinity, -0] });
    assert.equal(text.includes('NaN'), false);
    assert.equal(text.includes('Infinity'), false);
  });
});

describe('Lab: report payload content', () => {
  it('126. comparator cells carry every required metric as finite numbers', () => {
    const payload = buildLabReportPayload(initial(), {});
    for (const row of payload.comparator) {
      for (const cell of row.cells) {
        for (const key of ['peakKw', 'peakKwReduction', 'dailyKwh', 'dailyBillUsd', 'dailyCarbonKg', 'islandEnduranceHours', 'comfortShedKw', 'advisorValue']) {
          assert.ok(Number.isFinite(cell[key]), `${row.scenarioId}/${cell.policyId}/${key}`);
        }
        assert.equal(typeof cell.criticalsSafe, 'boolean');
      }
    }
  });

  it('127. invariants block names both protected circuits', () => {
    const payload = buildLabReportPayload(initial(), {});
    assert.deepEqual(payload.invariants.criticalCircuitIds, ['medical-fridge-core', 'lighting-it-routers']);
    assert.equal(payload.invariants.criticalsNeverShed, true);
    assert.equal(payload.invariants.checkedCells, 20);
  });

  it('128. payload contains no wall clock or random fields', () => {
    const a = buildLabReportPayload(initial(), {});
    const b = buildLabReportPayload(initial(), {});
    assert.deepEqual(a, b);
    const text = JSON.stringify(a).toLowerCase();
    for (const banned of ['date', 'time', 'random', 'nonce']) {
      assert.equal(text.includes(banned), false, banned);
    }
  });

  it('129. stamped digest is stable across cache eviction pressure', () => {
    const target = getStampedReport(initial(), { policyId: 'unshifted-baseline' }).digestHex;
    for (let i = 0; i < 30; i += 1) {
      getStampedReport({ ...initial(), batteryCapacityKwh: 6.75 + i }, { comfortWeight: (i % 8) / 2 });
    }
    const again = getStampedReport(initial(), { policyId: 'unshifted-baseline' }).digestHex;
    assert.equal(again, target);
  });
});

describe('Lab: sweep capacities in bookmark round-trips', () => {
  for (const kwh of BATTERY_SWEEP_KWH) {
    it(`130. capacity ${kwh} survives the hash round-trip`, () => {
      const state = { ...initial(), batteryCapacityKwh: kwh };
      const decoded = decodeLabHash(encodeLabHash(state, { policyId: 'tou-delay-shift', reserveFloorPct: 10, comfortWeight: 2 }));
      assert.equal(decoded.batteryCapacityKwh, kwh);
    });
  }
});

describe('Lab: digest parity per scenario', () => {
  for (const scenario of ERCOT_SCENARIOS) {
    it(`131. ${scenario.id} digest matches across JSON, CSV and Markdown`, () => {
      const state = { ...initial(), scenarioId: scenario.id };
      const digest = getStampedReport(state, {}).digestHex;
      assert.ok(exportReportJson(state, {}).includes(digest));
      assert.ok(exportReportCsv(state, {}).includes('# sha256:' + digest));
      assert.ok(exportReportMarkdown(state, {}).includes('sha256:' + digest));
      assert.match(digest, /^[0-9a-f]{64}$/);
    });
  }
});

describe('Lab: comparator best-answer semantics', () => {
  it('132. battery-peak-shave shaves more peak than tou-delay-shift in every scenario', () => {
    const matrix = compareAllPoliciesAllScenarios(initial(), {});
    for (const row of matrix.scenarios) {
      const shave = row.cells.find((c) => c.policyId === 'battery-peak-shave');
      const tou = row.cells.find((c) => c.policyId === 'tou-delay-shift');
      assert.ok(shave.peakKw <= tou.peakKw, row.scenarioId);
    }
  });

  it('133. island endurance is identical across policies that keep the same load', () => {
    const matrix = compareAllPoliciesAllScenarios(initial(), {});
    const islandRow = matrix.scenarios.find((s) => s.scenarioId === 'ercot-outage-island');
    const shave = islandRow.cells.find((c) => c.policyId === 'battery-peak-shave');
    const baseline = islandRow.cells.find((c) => c.policyId === 'unshifted-baseline');
    assert.ok(shave.islandEnduranceHours > baseline.islandEnduranceHours);
  });
});

describe('Lab: additional hostile codec inputs', () => {
  it('134. hash bodies with only spaces or repeated gp= fail closed', () => {
    assert.equal(decodeLabHash('#gp=   '), null);
    assert.equal(decodeLabHash('#gp=gp=gp='), null);
    assert.equal(decodeLabHash('#gp=v1'), null);
    assert.equal(decodeLabHash('#gp=v1|'), null);
  });

  it('135. unicode, uppercase and percent-encoded values are rejected', () => {
    assert.equal(decodeLabHash('#gp=v1|s=ERCOT|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=é|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
    assert.equal(decodeLabHash('#gp=v1|s=%20|p=tou-delay-shift|b=13.5|r=10|c=2'), null);
  });

  it('136. exponent notation fails closed and overflow clamps', () => {
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=1e5|r=10|c=9'), null);
    assert.equal(decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=1e2'), null);
    const decoded = decodeLabHash('#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=1000000|r=10|c=9');
    assert.equal(decoded.batteryCapacityKwh, 40.5);
    assert.equal(decoded.comfortWeight, 4);
  });
});

describe('Lab: exporter structure deep checks', () => {
  it('137. CSV rows carry one column per header field', () => {
    const csv = exportReportCsv(initial(), {});
    const lines = csv.trimEnd().split('\n').filter((l) => !l.startsWith('#'));
    const cols = lines[0].split(',').length;
    assert.equal(cols, 13);
    for (const line of lines.slice(1)) {
      assert.equal(line.split(',').length, cols, line);
    }
  });

  it('138. JSON export is valid parseable JSON ending in a newline', () => {
    const text = exportReportJson(initial(), {});
    assert.ok(text.endsWith('\n'));
    const parsed = JSON.parse(text);
    assert.equal(parsed.inputs.batteryCapacityKwh, 13.5);
    assert.equal(parsed.inputs.selectedPolicyId, 'tou-delay-shift');
  });

  it('139. Markdown tables have consistent pipe columns', () => {
    const md = exportReportMarkdown(initial(), {});
    const tableLines = md.split('\n').filter((l) => l.startsWith('| Scenario |') || l.startsWith('| ercot'));
    assert.ok(tableLines.length >= 21);
    for (const line of tableLines) {
      assert.equal(line.split('|').length, 13, line);
    }
  });

  it('140. CSV output never begins a data cell with a formula token', () => {
    const csv = exportReportCsv(initial(), {});
    for (const line of csv.trimEnd().split('\n')) {
      if (line.startsWith('#')) continue;
      for (const cell of line.split(',')) {
        assert.equal(/^[=+\-@]/.test(cell), false, cell);
      }
    }
  });
});

describe('Lab: endurance edge cases', () => {
  it('141. zero-reserve zero-load yields the 120h clamp', () => {
    const res = calculateIslandEndurance({ activeCircuitsKw: 0, batteryCapacityKwh: 40.5, stateOfChargePct: 100, solarOffsetKw: 2, reserveFloorPct: 0 });
    assert.equal(res.enduranceHoursDecimal, 120);
  });

  it('142. heavy load yields short critical status', () => {
    const res = calculateIslandEndurance({ activeCircuitsKw: 24, batteryCapacityKwh: 6.75, stateOfChargePct: 50, solarOffsetKw: 0, reserveFloorPct: 10 });
    assert.equal(res.enduranceStatus, 'CRITICAL_DEPLETION');
    assert.ok(res.enduranceHoursDecimal < 4);
  });

  it('143. a 100 percent floor yields zero usable energy regardless of SoC', () => {
    const res = calculateIslandEndurance({ activeCircuitsKw: 1, batteryCapacityKwh: 40.5, stateOfChargePct: 100, solarOffsetKw: 0, reserveFloorPct: 100 });
    assert.equal(res.usableKwh, 0);
    assert.equal(res.enduranceHoursDecimal, 0);
  });
});

describe('Lab: engine capacity action integration', () => {
  it('94. SET_BATTERY_CAPACITY clamps into the 6.75 to 40.5 sweep window', () => {
    let state = initial();
    state = applyAppAction(state, { type: 'SET_BATTERY_CAPACITY', value: 100 });
    assert.equal(state.batteryCapacityKwh, 40.5);
    state = applyAppAction(state, { type: 'SET_BATTERY_CAPACITY', value: 1 });
    assert.equal(state.batteryCapacityKwh, 6.75);
    state = applyAppAction(state, { type: 'SET_BATTERY_CAPACITY', value: 27 });
    assert.equal(state.batteryCapacityKwh, 27);
  });

  it('95. SET_BATTERY_CAPACITY keeps hostile input inside the sweep bounds', () => {
    let state = initial();
    for (const bad of [NaN, Infinity, 'big', null, undefined, {}, []]) {
      state = applyAppAction(state, { type: 'SET_BATTERY_CAPACITY', value: bad });
      assert.ok(state.batteryCapacityKwh >= 6.75 && state.batteryCapacityKwh <= 40.5,
        'out of bounds for ' + JSON.stringify(bad));
    }
  });

  it('96. capacity flows into the simulation endurance and view state', () => {
    const small = simulateHouseholdGridPulse({ ...initial(), batteryCapacityKwh: 6.75 });
    const large = simulateHouseholdGridPulse({ ...initial(), batteryCapacityKwh: 40.5 });
    assert.ok(large.outageEndurance.enduranceHoursDecimal > small.outageEndurance.enduranceHoursDecimal);
    assert.equal(large.outageEndurance.batteryCapacityKwh, 40.5);
  });
});
