import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ERCOT_SCENARIOS,
  HOUSEHOLD_CIRCUITS,
  createInitialAppState,
  applyAppAction,
  buildUiViewState
} from '../js/gridpulse-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(repoRoot, 'js/app.js'), 'utf8');

test('DOM Smoke 01: index.html starts with HTML5 doctype and lang=en', () => {
  assert.match(indexHtml.trimStart(), /^<!DOCTYPE html>/i);
  assert.match(indexHtml, /<html\s+lang="en"/i);
});

test('DOM Smoke 02: index.html contains exactly one <h1> element', () => {
  const h1Matches = indexHtml.match(/<h1\b[^>]*>/gi) || [];
  assert.equal(h1Matches.length, 1);
});

test('DOM Smoke 03: heading hierarchy in index.html never skips levels', () => {
  const levels = [...indexHtml.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  assert.ok(levels.length >= 8);
  assert.equal(levels[0], 1);
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(
      levels[i] <= levels[i - 1] + 1,
      `Heading level jumped from h${levels[i - 1]} to h${levels[i]}`
    );
  }
});

test('DOM Smoke 04: all id attributes in index.html are unique', () => {
  const ids = [...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 30);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, 'Duplicate IDs found in index.html');
});

test('DOM Smoke 05: OpenGraph and Twitter meta tags are complete', () => {
  assert.match(indexHtml, /property="og:title"\s+content="[^"]+"/);
  assert.match(indexHtml, /property="og:description"\s+content="[^"]+"/);
  assert.match(indexHtml, /property="og:type"\s+content="website"/);
  assert.match(indexHtml, /property="og:url"\s+content="https:\/\/[^"]+"/);
  assert.match(indexHtml, /name="twitter:card"\s+content="summary_large_image"/);
});

test('DOM Smoke 06: inline SVG favicon link is present in <head>', () => {
  assert.match(indexHtml, /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="data:image\/svg\+xml,/);
});

test('DOM Smoke 07: accessible skip-link points to #main-console and target exists', () => {
  assert.match(indexHtml, /<a\s+class="skip-link"\s+href="#main-console">/);
  assert.match(indexHtml, /<main\s+id="main-console"/);
});

test('DOM Smoke 08: <noscript> fallback banner is present inside <body>', () => {
  assert.match(indexHtml, /<noscript>[\s\S]*?<div\s+class="noscript-banner"[\s\S]*?<\/noscript>/);
});

test('DOM Smoke 09: styles.css enforces overflow-x: clip on html and body', () => {
  assert.match(stylesCss, /html,\s*body\s*\{\s*overflow-x:\s*clip;/);
});

test('DOM Smoke 10: styles.css provides :focus-visible outline and reduced-motion guard', () => {
  assert.match(stylesCss, /:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(stylesCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('DOM Smoke 11: styles.css enforces tabular-nums on numeric readouts', () => {
  assert.match(stylesCss, /font-variant-numeric:\s*tabular-nums/);
});

test('DOM Smoke 12: zero em-dashes or en-dashes across HTML, CSS, and UI JS', () => {
  assert.equal(/[\u2013\u2014]/.test(indexHtml), false);
  assert.equal(/[\u2013\u2014]/.test(stylesCss), false);
  assert.equal(/[\u2013\u2014]/.test(appJs), false);
});

test('DOM Smoke 13: zero emoji characters across HTML, CSS, and UI JS', () => {
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(indexHtml), false);
  assert.equal(emojiRegex.test(stylesCss), false);
  assert.equal(emojiRegex.test(appJs), false);
});

test('DOM Smoke 14: zero uppercase CSS transforms in styles.css', () => {
  assert.equal(/text-transform\s*:\s*uppercase/i.test(stylesCss), false);
});

test('DOM Smoke 15: all 4 ERCOT scenario buttons in index.html match ERCOT_SCENARIOS', () => {
  const scenarioBtns = [...indexHtml.matchAll(/data-scenario-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(scenarioBtns.length, 4);
  assert.deepEqual(scenarioBtns, ERCOT_SCENARIOS.map((s) => s.id));
});

test('DOM Smoke 16: all DOM IDs updated via setText/setHtml in js/app.js exist in index.html', () => {
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const boundIds = [...appJs.matchAll(/set(?:Text|Html)\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(boundIds.length >= 25);
  for (const id of boundIds) {
    assert.ok(htmlIds.has(id), `ID #${id} updated in js/app.js is missing from index.html`);
  }
});

test('DOM Smoke 17: master relay actuator buttons in index.html match action handlers in js/app.js', () => {
  assert.match(indexHtml, /data-action="auto-optimize"/);
  assert.match(indexHtml, /data-action="island-critical-only"/);
  assert.match(indexHtml, /data-action="reset-baseline"/);
  assert.match(indexHtml, /data-action="toggle-solar"/);
  assert.match(indexHtml, /data-action="print-schedule"/);
});

test('DOM Smoke 18: hour scrubber and battery SoC range sliders have matching min, max, and step attributes', () => {
  assert.match(indexHtml, /id="hour-scrubber-input"[\s\S]*?min="0"[\s\S]*?max="23"/);
  assert.match(indexHtml, /id="battery-soc-slider"[\s\S]*?min="20"[\s\S]*?max="100"/);
});

test('DOM Smoke 19: all 8 household circuits render clean HTML cards and print rows without dashes', () => {
  const view = buildUiViewState(createInitialAppState());
  for (const circuit of HOUSEHOLD_CIRCUITS) {
    assert.ok(view.breakerDirectoryHtml.includes(`data-circuit-card="${circuit.id}"`));
    assert.ok(view.printScheduleRowsHtml.includes(circuit.name));
  }
  assert.equal(/[\u2013\u2014]/.test(view.breakerDirectoryHtml), false);
  assert.equal(/[\u2013\u2014]/.test(view.printScheduleRowsHtml), false);
});

test('DOM Smoke 20: buildUiViewState produces valid SVG oscilloscope and telemetry across all 4 ERCOT scenarios', () => {
  for (const scenario of ERCOT_SCENARIOS) {
    let state = createInitialAppState();
    state = applyAppAction(state, { type: 'SELECT_SCENARIO', scenarioId: scenario.id });
    state = applyAppAction(state, { type: 'AUTO_OPTIMIZE' });
    const view = buildUiViewState(state);
    assert.equal(view.scenarioId, scenario.id);
    assert.ok(view.oscilloscopeSvg.includes('<svg class="oscilloscope-svg"'));
    assert.equal(/[\u2013\u2014]/.test(view.scenarioSummary), false);
  }
});
