import {
  createInitialAppState,
  applyAppAction,
  buildUiViewState
} from './gridpulse-engine.js';
import {
  marginalCircuitContributions,
  optimizeSchedule,
  stressTestScenarios,
  compareSchedules
} from './gridpulse-advisor.js';

let currentState = createInitialAppState();

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) {
    el.innerHTML = html;
  }
}

function signed(value, digits, unit) {
  const n = Number(value);
  const prefix = n > 0 ? '+' : '';
  return prefix + n.toFixed(digits) + (unit ? ' ' + unit : '');
}

function toneFor(value) {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
}

function renderAdvisor() {
  const comfort = Number(document.getElementById('comfort-weight')?.value ?? 2);
  const maxSteps = Number(document.getElementById('plan-steps')?.value ?? 3);
  const options = { weights: { comfort } };

  const marginals = marginalCircuitContributions(currentState, options);
  const plan = optimizeSchedule(currentState, { ...options, weights: { ...options.weights }, maxSteps });
  const stress = stressTestScenarios(currentState, options);
  const comparison = compareSchedules(currentState, plan.optimized, options);

  setText('comfort-weight-out', comfort.toFixed(1));
  setText('plan-steps-out', maxSteps + (maxSteps === 1 ? ' move' : ' moves'));

  const top = marginals.contributions[0];
  setText('advisor-best-move', top
    ? top.description + ' gains ' + signed(top.deltaValue, 2, 'points') +
      ', ' + signed(top.deltaPeakKw, 2, 'kW') + ' peak and ' + signed(top.deltaSavingsUsd, 2, 'USD per day') + '.'
    : 'No legal move is available for this schedule.');

  const marginalsHost = document.getElementById('advisor-marginals-body');
  if (marginalsHost) {
    marginalsHost.innerHTML = marginals.contributions.map((row) =>
      '<tr><td>' + row.circuitId + '</td><td>' + row.action + '</td>' +
      '<td class="' + toneFor(row.deltaPeakKw) + '">' + signed(row.deltaPeakKw, 2) + '</td>' +
      '<td class="' + toneFor(row.deltaSavingsUsd) + '">' + signed(row.deltaSavingsUsd, 2) + '</td>' +
      '<td class="' + toneFor(row.deltaCarbonKg) + '">' + signed(row.deltaCarbonKg, 2) + '</td>' +
      '<td class="' + toneFor(row.deltaValue) + '">' + signed(row.deltaValue, 2) + '</td></tr>'
    ).join('');
  }

  setText('advisor-plan-summary',
    plan.steps.length + ' move' + (plan.steps.length === 1 ? '' : 's') +
    ', net score ' + signed(comparison.delta.value, 2, 'points') +
    ', peak ' + signed(comparison.delta.peakKwReduction, 2, 'kW') +
    '. ' + (plan.exhausted ? 'No further improving move fits the budget.' : 'The budget was filled.'));

  const planHost = document.getElementById('advisor-plan-list');
  if (planHost) {
    planHost.innerHTML = plan.steps.length > 0
      ? plan.steps.map((step) => '<li><b>' + step.action + '</b> ' + step.circuitId +
          ', gain ' + step.gain.toFixed(2) + ' points, cumulative ' +
          step.cumulativePeakKwReduction.toFixed(2) + ' kW shaved</li>').join('')
      : '<li>Every legal move would reduce the score. Keep the current schedule.</li>';
  }

  setText('advisor-stress-summary',
    'Worst feeder strain under ' + stress.worstStrain.scenarioName + ' at ' +
    stress.worstStrain.optimizedStrainIndex + ' of 100. Best bill saving under ' +
    stress.bestSavings.scenarioName + ' at ' + stress.bestSavings.dailySavingsUsd.toFixed(2) +
    ' USD per day.');

  const stressHost = document.getElementById('advisor-stress-body');
  if (stressHost) {
    stressHost.innerHTML = stress.rows.map((row) =>
      '<tr><td>' + row.scenarioId + '</td><td>' + row.peakKwReduction.toFixed(2) +
      '</td><td>' + row.dailySavingsUsd.toFixed(2) + '</td><td>' +
      row.dailyCarbonAvoidedKg.toFixed(2) + '</td><td>' + row.optimizedStrainIndex + '</td></tr>'
    ).join('');
  }

  // Remember the plan so the apply button does not have to recompute it.
  pendingPlan = plan.optimized;
}

let pendingPlan = null;

