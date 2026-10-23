/**
 * GridPulse Core Engine: ERCOT Peak-Load Shift Optimizer, Circuit Breaker Telemetry,
 * and 13.5 kWh LFP Outage Island Simulator.
 *
 * Pure ES module with zero external runtime dependencies.
 */

export const BATTERY_DEFAULT_CAPACITY_KWH = 13.5;
export const BATTERY_RESERVE_FLOOR_PCT = 10;
export const BATTERY_INVERTER_EFFICIENCY = 0.94;
export const PANEL_MAX_BUS_KW = 24.0;

export const ERCOT_SCENARIOS = [
  {
    id: 'ercot-summer-peak',
    name: 'August 104°F Thermal Peak',
    shortLabel: 'Aug 104°F Peak',
    season: 'summer',
    alertCode: 'ERCOT EEA-1 WATCH',
    ambientPeakF: 104,
    reserveMarginPct: 4.2,
    peakWindowLabel: '16:00 - 20:00',
    peakHours: [16, 17, 18, 19],
    peakTariffPerKwh: 0.32,
    offPeakTariffPerKwh: 0.09,
    peakCarbonKgPerKwh: 0.62,
    offPeakCarbonKgPerKwh: 0.18,
    hvacWeatherMultiplier: 1.25,
    waterHeaterWeatherMultiplier: 0.9,
    solarPeakOffsetKw: 1.4,
    isOutageIsland: false,
    summary:
      'Stagnant high-pressure heat dome pushes afternoon ambient temperatures to 104°F while thermal generation derates and evening AC load spikes across ERCOT.',
    feederGuidance:
      'Pre-cool thermal mass between 13:00 and 15:30, defer 40A EV charging to 01:00 wind surplus, and lock out resistive dryer drums during 16:00 - 20:00.'
  },
  {
    id: 'ercot-winter-freeze',
    name: 'February Polar Vortex Freeze',
    shortLabel: 'Feb Polar Freeze',
    season: 'winter',
    alertCode: 'ERCOT EEA-2 DUAL PEAK',
    ambientPeakF: 18,
    reserveMarginPct: 3.5,
    peakWindowLabel: '06:00 - 09:00 & 17:00 - 21:00',
    peakHours: [6, 7, 8, 17, 18, 19, 20],
    peakTariffPerKwh: 0.36,
    offPeakTariffPerKwh: 0.10,
    peakCarbonKgPerKwh: 0.68,
    offPeakCarbonKgPerKwh: 0.24,
    hvacWeatherMultiplier: 1.35,
    waterHeaterWeatherMultiplier: 1.3,
    solarPeakOffsetKw: 0.7,
    isOutageIsland: false,
    summary:
      'Sub-freezing 18°F morning and evening troughs trigger auxiliary heat-strip surges across residential heat pumps while gas wellhead freeze-offs tighten ERCOT reserves.',
    feederGuidance:
      'Stagger morning water-heater recovery before 05:30, pre-heat living zones at midday solar peak, and inhibit EV and laundry circuits during both heating ramps.'
  },
  {
    id: 'ercot-coastal-calm',
    name: 'Coastal Wind Drop & Solar Ramp',
    shortLabel: 'Wind Drop Ramp',
    season: 'shoulder',
    alertCode: 'NET LOAD DUCK RAMP',
    ambientPeakF: 94,
    reserveMarginPct: 5.8,
    peakWindowLabel: '17:00 - 20:00',
    peakHours: [17, 18, 19],
    peakTariffPerKwh: 0.29,
    offPeakTariffPerKwh: 0.08,
    peakCarbonKgPerKwh: 0.58,
    offPeakCarbonKgPerKwh: 0.15,
    hvacWeatherMultiplier: 1.05,
    waterHeaterWeatherMultiplier: 1.0,
    solarPeakOffsetKw: 1.2,
    isOutageIsland: false,
    summary:
      'Gulf Coast sea-breeze stall coincides with West Texas sunset, forcing ERCOT fast-start simple-cycle gas peakers to climb 14 GW inside three hours.',
    feederGuidance:
      'Shift variable-speed pool filtration and domestic hot-water recovery into the 10:00 - 15:00 solar belly and move EV charging past midnight.'
  },
  {
    id: 'ercot-outage-island',
    name: 'Outage Microgrid Island (13.5 kWh)',
    shortLabel: 'Outage Island Mode',
    season: 'outage',
    alertCode: 'ISLAND BUS ACTIVE',
    ambientPeakF: 98,
    reserveMarginPct: 0.0,
    peakWindowLabel: '16:00 - 20:00 Island Stress',
    peakHours: [16, 17, 18, 19],
    peakTariffPerKwh: 0.32,
    offPeakTariffPerKwh: 0.09,
    peakCarbonKgPerKwh: 0.65,
    offPeakCarbonKgPerKwh: 0.20,
    hvacWeatherMultiplier: 1.15,
    waterHeaterWeatherMultiplier: 1.0,
    solarPeakOffsetKw: 1.1,
    isOutageIsland: true,
    summary:
      'Distribution feeder relay opens under storm or load-shedding conditions; home transfers to a 13.5 kWh LFP battery reserve with automatic heavy-breaker load shedding.',
    feederGuidance:
      'Open non-essential 240V two-pole breakers (EV, Dryer, Oven, Pool, Water Heater) to preserve LFP battery endurance for medical refrigeration, lighting, and gateway telemetry.'
  }
];

