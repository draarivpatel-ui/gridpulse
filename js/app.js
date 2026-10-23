import {
  createInitialAppState,
  applyAppAction,
  buildUiViewState
} from './gridpulse-engine.js';

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
}

if (typeof document !== 'undefined') {
  bindEvents();
  renderApp();
}
