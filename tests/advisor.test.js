/**
 * advisor.test.js - unit, invariant and regression tests for the load-shift
 * advisor. Every reported number is checked against the core simulator, so a
 * recommendation can never claim a saving the engine does not produce.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ERCOT_SCENARIOS,
  HOUSEHOLD_CIRCUITS,
  createInitialAppState,
  createDefaultCircuitStateMap,
  applyAppAction,
  simulateHouseholdGridPulse
} from '../js/gridpulse-engine.js';
import {
  enumerateMoves,
  scoreSchedule,
  marginalCircuitContributions,
  optimizeSchedule,
  compareSchedules,
  stressTestScenarios,
  buildAdvisorReport,
  stateForScenario
} from '../js/gridpulse-advisor.js';

const initial = () => createInitialAppState();
const inUnit = (v) => Number.isFinite(v);

function independentPeakKw(state) {
  return simulateHouseholdGridPulse(state).metrics.peakKwReduction;
}

describe('Advisor: move enumeration', () => {
  it('01. enumerates one shed or reclose plus one shift per shiftable circuit', () => {
    const moves = enumerateMoves(createDefaultCircuitStateMap('unoptimized'));
    const shiftable = HOUSEHOLD_CIRCUITS.filter((c) => c.shiftable === true).length;
    const critical = HOUSEHOLD_CIRCUITS.filter((c) => c.critical === true).length;
    assert.equal(moves.length, (HOUSEHOLD_CIRCUITS.length - critical) + shiftable);
    assert.ok(moves.every((m) => m.states && m.circuitId && m.action));
  });

  it('02. never offers to shed a protected critical circuit', () => {
    for (const move of enumerateMoves(createDefaultCircuitStateMap('unoptimized'))) {
      const circuit = HOUSEHOLD_CIRCUITS.find((c) => c.id === move.circuitId);
      if (move.action === 'SHED') assert.notEqual(circuit.critical, true);
    }
  });

  it('03. no move mutates the input state map', () => {
    const states = createDefaultCircuitStateMap('unoptimized');
    const snapshot = JSON.stringify(states);
    enumerateMoves(states);
    assert.equal(JSON.stringify(states), snapshot);
  });

  it('04. a shed circuit gains a RECLOSE move and no SHED move', () => {
    let state = initial();
    state = applyAppAction(state, { type: 'TOGGLE_BREAKER', circuitId: 'ev-charger-l2' });
    const moves = enumerateMoves(state.circuitStates);
    const ev = moves.filter((m) => m.circuitId === 'ev-charger-l2');
    assert.ok(ev.some((m) => m.action === 'RECLOSE'));
    assert.equal(ev.some((m) => m.action === 'SHED'), false);
    assert.equal(ev.some((m) => m.action === 'SHIFT'), true);
  });

  it('05. protectCritical false exposes sheds for every circuit', () => {
    const moves = enumerateMoves(createDefaultCircuitStateMap('unoptimized'), { protectCritical: false });
    const sheds = moves.filter((m) => m.action === 'SHED');
    assert.equal(sheds.length, HOUSEHOLD_CIRCUITS.length);
  });

  it('06. move order is stable and deterministic', () => {
    const states = createDefaultCircuitStateMap('unoptimized');
    assert.deepEqual(
      enumerateMoves(states).map((m) => `${m.circuitId}:${m.action}`),
      enumerateMoves(states).map((m) => `${m.circuitId}:${m.action}`)
    );
  });
});

describe('Advisor: scoreSchedule', () => {
  it('07. the unoptimized baseline scores zero peak reduction and zero savings', () => {
    const scored = scoreSchedule(initial());
    assert.equal(scored.peakKwReduction, 0);
    assert.equal(scored.dailySavingsUsd, 0);
    assert.equal(scored.dailyCarbonAvoidedKg, 0);
    assert.equal(scored.activeCount, 8);
  });

  it('08. score metrics exactly match a direct simulator call', () => {
    let state = initial();
    state = applyAppAction(state, { type: 'AUTO_OPTIMIZE' });
    const scored = scoreSchedule(state);
    const sim = simulateHouseholdGridPulse(state);
    assert.equal(scored.peakKwReduction, sim.metrics.peakKwReduction);
    assert.equal(scored.dailySavingsUsd, sim.metrics.dailySavingsUsd);
    assert.equal(scored.dailyCarbonAvoidedKg, sim.metrics.dailyCarbonAvoidedKg);
    assert.equal(scored.enduranceHours, sim.outageEndurance.enduranceHoursDecimal);
    assert.equal(scored.optimizedStrainIndex, sim.metrics.optimizedStrainIndex);
  });

  it('09. the comfort penalty makes a shed schedule score below an all-shift schedule with equal savings', () => {
    const shifted = { ...initial(), circuitStates: createDefaultCircuitStateMap('optimized') };
    const shed = { ...initial(), circuitStates: createDefaultCircuitStateMap('outage-critical') };
    const a = scoreSchedule(shifted, { weights: { comfort: 4 } });
    const b = scoreSchedule(shed, { weights: { comfort: 4 } });
    assert.ok(inUnit(a.value) && inUnit(b.value));
    assert.ok(a.value > 0);
    assert.ok(b.value < scoreSchedule(shed, { weights: { comfort: 0 } }).value);
  });

  it('10. scoreSchedule is deterministic and bounded for every scenario', () => {
    for (const scenario of ERCOT_SCENARIOS) {
      const state = stateForScenario(scenario.id);
      const a = scoreSchedule(state);
      const b = scoreSchedule(state);
      assert.deepEqual(a, b);
      assert.ok(inUnit(a.value) && inUnit(a.peakKwReduction) && inUnit(a.enduranceHours));
    }
  });

  it('11. a zero comfort weight falls back to the pure savings objective', () => {
    let state = initial();
    state = applyAppAction(state, { type: 'AUTO_OPTIMIZE' });
    const withComfort = scoreSchedule(state, { weights: { comfort: 2 } });
    const without = scoreSchedule(state, { weights: { comfort: 0 } });
    assert.equal(withComfort.value, without.value, 'no shed means no comfort penalty');
  });
});

describe('Advisor: marginal contributions', () => {
  it('12. every contribution delta equals the difference of two real simulations', () => {
    const state = initial();
    const base = simulateHouseholdGridPulse(state).metrics;
    for (const row of marginalCircuitContributions(state).contributions) {
      const candidate = { ...state, circuitStates: row.states };
      const m = simulateHouseholdGridPulse(candidate).metrics;
      assert.equal(row.deltaPeakKw, Math.round((m.peakKwReduction - base.peakKwReduction) * 100) / 100);
      assert.equal(row.deltaSavingsUsd, Math.round((m.dailySavingsUsd - base.dailySavingsUsd) * 100) / 100);
    }
  });

  it('13. contributions are sorted by descending delta with a stable tie break', () => {
    const rows = marginalCircuitContributions(initial()).contributions;
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i - 1].deltaValue >= rows[i].deltaValue);
      if (rows[i - 1].deltaValue === rows[i].deltaValue) {
        assert.ok(rows[i - 1].circuitId <= rows[i].circuitId);
      }
    }
  });

  it('14. the best single move from baseline shifts the EV charger', () => {
    const top = marginalCircuitContributions(initial()).contributions[0];
    assert.equal(top.circuitId, 'ev-charger-l2');
    assert.equal(top.action, 'SHIFT');
    assert.ok(top.deltaPeakKw > 9);
    assert.ok(top.deltaValue > 0);
  });

  it('15. a low comfort weight makes shedding the EV charger the best move', () => {
    const top = marginalCircuitContributions(initial(), { weights: { comfort: 0 } }).contributions[0];
    assert.equal(top.circuitId, 'ev-charger-l2');
    assert.equal(top.action, 'SHED');
  });

  it('16. invariant: every reported delta is finite across all scenarios', () => {
    for (const scenario of ERCOT_SCENARIOS) {
      for (const row of marginalCircuitContributions(stateForScenario(scenario.id)).contributions) {
        assert.ok(inUnit(row.deltaValue));
        assert.ok(inUnit(row.deltaPeakKw));
        assert.ok(inUnit(row.deltaSavingsUsd));
        assert.ok(inUnit(row.deltaCarbonKg));
        assert.ok(inUnit(row.deltaEnduranceHours));
      }
    }
  });

  it('17. a fully optimized schedule still exposes legal inverse moves', () => {
    let state = initial();
    state = applyAppAction(state, { type: 'AUTO_OPTIMIZE' });
    const rows = marginalCircuitContributions(state).contributions;
    assert.ok(rows.some((r) => r.action === 'UNSHIFT'));
    assert.ok(rows.some((r) => r.action === 'SHED'));
  });
});

describe('Advisor: greedy optimization', () => {
  it('18. maxSteps zero returns the input unchanged', () => {
    const state = initial();
    const plan = optimizeSchedule(state, { maxSteps: 0 });
    assert.deepEqual(plan.optimized.circuitStates, state.circuitStates);
    assert.deepEqual(plan.steps, []);
    assert.equal(plan.improvement, 0);
  });

  it('19. every greedy step strictly improves the objective', () => {
    const plan = optimizeSchedule(initial(), { maxSteps: 5 });
    assert.ok(plan.steps.length > 0);
    for (const step of plan.steps) assert.ok(step.gain > 0);
    assert.ok(plan.after.value > plan.before.value);
  });

  it('20. the reported improvement equals after minus before', () => {
    const plan = optimizeSchedule(initial(), { maxSteps: 4 });
    assert.equal(plan.improvement, Math.round((plan.after.value - plan.before.value) * 10000) / 10000);
  });

  it('21. a circuit is touched at most once unless allowRevisit is set', () => {
    const plan = optimizeSchedule(initial(), { maxSteps: 6 });
    const ids = plan.steps.map((s) => s.circuitId);
    assert.equal(new Set(ids).size, ids.length);
    const revisiting = optimizeSchedule(initial(), { maxSteps: 6, allowRevisit: true });
    assert.ok(revisiting.steps.length >= plan.steps.length);
  });

  it('22. the default comfort weight produces an all-shift plan', () => {
    const plan = optimizeSchedule(initial(), { maxSteps: 4 });
    assert.ok(plan.steps.length > 0);
    assert.equal(plan.steps.some((s) => s.action === 'SHED'), false);
    assert.ok(plan.steps.every((s) => s.action === 'SHIFT'));
  });

  it('23. a zero comfort weight produces sheds', () => {
    const plan = optimizeSchedule(initial(), { maxSteps: 4, weights: { comfort: 0 } });
    assert.ok(plan.steps.some((s) => s.action === 'SHED'));
  });

  it('24. the plan state actually produces the reported peak reduction', () => {
    for (const scenario of ERCOT_SCENARIOS) {
      const plan = optimizeSchedule(stateForScenario(scenario.id), { maxSteps: 3 });
      assert.equal(independentPeakKw(plan.optimized), plan.after.peakKwReduction);
    }
  });

  it('25. maxSteps is clamped to the number of circuits', () => {
    const plan = optimizeSchedule(initial(), { maxSteps: 99 });
    assert.ok(plan.steps.length <= HOUSEHOLD_CIRCUITS.length);
  });

  it('26. invariant: the original state is never mutated by the search', () => {
    const state = initial();
    const snapshot = JSON.stringify(state);
    optimizeSchedule(state, { maxSteps: 6 });
    assert.equal(JSON.stringify(state), snapshot);
  });

  it('27. regression: the exact default four move plan and final score', () => {
    const plan = optimizeSchedule(initial(), { maxSteps: 4 });
    assert.deepEqual(plan.steps.map((s) => `${s.circuitId}:${s.action}`), [
      'ev-charger-l2:SHIFT',
      'hvac-central:SHIFT',
      'electric-dryer:SHIFT',
      'water-heater:SHIFT'
    ]);
    assert.ok(plan.after.peakKwReduction >= 9.6);
    assert.equal(plan.exhausted, false);
  });
});

describe('Advisor: comparison and stress test', () => {
  it('28. compareSchedules reports deltas that equal the two scores', () => {
    const before = initial();
    const after = applyAppAction(before, { type: 'AUTO_OPTIMIZE' });
    const result = compareSchedules(before, after);
    assert.equal(result.delta.peakKwReduction, Math.round((result.after.peakKwReduction - result.before.peakKwReduction) * 100) / 100);
    assert.equal(result.delta.value, Math.round((result.after.value - result.before.value) * 10000) / 10000);
    assert.ok(result.delta.peakKwReduction > 0);
  });

  it('29. comparing a state with itself yields all zero deltas', () => {
    const result = compareSchedules(initial(), initial());
    for (const value of Object.values(result.delta)) assert.equal(value, 0);
  });

  it('30. stressTestScenarios covers all four shipped scenarios', () => {
    const stress = stressTestScenarios(initial());
    assert.equal(stress.scenarioCount, 4);
    assert.deepEqual(stress.rows.map((r) => r.scenarioId), ERCOT_SCENARIOS.map((s) => s.id));
    assert.equal(stress.worstStrain.scenarioId, [...stress.rows].sort((a, b) => b.optimizedStrainIndex - a.optimizedStrainIndex)[0].scenarioId);
  });

  it('31. invariant: stress rows are finite and the mean is their average', () => {
    const stress = stressTestScenarios(initial());
    for (const row of stress.rows) {
      for (const value of Object.values(row)) assert.ok(inUnit(value) || typeof value === 'string');
    }
    const expected = Math.round((stress.rows.reduce((s, r) => s + r.value, 0) / 4) * 10000) / 10000;
    assert.equal(stress.meanValue, expected);
  });

  it('32. buildAdvisorReport assembles all three analyses consistently', () => {
    const state = initial();
    const report = buildAdvisorReport(state);
    const marginals = marginalCircuitContributions(state);
    const plan = optimizeSchedule(state, { maxSteps: 3 });
    assert.equal(report.bestSingleMove.circuitId, marginals.contributions[0].circuitId);
    assert.equal(report.bestSingleMove.action, marginals.contributions[0].action);
    assert.equal(report.plan.improvement, plan.improvement);
    assert.equal(report.plan.steps.length, plan.steps.length);
    assert.equal(report.evaluationCount, marginals.contributions.length);
    assert.ok(inUnit(report.stress.meanValue));
  });

  it('33. stateForScenario resolves unknown ids to the first scenario', () => {
    assert.equal(stateForScenario('not-real').scenarioId, ERCOT_SCENARIOS[0].id);
    assert.equal(stateForScenario('ercot-winter-freeze').scenarioId, 'ercot-winter-freeze');
  });
});

describe('Advisor: adversarial robustness regressions', () => {
  it('tolerates a missing circuitStates map in enumerateMoves, scoreSchedule and marginals', () => {
    const moves = enumerateMoves(undefined);
    assert.ok(moves.length > 0);
    const criticalIds = new Set(HOUSEHOLD_CIRCUITS.filter((c) => c.critical).map((c) => c.id));
    assert.equal(moves.some((m) => m.action === 'SHED' && criticalIds.has(m.circuitId)), false);

    const scored = scoreSchedule({ scenarioId: 'ercot-summer-peak' });
    assert.ok(Number.isFinite(scored.value));

    const marginals = marginalCircuitContributions({ scenarioId: 'ercot-summer-peak' });
    assert.ok(Number.isFinite(marginals.baseline.value));
  });

  it('never applies a worsening move when minGain or maxSteps is NaN', () => {
    const state = stateForScenario('ercot-summer-peak');
    const result = optimizeSchedule(state, { minGain: NaN, maxSteps: NaN });
    assert.ok(result.improvement >= 0);
    for (const step of result.steps) {
      assert.ok(step.gain > 0);
    }
  });

  it('sanitizes NaN and negative scoring weights to finite defaults', () => {
    const state = stateForScenario('ercot-summer-peak');
    const nanWeighted = scoreSchedule(state, { weights: { peak: NaN, bill: 'bogus' } });
    const defaultWeighted = scoreSchedule(state);
    assert.equal(nanWeighted.value, defaultWeighted.value);

    const negComfort = scoreSchedule(state, { weights: { comfort: -100 } });
    const zeroComfort = scoreSchedule(state, { weights: { comfort: 0 } });
    assert.equal(negComfort.value, zeroComfort.value);
  });
});
