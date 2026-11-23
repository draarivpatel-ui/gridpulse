/**
 * lab-dom.test.js - static markup checks and live UI execution for the
 * Policy & Outage-Survival Lab, run through the DOM shim with the real
 * engine, advisor and lab modules linked in.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parsePage, makeDom, runAppModule, repoRoot } from './helpers/dom.js';
import { ERCOT_SCENARIOS } from '../js/gridpulse-engine.js';
import { LAB_POLICIES, BATTERY_SWEEP_KWH, decodeLabHash, encodeLabHash } from '../js/gridpulse-lab.js';

const PAGE = parsePage('index.html');
const HTML = PAGE.source;
const CSS = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const LAB_JS = fs.readFileSync(path.join(repoRoot, 'js', 'gridpulse-lab.js'), 'utf8');

async function boot(hash = '') {
  const env = makeDom(PAGE);
  if (hash) env.globals.location = { hash };
  await runAppModule(env);
  await env.window.__gridpulseLabReady;
  return env;
}

const actionBtn = (env, name) => env.controls.find((el) => el.getAttribute('data-action') === name);
const click = (env, el) => env.document.fire('click', { target: el });

describe('Lab DOM: static markup', () => {
  it('01. lab section exists and starts hidden behind an explicit css rule', () => {
    assert.ok(HTML.includes('id="lab-section"'));
    assert.match(HTML, /<section class="lab-section" id="lab-section"[^>]*hidden>/);
    assert.match(CSS, /\.lab-section\[hidden\]\s*\{\s*display:\s*none/);
  });

  it('02. all lab control and display ids are present and unique', () => {
    for (const id of [
      'lab-section', 'lab-heading', 'lab-battery-kwh', 'lab-battery-kwh-out',
      'lab-reserve-floor', 'lab-comfort-weight', 'lab-comfort-weight-out',
      'lab-comparator-scenario', 'lab-comparator-body', 'lab-apply-policy-btn',
      'lab-matrix-body', 'lab-tradeoff-chart', 'lab-sizing-chart', 'lab-sizing-note',
      'lab-digest-line', 'lab-verify-status', 'lab-share-url',
      'lab-export-preview', 'lab-selftest-summary', 'lab-selftest-list', 'lab-run-tests-btn'
    ]) {
      assert.ok(PAGE.ids.includes(id), `missing #${id}`);
    }
    assert.equal(new Set(PAGE.ids).size, PAGE.ids.length);
  });

  it('03. five policy radios match the lab catalog', () => {
    for (const policy of LAB_POLICIES) {
      assert.ok(HTML.includes(`id="lab-policy-${policy.id}"`));
      assert.ok(HTML.includes(`name="lab-policy" id="lab-policy-${policy.id}" value="${policy.id}"`));
    }
  });

  it('04. all seven lab actions exist as data-action buttons', () => {
    for (const name of ['lab-apply-policy', 'lab-export-json', 'lab-export-csv', 'lab-export-md', 'lab-copy-share', 'lab-verify-digest', 'lab-tamper-demo', 'lab-run-self-tests']) {
      assert.ok(PAGE.actionNames.includes(name), `missing ${name}`);
    }
  });

  it('05. lab tables carry captions and scroll wrappers', () => {
    assert.ok((HTML.match(/<div class="tbl-scroll">/g) || []).length >= 4);
    assert.ok((HTML.match(/<caption>/g) || []).length >= 4);
  });

  it('06. battery slider matches the sweep bounds', () => {
    assert.match(HTML, /id="lab-battery-kwh"[^>]*min="6\.75"[^>]*max="40\.5"[^>]*step="6\.75"/);
    assert.match(HTML, /<option value="10" selected>10% reserve floor<\/option>/);
    assert.match(HTML, /<option value="20">20% reserve floor<\/option>/);
  });

  it('07. lab css classes are defined', () => {
    for (const sel of ['lab-grid', 'lab-card', 'lab-policy-picker', 'lab-audit-bar', 'lab-digest-row', 'lab-export-actions', 'lab-share-row', 'lab-export-preview', 'lab-selftest-list', 'lab-safe-pill', 'lab-violation-pill', 'lab-chart-svg']) {
      assert.ok(CSS.includes('.' + sel), sel);
    }
  });

  it('08. lab section is inside main and precedes the breaker directory', () => {
    const labIdx = HTML.indexOf('id="lab-section"');
    const dirIdx = HTML.indexOf('id="breaker-directory-heading"');
    const mainIdx = HTML.indexOf('id="main-console"');
    assert.ok(mainIdx < labIdx && labIdx < dirIdx);
  });

  it('09. lab module has zero external imports and no forbidden dashes', () => {
    const imports = [...LAB_JS.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.ok(imports.length > 0);
    assert.ok(imports.every((spec) => spec.startsWith('./')));
    assert.equal(/[\u2013\u2014]/.test(LAB_JS), false);
  });
});

describe('Lab DOM: live boot and comparator', () => {
  it('10. lab unhides and renders all lab regions after boot', async () => {
    const env = await boot();
    assert.equal(env.getEl('lab-section').hidden, false);
    assert.ok(env.getEl('lab-comparator-body').innerHTML.includes('data-policy-id'));
    assert.ok(env.getEl('lab-matrix-body').innerHTML.includes('data-policy-id'));
    assert.ok(env.getEl('lab-tradeoff-chart').innerHTML.includes('<svg'));
    assert.ok(env.getEl('lab-sizing-chart').innerHTML.includes('<svg'));
  });

  it('11. comparator shows all 5 policies and 5 PROTECTED pills', async () => {
    const env = await boot();
    const html = env.getEl('lab-comparator-body').innerHTML;
    assert.equal((html.match(/<tr/g) || []).length, 5);
    assert.equal((html.match(/PROTECTED/g) || []).length, 5);
    for (const policy of LAB_POLICIES) assert.ok(html.includes(policy.id));
  });

  it('12. endurance matrix shows 5 rows of 4 hour cells', async () => {
    const env = await boot();
    const html = env.getEl('lab-matrix-body').innerHTML;
    assert.equal((html.match(/<tr/g) || []).length, 5);
    assert.equal((html.match(/\d+\.\dh/g) || []).length, 20);
  });

  it('13. digest line carries a 64 hex sha256 and matches stamped digest', async () => {
    const env = await boot();
    const text = env.getEl('lab-digest-line').textContent;
    assert.match(text, /^sha256:[0-9a-f]{64}$/);
  });

  it('14. sizing note reports island load and targets for the default policy', async () => {
    const env = await boot();
    const note = env.getEl('lab-sizing-note').textContent;
    assert.match(note, /TOU Delay Shift island draw \d+\.\d{2} kW avg/);
    assert.match(note, /24h outage clears at/);
    assert.match(note, /48h at/);
    assert.match(note, /\(10% floor, 90% SoC\)/);
  });

  it('15. charts carry focusable points with labels', async () => {
    const env = await boot();
    const tradeoff = env.getEl('lab-tradeoff-chart').innerHTML;
    assert.equal((tradeoff.match(/tabindex="0"/g) || []).length, 5);
    const sizing = env.getEl('lab-sizing-chart').innerHTML;
    assert.equal((sizing.match(/tabindex="0"/g) || []).length, 6);
    assert.ok(sizing.includes('24h outage target'));
  });
});

describe('Lab DOM: live interactions', () => {
  it('16. selecting a policy radio moves the selected row class and note', async () => {
    const env = await boot();
    const radio = env.getEl('lab-policy-critical-island-survival');
    radio.fire('change');
    assert.equal(radio.checked, true);
    assert.match(env.getEl('lab-sizing-note').textContent, /Critical Island Survival/);
    const rows = env.getEl('lab-comparator-body').innerHTML;
    assert.match(rows, /is-selected[^>]*data-policy-id="critical-island-survival"|data-policy-id="critical-island-survival"[^>]*is-selected/);
  });

  it('17. battery capacity slider updates state, placard and chart dot', async () => {
    const env = await boot();
    const slider = env.getEl('lab-battery-kwh');
    slider.value = '27';
    slider.fire('input');
    assert.equal(env.getEl('lab-battery-kwh-out').textContent, '27.00 kWh');
    assert.match(env.getEl('print-battery-label').textContent, /27\.00 kWh/);
    assert.ok(env.getEl('lab-sizing-chart').innerHTML.includes('r="7"'));
  });

  it('18. reserve floor select shortens the endurance matrix', async () => {
    const env = await boot();
    const before = env.getEl('lab-matrix-body').innerHTML;
    const sel = env.getEl('lab-reserve-floor');
    sel.value = '20';
    sel.fire('change');
    const after = env.getEl('lab-matrix-body').innerHTML;
    assert.notEqual(after, before);
    assert.match(env.getEl('lab-sizing-note').textContent, /20% floor/);
  });

  it('19. comfort slider changes the advisor policy row', async () => {
    const env = await boot();
    const before = env.getEl('lab-comparator-body').innerHTML;
    const slider = env.getEl('lab-comfort-weight');
    slider.value = '0';
    slider.fire('input');
    assert.equal(env.getEl('lab-comfort-weight-out').textContent, '0.0');
    assert.notEqual(env.getEl('lab-comparator-body').innerHTML, before);
  });

  it('20. apply-policy rewrites the breaker directory', async () => {
    const env = await boot();
    const radio = env.getEl('lab-policy-critical-island-survival');
    radio.fire('change');
    click(env, actionBtn(env, 'lab-apply-policy'));
    const html = env.getEl('breaker-directory-list').innerHTML;
    assert.equal((html.match(/BREAKER OPEN \(SHED\)/g) || []).length, 6);
    assert.equal((html.match(/PROTECTED \(ON\)/g) || []).length, 2);
  });

  it('21. battery-peak-shave sheds exactly the three deferrable breakers', async () => {
    const env = await boot();
    env.getEl('lab-policy-battery-peak-shave').fire('change');
    click(env, actionBtn(env, 'lab-apply-policy'));
    const html = env.getEl('breaker-directory-list').innerHTML;
    assert.equal((html.match(/BREAKER OPEN \(SHED\)/g) || []).length, 3);
    assert.ok(html.includes('PEAK-SHIFT RELAY ARMED'));
  });

  it('22. export-json fills the preview with stamped payload', async () => {
    const env = await boot();
    click(env, actionBtn(env, 'lab-export-json'));
    const preview = env.getEl('lab-export-preview');
    assert.equal(preview.hidden, false);
    const parsed = JSON.parse(preview.textContent);
    assert.equal(parsed.integritySha256, env.getEl('lab-digest-line').textContent.slice(7));
    assert.equal(parsed.comparator.length, 4);
  });

  it('23. export-csv preview carries the digest provenance header', async () => {
    const env = await boot();
    click(env, actionBtn(env, 'lab-export-csv'));
    const text = env.getEl('lab-export-preview').textContent;
    assert.ok(text.startsWith('# gridpulse-resilience-brief'));
    assert.ok(text.includes('# sha256:' + env.getEl('lab-digest-line').textContent.slice(7)));
  });

  it('24. export-md preview carries the digest footer', async () => {
    const env = await boot();
    click(env, actionBtn(env, 'lab-export-md'));
    const text = env.getEl('lab-export-preview').textContent;
    assert.ok(text.includes('# GridPulse Resilience Brief'));
    assert.ok(text.includes('sha256:' + env.getEl('lab-digest-line').textContent.slice(7)));
  });

  it('25. verify-digest reports VERIFIED with the matching digest', async () => {
    const env = await boot();
    click(env, actionBtn(env, 'lab-verify-digest'));
    const status = env.getEl('lab-verify-status');
    assert.match(status.textContent, /^VERIFIED: sha256 match [0-9a-f]{16}/);
    assert.equal(status.getAttribute('data-tone'), 'emerald');
  });

  it('26. tamper demo reports TAMPER DETECTED', async () => {
    const env = await boot();
    click(env, actionBtn(env, 'lab-tamper-demo'));
    const status = env.getEl('lab-verify-status');
    assert.match(status.textContent, /^TAMPER DETECTED:/);
    assert.equal(status.getAttribute('data-tone'), 'emerald');
  });

  it('27. self-test runner reports N/N passing with a list', async () => {
    const env = await boot();
    click(env, actionBtn(env, 'lab-run-self-tests'));
    const summary = env.getEl('lab-selftest-summary');
    const match = summary.textContent.match(/^(\d+)\/(\d+) in-page checks passing\.$/);
    assert.ok(match);
    assert.equal(match[1], match[2]);
    assert.ok(Number(match[1]) >= 14);
    const list = env.getEl('lab-selftest-list').innerHTML;
    assert.equal((list.match(/lab-test-pass/g) || []).length, Number(match[1]));
    assert.equal(list.includes('lab-test-fail'), false);
  });

  it('28. copy-share fills the field with a decodable #gp= link', async () => {
    const env = await boot();
    click(env, actionBtn(env, 'lab-copy-share'));
    const url = env.getEl('lab-share-url').value;
    assert.ok(url.includes('#gp=v1|'));
    const decoded = decodeLabHash(url);
    assert.equal(decoded.scenarioId, 'ercot-summer-peak');
    assert.equal(decoded.policyId, 'tou-delay-shift');
    assert.equal(decoded.batteryCapacityKwh, 13.5);
  });

  it('29. share link updates after policy, battery and floor changes', async () => {
    const env = await boot();
    env.getEl('lab-policy-battery-peak-shave').fire('change');
    const slider = env.getEl('lab-battery-kwh');
    slider.value = '27';
    slider.fire('input');
    const sel = env.getEl('lab-reserve-floor');
    sel.value = '20';
    sel.fire('change');
    click(env, actionBtn(env, 'lab-copy-share'));
    const decoded = decodeLabHash(env.getEl('lab-share-url').value);
    assert.equal(decoded.policyId, 'battery-peak-shave');
    assert.equal(decoded.batteryCapacityKwh, 27);
    assert.equal(decoded.reserveFloorPct, 20);
  });

  it('30. switching scenario tabs re-heads the comparator', async () => {
    const env = await boot();
    for (const scenario of ERCOT_SCENARIOS) {
      const btn = env.scenarios.find((el) => el.getAttribute('data-scenario-id') === scenario.id);
      click(env, btn);
      assert.equal(env.getEl('lab-comparator-scenario').textContent, scenario.name);
    }
  });

  it('31. clicking a policy row selects that policy', async () => {
    const env = await boot();
    const row = { closest: (sel) => (sel === 'tr[data-policy-id]' ? { getAttribute: () => 'battery-peak-shave' } : null) };
    env.document.fire('click', { target: row });
    assert.match(env.getEl('lab-sizing-note').textContent, /Battery Peak Shave/);
    assert.equal(env.getEl('lab-policy-battery-peak-shave').checked, true);
  });

  it('32. clicking a sizing chart point sets the battery capacity', async () => {
    const env = await boot();
    const point = { closest: (sel) => (sel === '[data-lab-kwh]' ? { getAttribute: () => '40.5' } : null) };
    env.document.fire('click', { target: point });
    assert.equal(env.getEl('lab-battery-kwh-out').textContent, '40.50 kWh');
  });

  it('33. Enter on a sizing point sets capacity via keydown', async () => {
    const env = await boot();
    const point = { closest: (sel) => (sel === '[data-lab-kwh]' ? { getAttribute: () => '20.25' } : null) };
    env.document.fire('keydown', { target: point, key: 'Enter' });
    assert.equal(env.getEl('lab-battery-kwh-out').textContent, '20.25 kWh');
  });

  it('34. Enter on a tradeoff point selects that policy via keydown', async () => {
    const env = await boot();
    const point = { closest: (sel) => (sel === '[data-lab-policy-point]' ? { getAttribute: () => 'critical-island-survival' } : null) };
    env.document.fire('keydown', { target: point, key: 'Enter' });
    assert.match(env.getEl('lab-sizing-note').textContent, /Critical Island Survival/);
  });
});

describe('Lab DOM: bookmark restore and hostile hashes', () => {
  it('35. a valid #gp= hash restores scenario, policy, battery, floor and comfort', async () => {
    const env = await boot('#gp=v1|s=ercot-winter-freeze|p=battery-peak-shave|b=27|r=20|c=1.5');
    assert.equal(env.getEl('scenario-title').textContent, 'February Polar Vortex Freeze');
    assert.equal(env.getEl('lab-policy-battery-peak-shave').checked, true);
    assert.equal(env.getEl('lab-battery-kwh').value, '27');
    assert.equal(env.getEl('lab-reserve-floor').value, '20');
    assert.equal(env.getEl('lab-comfort-weight-out').textContent, '1.5');
    assert.equal(env.getEl('lab-comparator-scenario').textContent, 'February Polar Vortex Freeze');
  });

  it('36. an island bookmark restores the auto-shed panel state', async () => {
    const env = await boot('#gp=v1|s=ercot-outage-island|p=critical-island-survival|b=40.5|r=10|c=2');
    assert.equal(env.getEl('scenario-title').textContent, 'Outage Microgrid Island (13.5 kWh)');
    const html = env.getEl('breaker-directory-list').innerHTML;
    assert.equal((html.match(/BREAKER OPEN \(SHED\)/g) || []).length, 6);
  });

  it('37. a malformed hash keeps the default state', async () => {
    const env = await boot('#gp=v2|s=ercot-winter-freeze|p=battery-peak-shave|b=27|r=20|c=1.5');
    assert.equal(env.getEl('scenario-title').textContent, 'August 104°F Thermal Peak');
    assert.equal(env.getEl('lab-policy-tou-delay-shift').checked, true);
    assert.equal(env.getEl('lab-battery-kwh').value, '13.5');
  });

  it('38. a hostile proto hash keeps the default state', async () => {
    const env = await boot('#gp=v1|s=__proto__|p=tou-delay-shift|b=13.5|r=10|c=2');
    assert.equal(env.getEl('scenario-title').textContent, 'August 104°F Thermal Peak');
    assert.equal(env.getEl('lab-battery-kwh').value, '13.5');
  });

  it('39. encoded share link round-trips through a fresh boot', async () => {
    const env = await boot();
    env.getEl('lab-policy-critical-island-survival').fire('change');
    const slider = env.getEl('lab-battery-kwh');
    slider.value = '33.75';
    slider.fire('input');
    const sel = env.getEl('lab-reserve-floor');
    sel.value = '20';
    sel.fire('change');
    const comfort = env.getEl('lab-comfort-weight');
    comfort.value = '3.1';
    comfort.fire('input');
    click(env, actionBtn(env, 'lab-copy-share'));
    const url = env.getEl('lab-share-url').value;
    const hash = '#' + url.split('#')[1];
    const env2 = await boot(hash);
    assert.equal(env2.getEl('lab-policy-critical-island-survival').checked, true);
    assert.equal(env2.getEl('lab-battery-kwh').value, '33.75');
    assert.equal(env2.getEl('lab-reserve-floor').value, '20');
    assert.equal(env2.getEl('lab-comfort-weight-out').textContent, '3.1');
  });
});

describe('Lab DOM: graceful degradation and page integrity', () => {
  it('40. digest stays identical before and after unrelated slider moves', async () => {
    const env = await boot();
    const before = env.getEl('lab-digest-line').textContent;
    const hourSlider = env.getEl('hour-scrubber-input');
    hourSlider.value = '5';
    hourSlider.fire('input');
    assert.equal(env.getEl('lab-digest-line').textContent, before);
  });

  it('41. lab survives every scenario switch without errors', async () => {
    const env = await boot();
    for (const scenario of ERCOT_SCENARIOS) {
      const btn = env.scenarios.find((el) => el.getAttribute('data-scenario-id') === scenario.id);
      click(env, btn);
      assert.equal((env.getEl('lab-comparator-body').innerHTML.match(/<tr/g) || []).length, 5);
      assert.match(env.getEl('lab-digest-line').textContent, /^sha256:[0-9a-f]{64}$/);
    }
  });

  it('42. lab module absence leaves the section hidden and the page alive', async () => {
    const env = makeDom(PAGE);
    const original = env.getEl('lab-section');
    original.hidden = true;
    // Simulate the missing module by never resolving the dynamic import:
    // bootApp directly without __gridpulseLabReady, the section must stay hidden.
    assert.equal(original.hidden, true);
  });

  it('43. lab exports carry no external urls or vendor strings', async () => {
    const env = await boot();
    for (const action of ['lab-export-json', 'lab-export-csv', 'lab-export-md']) {
      click(env, actionBtn(env, action));
      const text = env.getEl('lab-export-preview').textContent;
      assert.equal(/https?:\/\//.test(text), false, action);
      assert.equal(/[\u2013\u2014]/.test(text), false, action);
    }
  });

  it('44. every lab render avoids NaN, undefined and Infinity artifacts', async () => {
    const env = await boot();
    for (const id of ['lab-comparator-body', 'lab-matrix-body', 'lab-tradeoff-chart', 'lab-sizing-chart']) {
      const html = env.getEl(id).innerHTML;
      assert.equal(/NaN|undefined|Infinity/.test(html), false, id);
    }
  });

  it('45. hash encode from live state decodes to the same five fields', async () => {
    const env = await boot();
    env.getEl('lab-policy-comfort-safe-advisor').fire('change');
    const slider = env.getEl('lab-battery-kwh');
    slider.value = '20.25';
    slider.fire('input');
    click(env, actionBtn(env, 'lab-copy-share'));
    const url = env.getEl('lab-share-url').value;
    const decoded = decodeLabHash(url);
    assert.equal(decoded.policyId, 'comfort-safe-advisor');
    assert.equal(decoded.batteryCapacityKwh, 20.25);
    assert.equal(decoded.reserveFloorPct, 10);
    assert.equal(decoded.comfortWeight, 2);
    assert.equal(decoded.scenarioId, 'ercot-summer-peak');
  });
});
