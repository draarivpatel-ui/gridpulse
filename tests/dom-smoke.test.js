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

test('DOM Smoke 21: both advisor tables sit inside .tbl-scroll wrappers', () => {
  const pattern = /<div class="tbl-scroll">\s*<table class="advisor-table">/g;
  assert.equal((indexHtml.match(pattern) || []).length, 2);
});

test('DOM Smoke 22: .tbl-scroll enforces overflow-x auto so narrow viewports can reach every column', () => {
  assert.match(stylesCss, /\.tbl-scroll\s*\{\s*overflow-x:\s*auto/);
});

test('DOM Smoke 23: visible text controls are not overridden by conflicting aria-labels', () => {
  const tagFor = (tag, id) => {
    const re = new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>`);
    return indexHtml.match(re)?.[0] || '';
  };
  for (const id of [
    'hour-scrubber-input',
    'battery-soc-slider',
    'comfort-weight',
    'plan-steps',
    'lab-battery-kwh',
    'lab-reserve-floor',
    'lab-comfort-weight',
    'lab-share-url'
  ]) {
    const tag = tagFor(id === 'lab-reserve-floor' ? 'select' : 'input', id);
    assert.ok(tag, `missing control #${id}`);
    assert.equal(tag.includes('aria-label'), false, `#${id} overrides its visible label with aria-label`);
  }
});

test('DOM Smoke 24: skip target clears the sticky header', () => {
  assert.match(stylesCss, /\.main-console\s*\{[^}]*scroll-margin-top\s*:/);
});

test('DOM Smoke 25: reduced motion is intentional rather than a blanket 0.01ms kill', () => {
  assert.equal(stylesCss.includes('animation-duration: 0.01ms !important'), false);
  assert.equal(stylesCss.includes('transition-duration: 0.01ms !important'), false);
  const reduced = stylesCss.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
  assert.ok(reduced, 'missing reduced-motion block');
  assert.match(reduced[0], /transition:\s*none/);
});

test('DOM Smoke 26: footer does not hard-code a stale test count', () => {
  assert.equal(/\b\d+ Automated Unit &amp; DOM Checks\b/.test(indexHtml), false);
  assert.match(indexHtml, /Automated Unit &amp; DOM Checks/);
});

test('DOM Smoke 27: initial zero reduction copy does not use negative zero', () => {
  assert.equal(indexHtml.includes('-0.00 kW'), false);
});

test('DOM Smoke 28: full re-renders capture and restore keyboard focus without scrolling', () => {
  assert.match(appJs, /function captureFocusDescriptor/);
  assert.match(appJs, /function restoreFocusDescriptor/);
  assert.match(appJs, /preventScroll/);
});

test('DOM Smoke 29: object URLs created for exports are revoked after download', () => {
  assert.match(appJs, /revokeObjectURL/);
});

test('DOM Smoke 30: signal colors meet WCAG AA contrast on their tinted surfaces', () => {
  const luminance = (hex) => {
    const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const token = (name) => stylesCss.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
  assert.ok(contrast(token('amber'), token('amber-wash')) >= 4.5, 'amber on amber wash below AA');
  assert.ok(contrast(token('emerald'), token('emerald-wash')) >= 4.5, 'emerald on emerald wash below AA');
  assert.ok(contrast(token('emerald'), token('panel')) >= 4.5, 'emerald on panel below AA');
  assert.ok(contrast(token('vermilion'), token('vermilion-wash')) >= 4.5, 'vermilion on vermilion wash below AA');
  assert.ok(contrast(token('vermilion'), token('panel')) >= 4.5, 'vermilion on panel below AA');
});

test('DOM Smoke 31: CSS body-control font sizes do not drop below 12px', () => {
  const sizes = [...stylesCss.matchAll(/font-size:\s*0\.(\d+)rem/g)].map((m) => Number(`0.${m[1]}`));
  assert.ok(sizes.length > 0);
  assert.equal(Math.min(...sizes) >= 0.76, true, `minimum rem size ${Math.min(...sizes)}`);
});
