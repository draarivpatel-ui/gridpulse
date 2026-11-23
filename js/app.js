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

/* ------------------------------------------------------------------ */
/* Policy & Outage-Survival Lab                                        */
/* ------------------------------------------------------------------ */

let labModule = null;
const labState = { policyId: 'tou-delay-shift', reserveFloorPct: 10, comfortWeight: 2.0 };

function labOptions() {
  return {
    policyId: labState.policyId,
    reserveFloorPct: labState.reserveFloorPct,
    comfortWeight: labState.comfortWeight
  };
}

function renderLab() {
  if (!labModule) return;
  const mod = labModule;
  const opts = labOptions();

  setText('lab-battery-kwh-out', `${Number(currentState.batteryCapacityKwh).toFixed(2)} kWh`);
  setText('lab-comfort-weight-out', labState.comfortWeight.toFixed(1));

  const batterySlider = document.getElementById('lab-battery-kwh');
  if (batterySlider) batterySlider.value = String(currentState.batteryCapacityKwh);
  const floorSelect = document.getElementById('lab-reserve-floor');
  if (floorSelect) floorSelect.value = String(labState.reserveFloorPct);
  const comfortSlider = document.getElementById('lab-comfort-weight');
  if (comfortSlider) comfortSlider.value = String(labState.comfortWeight);

  for (const policy of mod.LAB_POLICIES) {
    const radio = document.getElementById(`lab-policy-${policy.id}`);
    if (radio) radio.checked = policy.id === labState.policyId;
  }

  const view = mod.comparePoliciesForScenario(currentState.scenarioId, currentState, opts);
  setText('lab-comparator-scenario', view.scenarioName);
  setHtml('lab-comparator-body', mod.renderComparatorRowsHtml(currentState, opts));
  setHtml('lab-matrix-body', mod.renderEnduranceMatrixRowsHtml(currentState, opts));
  setHtml('lab-tradeoff-chart', mod.renderTradeoffChartSvg(currentState, opts));
  setHtml('lab-sizing-chart', mod.renderSizingCurveSvg(currentState, opts));

  const sizing = mod.sweepBatterySizing(currentState, opts);
  const sweep = sizing.perPolicy.find((entry) => entry.policyId === labState.policyId) || sizing.perPolicy[0];
  const fmtTarget = (kwh) => (kwh === null ? 'not reached within 40.5 kWh' : `${kwh} kWh`);
  setText('lab-sizing-note',
    `${sweep.policyName || sweep.policyId} island draw ${sweep.islandAverageLoadKw.toFixed(2)} kW avg. ` +
    `24h outage clears at ${fmtTarget(sweep.minKwhFor24h)}; 48h at ${fmtTarget(sweep.minKwhFor48h)} ` +
    `(${sizing.reserveFloorPct}% floor, ${sizing.batterySocPct}% SoC).`);

  const stamped = mod.getStampedReport(currentState, opts);
  setText('lab-digest-line', `sha256:${stamped.digestHex}`);
}

function applyLabBookmark() {
  if (!labModule || typeof location === 'undefined') return;
  const decoded = labModule.decodeLabHash(location.hash);
  if (!decoded) return;
  const applied = labModule.applyDecodedBookmark(currentState, decoded);
  currentState = applied.appState;
  labState.policyId = applied.labOptions.policyId;
  labState.reserveFloorPct = applied.labOptions.reserveFloorPct;
  labState.comfortWeight = applied.labOptions.comfortWeight;
}

function labShareUrl() {
  const hash = labModule.encodeLabHash(currentState, labOptions());
  if (typeof location !== 'undefined' && typeof location.origin === 'string' && typeof location.pathname === 'string') {
    return location.origin + location.pathname + hash;
  }
  return hash;
}