export const HOUSEHOLD_CIRCUITS = [
  {
    id: 'hvac-central',
    panelSlot: 'B1/B3',
    name: 'Central HVAC Compressor (4-Ton)',
    category: 'Thermal Comfort',
    breakerAmps: 30,
    voltage: 240,
    ratedKw: 3.8,
    priority: 'flexible-comfort',
    shiftable: true,
    critical: false,
    recommendedOutageShed: true,
    defaultWindow: '14:00 - 21:00 Peak Thermal Load',
    shiftedWindow: '12:00 - 15:00 Pre-Cool + 35% Peak Duty',
    shiftStrategy:
      'Pre-cool slab and envelope 2°F below setpoint from 12:00 to 15:00 so compressor duty drops by 65% during the 16:00 - 20:00 ERCOT emergency window.',
    baselineHourlyFraction: [
      0.20, 0.18, 0.15, 0.15, 0.15, 0.18,
      0.30, 0.42, 0.48, 0.52, 0.58, 0.65,
      0.72, 0.80, 0.88, 0.92, 1.00, 1.00,
      1.00, 0.95, 0.82, 0.65, 0.45, 0.30
    ],
    shiftedHourlyFraction: [
      0.20, 0.18, 0.15, 0.15, 0.15, 0.25,
      0.22, 0.22, 0.25, 0.45, 0.60, 0.78,
      0.95, 1.00, 1.00, 0.95, 0.35, 0.35,
      0.35, 0.35, 0.40, 0.75, 0.55, 0.32
    ]
  },
  {
    id: 'ev-charger-l2',
    panelSlot: 'B2/B4',
    name: 'Level-2 EV Supply Equipment (40A)',
    category: 'Mobility Storage',
    breakerAmps: 50,
    voltage: 240,
    ratedKw: 9.6,
    priority: 'deferrable',
    shiftable: true,
    critical: false,
    recommendedOutageShed: true,
    defaultWindow: '17:00 - 20:00 Commuter Arrival',
    shiftedWindow: '01:00 - 04:00 Nocturnal Wind Surplus',
    shiftStrategy:
      'Delay 9.6 kW J1772 / NACS contactor closure until 01:00 when West Texas wind generation peaks and wholesale LMP clears near off-peak floor.',
    baselineHourlyFraction: [
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.00, 0.35, 1.00,
      1.00, 0.85, 0.20, 0.00, 0.00, 0.00
    ],
    shiftedHourlyFraction: [
      0.00, 1.00, 1.00, 1.00, 0.40, 0.00,
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00
    ]
  },
  {
    id: 'electric-dryer',
    panelSlot: 'B5/B7',
    name: 'Electric Resistance Tumble Dryer',
    category: 'Appliance Heating',
    breakerAmps: 30,
    voltage: 240,
    ratedKw: 4.5,
    priority: 'deferrable',
    shiftable: true,
    critical: false,
    recommendedOutageShed: true,
    defaultWindow: '17:00 - 19:00 Peak Laundry Window',
    shiftedWindow: '21:00 - 23:00 Post-Peak Tariff Window',
    shiftStrategy:
      'Inhibit 4.5 kW nichrome heating element during 16:00 - 20:00 and run drum cycle after 21:00 when feeder thermal loading subsides.',
    baselineHourlyFraction: [
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.15, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.00, 0.25, 0.85,
      0.80, 0.20, 0.00, 0.00, 0.00, 0.00
    ],
    shiftedHourlyFraction: [
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.00, 0.00, 0.15,
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.90, 0.85, 0.35
    ]
  },
  {
    id: 'pool-pump',
    panelSlot: 'B6/B8',
    name: 'Variable-Speed Pool Filtration Pump',
    category: 'Auxiliary Motor',
    breakerAmps: 20,
    voltage: 240,
    ratedKw: 1.8,
    priority: 'deferrable',
    shiftable: true,
    critical: false,
    recommendedOutageShed: true,
    defaultWindow: '14:00 - 19:00 Afternoon Turnover',
    shiftedWindow: '09:00 - 14:00 Midday Solar Window',
    shiftStrategy:
      'Complete daily filtration turnover between 09:00 and 14:00 on utility-scale solar surplus and open pump relay before 15:00.',
    baselineHourlyFraction: [
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.20, 0.50, 0.90, 1.00, 1.00, 1.00,
      0.90, 0.40, 0.00, 0.00, 0.00, 0.00
    ],
    shiftedHourlyFraction: [
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.85, 1.00, 1.00,
      1.00, 1.00, 0.65, 0.00, 0.00, 0.00,
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00
    ]
  },
  {
    id: 'water-heater',
    panelSlot: 'B9/B11',
    name: 'Heat-Pump / Hybrid Water Heater (50 Gal)',
    category: 'Thermal Storage',
    breakerAmps: 30,
    voltage: 240,
    ratedKw: 3.5,
    priority: 'flexible-thermal',
    shiftable: true,
    critical: false,
    recommendedOutageShed: true,
    defaultWindow: '06:30 - 08:30 & 17:00 - 19:30 Recovery',
    shiftedWindow: '04:00 - 05:30 & 13:00 - 15:00 Thermal Charge',
    shiftStrategy:
      'Boost tank temperature to 135°F via thermostatic mixing valve during off-peak solar/wind hours and coast through morning and evening peaks.',
    baselineHourlyFraction: [
      0.05, 0.05, 0.05, 0.05, 0.05, 0.15,
      0.75, 0.85, 0.60, 0.20, 0.15, 0.15,
      0.15, 0.15, 0.20, 0.25, 0.65, 0.90,
      0.85, 0.55, 0.25, 0.15, 0.10, 0.05
    ],
    shiftedHourlyFraction: [
      0.05, 0.05, 0.05, 0.10, 0.80, 0.85,
      0.15, 0.15, 0.15, 0.20, 0.25, 0.30,
      0.65, 0.95, 0.90, 0.45, 0.10, 0.10,
      0.10, 0.10, 0.15, 0.40, 0.20, 0.05
    ]
  },
  {
    id: 'induction-oven',
    panelSlot: 'B10/B12',
    name: 'Induction Range & Convection Oven',
    category: 'Culinary Load',
    breakerAmps: 40,
    voltage: 240,
    ratedKw: 3.2,
    priority: 'flexible-lifestyle',
    shiftable: true,
    critical: false,
    recommendedOutageShed: true,
    defaultWindow: '17:30 - 19:30 Peak Dinner Draw',
    shiftedWindow: '20:00 - 21:00 Post-Peak / Low-Draw Prep',
    shiftStrategy:
      'Defer high-wattage oven baking until 20:00 or limit peak dinner prep to a single 1.1 kW induction zone.',
    baselineHourlyFraction: [
      0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
      0.15, 0.25, 0.10, 0.00, 0.00, 0.00,
      0.20, 0.10, 0.00, 0.00, 0.20, 0.75,
      0.95, 0.50, 0.10, 0.00, 0.00, 0.00
    ],
    shiftedHourlyFraction: [
      0.00, 0.00, 0.00, 0.00, 0.00, 0.25,
      0.05, 0.05, 0.05, 0.00, 0.00, 0.25,
      0.25, 0.10, 0.00, 0.00, 0.10, 0.20,
      0.25, 0.20, 0.85, 0.55, 0.00, 0.00
    ]
  },
  {
    id: 'medical-fridge-core',
    panelSlot: 'A1',
    name: 'Medical CPAP & Kitchen Refrigeration',
    category: 'Critical Life-Safety',
    breakerAmps: 20,
    voltage: 120,
    ratedKw: 0.45,
    priority: 'critical',
    shiftable: false,
    critical: true,
    recommendedOutageShed: false,
    defaultWindow: '00:00 - 24:00 Protected Critical Bus',
    shiftedWindow: '00:00 - 24:00 Protected Critical Bus',
    shiftStrategy:
      'Non-sheddable life-safety and cold-storage compressor bus; remains closed across all peak tariff and outage island scenarios.',
    baselineHourlyFraction: [
      0.40, 0.38, 0.38, 0.38, 0.38, 0.40,
      0.45, 0.50, 0.48, 0.45, 0.48, 0.50,
      0.55, 0.55, 0.58, 0.60, 0.62, 0.65,
      0.65, 0.60, 0.55, 0.50, 0.45, 0.42
    ],
    shiftedHourlyFraction: [
      0.40, 0.38, 0.38, 0.38, 0.38, 0.40,
      0.45, 0.50, 0.48, 0.45, 0.48, 0.50,
      0.55, 0.55, 0.58, 0.60, 0.62, 0.65,
      0.65, 0.60, 0.55, 0.50, 0.45, 0.42
    ]
  },
  {
    id: 'lighting-it-routers',
    panelSlot: 'A2',
    name: 'LED Lighting, Fiber ONT & Telemetry',
    category: 'Critical Comms',
    breakerAmps: 15,
    voltage: 120,
    ratedKw: 0.35,
    priority: 'critical',
    shiftable: false,
    critical: true,
    recommendedOutageShed: false,
    defaultWindow: '00:00 - 24:00 Continuous Gateway Bus',
    shiftedWindow: '00:00 - 24:00 Continuous Gateway Bus',
    shiftStrategy:
      'Maintains fiber gateway, emergency weather radio, sub-panel CT metering, and high-efficacy LED task lighting during grid emergencies.',
    baselineHourlyFraction: [
      0.30, 0.25, 0.25, 0.25, 0.25, 0.35,
      0.55, 0.60, 0.45, 0.40, 0.40, 0.40,
      0.40, 0.40, 0.40, 0.45, 0.55, 0.70,
      0.85, 0.90, 0.85, 0.75, 0.55, 0.35
    ],
    shiftedHourlyFraction: [
      0.30, 0.25, 0.25, 0.25, 0.25, 0.35,
      0.55, 0.60, 0.45, 0.40, 0.40, 0.40,
      0.40, 0.40, 0.40, 0.45, 0.55, 0.70,
      0.85, 0.90, 0.85, 0.75, 0.55, 0.35
    ]
  }
];

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function getScenarioById(scenarioId) {
  if (typeof scenarioId !== 'string' || scenarioId.trim() === '') {
    return ERCOT_SCENARIOS[0];
  }
  const normalized = scenarioId.trim().toLowerCase();
  const found = ERCOT_SCENARIOS.find((item) => item.id === normalized);
  return found || ERCOT_SCENARIOS[0];
}

