/**
 * GridPulse advisor: marginal circuit analysis, greedy schedule search, and
 * what-if comparison. Pure ES module, zero external runtime dependencies.
 *
 * The core simulator in gridpulse-engine.js already answers "what does this
 * breaker schedule cost?". This module answers "which single breaker or relay
 * change buys the most, and what is the best schedule under a budget of
 * changes?". Every candidate is scored by actually running the simulator, so
 * the advisor can never report a saving the engine does not produce.
 */

import {
  ERCOT_SCENARIOS,
  HOUSEHOLD_CIRCUITS,
  getScenarioById,
  simulateHouseholdGridPulse,
  createInitialAppState
} from './gridpulse-engine.js';

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function cloneStates(state) {
  const copy = {};
  for (const key of Object.keys(state || {})) {
    copy[key] = { enabled: state[key].enabled, shifted: state[key].shifted };
  }
  return copy;
}

/**
 * All legal one-step mutations of a circuit state map, in a stable order.
 * Shedding is a breaker throw, shifting is a relay arm, and reclosing is the
 * inverse of a shed. Critical circuits are never offered for shedding, and
 * non shiftable circuits are never offered for shifting.
 */
export function enumerateMoves(circuitStates, options = {}) {
  const protectCritical = options.protectCritical !== false;
  const states = circuitStates || {};
  const moves = [];
  for (const circuit of HOUSEHOLD_CIRCUITS) {
    const current = states[circuit.id] || { enabled: true, shifted: false };
    if (current.enabled) {
      if (!(protectCritical && circuit.critical === true)) {
        moves.push({
          circuitId: circuit.id,
          action: 'SHED',
          description: 'Open the ' + circuit.name + ' breaker',
          states: withState(states, circuit.id, { enabled: false, shifted: current.shifted })
        });
      }
    } else {
      moves.push({
        circuitId: circuit.id,
        action: 'RECLOSE',
        description: 'Reclose the ' + circuit.name + ' breaker',
        states: withState(states, circuit.id, { enabled: true, shifted: current.shifted })
      });
    }
    if (circuit.shiftable === true) {
      moves.push({
        circuitId: circuit.id,
        action: current.shifted ? 'UNSHIFT' : 'SHIFT',
        description: (current.shifted ? 'Disarm' : 'Arm') + ' the ' + circuit.name + ' relay',
        states: withState(states, circuit.id, { enabled: current.enabled, shifted: !current.shifted })
      });
    }
  }
  return moves;
}

function withState(states, circuitId, next) {
  const copy = cloneStates(states);
  copy[circuitId] = next;
  return copy;
}

/**
 * Score one schedule. The four objectives are all read straight from the
 * simulator: peak reduction, daily bill saving, daily carbon avoided and
 * battery endurance. The weighted objective is normalized so the advisor can
 * compare schedules across scenarios with different tariff spreads.
 */
export function scoreSchedule(state, options = {}) {
  const sim = simulateHouseholdGridPulse(state || {});
  const m = sim.metrics;
  const defaults = { peak: 0.45, bill: 0.25, carbon: 0.20, endurance: 0.10, comfort: 2.0 };
  const weights = {};
  for (const key of Object.keys(defaults)) {
    const raw = options.weights && Number(options.weights[key]);
    weights[key] = Number.isFinite(raw) ? Math.max(0, raw) : defaults[key];
  }
  // A shed circuit is a real loss of service, so it pays a comfort penalty
  // proportional to its nameplate rating. Without this the greedy search would
  // simply open every breaker, which is not an actionable household plan.
  let shedKw = 0;
  const states = (state && state.circuitStates) || {};
  for (const circuit of HOUSEHOLD_CIRCUITS) {
    const entry = states[circuit.id];
    if (entry && entry.enabled === false) shedKw += circuit.ratedKw;
  }
  const value =
    weights.peak * m.peakKwReduction +
    weights.bill * m.dailySavingsUsd * 2 +
    weights.carbon * m.dailyCarbonAvoidedKg +
    weights.endurance * Math.min(30, sim.outageEndurance.enduranceHoursDecimal) * 0.05 -
    weights.comfort * shedKw;
  return {
    value: roundTo(value, 4),
    peakKwReduction: m.peakKwReduction,
    dailySavingsUsd: m.dailySavingsUsd,
    dailyCarbonAvoidedKg: m.dailyCarbonAvoidedKg,
    enduranceHours: sim.outageEndurance.enduranceHoursDecimal,
    optimizedStrainIndex: m.optimizedStrainIndex,
    activeCount: m.activeCount,
    simulation: sim
  };
}

/**
 * The marginal value of every legal one-step change from a baseline. A
 * positive delta means the move improves the weighted objective. The result is
 * sorted by descending delta, ties by circuit id then action, so it is fully
 * deterministic.
 */
export function marginalCircuitContributions(state, options = {}) {
  const base = scoreSchedule(state, options);
  const rows = [];
  for (const move of enumerateMoves(state && state.circuitStates, options)) {
    const candidate = { ...state, circuitStates: move.states };
    const scored = scoreSchedule(candidate, options);
    rows.push({
      circuitId: move.circuitId,
      action: move.action,
      description: move.description,
      deltaValue: roundTo(scored.value - base.value, 4),
      deltaPeakKw: roundTo(scored.peakKwReduction - base.peakKwReduction, 2),
      deltaSavingsUsd: roundTo(scored.dailySavingsUsd - base.dailySavingsUsd, 2),
      deltaCarbonKg: roundTo(scored.dailyCarbonAvoidedKg - base.dailyCarbonAvoidedKg, 2),
      deltaEnduranceHours: roundTo(scored.enduranceHours - base.enduranceHours, 2),
      states: move.states
    });
  }
  rows.sort((a, b) => (b.deltaValue - a.deltaValue)
    || (a.circuitId < b.circuitId ? -1 : a.circuitId > b.circuitId ? 1 : 0)
    || (a.action < b.action ? -1 : 1));
  return { baseline: base, contributions: rows };
}