function labDownload(filename, text, mime) {
  if (typeof Blob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([text], { type: mime }));
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

function labHandleAction(actionName, el) {
  if (!labModule) return;
  const mod = labModule;
  const opts = labOptions();

  if (actionName === 'apply-policy') {
    const states = mod.buildPolicyStates(labState.policyId, {
      ...currentState,
      comfortWeight: labState.comfortWeight
    });
    currentState = { ...currentState, circuitStates: states };
    renderApp();
    return;
  }

  if (actionName === 'export-json' || actionName === 'export-csv' || actionName === 'export-md') {
    const exporters = {
      'export-json': ['gridpulse-resilience-brief.json', mod.exportReportJson, 'application/json'],
      'export-csv': ['gridpulse-resilience-brief.csv', mod.exportReportCsv, 'text/csv'],
      'export-md': ['gridpulse-resilience-brief.md', mod.exportReportMarkdown, 'text/markdown']
    };
    const [filename, build, mime] = exporters[actionName];
    const text = build(currentState, opts);
    const preview = document.getElementById('lab-export-preview');
    if (preview) {
      preview.hidden = false;
      preview.textContent = text;
    }
    labDownload(filename, text, mime);
    setText('lab-verify-status', `Exported ${filename}.`);
    return;
  }

  if (actionName === 'copy-share') {
    const url = labShareUrl();
    const field = document.getElementById('lab-share-url');
    if (field) {
      field.value = url;
      if (typeof field.select === 'function') field.select();
    }
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      nav.clipboard.writeText(url).then(
        () => setText('lab-verify-status', 'Share link copied to clipboard.'),
        () => setText('lab-verify-status', 'Share link shown in the field; clipboard unavailable.')
      );
    } else {
      setText('lab-verify-status', 'Share link shown in the field; clipboard unavailable.');
    }
    return;
  }

  if (actionName === 'verify-digest') {
    const verdict = mod.verifyStampedReport(mod.getStampedReport(currentState, opts));
    setText('lab-verify-status', verdict.ok
      ? `VERIFIED: sha256 match ${verdict.actual.slice(0, 16)}...`
      : `MISMATCH: expected ${verdict.expected.slice(0, 16)} got ${verdict.actual.slice(0, 16)}`);
    const statusEl = document.getElementById('lab-verify-status');
    if (statusEl) statusEl.setAttribute('data-tone', verdict.ok ? 'emerald' : 'vermilion');
    return;
  }

  if (actionName === 'tamper-demo') {
    const stamped = mod.getStampedReport(currentState, opts);
    const tampered = {
      ...stamped.payload,
      inputs: { ...stamped.payload.inputs, batteryCapacityKwh: stamped.payload.inputs.batteryCapacityKwh + 1 }
    };
    const verdict = mod.verifyStampedReport({ payload: tampered, digestHex: stamped.digestHex });
    setText('lab-verify-status', verdict.ok
      ? 'Tamper demo failed to detect a mutation (unexpected).'
      : `TAMPER DETECTED: capacity edit yields ${verdict.actual.slice(0, 16)}... not ${verdict.expected.slice(0, 16)}...`);
    const statusEl = document.getElementById('lab-verify-status');
    if (statusEl) statusEl.setAttribute('data-tone', verdict.ok ? 'vermilion' : 'emerald');
    return;
  }

  if (actionName === 'run-self-tests') {
    const { results, passed, total } = mod.runLabSelfTests(currentState, opts);
    setText('lab-selftest-summary', `${passed}/${total} in-page checks passing.`);
    const list = document.getElementById('lab-selftest-list');
    if (list) {
      list.innerHTML = results.map((item) =>
        `<li class="${item.pass ? 'lab-test-pass' : 'lab-test-fail'}"><b>${item.pass ? 'PASS' : 'FAIL'}</b> ${item.name}. ${item.detail}</li>`
      ).join('');
    }
    const statusEl = document.getElementById('lab-selftest-summary');
    if (statusEl) statusEl.setAttribute('data-tone', passed === total ? 'emerald' : 'vermilion');
    return;
  }
}