export function getCircuitById(circuitId) {
  if (typeof circuitId !== 'string' || circuitId.trim() === '') {
    return null;
  }
  const normalized = circuitId.trim().toLowerCase();
  return HOUSEHOLD_CIRCUITS.find((item) => item.id === normalized) || null;
}

export function createDefaultCircuitStateMap(mode = 'unoptimized') {
  const map = {};
  for (const circuit of HOUSEHOLD_CIRCUITS) {
    if (mode === 'optimized') {
      map[circuit.id] = {
        enabled: true,
        shifted: circuit.shiftable === true
      };
    } else if (mode === 'outage-critical') {
      map[circuit.id] = {
        enabled: circuit.critical === true,
        shifted: circuit.shiftable === true
      };
    } else {
      map[circuit.id] = {
        enabled: true,
        shifted: false
      };
    }
  }
  return map;
}

export function getCircuitWeatherMultiplier(circuitId, scenario) {
  const resolvedScenario = typeof scenario === 'string' ? getScenarioById(scenario) : (scenario || ERCOT_SCENARIOS[0]);
  if (circuitId === 'hvac-central') {
    return resolvedScenario.hvacWeatherMultiplier;
  }
  if (circuitId === 'water-heater') {
    return resolvedScenario.waterHeaterWeatherMultiplier;
  }
  return 1.0;
}

export function isPeakHourForScenario(hour, scenario) {
  const resolvedScenario = typeof scenario === 'string' ? getScenarioById(scenario) : (scenario || ERCOT_SCENARIOS[0]);
  const numericHour = Number(hour);
  if (!Number.isInteger(numericHour) || numericHour < 0 || numericHour > 23) {
    return false;
  }
  return resolvedScenario.peakHours.includes(numericHour);
}