/**
 * Greedy hill climb over one-step moves. At each step the best strictly
 * improving move is applied, and a circuit may be changed at most once unless
 * allowRevisit is set. maxSteps caps the number of breaker or relay actions,
 * which is the budget a household would actually accept.
 *
 * The search is exhaustive at every step (all legal single moves are scored),
 * so the result is reproducible and independent of iteration order.
 */
export function optimizeSchedule(state, options = {}) {
  const rawSteps = Number(options.maxSteps ?? 3);
  const maxSteps = Number.isFinite(rawSteps) ? Math.max(0, Math.min(8, Math.floor(rawSteps))) : 3;
  const rawGain = Number(options.minGain ?? 0.0001);
  const minGain = Number.isFinite(rawGain) ? Math.max(0, rawGain) : 0.0001;
  const allowRevisit = options.allowRevisit === true;
  let current = { ...(state || {}), circuitStates: cloneStates(state && state.circuitStates) };
  let best = scoreSchedule(current, options);
  const steps = [];
  const touched = new Set();

  for (let step = 0; step < maxSteps; step += 1) {
    const { contributions } = marginalCircuitContributions(current, options);
    const candidate = contributions.find((row) => {
      if (row.deltaValue <= minGain) return false;
      if (!allowRevisit && touched.has(row.circuitId)) return false;
      return true;
    });
    if (!candidate) break;
    current = { ...current, circuitStates: candidate.states };
    const scored = scoreSchedule(current, options);
    steps.push({
      step: step + 1,
      circuitId: candidate.circuitId,
      action: candidate.action,
      description: candidate.description,
      gain: candidate.deltaValue,
      cumulativeValue: scored.value,
      cumulativePeakKwReduction: scored.peakKwReduction
    });
    touched.add(candidate.circuitId);
    best = scored;
  }

  return {
    original: state,
    optimized: current,
    before: scoreSchedule(state, options),
    after: best,
    steps,
    improvement: roundTo(best.value - scoreSchedule(state, options).value, 4),
    exhausted: steps.length < maxSteps
  };
}

/**
 * Compare two states objective by objective. The UI uses this to explain what
 * a single click changed rather than only showing the new absolute numbers.
 */
export function compareSchedules(beforeState, afterState, options = {}) {
  const before = scoreSchedule(beforeState, options);
  const after = scoreSchedule(afterState, options);
  const delta = (key) => roundTo(after[key] - before[key], 2);
  return {
    before,
    after,
    delta: {
      value: roundTo(after.value - before.value, 4),
      peakKwReduction: delta('peakKwReduction'),
      dailySavingsUsd: delta('dailySavingsUsd'),
      dailyCarbonAvoidedKg: delta('dailyCarbonAvoidedKg'),
      enduranceHours: delta('enduranceHours'),
      optimizedStrainIndex: delta('optimizedStrainIndex')
    }
  };
}

/**
 * Score every shipped scenario under the same circuit schedule and report the
 * worst case. This is a stress test, not a new simulation: it reuses the same
 * engine with a different scenario id each time.
 */
export function stressTestScenarios(state, options = {}) {
  const rows = ERCOT_SCENARIOS.map((scenario) => {
    const scenarioState = { ...state, scenarioId: scenario.id };
    const scored = scoreSchedule(scenarioState, options);
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      peakKwReduction: scored.peakKwReduction,
      dailySavingsUsd: scored.dailySavingsUsd,
      dailyCarbonAvoidedKg: scored.dailyCarbonAvoidedKg,
      enduranceHours: scored.enduranceHours,
      optimizedStrainIndex: scored.optimizedStrainIndex,
      value: scored.value
    };
  });
  const byPeak = rows.slice().sort((a, b) => b.optimizedStrainIndex - a.optimizedStrainIndex);
  const bySaving = rows.slice().sort((a, b) => b.dailySavingsUsd - a.dailySavingsUsd);
  return {
    rows,
    worstStrain: byPeak[0],
    bestSavings: bySaving[0],
    meanValue: roundTo(rows.reduce((sum, row) => sum + row.value, 0) / rows.length, 4),
    scenarioCount: rows.length
  };
}

/**
 * A compact, human readable recommendation card derived from the marginal
 * analysis. It reports the single best move and the best three move greedy
 * plan, with exact numbers from the simulator.
 */
export function buildAdvisorReport(state, options = {}) {
  const marginals = marginalCircuitContributions(state, options);
  const plan = optimizeSchedule(state, { ...options, maxSteps: 3 });
  const stress = stressTestScenarios(state, options);
  const top = marginals.contributions[0];
  return {
    bestSingleMove: top ? {
      circuitId: top.circuitId,
      action: top.action,
      description: top.description,
      deltaValue: top.deltaValue,
      deltaPeakKw: top.deltaPeakKw,
      deltaSavingsUsd: top.deltaSavingsUsd
    } : null,
    plan: {
      steps: plan.steps,
      improvement: plan.improvement,
      finalPeakKwReduction: plan.after.peakKwReduction,
      finalDailySavingsUsd: plan.after.dailySavingsUsd
    },
    stress: {
      worstStrain: stress.worstStrain,
      bestSavings: stress.bestSavings,
      meanValue: stress.meanValue
    },
    evaluationCount: marginals.contributions.length
  };
}

/** The default state with a scenario id applied, for callers and tests. */
export function stateForScenario(scenarioId) {
  const state = createInitialAppState();
  return { ...state, scenarioId: getScenarioById(scenarioId).id };
}
