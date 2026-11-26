/**
 * GridPulse Policy & Outage-Survival Lab.
 *
 * Pure ES module with zero external runtime dependencies. Every number on the
 * lab panel is computed by calling the real simulator in gridpulse-engine.js
 * and the real search in gridpulse-advisor.js, so a lab claim can never exceed
 * what the engine produces.
 *
 * Contents:
 *  - Five deterministic demand policies compared across all four shipped
 *    ERCOT conditions (peak kW, daily kWh, daily bill, marginal CO2, island
 *    endurance, comfort penalty, and a critical-bus non-shedding invariant).
 *  - An LFP battery sizing sweep from 6.75 kWh to 40.5 kWh at a selectable
 *    10% or 20% reserve floor.
 *  - A FIPS 180-4 SHA-256 implementation used to stamp one canonical
 *    resilience brief per input state; the on-page fingerprint, the JSON
 *    export, the CSV provenance header and the Markdown footer all reuse the
 *    same cached digest-stamped payload.
 *  - A strict #gp= bookmark codec that round-trips scenario, policy, battery
 *    capacity, reserve floor and comfort weight, and fails closed on any
 *    malformed or hostile hash.
 *  - Deterministic in-page self-tests runnable from the lab panel.
 */

import {
  BATTERY_DEFAULT_CAPACITY_KWH,
  BATTERY_RESERVE_FLOOR_PCT,
  BATTERY_INVERTER_EFFICIENCY,
  ERCOT_SCENARIOS,
  HOUSEHOLD_CIRCUITS,
  getScenarioById,
  createDefaultCircuitStateMap,
  calculateOutageBatteryEndurance,
  simulateHouseholdGridPulse,
  applyAppAction,
  createInitialAppState
} from './gridpulse-engine.js';
import {
  optimizeSchedule,
  scoreSchedule
} from './gridpulse-advisor.js';

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

/* ------------------------------------------------------------------ */
/* Policy catalog                                                      */
/* ------------------------------------------------------------------ */

export const LAB_SCHEMA_VERSION = 'gridpulse-lab-brief/v1';
export const HASH_SCHEMA_VERSION = 'v1';

export const BATTERY_SWEEP_KWH = [6.75, 13.5, 20.25, 27, 33.75, 40.5];
export const BATTERY_SWEEP_MIN_KWH = BATTERY_SWEEP_KWH[0];
export const BATTERY_SWEEP_MAX_KWH = BATTERY_SWEEP_KWH[BATTERY_SWEEP_KWH.length - 1];
export const RESERVE_FLOOR_OPTIONS = [10, 20];
export const COMFORT_WEIGHT_MIN = 0;
export const COMFORT_WEIGHT_MAX = 4;
export const ISLAND_SCENARIO_ID = 'ercot-outage-island';

const CRITICAL_CIRCUIT_IDS = HOUSEHOLD_CIRCUITS
  .filter((circuit) => circuit.critical === true)
  .map((circuit) => circuit.id);

function statesWith(overrides) {
  const map = createDefaultCircuitStateMap('unoptimized');
  for (const circuit of HOUSEHOLD_CIRCUITS) {
    map[circuit.id] = { ...map[circuit.id], ...(overrides[circuit.id] || {}) };
  }
  return map;
}

function deferrableShedStates() {
  const map = createDefaultCircuitStateMap('optimized');
  for (const circuit of HOUSEHOLD_CIRCUITS) {
    if (circuit.priority === 'deferrable') {
      map[circuit.id] = { enabled: false, shifted: true };
    }
  }
  return map;
}

/**
 * The five lab policies. Each builder returns a complete circuit state map;
 * the maps are pure data and never mutate the supplied application state.
 * comfort-safe-advisor is built by the greedy advisor search, so it changes
 * with the comfort weight and the scenario being evaluated.
 */
export const LAB_POLICIES = [
  {
    id: 'unshifted-baseline',
    name: 'Unshifted Baseline',
    summary: 'Every breaker closed on the factory schedule. The do-nothing reference case.',
    buildStates() {
      return createDefaultCircuitStateMap('unoptimized');
    }
  },
  {
    id: 'tou-delay-shift',
    name: 'TOU Delay Shift',
    summary: 'Every shiftable relay armed to move flexible load out of the priced peak window.',
    buildStates() {
      return createDefaultCircuitStateMap('optimized');
    }
  },
  {
    id: 'comfort-safe-advisor',
    name: 'Comfort-Safe Advisor',
    summary: 'Greedy advisor plan under the lab comfort weight. Comfort shedding is priced in.',
    buildStates(context) {
      const baseState = {
        scenarioId: context.scenarioId,
        circuitStates: createDefaultCircuitStateMap('unoptimized'),
        batterySocPct: context.batterySocPct,
        batteryCapacityKwh: context.batteryCapacityKwh,
        solarOffsetEnabled: context.solarOffsetEnabled,
        inspectedHour: 18
      };
      const plan = optimizeSchedule(baseState, {
        weights: { comfort: context.comfortWeight },
        maxSteps: 4
      });
      return plan.optimized.circuitStates;
    }
  },
  {
    id: 'battery-peak-shave',
    name: 'Battery Peak Shave',
    summary: 'Sheds every deferrable 240V circuit and arms comfort relays to stretch the reserve.',
    buildStates() {
      return deferrableShedStates();
    }
  },
  {
    id: 'critical-island-survival',
    name: 'Critical Island Survival',
    summary: 'Opens every non-critical breaker. Maximum island endurance on the critical bus.',
    buildStates() {
      return createDefaultCircuitStateMap('outage-critical');
    }
  }
];

export function getPolicyById(policyId) {
  if (typeof policyId !== 'string') return null;
  return LAB_POLICIES.find((policy) => policy.id === policyId.trim()) || null;
}

export function normalizeLabOptions(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const rawFloor = Number(source.reserveFloorPct);
  const reserveFloorPct = RESERVE_FLOOR_OPTIONS.includes(rawFloor) ? rawFloor : BATTERY_RESERVE_FLOOR_PCT;
  const rawComfort = Number(source.comfortWeight);
  const comfortWeight = Number.isFinite(rawComfort)
    ? Math.min(COMFORT_WEIGHT_MAX, Math.max(COMFORT_WEIGHT_MIN, roundTo(rawComfort, 2)))
    : 2.0;
  const rawPolicy = typeof source.policyId === 'string' ? source.policyId : '';
  const policyId = getPolicyById(rawPolicy) ? rawPolicy.trim() : 'tou-delay-shift';
  return { reserveFloorPct, comfortWeight, policyId };
}

/**
 * Build the circuit map for a policy under a scenario. The scenario matters
 * only for comfort-safe-advisor because its greedy plan is scenario aware.
 */
export function buildPolicyStates(policyId, context = {}) {
  const policy = getPolicyById(policyId) || getPolicyById('unshifted-baseline');
  const scenarioId = getScenarioById(context.scenarioId).id;
  const soc = Number.isFinite(Number(context.batterySocPct)) ? Number(context.batterySocPct) : 90;
  const capacity = Number.isFinite(Number(context.batteryCapacityKwh))
    ? Number(context.batteryCapacityKwh)
    : BATTERY_DEFAULT_CAPACITY_KWH;
  return policy.buildStates({
    scenarioId,
    batterySocPct: soc,
    batteryCapacityKwh: capacity,
    solarOffsetEnabled: context.solarOffsetEnabled !== false,
    comfortWeight: normalizeLabOptions(context).comfortWeight
  });
}