export function computeCircuitHourlyProfile(circuit, scenario, circuitState) {
  const resolvedScenario = typeof scenario === 'string' ? getScenarioById(scenario) : (scenario || ERCOT_SCENARIOS[0]);
  const weatherMult = getCircuitWeatherMultiplier(circuit.id, resolvedScenario);
  const isEnabled = circuitState ? circuitState.enabled !== false : true;
  const isShifted = Boolean(circuitState && circuitState.shifted === true && circuit.shiftable === true);

  const baselineHourlyKw = [];
  const activeHourlyKw = [];

  for (let hour = 0; hour < 24; hour += 1) {
    let baseFactor = circuit.baselineHourlyFraction[hour];
    let shiftFactor = isShifted ? circuit.shiftedHourlyFraction[hour] : baseFactor;

    // In winter polar vortex, morning heating (06:00-08:00) also carries elevated HVAC strip heat
    if (resolvedScenario.id === 'ercot-winter-freeze' && circuit.id === 'hvac-central') {
      if (hour >= 6 && hour <= 8) {
        baseFactor = isShifted ? 0.38 : 0.92;
        if (!isShifted) {
          shiftFactor = baseFactor;
        } else {
          shiftFactor = 0.38;
        }
      } else if (hour >= 4 && hour <= 5 && isShifted) {
        shiftFactor = 0.88;
      }
    }

    const baseKw = roundTo(circuit.ratedKw * weatherMult * baseFactor, 3);
    const currentKw = isEnabled ? roundTo(circuit.ratedKw * weatherMult * shiftFactor, 3) : 0;

    baselineHourlyKw.push(baseKw);
    activeHourlyKw.push(currentKw);
  }

  return {
    circuitId: circuit.id,
    enabled: isEnabled,
    shifted: isShifted,
    baselineHourlyKw,
    activeHourlyKw
  };
}

export function computeGridStrainIndex(peakWindowMaxKw, reserveMarginPct, isOutageIsland = false) {
  const loadRatio = Math.min(1.2, Math.max(0, Number(peakWindowMaxKw) / 18.0));
  const reservePenalty = isOutageIsland
    ? 22
    : Math.max(0, (8.0 - Number(reserveMarginPct)) * 4.5);
  const rawScore = Math.round(loadRatio * 68 + reservePenalty);
  return Math.max(0, Math.min(100, rawScore));
}

export function classifyGridStrainBand(strainIndex) {
  const score = Number(strainIndex);
  if (score >= 75) {
    return {
      band: 'CRITICAL',
      label: 'Critical Feeder Overload Risk',
      tone: 'vermilion'
    };
  }
  if (score >= 45) {
    return {
      band: 'ELEVATED',
      label: 'Elevated Peak Feeder Stress',
      tone: 'amber'
    };
  }
  return {
    band: 'STABLE',
    label: 'Grid-Safe Optimized Envelope',
    tone: 'emerald'
  };
}

