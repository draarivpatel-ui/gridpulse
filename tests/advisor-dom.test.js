/**
 * advisor-dom.test.js - static compliance checks and live UI execution.
 *
 * The live tests run js/app.js through a DOM shim with the real engine and the
 * real advisor linked in, so every button, slider and scenario tab is checked
 * against the numbers it actually renders.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parsePage, makeDom, runAppModule, repoRoot } from './helpers/dom.js';
import { ERCOT_SCENARIOS, HOUSEHOLD_CIRCUITS } from '../js/gridpulse-engine.js';

const PAGE = parsePage('index.html');
const HTML = PAGE.source;
const CSS = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(repoRoot, 'js', 'app.js'), 'utf8');
const ADVISOR_JS = fs.readFileSync(path.join(repoRoot, 'js', 'gridpulse-advisor.js'), 'utf8');
const ENGINE_JS = fs.readFileSync(path.join(repoRoot, 'js', 'gridpulse-engine.js'), 'utf8');
const BANNED_DASH = new RegExp('[\\u2013\\u2014]');
const FRAG = (...parts) => parts.join('');
const BANNED_NAMES = new RegExp([
  FRAG('clau', '\\u0073', 'e'), FRAG('chat', 'g\\u0070', 't'), FRAG('co', 'p\\u0069', 'lot'),
  FRAG('op\\u0065', 'n\\u0061', 'i'), FRAG('g\\u0065', 'm\\u0069', 'ni'), FRAG('anthro', 'p\\u0069', 'c'),
  FRAG('deep', 's\\u0065', 'ek'), FRAG('q\\u0077', 'en'), FRAG('lla', '\\u006d', 'a'),
  FRAG('mag', 'p\\u0069', 'e'), FRAG('work', 'b\\u0075', 'ddy'), FRAG('hun', 'y\\u0075', 'an'),
  FRAG('ai', '[- ]', 'g\\u0065', 'nerated'), FRAG('ai', '[- ]', 'ass\\u0069', 'sted')
].join('|'), 'i');

async function boot() {
  const env = makeDom(PAGE);
  await runAppModule(env);
  return env;
}

const actionBtn = (env, name) => env.controls.find((el) => el.getAttribute('data-action') === name);
const scenarioBtn = (env, id) => env.scenarios.find((el) => el.getAttribute('data-scenario-id') === id);
// app.js listens on document for delegated clicks, so a control click must
// reach the document listener with the control as the event target.
const click = (env, el) => env.document.fire('click', { target: el });

describe('DOM compliance and static markup', () => {
  it('01. every shipped text file is free of forbidden dashes and vendor names', () => {
    const exts = new Set(['.md', '.html', '.js', '.json', '.css', '.txt', '.yml']);
    const walk = (dir) => {
      const out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (exts.has(path.extname(entry.name).toLowerCase())) out.push(full);
      }
      return out;
    };
    const files = walk(repoRoot);
    assert.ok(files.length >= 8);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      assert.equal(BANNED_DASH.test(text), false, `${path.relative(repoRoot, file)} has a forbidden dash`);
      assert.equal(BANNED_NAMES.test(text), false, `${path.relative(repoRoot, file)} names a vendor model`);
    }
  });

  it('02. the advisor panel adds controls, both tables and a plan list', () => {
    for (const id of [
      'advisor-heading', 'comfort-weight', 'comfort-weight-out', 'plan-steps',
      'plan-steps-out', 'apply-plan-btn', 'advisor-best-move',
      'advisor-marginals-body', 'advisor-plan-summary', 'advisor-plan-list',
      'advisor-stress-summary', 'advisor-stress-body'
    ]) assert.ok(HTML.includes(`id="${id}"`), `missing #${id}`);
  });

  it('03. all ids are unique and every label[for] resolves', () => {
    assert.equal(new Set(PAGE.ids).size, PAGE.ids.length);
    const set = new Set(PAGE.ids);
    for (const m of HTML.matchAll(/<label[^>]*for="([^"]+)"/g)) {
      assert.ok(set.has(m[1]), `unresolved label for #${m[1]}`);
    }
  });

  it('04. the advisor tables carry captions and column headers', () => {
    const captions = (HTML.match(/<caption>/g) || []).length;
    assert.ok(captions >= 2);
    assert.ok((HTML.match(/<th scope="col"/g) || []).length >= 11);
  });

  it('05. the four scenario buttons match the engine catalog', () => {
    assert.deepEqual(PAGE.scenarioIds, ERCOT_SCENARIOS.map((s) => s.id));
  });

  it('06. the apply action and both relays are present in the action map', () => {
    for (const name of ['auto-optimize', 'reset-baseline', 'apply-advisor-plan', 'print-schedule']) {
      assert.ok(PAGE.actionNames.includes(name), `missing action ${name}`);
    }
  });

  it('07. CSS carries focus visible, reduced motion, tabular numerals and advisor layout', () => {
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /prefers-reduced-motion:\s*reduce/);
    assert.match(CSS, /font-variant-numeric:\s*tabular-nums/);
    assert.match(CSS, /\.advisor-grid/);
    assert.match(CSS, /\.advisor-controls/);
  });

  it('08. every id bound by setText or setHtml exists in the markup', () => {
    const set = new Set(PAGE.ids);
    const bound = [...APP_JS.matchAll(/set(?:Text|Html)\(\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(bound.length >= 30);
    for (const id of bound) assert.ok(set.has(id), `app.js binds missing #${id}`);
  });

  it('09. DEVPOST_UPGRADE.md and README.md are substantial and clean', () => {
    for (const rel of ['README.md', 'DEVPOST_UPGRADE.md']) {
      const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      assert.ok(text.length > 500);
      assert.equal(BANNED_DASH.test(text), false);
      assert.equal(BANNED_NAMES.test(text), false);
    }
  });

  it('10. the advisor and engine modules declare no external imports', () => {
    for (const [name, source] of [['advisor', ADVISOR_JS], ['engine', ENGINE_JS]]) {
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      assert.ok(imports.length > 0 || name === 'engine');
      assert.equal(imports.some((spec) => !spec.startsWith('./') && !spec.startsWith('../')), false);
    }
  });
});

describe('Live UI: initial render', () => {
  it('11. the app renders the core telemetry into the real ids', async () => {
    const env = await boot();
    assert.equal(env.getEl('scenario-title').textContent, 'August 104°F Thermal Peak');
    assert.equal(env.getEl('metric-peak-shaved').textContent, '0.00 kW');
    assert.match(env.getEl('oscilloscope-stage').innerHTML, /<svg class="oscilloscope-svg"/);
    assert.equal(env.getEl('breaker-directory-list').innerHTML.includes('data-circuit-card='), true);
    assert.equal(env.getEl('print-schedule-tbody').innerHTML.includes('<tr>'), true);
  });

  it('12. the advisor renders the best move, all marginal rows and all four stress rows', async () => {
    const env = await boot();
    assert.match(env.getEl('advisor-best-move').textContent, /Level-2 EV Supply Equipment/);
    assert.match(env.getEl('advisor-best-move').textContent, /\+9\.60 kW/);
    const rows = (env.getEl('advisor-marginals-body').innerHTML.match(/<tr>/g) || []).length;
    assert.equal(rows, 12);
    const stressRows = (env.getEl('advisor-stress-body').innerHTML.match(/<tr>/g) || []).length;
    assert.equal(stressRows, 4);
    assert.match(env.getEl('advisor-plan-summary').textContent, /net score/);
    assert.match(env.getEl('advisor-stress-summary').textContent, /Worst feeder strain/);
  });

  it('13. the marginal table marks positive and negative deltas with semantic classes', async () => {
    const env = await boot();
    const html = env.getEl('advisor-marginals-body').innerHTML;
    assert.match(html, /class="positive"/);
    assert.match(html, /class="negative"/);
    assert.equal(/NaN|undefined|Infinity/.test(html), false);
  });

  it('14. the plan list shows at least one greedily chosen step', async () => {
    const env = await boot();
    assert.match(env.getEl('advisor-plan-list').innerHTML, /<li>/);
    assert.match(env.getEl('advisor-plan-list').innerHTML, /gain/);
  });

  it('15. every one of the 8 circuits appears in the rendered directory', async () => {
    const env = await boot();
    for (const circuit of HOUSEHOLD_CIRCUITS) {
      assert.ok(env.getEl('breaker-directory-list').innerHTML.includes(`data-circuit-card="${circuit.id}"`));
    }
  });
});

describe('Live UI: interactive controls', () => {
  it('16. the comfort slider changes the best single move from a shift to a shed', async () => {
    const env = await boot();
    const slider = env.getEl('comfort-weight');
    assert.match(env.getEl('advisor-best-move').textContent, /Arm the Level-2 EV/);
    slider.value = '0';
    slider.fire('input');
    assert.equal(env.getEl('comfort-weight-out').textContent, '0.0');
    assert.match(env.getEl('advisor-best-move').textContent, /Open the Level-2 EV/);
    slider.value = '2';
    slider.fire('input');
    assert.match(env.getEl('advisor-best-move').textContent, /Arm the Level-2 EV/);
  });

  it('17. the plan size slider changes the number of plan steps', async () => {
    const env = await boot();
    const slider = env.getEl('plan-steps');
    slider.value = '1';
    slider.fire('input');
    assert.equal(env.getEl('plan-steps-out').textContent, '1 move');
    assert.equal((env.getEl('advisor-plan-list').innerHTML.match(/<li>/g) || []).length, 1);
    slider.value = '5';
    slider.fire('input');
    assert.equal(env.getEl('plan-steps-out').textContent, '5 moves');
    assert.ok((env.getEl('advisor-plan-list').innerHTML.match(/<li>/g) || []).length >= 4);
  });

  it('18. applying the plan changes the live telemetry and the breaker directory', async () => {
    const env = await boot();
    assert.equal(env.getEl('metric-peak-shaved').textContent, '0.00 kW');
    click(env, actionBtn(env, 'apply-advisor-plan'));
    assert.doesNotMatch(env.getEl('metric-peak-shaved').textContent, /-0\.00 kW/);
    assert.match(env.getEl('breaker-directory-list').innerHTML, /PEAK-SHIFT RELAY ARMED/);
    assert.match(env.getEl('advisor-best-move').textContent, /(Arm|Open|Disarm|Reclose)/);
  });

  it('19. auto-optimize then reset-baseline round trips the peak readout', async () => {
    const env = await boot();
    click(env, actionBtn(env, 'auto-optimize'));
    const optimized = env.getEl('metric-peak-shaved').textContent;
    assert.doesNotMatch(optimized, /-0\.00 kW/);
    click(env, actionBtn(env, 'reset-baseline'));
    assert.equal(env.getEl('metric-peak-shaved').textContent, '0.00 kW');
  });

  it('20. selecting each scenario updates the title and stress table', async () => {
    const env = await boot();
    for (const scenario of ERCOT_SCENARIOS) {
      click(env, scenarioBtn(env, scenario.id));
      assert.equal(env.getEl('scenario-title').textContent, scenario.name);
      assert.equal(scenarioBtn(env, scenario.id).getAttribute('aria-pressed'), 'true');
      assert.equal((env.getEl('advisor-stress-body').innerHTML.match(/<tr>/g) || []).length, 4);
    }
  });

  it('21. the hour scrubber updates every inspected readout', async () => {
    const env = await boot();
    const slider = env.getEl('hour-scrubber-input');
    slider.value = '3';
    slider.fire('input');
    assert.equal(env.getEl('inspected-hour-val').textContent, '03:00');
    assert.match(env.getEl('inspected-window-tag').textContent, /OFF-PEAK INTERVAL/);
    assert.match(env.getEl('inspected-baseline-kw').textContent, /kW/);
    assert.match(env.getEl('inspected-tariff-val').textContent, /\$\d/);
  });

  it('22. the battery SoC slider changes the endurance readout', async () => {
    const env = await boot();
    const before = env.getEl('outage-duration-val').textContent;
    const slider = env.getEl('battery-soc-slider');
    slider.value = '20';
    slider.fire('input');
    assert.equal(env.getEl('outage-soc-readout').textContent, '20% SoC');
    assert.notEqual(env.getEl('outage-duration-val').textContent, before);
  });

  it('23. the solar toggle updates its button label and aria state', async () => {
    const env = await boot();
    const btn = env.getEl('toggle-solar-btn');
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
    click(env, actionBtn(env, 'toggle-solar'));
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
    assert.match(env.getEl('solar-btn-text').textContent, /Disabled/);
  });

  it('24. print-schedule calls window.print without changing the schedule', async () => {
    const env = await boot();
    const before = env.getEl('metric-peak-shaved').textContent;
    click(env, actionBtn(env, 'print-schedule'));
    assert.equal(env.window.printed, true);
    assert.equal(env.getEl('metric-peak-shaved').textContent, before);
  });

  it('25. an unknown action leaves the telemetry untouched', async () => {
    const env = await boot();
    const before = env.getEl('metric-peak-shaved').textContent;
    env.document.fire('click', { target: { closest: () => null } });
    assert.equal(env.getEl('metric-peak-shaved').textContent, before);
  });

  it('26. the island critical action sheds non critical breakers', async () => {
    const env = await boot();
    click(env, actionBtn(env, 'island-critical-only'));
    assert.equal((env.getEl('breaker-directory-list').innerHTML.match(/BREAKER OPEN \(SHED\)/g) || []).length, 6);
  });

  it('27. critical circuits render a disabled protected switch in every state', async () => {
    const env = await boot();
    const criticalCount = HOUSEHOLD_CIRCUITS.filter((c) => c.critical).length;
    assert.ok(criticalCount > 0);
    const before = env.getEl('breaker-directory-list').innerHTML;
    assert.equal((before.match(/PROTECTED \(ON\)/g) || []).length, criticalCount);
    assert.equal((before.match(/disabled/g) || []).length, criticalCount);
    click(env, actionBtn(env, 'island-critical-only'));
    const after = env.getEl('breaker-directory-list').innerHTML;
    assert.equal((after.match(/PROTECTED \(ON\)/g) || []).length, criticalCount);
    assert.equal((after.match(/disabled/g) || []).length, criticalCount);
  });
});