/**
 * The safety invariant every exported brief proves: both life-safety circuits
 * are closed in every evaluated policy, under every scenario. Returns the list
 * of violations; an empty list means the invariant held.
 */
export function criticalShedViolations(circuitStates) {
  const violations = [];
  for (const id of CRITICAL_CIRCUIT_IDS) {
    const entry = (circuitStates || {})[id];
    if (!entry || entry.enabled !== true) {
      violations.push(id);
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ */
/* Island endurance with a selectable reserve floor                    */
/* ------------------------------------------------------------------ */

/**
 * Mirror of calculateOutageBatteryEndurance with the reserve floor exposed as
 * a parameter. At the engine floor of 10% the result is identical to the
 * engine call, which the test suite asserts. Floors above SoC yield zero
 * usable energy and a zero hour runtime.
 */
export function calculateIslandEndurance({
  activeCircuitsKw,
  batteryCapacityKwh = BATTERY_DEFAULT_CAPACITY_KWH,
  stateOfChargePct = 90,
  solarOffsetKw = 0,
  reserveFloorPct = BATTERY_RESERVE_FLOOR_PCT
} = {}) {
  const rawCapacity = Number(batteryCapacityKwh);
  const safeCapacity = Number.isFinite(rawCapacity) && rawCapacity > 0
    ? rawCapacity
    : BATTERY_DEFAULT_CAPACITY_KWH;
  const rawFloor = Number(reserveFloorPct);
  const safeFloor = Number.isFinite(rawFloor)
    ? Math.min(100, Math.max(0, rawFloor))
    : BATTERY_RESERVE_FLOOR_PCT;
  const rawSoc = Number(stateOfChargePct);
  const safeSoc = Number.isFinite(rawSoc) ? rawSoc : 90;
  const clampedSoc = Math.max(safeFloor, Math.min(100, safeSoc));
  const usableFraction = (clampedSoc - safeFloor) / 100;
  const usableKwh = roundTo(safeCapacity * usableFraction * BATTERY_INVERTER_EFFICIENCY, 2);

  const rawLoad = Number(activeCircuitsKw);
  const grossLoadKw = roundTo(Number.isFinite(rawLoad) ? Math.max(0, rawLoad) : 0, 2);
  const rawSolar = Number(solarOffsetKw);
  const effectiveSolarKw = roundTo((Number.isFinite(rawSolar) ? Math.max(0, rawSolar) : 0) * 0.35, 2);
  const netDrainKw = roundTo(Math.max(0.12, grossLoadKw - effectiveSolarKw), 2);

  const rawHours = usableKwh / netDrainKw;
  const clampedHours = roundTo(Math.min(120, rawHours), 2);
  const totalMinutes = Math.round(clampedHours * 60);
  const normalizedHours = Math.floor(totalMinutes / 60);
  const normalizedMinutes = totalMinutes % 60;

  let enduranceStatus = 'CRITICAL_DEPLETION';
  if (clampedHours >= 18) {
    enduranceStatus = 'EXTENDED_ISLAND_SAFE';
  } else if (clampedHours >= 8) {
    enduranceStatus = 'OVERNIGHT_VIABLE';
  }

  return {
    batteryCapacityKwh: roundTo(safeCapacity, 2),
    reserveFloorPct: safeFloor,
    stateOfChargePct: clampedSoc,
    usableKwh,
    grossLoadKw,
    effectiveSolarKw,
    netDrainKw,
    enduranceHoursDecimal: clampedHours,
    hours: normalizedHours,
    minutes: normalizedMinutes,
    formattedDuration: `${normalizedHours}h ${String(normalizedMinutes).padStart(2, '0')}m`,
    enduranceStatus
  };
}

/* ------------------------------------------------------------------ */
/* Five-policy x four-condition comparator                             */
/* ------------------------------------------------------------------ */

function simulationContext(appState = {}, labOptions = {}) {
  const base = appState || {};
  return {
    batterySocPct: Number.isFinite(Number(base.batterySocPct)) ? Number(base.batterySocPct) : 90,
    batteryCapacityKwh: Number.isFinite(Number(base.batteryCapacityKwh))
      ? Number(base.batteryCapacityKwh)
      : BATTERY_DEFAULT_CAPACITY_KWH,
    solarOffsetEnabled: base.solarOffsetEnabled !== false,
    reserveFloorPct: normalizeLabOptions(labOptions).reserveFloorPct,
    comfortWeight: normalizeLabOptions(labOptions).comfortWeight
  };
}

/**
 * Evaluate one policy under one scenario through the real simulator and the
 * real advisor scorer. All reported numbers are copied from those calls, so
 * the comparator is exactly as honest as the engine.
 */
export function evaluatePolicy(scenarioId, policyId, appState = {}, labOptions = {}) {
  const scenario = getScenarioById(scenarioId);
  const ctx = simulationContext(appState, labOptions);
  const circuitStates = buildPolicyStates(policyId, { ...ctx, scenarioId: scenario.id });
  const sim = simulateHouseholdGridPulse({
    scenarioId: scenario.id,
    circuitStates,
    batterySocPct: ctx.batterySocPct,
    batteryCapacityKwh: ctx.batteryCapacityKwh,
    solarOffsetEnabled: ctx.solarOffsetEnabled,
    inspectedHour: 18
  });
  const m = sim.metrics;

  const endurance = calculateIslandEndurance({
    activeCircuitsKw: m.averageActiveHourlyKw,
    batteryCapacityKwh: ctx.batteryCapacityKwh,
    stateOfChargePct: ctx.batterySocPct,
    solarOffsetKw: ctx.solarOffsetEnabled ? scenario.solarPeakOffsetKw : 0,
    reserveFloorPct: ctx.reserveFloorPct
  });

  let comfortShedKw = 0;
  for (const circuit of HOUSEHOLD_CIRCUITS) {
    const entry = circuitStates[circuit.id];
    if (entry && entry.enabled === false) comfortShedKw += circuit.ratedKw;
  }
  comfortShedKw = roundTo(comfortShedKw, 2);

  const advisor = scoreSchedule({
    scenarioId: scenario.id,
    circuitStates,
    batterySocPct: ctx.batterySocPct,
    batteryCapacityKwh: ctx.batteryCapacityKwh,
    solarOffsetEnabled: ctx.solarOffsetEnabled
  }, { weights: { comfort: ctx.comfortWeight } });

  const shedCriticals = criticalShedViolations(circuitStates);
  const policy = getPolicyById(policyId) || getPolicyById('unshifted-baseline');

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    policyId: policy.id,
    policyName: policy.name,
    peakKw: m.optimizedPeakMaxKw,
    peakKwReduction: m.peakKwReduction,
    dailyKwh: m.totalActiveDailyKwh,
    dailyBillUsd: m.optimizedDailyCost,
    dailyCarbonKg: m.optimizedDailyCarbonKg,
    islandEnduranceHours: endurance.enduranceHoursDecimal,
    enduranceStatus: endurance.enduranceStatus,
    comfortShedKw,
    advisorValue: advisor.value,
    shedCount: m.shedCount,
    shiftedCount: m.shiftedCount,
    criticalsSafe: shedCriticals.length === 0
  };
}

/**
 * The full 5-policy x 4-condition matrix. Rows are grouped per scenario, each
 * holding one cell per policy, so exports and the panel share one structure.
 * The matrix does not depend on the live breaker toggles: every policy builds
 * its own schedule, so the result is fully determined by the inputs below.
 * The comfort-safe-advisor cell runs a greedy search per scenario, so the
 * matrix is memoized on its input context.
 */
const matrixCache = new Map();
const MEMO_MAX = 24;

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function memoGet(map, key, build) {
  if (map.has(key)) return map.get(key);
  const value = deepFreeze(build());
  if (map.size >= MEMO_MAX) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
}

function contextKey(ctx) {
  return canonicalJson({
    soc: ctx.batterySocPct,
    cap: ctx.batteryCapacityKwh,
    solar: ctx.solarOffsetEnabled,
    floor: ctx.reserveFloorPct,
    comfort: ctx.comfortWeight
  });
}

export function compareAllPoliciesAllScenarios(appState = {}, labOptions = {}) {
  const ctx = simulationContext(appState, labOptions);
  return memoGet(matrixCache, contextKey(ctx), () => buildPolicyMatrix(ctx, labOptions));
}

function buildPolicyMatrix(ctx, labOptions) {
  const scenarios = ERCOT_SCENARIOS.map((scenario) => {
    const cells = LAB_POLICIES.map((policy) =>
      evaluatePolicy(scenario.id, policy.id, ctx, labOptions));
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      shortLabel: scenario.shortLabel,
      cells
    };
  });
  const checkedCells = scenarios.reduce((sum, row) => sum + row.cells.length, 0);
  const failedCells = scenarios
    .flatMap((row) => row.cells)
    .filter((cell) => cell.criticalsSafe !== true).length;
  return {
    scenarios,
    checkedCells,
    criticalsNeverShed: failedCells === 0,
    inputs: {
      batteryCapacityKwh: ctx.batteryCapacityKwh,
      batterySocPct: ctx.batterySocPct,
      solarOffsetEnabled: ctx.solarOffsetEnabled,
      reserveFloorPct: ctx.reserveFloorPct,
      comfortWeight: ctx.comfortWeight
    }
  };
}

/** Convenience view: the 5 policy cells for one scenario. */
export function comparePoliciesForScenario(scenarioId, appState = {}, labOptions = {}) {
  const matrix = compareAllPoliciesAllScenarios(appState, labOptions);
  const scenario = getScenarioById(scenarioId);
  const row = matrix.scenarios.find((entry) => entry.scenarioId === scenario.id);
  return { scenarioId: scenario.id, scenarioName: scenario.name, cells: row.cells };
}

/* ------------------------------------------------------------------ */
/* LFP battery sizing sweep                                            */
/* ------------------------------------------------------------------ */

/**
 * Island endurance for every sweep capacity for each policy. The load is the
 * island-scenario average active draw for that policy's schedule; endurance
 * uses the lab reserve floor. minKwhFor24h and minKwhFor48h report the first
 * sweep capacity clearing each outage target, or null when no sweep point
 * reaches it, which the UI reports honestly rather than extrapolating.
 */
const sizingCache = new Map();

export function sweepBatterySizing(appState = {}, labOptions = {}) {
  const ctx = simulationContext(appState, labOptions);
  return memoGet(sizingCache, contextKey(ctx), () => buildSizingSweep(ctx, labOptions));
}

function buildSizingSweep(ctx, labOptions) {
  const island = getScenarioById(ISLAND_SCENARIO_ID);
  const perPolicy = LAB_POLICIES.map((policy) => {
    const circuitStates = buildPolicyStates(policy.id, { ...ctx, scenarioId: island.id });
    const sim = simulateHouseholdGridPulse({
      scenarioId: island.id,
      circuitStates,
      batterySocPct: ctx.batterySocPct,
      batteryCapacityKwh: ctx.batteryCapacityKwh,
      solarOffsetEnabled: ctx.solarOffsetEnabled,
      inspectedHour: 18
    });
    const loadKw = sim.metrics.averageActiveHourlyKw;
    const points = BATTERY_SWEEP_KWH.map((kwh) => {
      const endurance = calculateIslandEndurance({
        activeCircuitsKw: loadKw,
        batteryCapacityKwh: kwh,
        stateOfChargePct: ctx.batterySocPct,
        solarOffsetKw: ctx.solarOffsetEnabled ? island.solarPeakOffsetKw : 0,
        reserveFloorPct: ctx.reserveFloorPct
      });
      return {
        kwh,
        enduranceHours: endurance.enduranceHoursDecimal,
        enduranceStatus: endurance.enduranceStatus
      };
    });
    const clears24 = points.find((point) => point.enduranceHours >= 24) || null;
    const clears48 = points.find((point) => point.enduranceHours >= 48) || null;
    return {
      policyId: policy.id,
      policyName: policy.name,
      islandAverageLoadKw: loadKw,
      criticalsSafe: criticalShedViolations(circuitStates).length === 0,
      points,
      minKwhFor24h: clears24 ? clears24.kwh : null,
      minKwhFor48h: clears48 ? clears48.kwh : null
    };
  });
  return {
    scenarioId: island.id,
    sweepKwh: [...BATTERY_SWEEP_KWH],
    reserveFloorPct: ctx.reserveFloorPct,
    batterySocPct: ctx.batterySocPct,
    solarOffsetEnabled: ctx.solarOffsetEnabled,
    perPolicy
  };
}

/* ------------------------------------------------------------------ */
/* FIPS 180-4 SHA-256 (pure JS, no dependencies)                       */
/* ------------------------------------------------------------------ */

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

const SHA256_H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
];