export function calculateOutageBatteryEndurance({
  activeCircuitsKw,
  batteryCapacityKwh = BATTERY_DEFAULT_CAPACITY_KWH,
  stateOfChargePct = 90,
  solarOffsetKw = 0
}) {
  const clampedSoc = Math.max(BATTERY_RESERVE_FLOOR_PCT, Math.min(100, Number(stateOfChargePct)));
  const usableFraction = (clampedSoc - BATTERY_RESERVE_FLOOR_PCT) / 100;
  const usableKwh = roundTo(
    Number(batteryCapacityKwh) * usableFraction * BATTERY_INVERTER_EFFICIENCY,
    2
  );

  const grossLoadKw = roundTo(Math.max(0, Number(activeCircuitsKw)), 2);
  const effectiveSolarKw = roundTo(Math.max(0, Number(solarOffsetKw)) * 0.35, 2);
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
    batteryCapacityKwh: roundTo(Number(batteryCapacityKwh), 2),
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

export function simulateHouseholdGridPulse({
  scenarioId = 'ercot-summer-peak',
  circuitStates = {},
  batterySocPct = 90,
  batteryCapacityKwh = BATTERY_DEFAULT_CAPACITY_KWH,
  solarOffsetEnabled = true,
  inspectedHour = 18
} = {}) {
  const scenario = getScenarioById(scenarioId);
  const baselineHourlyKw = new Array(24).fill(0);
  const optimizedHourlyKw = new Array(24).fill(0);

  const circuitBreakdown = [];

  for (const circuit of HOUSEHOLD_CIRCUITS) {
    const state = circuitStates[circuit.id] || { enabled: true, shifted: false };
    const profile = computeCircuitHourlyProfile(circuit, scenario, state);

    let circuitBaselinePeakSum = 0;
    let circuitActivePeakSum = 0;
    let circuitBaselineDailyKwh = 0;
    let circuitActiveDailyKwh = 0;

    for (let h = 0; h < 24; h += 1) {
      const bKw = profile.baselineHourlyKw[h];
      const aKw = profile.activeHourlyKw[h];
      baselineHourlyKw[h] = roundTo(baselineHourlyKw[h] + bKw, 3);
      optimizedHourlyKw[h] = roundTo(optimizedHourlyKw[h] + aKw, 3);

      circuitBaselineDailyKwh = roundTo(circuitBaselineDailyKwh + bKw, 3);
      circuitActiveDailyKwh = roundTo(circuitActiveDailyKwh + aKw, 3);

      if (isPeakHourForScenario(h, scenario)) {
        circuitBaselinePeakSum = roundTo(circuitBaselinePeakSum + bKw, 3);
        circuitActivePeakSum = roundTo(circuitActivePeakSum + aKw, 3);
      }
    }

    const peakHoursCount = scenario.peakHours.length;
    const baselinePeakAvgKw = roundTo(circuitBaselinePeakSum / peakHoursCount, 2);
    const activePeakAvgKw = roundTo(circuitActivePeakSum / peakHoursCount, 2);

    circuitBreakdown.push({
      id: circuit.id,
      panelSlot: circuit.panelSlot,
      name: circuit.name,
      category: circuit.category,
      breakerAmps: circuit.breakerAmps,
      voltage: circuit.voltage,
      ratedKw: circuit.ratedKw,
      priority: circuit.priority,
      shiftable: circuit.shiftable,
      critical: circuit.critical,
      recommendedOutageShed: circuit.recommendedOutageShed,
      enabled: profile.enabled,
      shifted: profile.shifted,
      defaultWindow: circuit.defaultWindow,
      shiftedWindow: circuit.shiftedWindow,
      shiftStrategy: circuit.shiftStrategy,
      baselinePeakAvgKw,
      activePeakAvgKw,
      peakKwSaved: roundTo(Math.max(0, baselinePeakAvgKw - activePeakAvgKw), 2),
      baselineDailyKwh: roundTo(circuitBaselineDailyKwh, 2),
      activeDailyKwh: roundTo(circuitActiveDailyKwh, 2),
      baselineHourlyKw: profile.baselineHourlyKw,
      activeHourlyKw: profile.activeHourlyKw
    });
  }

  let baselinePeakMaxKw = 0;
  let optimizedPeakMaxKw = 0;
  let baselinePeakKwh = 0;
  let optimizedPeakKwh = 0;
  let baselineDailyCost = 0;
  let optimizedDailyCost = 0;
  let baselineDailyCarbonKg = 0;
  let optimizedDailyCarbonKg = 0;

  for (let h = 0; h < 24; h += 1) {
    const bKw = roundTo(baselineHourlyKw[h], 2);
    const oKw = roundTo(optimizedHourlyKw[h], 2);
    baselineHourlyKw[h] = bKw;
    optimizedHourlyKw[h] = oKw;

    const isPeak = isPeakHourForScenario(h, scenario);
    const tariff = isPeak ? scenario.peakTariffPerKwh : scenario.offPeakTariffPerKwh;
    const carbonFactor = isPeak ? scenario.peakCarbonKgPerKwh : scenario.offPeakCarbonKgPerKwh;

    if (isPeak) {
      if (bKw > baselinePeakMaxKw) {
        baselinePeakMaxKw = bKw;
      }
      if (oKw > optimizedPeakMaxKw) {
        optimizedPeakMaxKw = oKw;
      }
      baselinePeakKwh = roundTo(baselinePeakKwh + bKw, 2);
      optimizedPeakKwh = roundTo(optimizedPeakKwh + oKw, 2);
    }

    baselineDailyCost = roundTo(baselineDailyCost + bKw * tariff, 4);
    optimizedDailyCost = roundTo(optimizedDailyCost + oKw * tariff, 4);

    baselineDailyCarbonKg = roundTo(baselineDailyCarbonKg + bKw * carbonFactor, 4);
    optimizedDailyCarbonKg = roundTo(optimizedDailyCarbonKg + oKw * carbonFactor, 4);
  }

  const peakKwReduction = roundTo(Math.max(0, baselinePeakMaxKw - optimizedPeakMaxKw), 2);
  const peakReductionPct =
    baselinePeakMaxKw > 0
      ? roundTo((peakKwReduction / baselinePeakMaxKw) * 100, 1)
      : 0;

  const dailySavingsUsd = roundTo(Math.max(0, baselineDailyCost - optimizedDailyCost), 2);
  const monthlySavingsUsd = roundTo(dailySavingsUsd * 30, 2);
  const dailyCarbonAvoidedKg = roundTo(Math.max(0, baselineDailyCarbonKg - optimizedDailyCarbonKg), 2);
  const monthlyCarbonAvoidedKg = roundTo(dailyCarbonAvoidedKg * 30, 1);

  const baselineStrainIndex = computeGridStrainIndex(
    baselinePeakMaxKw,
    scenario.reserveMarginPct,
    scenario.isOutageIsland
  );
  const optimizedStrainIndex = computeGridStrainIndex(
    optimizedPeakMaxKw,
    scenario.reserveMarginPct,
    scenario.isOutageIsland
  );
  const strainClassification = classifyGridStrainIndexOrBand(optimizedStrainIndex);

  const totalActiveDailyKwh = roundTo(
    optimizedHourlyKw.reduce((acc, val) => acc + val, 0),
    2
  );
  const averageActiveHourlyKw = roundTo(totalActiveDailyKwh / 24, 2);

  const endurance = calculateOutageBatteryEndurance({
    activeCircuitsKw: averageActiveHourlyKw,
    batteryCapacityKwh,
    stateOfChargePct: batterySocPct,
    solarOffsetKw: solarOffsetEnabled ? scenario.solarPeakOffsetKw : 0
  });

  const safeInspectedHour =
    Number.isInteger(Number(inspectedHour)) && Number(inspectedHour) >= 0 && Number(inspectedHour) <= 23
      ? Number(inspectedHour)
      : 18;

  const inspectedBaselineKw = baselineHourlyKw[safeInspectedHour];
  const inspectedOptimizedKw = optimizedHourlyKw[safeInspectedHour];
  const inspectedDeltaKw = roundTo(inspectedBaselineKw - inspectedOptimizedKw, 2);
  const inspectedIsPeak = isPeakHourForScenario(safeInspectedHour, scenario);

  const shiftedCount = circuitBreakdown.filter((c) => c.shifted === true).length;
  const shedCount = circuitBreakdown.filter((c) => c.enabled === false).length;
  const activeCount = circuitBreakdown.filter((c) => c.enabled === true).length;

  return {
    scenario,
    baselineHourlyKw,
    optimizedHourlyKw,
    circuitBreakdown,
    metrics: {
      baselinePeakMaxKw,
      optimizedPeakMaxKw,
      peakKwReduction,
      peakReductionPct,
      baselinePeakKwh,
      optimizedPeakKwh,
      baselineDailyCost: roundTo(baselineDailyCost, 2),
      optimizedDailyCost: roundTo(optimizedDailyCost, 2),
      dailySavingsUsd,
      monthlySavingsUsd,
      baselineDailyCarbonKg: roundTo(baselineDailyCarbonKg, 2),
      optimizedDailyCarbonKg: roundTo(optimizedDailyCarbonKg, 2),
      dailyCarbonAvoidedKg,
      monthlyCarbonAvoidedKg,
      baselineStrainIndex,
      optimizedStrainIndex,
      strainBand: strainClassification.band,
      strainLabel: strainClassification.label,
      strainTone: strainClassification.tone,
      totalActiveDailyKwh,
      averageActiveHourlyKw,
      shiftedCount,
      shedCount,
      activeCount
    },
    inspected: {
      hour: safeInspectedHour,
      hourFormatted: `${String(safeInspectedHour).padStart(2, '0')}:00`,
      isPeak: inspectedIsPeak,
      baselineKw: inspectedBaselineKw,
      optimizedKw: inspectedOptimizedKw,
      deltaKw: inspectedDeltaKw,
      tariffPerKwh: inspectedIsPeak ? scenario.peakTariffPerKwh : scenario.offPeakTariffPerKwh
    },
    outageEndurance: endurance
  };
}

function classifyGridStrainIndexOrBand(strainIndex) {
  return classifyGridStrainIndex(strainIndex);
}

export function classifyGridStrainIndex(strainIndex) {
  return classifyGridStrainBand(strainIndex);
}

export function buildAutoOptimizedCircuitStates(scenarioId = 'ercot-summer-peak') {
  const scenario = getScenarioById(scenarioId);
  if (scenario.isOutageIsland === true) {
    return createDefaultCircuitStateMap('outage-critical');
  }
  return createDefaultCircuitStateMap('optimized');
}

export function createInitialAppState() {
  return {
    scenarioId: 'ercot-summer-peak',
    circuitStates: createDefaultCircuitStateMap('unoptimized'),
    batterySocPct: 90,
    batteryCapacityKwh: BATTERY_DEFAULT_CAPACITY_KWH,
    solarOffsetEnabled: true,
    inspectedHour: 18
  };
}

export function applyAppAction(state, action) {
  const next = {
    scenarioId: state.scenarioId,
    circuitStates: { ...state.circuitStates },
    batterySocPct: state.batterySocPct,
    batteryCapacityKwh: state.batteryCapacityKwh,
    solarOffsetEnabled: state.solarOffsetEnabled,
    inspectedHour: state.inspectedHour
  };

  if (!action || typeof action.type !== 'string') {
    return next;
  }

  if (action.type === 'SELECT_SCENARIO') {
    const scenario = getScenarioById(action.scenarioId);
    next.scenarioId = scenario.id;
    if (scenario.isOutageIsland === true) {
      next.circuitStates = createDefaultCircuitStateMap('outage-critical');
    }
    return next;
  }

  if (action.type === 'AUTO_OPTIMIZE') {
    next.circuitStates = buildAutoOptimizedCircuitStates(next.scenarioId);
    return next;
  }

  if (action.type === 'RESET_BASELINE') {
    next.circuitStates = createDefaultCircuitStateMap('unoptimized');
    return next;
  }

  if (action.type === 'ISLAND_CRITICAL_ONLY') {
    next.circuitStates = createDefaultCircuitStateMap('outage-critical');
    return next;
  }

  if (action.type === 'TOGGLE_BREAKER') {
    const circuit = getCircuitById(action.circuitId);
    if (!circuit) {
      return next;
    }
    const prev = next.circuitStates[circuit.id] || { enabled: true, shifted: false };
    next.circuitStates[circuit.id] = {
      enabled: !prev.enabled,
      shifted: prev.shifted
    };
    return next;
  }

  if (action.type === 'TOGGLE_SHIFT') {
    const circuit = getCircuitById(action.circuitId);
    if (!circuit || circuit.shiftable !== true) {
      return next;
    }
    const prev = next.circuitStates[circuit.id] || { enabled: true, shifted: false };
    next.circuitStates[circuit.id] = {
      enabled: prev.enabled,
      shifted: !prev.shifted
    };
    return next;
  }

  if (action.type === 'SET_BATTERY_SOC') {
    const numeric = Number(action.value);
    if (Number.isFinite(numeric)) {
      next.batterySocPct = Math.max(20, Math.min(100, Math.round(numeric)));
    }
    return next;
  }

  if (action.type === 'TOGGLE_SOLAR_OFFSET') {
    next.solarOffsetEnabled = !next.solarOffsetEnabled;
    return next;
  }

  if (action.type === 'SET_INSPECTED_HOUR') {
    const numeric = Number(action.hour);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 23) {
      next.inspectedHour = numeric;
    }
    return next;
  }

  return next;
}