function renderApp() {
  const view = buildUiViewState(currentState);

  // Update scenario tabs
  const scenarioButtons = document.querySelectorAll('[data-scenario-id]');
  scenarioButtons.forEach((btn) => {
    const id = btn.getAttribute('data-scenario-id');
    const isMatch = Object.is(id, view.scenarioId);
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', String(isMatch));
  });

  // Update scenario telemetry strip
  setText('scenario-title', view.scenarioName);
  setText('scenario-alert-code', view.alertCode);
  setText('scenario-ambient', view.ambientText);
  setText('scenario-reserve', view.reserveMarginText);
  setText('scenario-peak-window', view.peakWindowLabel);
  setText('scenario-tariffs', `${view.peakTariffText} peak / ${view.offPeakTariffText} off-peak`);
  setText('scenario-carbon', view.carbonRateText);
  setText('scenario-summary', view.scenarioSummary);
  setText('scenario-guidance', view.feederGuidance);

  // Update primary telemetry meters
  setText('metric-peak-shaved', view.peakKwReductionText);
  setText('metric-peak-pct', view.peakReductionPctText);
  setText('metric-peak-comparison', `${view.baselinePeakMaxText} baseline to ${view.optimizedPeakMaxText} active`);

  setText('metric-daily-savings', view.dailySavingsText);
  setText('metric-monthly-savings', view.monthlySavingsText);

  setText('metric-daily-carbon', view.dailyCarbonText);
  setText('metric-monthly-carbon', view.monthlyCarbonText);

  setText('metric-strain-score', view.strainScoreText);
  setText('metric-strain-label', `${view.strainBand}: ${view.strainLabel} (${view.baselineStrainText})`);

  const strainFill = document.getElementById('strain-meter-fill');
  if (strainFill) {
    strainFill.style.width = view.strainWidthPct;
    strainFill.setAttribute('data-tone', view.strainTone);
  }

  // Update oscilloscope SVG and scrubber readout
  setHtml('oscilloscope-stage', view.oscilloscopeSvg);
  setText('inspected-hour-val', view.inspectedHourText);
  setText('inspected-window-tag', view.inspectedWindowTag);
  setText('inspected-baseline-kw', view.inspectedBaselineText);
  setText('inspected-optimized-kw', view.inspectedOptimizedText);
  setText('inspected-delta-kw', view.inspectedDeltaText);
  setText('inspected-tariff-val', view.inspectedTariffText);

  const hourSlider = document.getElementById('hour-scrubber-input');
  if (hourSlider) {
    hourSlider.value = String(currentState.inspectedHour);
  }

  // Update breaker directory
  setText('breaker-summary-counts', view.activeCircuitCountText);
  setHtml('breaker-directory-list', view.breakerDirectoryHtml);

  // Update LFP outage island panel
  setText('outage-duration-val', view.outageDurationText);
  setText('outage-usable-kwh', view.outageUsableText);
  setText('outage-net-drain', view.outageDrainText);
  setText('outage-soc-readout', view.outageSocText);
  setText('outage-status-badge', view.outageStatusLabel);

  const socSlider = document.getElementById('battery-soc-slider');
  if (socSlider) {
    socSlider.value = String(currentState.batterySocPct);
  }

  const solarBtn = document.getElementById('toggle-solar-btn');
  if (solarBtn) {
    solarBtn.setAttribute('aria-pressed', view.solarPressedAttr);
    solarBtn.classList.toggle('is-active', Boolean(currentState.solarOffsetEnabled));
  }
  setText('solar-btn-text', view.solarButtonLabel);

  // Update printable schedule table
  setText('print-scenario-name', `${view.scenarioName} (${view.peakWindowLabel})`);
  setText('print-peak-reduction', `${view.peakKwReductionText} (${view.peakReductionPctText})`);
  setText('print-monthly-savings', view.monthlySavingsText);
  setText('print-outage-endurance', `${view.outageDurationText} @ ${view.outageSocText}`);
  setHtml('print-schedule-tbody', view.printScheduleRowsHtml);

  renderAdvisor();
}

function dispatch(action) {
  currentState = applyAppAction(currentState, action);
  renderApp();
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const scenarioBtn = event.target.closest('[data-scenario-id]');
    if (scenarioBtn) {
      dispatch({
        type: 'SELECT_SCENARIO',
        scenarioId: scenarioBtn.getAttribute('data-scenario-id')
      });
      return;
    }

    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      return;
    }

    const actionName = actionEl.getAttribute('data-action');
    const circuitId = actionEl.getAttribute('data-circuit-id');

    const actionMap = {
      'auto-optimize': { type: 'AUTO_OPTIMIZE' },
      'reset-baseline': { type: 'RESET_BASELINE' },
      'island-critical-only': { type: 'ISLAND_CRITICAL_ONLY' },
      'toggle-solar': { type: 'TOGGLE_SOLAR_OFFSET' },
      'toggle-breaker': { type: 'TOGGLE_BREAKER', circuitId },
      'toggle-shift': { type: 'TOGGLE_SHIFT', circuitId }
    };

    if (Object.is(actionName, 'print-schedule')) {
      window.print();
      return;
    }

    if (Object.is(actionName, 'apply-advisor-plan')) {
      if (pendingPlan) {
        currentState = { ...currentState, circuitStates: { ...pendingPlan.circuitStates } };
        renderApp();
      }
      return;
    }

    const mapped = actionMap[actionName];
    if (mapped) {
      dispatch(mapped);
    }
  });

  const hourSlider = document.getElementById('hour-scrubber-input');
  if (hourSlider) {
    hourSlider.addEventListener('input', (event) => {
      dispatch({
        type: 'SET_INSPECTED_HOUR',
        hour: Number(event.target.value)
      });
    });
  }

  const socSlider = document.getElementById('battery-soc-slider');
  if (socSlider) {
    socSlider.addEventListener('input', (event) => {
      dispatch({
        type: 'SET_BATTERY_SOC',
        value: Number(event.target.value)
      });
    });
  }

  // Advisor controls change the recommendation, not the live schedule, so
  // they rerender the advisor alone until the plan is applied.
  for (const id of ['comfort-weight', 'plan-steps']) {
    const control = document.getElementById(id);
    if (control) {
      control.addEventListener('input', renderAdvisor);
      control.addEventListener('change', renderAdvisor);
    }
  }
}

if (typeof document !== 'undefined') {
  bindEvents();
  renderApp();
}