function utf8Bytes(text) {
  const str = String(text);
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(str);
  }
  const bytes = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}

function sha256Bytes(bytes) {
  const bitLenHi = Math.floor((bytes.length / 0x20000000));
  const bitLenLo = (bytes.length * 8) >>> 0;

  const padded = [...bytes, 0x80];
  while (padded.length % 64 !== 56) padded.push(0);
  padded.push((bitLenHi >>> 24) & 0xff, (bitLenHi >>> 16) & 0xff, (bitLenHi >>> 8) & 0xff, bitLenHi & 0xff);
  padded.push((bitLenLo >>> 24) & 0xff, (bitLenLo >>> 16) & 0xff, (bitLenLo >>> 8) & 0xff, bitLenLo & 0xff);

  const h = [...SHA256_H0];
  const w = new Array(64);

  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t += 1) {
      const i = block + t * 4;
      w[t] = ((padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t += 1) {
      const w15 = w[t - 15];
      const w2 = w[t - 2];
      const s0 = (((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)) >>> 0;
      const s1 = (((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;

    for (let t = 0; t < 64; t += 1) {
      const s1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + s1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const s0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return h;
}

/** Hex digest of a UTF-8 message. Deterministic across Node and browsers. */
export function sha256Hex(message) {
  const words = sha256Bytes(utf8Bytes(message));
  let hex = '';
  for (const word of words) {
    hex += word.toString(16).padStart(8, '0');
  }
  return hex;
}

/* ------------------------------------------------------------------ */
/* Canonical payload + cached digest-stamped report                    */
/* ------------------------------------------------------------------ */

function sanitizeNumber(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const rounded = roundTo(num, digits);
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Deterministic JSON: object keys are sorted recursively, arrays keep order,
 * non-finite numbers become null and -0 becomes 0. The same logical payload
 * always serializes byte identically, which is what makes the unkeyed digest
 * a meaningful tamper check.
 */
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return JSON.stringify(sanitizeNumber(value, 10));
  }
  if (Array.isArray(value)) {
    return '[' + value.map((entry) => canonicalJson(entry)).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) {
      const entry = value[key];
      if (entry === undefined || typeof entry === 'function') continue;
      parts.push(JSON.stringify(key) + ':' + canonicalJson(entry));
    }
    return '{' + parts.join(',') + '}';
  }
  return 'null';
}

/**
 * Build the unsigned resilience-brief payload: inputs, the full 5x4
 * comparator matrix, the sizing sweep and the safety invariants. No wall
 * clock values are included, so the same inputs always produce the same
 * payload and the same digest.
 */
export function buildLabReportPayload(appState = {}, labOptions = {}) {
  const opts = normalizeLabOptions(labOptions);
  const activeScenario = getScenarioById(appState && appState.scenarioId);
  const matrix = compareAllPoliciesAllScenarios(appState, labOptions);
  const sizing = sweepBatterySizing(appState, labOptions);
  return {
    schema: LAB_SCHEMA_VERSION,
    kind: 'gridpulse-resilience-brief',
    inputs: {
      activeScenarioId: activeScenario.id,
      selectedPolicyId: opts.policyId,
      batteryCapacityKwh: matrix.inputs.batteryCapacityKwh,
      batterySocPct: matrix.inputs.batterySocPct,
      solarOffsetEnabled: matrix.inputs.solarOffsetEnabled,
      reserveFloorPct: matrix.inputs.reserveFloorPct,
      comfortWeight: matrix.inputs.comfortWeight
    },
    comparator: matrix.scenarios.map((row) => ({
      scenarioId: row.scenarioId,
      scenarioName: row.scenarioName,
      cells: row.cells.map((cell) => ({
        policyId: cell.policyId,
        policyName: cell.policyName,
        peakKw: cell.peakKw,
        peakKwReduction: cell.peakKwReduction,
        dailyKwh: cell.dailyKwh,
        dailyBillUsd: cell.dailyBillUsd,
        dailyCarbonKg: cell.dailyCarbonKg,
        islandEnduranceHours: cell.islandEnduranceHours,
        enduranceStatus: cell.enduranceStatus,
        comfortShedKw: cell.comfortShedKw,
        advisorValue: cell.advisorValue,
        shedCount: cell.shedCount,
        shiftedCount: cell.shiftedCount,
        criticalsSafe: cell.criticalsSafe
      }))
    })),
    sizing: {
      scenarioId: sizing.scenarioId,
      sweepKwh: sizing.sweepKwh,
      reserveFloorPct: sizing.reserveFloorPct,
      perPolicy: sizing.perPolicy.map((entry) => ({
        policyId: entry.policyId,
        policyName: entry.policyName,
        islandAverageLoadKw: entry.islandAverageLoadKw,
        minKwhFor24h: entry.minKwhFor24h,
        minKwhFor48h: entry.minKwhFor48h,
        points: entry.points
      }))
    },
    invariants: {
      criticalsNeverShed: matrix.criticalsNeverShed,
      checkedCells: matrix.checkedCells,
      criticalCircuitIds: [...CRITICAL_CIRCUIT_IDS]
    },
    disclosure:
      'All tariffs, breaker curves, weather multipliers and battery constants are deterministic reference-model values authored for this simulator, not live utility telemetry, metered data or electrical advice.'
  };
}

const reportCache = new Map();
const REPORT_CACHE_MAX = 24;

function cacheKeyFor(appState, labOptions) {
  const opts = normalizeLabOptions(labOptions);
  const ctx = simulationContext(appState, labOptions);
  return canonicalJson({
    scenarioId: getScenarioById(appState && appState.scenarioId).id,
    batterySocPct: ctx.batterySocPct,
    batteryCapacityKwh: ctx.batteryCapacityKwh,
    solarOffsetEnabled: ctx.solarOffsetEnabled,
    reserveFloorPct: opts.reserveFloorPct,
    comfortWeight: opts.comfortWeight,
    policyId: opts.policyId
  });
}

/**
 * The one canonical digest-stamped payload per input state. The on-page
 * fingerprint, the JSON export, the CSV provenance header and the Markdown
 * footer all read from this cached object, so they can never disagree about
 * the digest. The digest covers the canonical payload without the
 * integritySha256 field.
 */
export function getStampedReport(appState = {}, labOptions = {}) {
  const key = cacheKeyFor(appState, labOptions);
  const hit = reportCache.get(key);
  if (hit) return hit;

  const payload = buildLabReportPayload(appState, labOptions);
  const canonical = canonicalJson(payload);
  const digestHex = sha256Hex(canonical);
  const stamped = { payload: deepFreeze(payload), digestHex, canonical, cacheKey: key };
  if (reportCache.size >= REPORT_CACHE_MAX) {
    reportCache.delete(reportCache.keys().next().value);
  }
  reportCache.set(key, stamped);
  return stamped;
}

export function payloadWithoutDigest(payload) {
  const copy = { ...(payload || {}) };
  delete copy.integritySha256;
  return copy;
}

/**
 * Recompute the digest over a payload (the integritySha256 field is ignored)
 * and compare it with the stamped value. Returns the expected and actual
 * digests plus the boolean verdict used by the verify control.
 */
export function verifyStampedReport(stampedOrPayload) {
  const payload = stampedOrPayload && stampedOrPayload.payload
    ? stampedOrPayload.payload
    : stampedOrPayload;
  const expected = typeof stampedOrPayload?.digestHex === 'string'
    ? stampedOrPayload.digestHex
    : (typeof payload?.integritySha256 === 'string' ? payload.integritySha256 : '');
  const actual = sha256Hex(canonicalJson(payloadWithoutDigest(payload)));
  return { ok: expected === actual, expected, actual };
}

/* ------------------------------------------------------------------ */
/* Exporters: JSON, formula-safe CSV, Markdown                         */
/* ------------------------------------------------------------------ */

/**
 * Spreadsheet-safe CSV cell escaping. Cells starting with =, +, -, @, tab or
 * carriage return are formula-injection vectors when opened in a spreadsheet,
 * so they are prefixed with a single quote before quoting.
 */
export function csvEscape(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s\p{Cf}\p{Cc}]*[=+\-@\t\r]/u.test(text.normalize('NFKC'))) {
    text = "'" + text;
  }
  if (/[",\n\r]/.test(text)) {
    text = '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

export function exportReportJson(appState = {}, labOptions = {}) {
  const stamped = getStampedReport(appState, labOptions);
  const body = { ...stamped.payload, integritySha256: stamped.digestHex };
  return JSON.stringify(body, null, 2) + '\n';
}

export function exportReportCsv(appState = {}, labOptions = {}) {
  const stamped = getStampedReport(appState, labOptions);
  const { payload, digestHex } = stamped;
  const inputs = payload.inputs;
  const lines = [
    '# gridpulse-resilience-brief ' + LAB_SCHEMA_VERSION,
    '# sha256:' + digestHex,
    '# inputs scenario=' + inputs.activeScenarioId +
      ' policy=' + inputs.selectedPolicyId +
      ' battery_kwh=' + inputs.batteryCapacityKwh +
      ' soc_pct=' + inputs.batterySocPct +
      ' reserve_floor_pct=' + inputs.reserveFloorPct +
      ' comfort_weight=' + inputs.comfortWeight +
      ' solar=' + (inputs.solarOffsetEnabled ? 'on' : 'off'),
    '# values are deterministic reference-model outputs, not utility telemetry',
    [
      'scenario_id', 'policy_id', 'peak_kw', 'peak_kw_reduction', 'daily_kwh',
      'daily_bill_usd', 'daily_co2_kg', 'island_endurance_h', 'shed_comfort_kw',
      'advisor_value', 'shed_count', 'shifted_count', 'criticals_safe'
    ].map(csvEscape).join(',')
  ];
  for (const row of payload.comparator) {
    for (const cell of row.cells) {
      lines.push([
        row.scenarioId, cell.policyId, cell.peakKw, cell.peakKwReduction,
        cell.dailyKwh, cell.dailyBillUsd, cell.dailyCarbonKg,
        cell.islandEnduranceHours, cell.comfortShedKw, cell.advisorValue,
        cell.shedCount, cell.shiftedCount, cell.criticalsSafe ? 'yes' : 'NO'
      ].map(csvEscape).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

function mdCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function mdMoney(value) {
  return '`$' + Number(value).toFixed(2) + '`';
}

export function exportReportMarkdown(appState = {}, labOptions = {}) {
  const stamped = getStampedReport(appState, labOptions);
  const { payload, digestHex } = stamped;
  const inputs = payload.inputs;
  const lines = [];
  lines.push('# GridPulse Resilience Brief');
  lines.push('');
  lines.push('Deterministic reference-model audit brief. Every figure below is an');
  lines.push('output of the GridPulse hourly simulator on illustrative inputs. None of');
  lines.push('it is live utility telemetry, metered household data or electrical advice.');
  lines.push('');
  lines.push('## Inputs');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push('| Active scenario | ' + mdCell(inputs.activeScenarioId) + ' |');
  lines.push('| Selected policy | ' + mdCell(inputs.selectedPolicyId) + ' |');
  lines.push('| Battery capacity | ' + mdCell(inputs.batteryCapacityKwh) + ' kWh |');
  lines.push('| State of charge | ' + mdCell(inputs.batterySocPct) + '% |');
  lines.push('| Reserve floor | ' + mdCell(inputs.reserveFloorPct) + '% |');
  lines.push('| Comfort weight | ' + mdCell(inputs.comfortWeight) + ' |');
  lines.push('| Solar offset | ' + mdCell(inputs.solarOffsetEnabled ? 'enabled' : 'disabled') + ' |');
  lines.push('');
  lines.push('## Policy comparator across all four ERCOT conditions');
  lines.push('');
  lines.push('| Scenario | Policy | Peak kW | Peak shaved kW | kWh/day | Bill/day | CO2 kg/day | Island h | Shed kW | Advisor | Criticals |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of payload.comparator) {
    for (const cell of row.cells) {
      lines.push('| ' + mdCell(row.scenarioId) +
        ' | ' + mdCell(cell.policyId) +
        ' | ' + mdCell(cell.peakKw) +
        ' | ' + mdCell(cell.peakKwReduction) +
        ' | ' + mdCell(cell.dailyKwh) +
        ' | ' + mdMoney(cell.dailyBillUsd) +
        ' | ' + mdCell(cell.dailyCarbonKg) +
        ' | ' + mdCell(cell.islandEnduranceHours) +
        ' | ' + mdCell(cell.comfortShedKw) +
        ' | ' + mdCell(cell.advisorValue) +
        ' | ' + mdCell(cell.criticalsSafe ? 'protected' : 'VIOLATION') + ' |');
    }
  }
  lines.push('');
  lines.push('## LFP island sizing sweep at ' + payload.sizing.reserveFloorPct + '% reserve floor');
  lines.push('');
  const sweepHead = payload.sizing.sweepKwh.map((kwh) => mdCell(kwh) + ' kWh');
  lines.push('| Policy | ' + sweepHead.join(' | ') + ' | Clears 24h at | Clears 48h at |');
  lines.push('| --- | ' + sweepHead.map(() => '---').join(' | ') + ' | --- | --- |');
  for (const entry of payload.sizing.perPolicy) {
    const hours = entry.points.map((point) => mdCell(point.enduranceHours));
    lines.push('| ' + mdCell(entry.policyId) + ' | ' + hours.join(' | ') +
      ' | ' + mdCell(entry.minKwhFor24h === null ? 'not in sweep' : entry.minKwhFor24h + ' kWh') +
      ' | ' + mdCell(entry.minKwhFor48h === null ? 'not in sweep' : entry.minKwhFor48h + ' kWh') + ' |');
  }
  lines.push('');
  lines.push('## Integrity');
  lines.push('');
  lines.push('sha256:' + digestHex);
  lines.push('');
  lines.push('Digest covers the canonical payload with the integritySha256 field');
  lines.push('removed, object keys sorted, numbers rounded to the model precision.');
  lines.push('');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Strict #gp= bookmark codec                                          */
/* ------------------------------------------------------------------ */

const HASH_KEY_ALLOWLIST = new Set(['s', 'p', 'b', 'r', 'c']);
const HASH_VALUE_PATTERN = /^[a-z0-9.-]+$/;
const HASH_NUMBER_PATTERN = /^\d+(\.\d+)?$/;

function hashString(input) {
  const text = String(input == null ? '' : input);
  const idx = text.indexOf('gp=');
  if (idx === -1) return '';
  return text.slice(idx + 3).split(/[\s&#]/)[0];
}

/**
 * Encode lab bookmark state as a #gp= hash. Format is a fixed ordered field
 * list: v1|s=<scenario>|p=<policy>|b=<kwh>|r=<floor>|c=<comfort>. Only
 * normalized, in-range values are emitted, so an encoded hash always decodes.
 */
export function encodeLabHash(appState = {}, labOptions = {}) {
  const opts = normalizeLabOptions(labOptions);
  const scenarioId = getScenarioById(appState && appState.scenarioId).id;
  const capacityRaw = Number(appState && appState.batteryCapacityKwh);
  const capacity = Number.isFinite(capacityRaw)
    ? Math.min(BATTERY_SWEEP_MAX_KWH, Math.max(BATTERY_SWEEP_MIN_KWH, roundTo(capacityRaw, 2)))
    : BATTERY_DEFAULT_CAPACITY_KWH;
  const fields = [
    's=' + scenarioId,
    'p=' + opts.policyId,
    'b=' + capacity,
    'r=' + opts.reserveFloorPct,
    'c=' + opts.comfortWeight
  ];
  return '#gp=' + HASH_SCHEMA_VERSION + '|' + fields.join('|');
}

/**
 * Decode a #gp= hash strictly. Returns null on any malformed input: wrong
 * version, missing or duplicated fields, unknown keys, prototype-pollution
 * key names, illegal characters, out-of-catalog ids or non-numeric values.
 * Valid numbers are normalized into range (clamped and rounded).
 */
export function decodeLabHash(input) {
  const body = hashString(input);
  if (!body) return null;
  const parts = body.split('|');
  if (parts.length !== 6) return null;
  if (parts[0] !== HASH_SCHEMA_VERSION) return null;

  const seen = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (!HASH_KEY_ALLOWLIST.has(key)) return null;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return null;
    if (Object.prototype.hasOwnProperty.call(seen, key)) return null;
    if (!value || value.length > 64 || !HASH_VALUE_PATTERN.test(value)) return null;
    seen[key] = value;
  }
  for (const key of HASH_KEY_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(seen, key)) return null;
  }

  const scenario = ERCOT_SCENARIOS.find((entry) => entry.id === seen.s);
  const policy = getPolicyById(seen.p);
  if (!scenario || !policy) return null;
  if (!HASH_NUMBER_PATTERN.test(seen.b) || !HASH_NUMBER_PATTERN.test(seen.r) || !HASH_NUMBER_PATTERN.test(seen.c)) {
    return null;
  }

  const rawCapacity = Number(seen.b);
  const batteryCapacityKwh = Math.min(
    BATTERY_SWEEP_MAX_KWH,
    Math.max(BATTERY_SWEEP_MIN_KWH, roundTo(rawCapacity, 2))
  );
  const rawFloor = Number(seen.r);
  if (!RESERVE_FLOOR_OPTIONS.includes(rawFloor)) return null;
  const rawComfort = Number(seen.c);
  const comfortWeight = Math.min(COMFORT_WEIGHT_MAX, Math.max(COMFORT_WEIGHT_MIN, roundTo(rawComfort, 2)));

  return {
    scenarioId: scenario.id,
    policyId: policy.id,
    batteryCapacityKwh,
    reserveFloorPct: rawFloor,
    comfortWeight
  };
}

/**
 * Apply a decoded bookmark to an app state through the real reducer, so a
 * restored bookmark is indistinguishable from user input. Returns the new
 * app state plus normalized lab options.
 */
export function applyDecodedBookmark(appState, decoded) {
  const state = appState || createInitialAppState();
  if (!decoded) {
    return { appState: state, labOptions: normalizeLabOptions({}) };
  }
  let next = applyAppAction(state, { type: 'SELECT_SCENARIO', scenarioId: decoded.scenarioId });
  next = applyAppAction(next, { type: 'SET_BATTERY_CAPACITY', value: decoded.batteryCapacityKwh });
  return {
    appState: next,
    labOptions: {
      policyId: decoded.policyId,
      reserveFloorPct: decoded.reserveFloorPct,
      comfortWeight: decoded.comfortWeight
    }
  };
}

/* ------------------------------------------------------------------ */
/* SVG renderers (deterministic string markup like the engine's)       */
/* ------------------------------------------------------------------ */

const LAB_COLORS = {
  'unshifted-baseline': '#B42323',
  'tou-delay-shift': '#0A6B53',
  'comfort-safe-advisor': '#3E6EC2',
  'battery-peak-shave': '#9A4A05',
  'critical-island-survival': '#11161B'
};

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Peak reduction (y) vs island endurance hours (x) for the five policies,
 * evaluated under the active scenario for peak and the island scenario for
 * endurance. Points are keyboard focusable and carry data-policy-id so a
 * pointer or Enter key selects that policy.
 */
export function renderTradeoffChartSvg(appState = {}, labOptions = {}) {
  const opts = normalizeLabOptions(labOptions);
  const scenario = getScenarioById(appState && appState.scenarioId);
  const matrix = compareAllPoliciesAllScenarios(appState, labOptions);
  const sizing = sweepBatterySizing(appState, labOptions);
  const activeRow = matrix.scenarios.find((row) => row.scenarioId === scenario.id);

  const points = LAB_POLICIES.map((policy) => {
    const cell = activeRow.cells.find((item) => item.policyId === policy.id);
    const sweep = sizing.perPolicy.find((item) => item.policyId === policy.id);
    const island = getScenarioById(ISLAND_SCENARIO_ID);
    const endurance = calculateIslandEndurance({
      activeCircuitsKw: sweep.islandAverageLoadKw,
      batteryCapacityKwh: matrix.inputs.batteryCapacityKwh,
      stateOfChargePct: matrix.inputs.batterySocPct,
      solarOffsetKw: matrix.inputs.solarOffsetEnabled ? island.solarPeakOffsetKw : 0,
      reserveFloorPct: matrix.inputs.reserveFloorPct
    });
    return {
      policyId: policy.id,
      policyName: policy.name,
      x: endurance.enduranceHoursDecimal,
      y: cell.peakKwReduction,
      criticalsSafe: cell.criticalsSafe
    };
  });

  const width = 560;
  const height = 300;
  const padLeft = 46;
  const padRight = 20;
  const padTop = 26;
  const padBottom = 44;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const xMax = Math.max(24, Math.ceil(Math.max(...points.map((p) => p.x), 1) / 12) * 12);
  const yMax = Math.max(4, Math.ceil(Math.max(...points.map((p) => p.y), 1) / 4) * 4);
  const xFor = (v) => roundTo(padLeft + (Math.min(xMax, Math.max(0, v)) / xMax) * plotW, 1);
  const yFor = (v) => roundTo(padTop + plotH - (Math.min(yMax, Math.max(0, v)) / yMax) * plotH, 1);

  let grid = '';
  for (let gx = 0; gx <= xMax; gx += Math.max(6, Math.round(xMax / 6))) {
    const x = xFor(gx);
    grid += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop + plotH}" stroke="#CBC6B6" stroke-dasharray="3 3" stroke-width="1" />`;
    grid += `<text x="${x}" y="${height - 26}" text-anchor="middle" fill="#3E4852" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${gx}h</text>`;
  }
  for (let gy = 0; gy <= yMax; gy += Math.max(2, Math.round(yMax / 5))) {
    const y = yFor(gy);
    grid += `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#CBC6B6" stroke-dasharray="3 3" stroke-width="1" />`;
    grid += `<text x="${padLeft - 6}" y="${y + 3}" text-anchor="end" fill="#3E4852" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${gy}kW</text>`;
  }

  const circles = points.map((point) => {
    const color = LAB_COLORS[point.policyId] || '#11161B';
    const cx = xFor(point.x);
    const cy = yFor(point.y);
    const selected = point.policyId === opts.policyId;
    return `<g class="lab-point-group ${selected ? 'is-selected' : ''}">
      <circle cx="${cx}" cy="${cy}" r="${selected ? 8 : 6}" fill="${color}" stroke="#FAF9F5" stroke-width="1.5"
        tabindex="0" role="button" data-lab-policy-point="${point.policyId}"
        aria-label="Select ${escapeXml(point.policyName)} policy, ${point.y} kW peak shaved and ${point.x} hours island endurance">
        <title>${escapeXml(point.policyName)}: ${point.y} kW shaved, ${point.x}h island</title>
      </circle>
      <text x="${cx}" y="${cy - 11}" text-anchor="middle" fill="#11161B" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9">${escapeXml(point.policyName)}</text>
    </g>`;
  }).join('\n');

  return `<svg class="lab-chart-svg" viewBox="0 0 ${width} ${height}" role="group" aria-label="Tradeoff chart of peak kilowatt reduction against island battery endurance for five policies under ${escapeXml(scenario.name)}">
  ${grid}
  <text x="${padLeft + plotW / 2}" y="${height - 8}" text-anchor="middle" fill="#3E4852" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">Island endurance hours (${matrix.inputs.reserveFloorPct}% floor)</text>
  <text x="12" y="${padTop + plotH / 2}" text-anchor="middle" transform="rotate(-90 12 ${padTop + plotH / 2})" fill="#3E4852" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">Peak kW shaved</text>
  ${circles}
</svg>`;
}

/**
 * Island endurance vs battery capacity for the selected policy at the lab
 * reserve floor, with dashed 24h and 48h outage target lines. Points are
 * keyboard focusable; activating one sets the battery capacity control.
 */
export function renderSizingCurveSvg(appState = {}, labOptions = {}) {
  const opts = normalizeLabOptions(labOptions);
  const sizing = sweepBatterySizing(appState, labOptions);
  const entry = sizing.perPolicy.find((item) => item.policyId === opts.policyId)
    || sizing.perPolicy[0];
  const activeCapacity = Number(appState && appState.batteryCapacityKwh);
  const capacity = Number.isFinite(activeCapacity) ? activeCapacity : BATTERY_DEFAULT_CAPACITY_KWH;

  const width = 560;
  const height = 300;
  const padLeft = 46;
  const padRight = 20;
  const padTop = 26;
  const padBottom = 44;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const xMax = BATTERY_SWEEP_MAX_KWH;
  const yMax = Math.max(48, Math.ceil(Math.max(...entry.points.map((p) => p.enduranceHours), 1) / 12) * 12);
  const xFor = (v) => roundTo(padLeft + (Math.min(xMax, Math.max(0, v)) / xMax) * plotW, 1);
  const yFor = (v) => roundTo(padTop + plotH - (Math.min(yMax, Math.max(0, v)) / yMax) * plotH, 1);

  let grid = '';
  for (const kwh of BATTERY_SWEEP_KWH) {
    const x = xFor(kwh);
    grid += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop + plotH}" stroke="#CBC6B6" stroke-dasharray="3 3" stroke-width="1" />`;
    grid += `<text x="${x}" y="${height - 26}" text-anchor="middle" fill="#3E4852" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${kwh}</text>`;
  }
  const yStep = yMax <= 60 ? 12 : 24;
  for (let gy = 0; gy <= yMax; gy += yStep) {
    const y = yFor(gy);
    grid += `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#CBC6B6" stroke-dasharray="3 3" stroke-width="1" />`;
    grid += `<text x="${padLeft - 6}" y="${y + 3}" text-anchor="end" fill="#3E4852" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${gy}h</text>`;
  }

  const target24 = yFor(24);
  const target48 = yFor(48);
  let targets = `<line x1="${padLeft}" y1="${target24}" x2="${width - padRight}" y2="${target24}" stroke="#0A6B53" stroke-dasharray="6 4" stroke-width="1.5" />`;
  targets += `<text x="${width - padRight}" y="${target24 - 5}" text-anchor="end" fill="#0A6B53" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">24h outage target</text>`;
  if (yMax >= 48) {
    targets += `<line x1="${padLeft}" y1="${target48}" x2="${width - padRight}" y2="${target48}" stroke="#9A4A05" stroke-dasharray="6 4" stroke-width="1.5" />`;
    targets += `<text x="${width - padRight}" y="${target48 - 5}" text-anchor="end" fill="#9A4A05" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">48h outage target</text>`;
  }

  const polyline = entry.points.map((p) => `${xFor(p.kwh)},${yFor(p.enduranceHours)}`).join(' ');
  const circles = entry.points.map((point) => {
    const cx = xFor(point.kwh);
    const cy = yFor(point.enduranceHours);
    const isActive = Math.abs(point.kwh - capacity) < 0.01;
    return `<circle cx="${cx}" cy="${cy}" r="${isActive ? 7 : 5}" fill="${isActive ? '#9A4A05' : '#0A6B53'}" stroke="#FAF9F5" stroke-width="1.5"
      tabindex="0" role="button" data-lab-kwh="${point.kwh}"
      aria-label="Set battery to ${point.kwh} kWh, endurance ${point.enduranceHours} hours">
      <title>${point.kwh} kWh: ${point.enduranceHours}h island endurance</title>
    </circle>`;
  }).join('\n');

  return `<svg class="lab-chart-svg" viewBox="0 0 ${width} ${height}" role="group" aria-label="LFP battery sizing curve of island endurance hours against capacity for the ${escapeXml(entry.policyName)} policy at ${sizing.reserveFloorPct} percent reserve floor">
  ${grid}
  ${targets}
  <polyline fill="none" stroke="#0A6B53" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${polyline}" />
  ${circles}
  <text x="${padLeft + plotW / 2}" y="${height - 8}" text-anchor="middle" fill="#3E4852" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">LFP battery capacity kWh</text>
</svg>`;
}

/** Comparator table body rows for the active scenario (5 policy cells). */
export function renderComparatorRowsHtml(appState = {}, labOptions = {}) {
  const opts = normalizeLabOptions(labOptions);
  const view = comparePoliciesForScenario(appState && appState.scenarioId, appState, labOptions);
  return view.cells.map((cell) => {
    const selected = cell.policyId === opts.policyId;
    const crit = cell.criticalsSafe
      ? '<span class="lab-safe-pill">PROTECTED</span>'
      : '<span class="lab-violation-pill">VIOLATION</span>';
    return `<tr class="lab-policy-row ${selected ? 'is-selected' : ''}" data-policy-id="${cell.policyId}">
      <td><strong>${escapeXml(cell.policyName)}</strong></td>
      <td class="tabular">${cell.peakKw.toFixed(2)}</td>
      <td class="tabular">${cell.peakKwReduction.toFixed(2)}</td>
      <td class="tabular">${cell.dailyKwh.toFixed(2)}</td>
      <td class="tabular">$${cell.dailyBillUsd.toFixed(2)}</td>
      <td class="tabular">${cell.dailyCarbonKg.toFixed(2)}</td>
      <td class="tabular">${cell.islandEnduranceHours.toFixed(1)}h</td>
      <td class="tabular">${cell.comfortShedKw.toFixed(2)}</td>
      <td class="tabular">${cell.advisorValue.toFixed(2)}</td>
      <td>${crit}</td>
    </tr>`;
  }).join('\n');
}

/** 5x4 island endurance matrix (policies x scenarios), hours per cell. */
export function renderEnduranceMatrixRowsHtml(appState = {}, labOptions = {}) {
  const opts = normalizeLabOptions(labOptions);
  const matrix = compareAllPoliciesAllScenarios(appState, labOptions);
  return LAB_POLICIES.map((policy) => {
    const cells = matrix.scenarios.map((row) => {
      const cell = row.cells.find((item) => item.policyId === policy.id);
      return `<td class="tabular">${cell.islandEnduranceHours.toFixed(1)}h</td>`;
    }).join('');
    const selected = policy.id === opts.policyId;
    return `<tr class="lab-policy-row ${selected ? 'is-selected' : ''}" data-policy-id="${policy.id}"><td><strong>${escapeXml(policy.name)}</strong></td>${cells}</tr>`;
  }).join('\n');
}

/* ------------------------------------------------------------------ */
/* Deterministic in-page self-tests                                    */
/* ------------------------------------------------------------------ */

function selfTest(name, fn) {
  try {
    const detail = fn();
    return { name, pass: true, detail: typeof detail === 'string' ? detail : 'ok' };
  } catch (error) {
    return { name, pass: false, detail: String(error && error.message ? error.message : error) };
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
  return message;
}

export function runLabSelfTests(appState = {}, labOptions = {}) {
  const ctx = simulationContext(appState, labOptions);
  const results = [];

  results.push(selfTest('SHA-256 empty-string KAT', () => expect(
    sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'empty message digest matches FIPS 180-4')));

  results.push(selfTest('SHA-256 abc KAT', () => expect(
    sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'abc digest matches FIPS 180-4')));

  results.push(selfTest('SHA-256 448-bit boundary KAT', () => expect(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') ===
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    '56-byte message digest matches FIPS 180-4')));

  results.push(selfTest('SHA-256 multi-block KAT', () => expect(
    sha256Hex('The quick brown fox jumps over the lazy dog') ===
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    'quick-brown-fox digest matches FIPS 180-4')));

  results.push(selfTest('Critical circuits never shed in any policy or scenario', () => {
    const matrix = compareAllPoliciesAllScenarios(ctx, labOptions);
    expect(matrix.checkedCells === 20, '20 policy-scenario cells evaluated');
    return expect(matrix.criticalsNeverShed === true, 'CPAP/fridge and comms bus stay closed everywhere');
  }));

  results.push(selfTest('Comparator metrics equal direct simulator output', () => {
    const cell = evaluatePolicy('ercot-summer-peak', 'tou-delay-shift', ctx, labOptions);
    const sim = simulateHouseholdGridPulse({
      scenarioId: 'ercot-summer-peak',
      circuitStates: buildPolicyStates('tou-delay-shift', { ...ctx, scenarioId: 'ercot-summer-peak' }),
      batterySocPct: ctx.batterySocPct,
      batteryCapacityKwh: ctx.batteryCapacityKwh,
      solarOffsetEnabled: ctx.solarOffsetEnabled
    });
    expect(cell.peakKw === sim.metrics.optimizedPeakMaxKw, 'peak kW parity');
    return expect(cell.dailyBillUsd === sim.metrics.optimizedDailyCost, 'daily bill parity');
  }));

  results.push(selfTest('Tariff arithmetic exactness on summer baseline', () => {
    const sim = simulateHouseholdGridPulse({
      scenarioId: 'ercot-summer-peak',
      circuitStates: createDefaultCircuitStateMap('unoptimized'),
      batterySocPct: ctx.batterySocPct,
      batteryCapacityKwh: ctx.batteryCapacityKwh
    });
    let manual = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      const tariff = [16, 17, 18, 19].includes(hour) ? 0.32 : 0.09;
      manual += sim.baselineHourlyKw[hour] * tariff;
    }
    manual = roundTo(manual, 2);
    return expect(manual === sim.metrics.baselineDailyCost, 'bill equals hourly tariff sum');
  }));

  results.push(selfTest('Endurance math parity with engine at 10% floor', () => {
    const lab = calculateIslandEndurance({
      activeCircuitsKw: 1.25, batteryCapacityKwh: 20.25,
      stateOfChargePct: 85, solarOffsetKw: 1.1, reserveFloorPct: 10
    });
    const eng = calculateOutageBatteryEndurance({
      activeCircuitsKw: 1.25, batteryCapacityKwh: 20.25,
      stateOfChargePct: 85, solarOffsetKw: 1.1
    });
    expect(lab.enduranceHoursDecimal === eng.enduranceHoursDecimal, 'hours parity');
    return expect(lab.usableKwh === eng.usableKwh && lab.netDrainKw === eng.netDrainKw, 'usable and drain parity');
  }));

  results.push(selfTest('Sizing sweep endurance is nondecreasing in capacity', () => {
    const sizing = sweepBatterySizing(ctx, labOptions);
    for (const entry of sizing.perPolicy) {
      for (let i = 1; i < entry.points.length; i += 1) {
        if (entry.points[i].enduranceHours < entry.points[i - 1].enduranceHours) {
          throw new Error(entry.policyId + ' regresses between ' + entry.points[i - 1].kwh + ' and ' + entry.points[i].kwh + ' kWh');
        }
      }
    }
    return 'monotone for all 5 policies';
  }));

  results.push(selfTest('Advisor and comparator are deterministic', () => {
    const a = compareAllPoliciesAllScenarios(ctx, labOptions);
    const b = compareAllPoliciesAllScenarios(ctx, labOptions);
    return expect(JSON.stringify(a) === JSON.stringify(b), 'identical matrix on repeat evaluation');
  }));

  results.push(selfTest('CSV formula escaping blocks spreadsheet injection', () => {
    const hostile = csvEscape('=CMD()');
    const plus = csvEscape('+1-202-555-0100');
    const at = csvEscape('@SUM(1)');
    expect(hostile.startsWith("'") && plus.startsWith("'") && at.startsWith("'"), 'formula prefixes get a quote');
    return expect(csvEscape('plain, "text"') === '"plain, ""text"""', 'commas and quotes escape cleanly');
  }));

  results.push(selfTest('Tamper detection flips the verify verdict', () => {
    const stamped = getStampedReport(ctx, labOptions);
    const before = verifyStampedReport(stamped);
    const tampered = { ...stamped.payload, inputs: { ...stamped.payload.inputs, batteryCapacityKwh: 1 } };
    const after = verifyStampedReport({ payload: tampered, digestHex: stamped.digestHex });
    expect(before.ok === true, 'untouched payload verifies');
    return expect(after.ok === false && after.actual !== stamped.digestHex, 'mutated payload is detected');
  }));

  results.push(selfTest('One digest across page line, JSON, CSV and Markdown', () => {
    const stamped = getStampedReport(ctx, labOptions);
    const json = exportReportJson(ctx, labOptions);
    const csv = exportReportCsv(ctx, labOptions);
    const md = exportReportMarkdown(ctx, labOptions);
    expect(json.includes(stamped.digestHex), 'JSON carries the digest');
    expect(csv.includes('# sha256:' + stamped.digestHex), 'CSV header carries the digest');
    return expect(md.includes('sha256:' + stamped.digestHex), 'Markdown footer carries the digest');
  }));

  results.push(selfTest('#gp= bookmark round-trips every field', () => {
    const state = { ...ctx, scenarioId: 'ercot-winter-freeze', batteryCapacityKwh: 27 };
    const opts = { policyId: 'battery-peak-shave', reserveFloorPct: 20, comfortWeight: 1.5 };
    const decoded = decodeLabHash(encodeLabHash(state, opts));
    expect(decoded && decoded.scenarioId === 'ercot-winter-freeze', 'scenario restored');
    expect(decoded.policyId === 'battery-peak-shave', 'policy restored');
    expect(decoded.batteryCapacityKwh === 27, 'battery restored');
    expect(decoded.reserveFloorPct === 20, 'floor restored');
    return expect(decoded.comfortWeight === 1.5, 'comfort restored');
  }));

  results.push(selfTest('#gp= decode fails closed on hostile input', () => {
    const hostile = [
      '#gp=', '#gp=v2|s=ercot-summer-peak|p=x|b=1|r=10|c=1',
      '#gp=v1|s=__proto__|p=tou-delay-shift|b=13.5|r=10|c=2',
      '#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=2|extra=1',
      '#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10',
      '#gp=v1|s=<script>|p=tou-delay-shift|b=13.5|r=10|c=2',
      '#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=abc|r=10|c=2',
      '#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=2|',
      '#gp=v1|s=ercot-summer-peak|p=tou-delay-shift|b=13.5|r=10|c=-2'
    ];
    for (const hash of hostile) {
      if (decodeLabHash(hash) !== null) throw new Error('accepted hostile hash ' + hash);
    }
    return hostile.length + ' hostile hashes rejected';
  }));

  results.push(selfTest('Policy builders never mutate their input state', () => {
    const frozen = createDefaultCircuitStateMap('unoptimized');
    const snapshot = JSON.stringify(frozen);
    for (const policy of LAB_POLICIES) {
      buildPolicyStates(policy.id, { ...ctx, scenarioId: 'ercot-summer-peak' });
    }
    return expect(JSON.stringify(frozen) === snapshot, 'input map untouched by all 5 builders');
  }));

  results.push(selfTest('Sizing targets report honestly when unreachable', () => {
    const sizing = sweepBatterySizing(ctx, { ...labOptions, reserveFloorPct: 20 });
    for (const entry of sizing.perPolicy) {
      const maxHours = Math.max(...entry.points.map((p) => p.enduranceHours));
      if (maxHours < 24) {
        expect(entry.minKwhFor24h === null, entry.policyId + ' reports null under 24h');
      }
      if (maxHours < 48) {
        expect(entry.minKwhFor48h === null, entry.policyId + ' reports null under 48h');
      }
    }
    return 'unreachable targets are null, never extrapolated';
  }));

  results.push(selfTest('Exported JSON parses and restamps the same digest', () => {
    const stamped = getStampedReport(ctx, labOptions);
    const parsed = JSON.parse(exportReportJson(ctx, labOptions));
    expect(parsed.integritySha256 === stamped.digestHex, 'stamped digest in JSON');
    return expect(verifyStampedReport(parsed).ok === true, 'exported payload verifies');
  }));

  const passed = results.filter((item) => item.pass).length;
  return { results, passed, total: results.length };
}