export function renderOscilloscopeSvgMarkup(simulation) {
  const width = 840;
  const height = 280;
  const padLeft = 52;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 42;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const maxKwScale = 22.0;

  const xForHour = (h) => roundTo(padLeft + (h / 23) * plotW, 1);
  const yForKw = (kw) => roundTo(padTop + plotH - (Math.min(maxKwScale, Math.max(0, kw)) / maxKwScale) * plotH, 1);

  const basePoints = simulation.baselineHourlyKw.map((kw, h) => `${xForHour(h)},${yForKw(kw)}`);
  const optPoints = simulation.optimizedHourlyKw.map((kw, h) => `${xForHour(h)},${yForKw(kw)}`);

  const basePolyline = basePoints.join(' ');
  const optPolyline = optPoints.join(' ');

  const baseArea = `${xForHour(0)},${yForKw(0)} ${basePolyline} ${xForHour(23)},${yForKw(0)}`;
  const optArea = `${xForHour(0)},${yForKw(0)} ${optPolyline} ${xForHour(23)},${yForKw(0)}`;

  // Build peak window highlight bands
  let peakRects = '';
  for (let h = 0; h < 24; h += 1) {
    if (isPeakHourForScenario(h, simulation.scenario)) {
      const xStart = roundTo(padLeft + (Math.max(0, h - 0.5) / 23) * plotW, 1);
      const xEnd = roundTo(padLeft + (Math.min(23, h + 0.5) / 23) * plotW, 1);
      const w = roundTo(Math.max(8, xEnd - xStart), 1);
      peakRects += `<rect x="${xStart}" y="${padTop}" width="${w}" height="${plotH}" fill="rgba(200, 100, 10, 0.14)" />`;
    }
  }

  // Horizontal graticule lines
  const yTicks = [0, 5, 10, 15, 20];
  let gridLines = '';
  for (const tick of yTicks) {
    const y = yForKw(tick);
    gridLines += `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#CBC6B6" stroke-dasharray="3 3" stroke-width="1" />`;
    gridLines += `<text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" fill="#3E4852" font-family="JetBrains Mono, monospace" font-size="11">${tick}kW</text>`;
  }

  // X-axis hour ticks
  const xTicks = [0, 4, 8, 12, 16, 20, 23];
  let xLabels = '';
  for (const h of xTicks) {
    const x = xForHour(h);
    const label = `${String(h).padStart(2, '0')}:00`;
    xLabels += `<text x="${x}" y="${height - 12}" text-anchor="middle" fill="#3E4852" font-family="JetBrains Mono, monospace" font-size="11">${label}</text>`;
  }

  const inspectedH = simulation.inspected.hour;
  const cursorX = xForHour(inspectedH);
  const cursorBaseY = yForKw(simulation.inspected.baselineKw);
  const cursorOptY = yForKw(simulation.inspected.optimizedKw);

  return `<svg class="oscilloscope-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="24-hour ERCOT household demand curve comparing baseline peak draw with load-shifted profile">
    <defs>
      <linearGradient id="baseAreaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#C92A2A" stop-opacity="0.22" />
        <stop offset="100%" stop-color="#C92A2A" stop-opacity="0.02" />
      </linearGradient>
      <linearGradient id="optAreaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0D7A5F" stop-opacity="0.28" />
        <stop offset="100%" stop-color="#0D7A5F" stop-opacity="0.03" />
      </linearGradient>
    </defs>
    ${peakRects}
    ${gridLines}
    <polygon points="${baseArea}" fill="url(#baseAreaFill)" />
    <polygon points="${optArea}" fill="url(#optAreaFill)" />
    <polyline fill="none" stroke="#C92A2A" stroke-width="2.25" stroke-dasharray="6 4" points="${basePolyline}" />
    <polyline fill="none" stroke="#0D7A5F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${optPolyline}" />
    <line x1="${cursorX}" y1="${padTop}" x2="${cursorX}" y2="${padTop + plotH}" stroke="#11161B" stroke-width="1.5" />
    <circle cx="${cursorX}" cy="${cursorBaseY}" r="4.5" fill="#C92A2A" stroke="#FAF9F5" stroke-width="1.5" />
    <circle cx="${cursorX}" cy="${cursorOptY}" r="5.5" fill="#0D7A5F" stroke="#FAF9F5" stroke-width="1.5" />
    ${xLabels}
  </svg>`;
}