function bindLabEvents() {
  for (const policy of labModule.LAB_POLICIES) {
    const radio = document.getElementById(`lab-policy-${policy.id}`);
    if (radio) {
      radio.addEventListener('change', (event) => {
        labState.policyId = event.target.value;
        renderLab();
      });
    }
  }

  const batterySlider = document.getElementById('lab-battery-kwh');
  if (batterySlider) {
    batterySlider.addEventListener('input', (event) => {
      dispatch({ type: 'SET_BATTERY_CAPACITY', value: Number(event.target.value) });
    });
  }

  const floorSelect = document.getElementById('lab-reserve-floor');
  if (floorSelect) {
    floorSelect.addEventListener('change', (event) => {
      const next = Number(event.target.value);
      if (labModule.RESERVE_FLOOR_OPTIONS.includes(next)) {
        labState.reserveFloorPct = next;
        renderLab();
      }
    });
  }

  const comfortSlider = document.getElementById('lab-comfort-weight');
  if (comfortSlider) {
    comfortSlider.addEventListener('input', (event) => {
      const next = Number(event.target.value);
      if (Number.isFinite(next)) {
        labState.comfortWeight = Math.min(4, Math.max(0, next));
        renderLab();
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('hashchange', () => {
      applyLabBookmark();
      renderApp();
    });
  }
}

function bootLab() {
  const section = document.getElementById('lab-section');
  const ready = import('./gridpulse-lab.js')
    .then((mod) => {
      labModule = mod;
      applyLabBookmark();
      if (section) section.hidden = false;
      bindLabEvents();
      renderApp();
    })
    .catch((err) => {
      if (typeof console !== 'undefined' && console.error) console.error('gridpulse lab unavailable', err);
      labModule = null;
      if (section) section.hidden = true;
    });
  if (typeof window !== 'undefined') {
    window.__gridpulseLabReady = ready;
  }
  return ready;
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
  setText('print-battery-label', `${view.outageCapacityText} Island Runtime:`);
  setText('print-outage-endurance', `${view.outageDurationText} @ ${view.outageSocText}`);
  setHtml('print-schedule-tbody', view.printScheduleRowsHtml);

  renderAdvisor();
  renderLab();
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

    if (labModule && event.target && typeof event.target.closest === 'function') {
      const labPolicyPoint = event.target.closest('[data-lab-policy-point]');
      const labRow = labPolicyPoint ? null : event.target.closest('tr[data-policy-id]');
      const labKwh = (labPolicyPoint || labRow) ? null : event.target.closest('[data-lab-kwh]');
      const picked = labPolicyPoint || labRow;
      if (picked) {
        labState.policyId = picked.getAttribute(labPolicyPoint ? 'data-lab-policy-point' : 'data-policy-id');
        renderLab();
        return;
      }
      if (labKwh) {
        dispatch({ type: 'SET_BATTERY_CAPACITY', value: Number(labKwh.getAttribute('data-lab-kwh')) });
        return;
      }
    }

    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      return;
    }

    const actionName = actionEl.getAttribute('data-action');
    const circuitId = actionEl.getAttribute('data-circuit-id');

    if (labModule && actionName && actionName.startsWith('lab-')) {
      labHandleAction(actionName.slice(4), actionEl);
      return;
    }

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

  document.addEventListener('keydown', (event) => {
    if (!labModule || !event.target || typeof event.target.closest !== 'function') return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const labKwh = event.target.closest('[data-lab-kwh]');
    if (labKwh) {
      dispatch({ type: 'SET_BATTERY_CAPACITY', value: Number(labKwh.getAttribute('data-lab-kwh')) });
      return;
    }
    const labPolicyPoint = event.target.closest('[data-lab-policy-point]');
    if (labPolicyPoint) {
      labState.policyId = labPolicyPoint.getAttribute('data-lab-policy-point');
      renderLab();
    }
  });

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
  bootLab();
}