export function renderBreakerDirectoryMarkup(simulation) {
  return simulation.circuitBreakdown
    .map((circuit) => {
      const statusBadgeClass = !circuit.enabled
        ? 'status-pill status-shed'
        : circuit.shifted
          ? 'status-pill status-shifted'
          : circuit.critical
            ? 'status-pill status-critical'
            : 'status-pill status-unshifted';

      const statusBadgeText = !circuit.enabled
        ? 'BREAKER OPEN (SHED)'
        : circuit.shifted
          ? 'PEAK-SHIFT RELAY ARMED'
          : circuit.critical
            ? 'PROTECTED CRITICAL BUS'
            : 'UNSHIFTED PEAK BUS';

      const breakerBtnClass = circuit.enabled
        ? 'breaker-switch-btn is-closed'
        : 'breaker-switch-btn is-open';

      const breakerBtnText = circuit.enabled ? 'CLOSED (ON)' : 'OPEN (SHED)';

      const shiftControlMarkup = circuit.shiftable
        ? `<button type="button" class="shift-relay-btn ${circuit.shifted ? 'is-shifted' : ''}" data-action="toggle-shift" data-circuit-id="${circuit.id}" aria-pressed="${circuit.shifted ? 'true' : 'false'}">
            <span class="relay-dot" aria-hidden="true"></span>
            <span>${circuit.shifted ? 'Shifted Off-Peak' : 'Shift Out of Peak'}</span>
          </button>`
        : `<span class="critical-lock-tag">Continuous 24h Bus</span>`;

      return `<article class="circuit-row ${!circuit.enabled ? 'is-shed-row' : ''} ${circuit.shifted ? 'is-shifted-row' : ''}" data-circuit-card="${circuit.id}">
        <div class="circuit-slot-col">
          <span class="slot-code tabular">${circuit.panelSlot}</span>
          <span class="amp-rating tabular">${circuit.breakerAmps}A / ${circuit.voltage}V</span>
        </div>
        <div class="circuit-info-col">
          <div class="circuit-title-line">
            <h4 class="circuit-name">${circuit.name}</h4>
            <span class="${statusBadgeClass}">${statusBadgeText}</span>
          </div>
          <p class="circuit-strategy">${circuit.shiftStrategy}</p>
          <div class="circuit-window-meta tabular">
            <span><strong>Default:</strong> ${circuit.defaultWindow}</span>
            <span><strong>Target:</strong> ${circuit.shiftedWindow}</span>
          </div>
        </div>
        <div class="circuit-telemetry-col tabular">
          <div class="kw-pair">
            <span class="kw-label">Nameplate</span>
            <strong class="kw-val">${circuit.ratedKw.toFixed(2)} kW</strong>
          </div>
          <div class="kw-pair">
            <span class="kw-label">Peak Window Avg</span>
            <strong class="kw-val ${circuit.activePeakAvgKw < circuit.baselinePeakAvgKw ? 'text-emerald' : ''}">${circuit.activePeakAvgKw.toFixed(2)} kW</strong>
          </div>
          <div class="kw-pair">
            <span class="kw-label">Peak Shaved</span>
            <strong class="kw-val text-emerald">-${circuit.peakKwSaved.toFixed(2)} kW</strong>
          </div>
        </div>
        <div class="circuit-controls-col">
          <button type="button" class="${breakerBtnClass}" data-action="toggle-breaker" data-circuit-id="${circuit.id}" aria-pressed="${circuit.enabled ? 'true' : 'false'}">
            <span class="switch-lever" aria-hidden="true"></span>
            <span class="tabular">${breakerBtnText}</span>
          </button>
          ${shiftControlMarkup}
        </div>
      </article>`;
    })
    .join('\n');
}

export function renderPrintScheduleRowsMarkup(simulation) {
  return simulation.circuitBreakdown
    .map((circuit) => {
      const actionDirective = !circuit.enabled
        ? 'OPEN BREAKER (SHED)'
        : circuit.shifted
          ? `SHIFT TO: ${circuit.shiftedWindow}`
          : circuit.critical
            ? 'KEEP CLOSED (CRITICAL 24H)'
            : `UNSHIFTED (${circuit.defaultWindow})`;

      return `<tr>
        <td class="tabular">${circuit.panelSlot} (${circuit.breakerAmps}A)</td>
        <td><strong>${circuit.name}</strong></td>
        <td class="tabular">${circuit.ratedKw.toFixed(2)} kW</td>
        <td class="tabular">${circuit.baselinePeakAvgKw.toFixed(2)} kW</td>
        <td class="tabular">${circuit.activePeakAvgKw.toFixed(2)} kW</td>
        <td>${actionDirective}</td>
      </tr>`;
    })
    .join('\n');
}

export function buildUiViewState(state) {
  const sim = simulateHouseholdGridPulse(state);
  const m = sim.metrics;
  const sc = sim.scenario;
  const out = sim.outageEndurance;
  const insp = sim.inspected;

  return {
    simulation: sim,
    scenarioId: sc.id,
    scenarioName: sc.name,
    alertCode: sc.alertCode,
    ambientText: `${sc.ambientPeakF}°F`,
    reserveMarginText: `${sc.reserveMarginPct.toFixed(1)}%`,
    peakWindowLabel: sc.peakWindowLabel,
    peakTariffText: `$${sc.peakTariffPerKwh.toFixed(2)}/kWh`,
    offPeakTariffText: `$${sc.offPeakTariffPerKwh.toFixed(2)}/kWh`,
    carbonRateText: `${sc.peakCarbonKgPerKwh.toFixed(2)} kg CO2/kWh`,
    scenarioSummary: sc.summary,
    feederGuidance: sc.feederGuidance,
    baselinePeakMaxText: `${m.baselinePeakMaxKw.toFixed(2)} kW`,
    optimizedPeakMaxText: `${m.optimizedPeakMaxKw.toFixed(2)} kW`,
    peakKwReductionText: `-${m.peakKwReduction.toFixed(2)} kW`,
    peakReductionPctText: `${m.peakReductionPct.toFixed(1)}% shaved`,
    dailySavingsText: `$${m.dailySavingsUsd.toFixed(2)}`,
    monthlySavingsText: `$${m.monthlySavingsUsd.toFixed(2)} / 30d`,
    dailyCarbonText: `${m.dailyCarbonAvoidedKg.toFixed(2)} kg`,
    monthlyCarbonText: `${m.monthlyCarbonAvoidedKg.toFixed(1)} kg / 30d`,
    strainScoreText: `${m.optimizedStrainIndex} / 100`,
    baselineStrainText: `Baseline ${m.baselineStrainIndex}`,
    strainBand: m.strainBand,
    strainLabel: m.strainLabel,
    strainTone: m.strainTone,
    strainWidthPct: `${m.optimizedStrainIndex}%`,
    outageDurationText: out.formattedDuration,
    outageUsableText: `${out.usableKwh.toFixed(2)} kWh usable`,
    outageDrainText: `${out.netDrainKw.toFixed(2)} kW net drain`,
    outageSocText: `${out.stateOfChargePct}% SoC`,
    outageStatusLabel:
      out.enduranceStatus === 'EXTENDED_ISLAND_SAFE'
        ? 'Extended Island Endurance (18h+)'
        : out.enduranceStatus === 'OVERNIGHT_VIABLE'
          ? 'Overnight Backup Viable (8h - 18h)'
          : 'High Drain Warning (<8h Backup)',
    solarPressedAttr: state.solarOffsetEnabled ? 'true' : 'false',
    solarButtonLabel: state.solarOffsetEnabled
      ? `Solar Offset Active (+${sc.solarPeakOffsetKw.toFixed(1)} kW peak)`
      : 'Solar Offset Disabled (Night / Overcast)',
    inspectedHourText: insp.hourFormatted,
    inspectedWindowTag: insp.isPeak ? 'ERCOT PEAK INTERVAL' : 'OFF-PEAK INTERVAL',
    inspectedBaselineText: `${insp.baselineKw.toFixed(2)} kW`,
    inspectedOptimizedText: `${insp.optimizedKw.toFixed(2)} kW`,
    inspectedDeltaText:
      insp.deltaKw >= 0 ? `-${insp.deltaKw.toFixed(2)} kW` : `+${Math.abs(insp.deltaKw).toFixed(2)} kW`,
    inspectedTariffText: `$${insp.tariffPerKwh.toFixed(2)}/kWh`,
    activeCircuitCountText: `${m.activeCount} Closed / ${m.shedCount} Shed / ${m.shiftedCount} Shifted`,
    oscilloscopeSvg: renderOscilloscopeSvgMarkup(sim),
    breakerDirectoryHtml: renderBreakerDirectoryMarkup(sim),
    printScheduleRowsHtml: renderPrintScheduleRowsMarkup(sim)
  };
}


