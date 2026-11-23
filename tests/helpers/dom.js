/**
 * helpers/dom.js - a zero dependency DOM shim for js/app.js.
 *
 * app.js is a plain ES module with static imports. This shim supplies the DOM
 * it needs, then executes the module through vm.SourceTextModule with the real
 * engine and advisor modules linked in, so the interactive tests exercise the
 * actual click handlers and the actual rendering functions.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...n) { n.forEach((x) => this.set.add(x)); }
  remove(...n) { n.forEach((x) => this.set.delete(x)); }
  contains(n) { return this.set.has(n); }
  toggle(n, force) {
    const next = force === undefined ? !this.set.has(n) : Boolean(force);
    if (next) this.set.add(n); else this.set.delete(n);
    return next;
  }
  toString() { return [...this.set].join(' '); }
}

export class El {
  constructor(tag = 'div', id = '') {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.type = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this.hidden = false;
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.children = [];
    this.parentNode = null;
    this.style = { setProperty() {}, width: '' };
    this.classList = new ClassList(this);
    this.scrollTop = 0;
    this.scrollHeight = 400;
    this.clientHeight = 200;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v);
    this.children = [];
  }
  get firstChild() { return this.children[0] ?? null; }
  append(...nodes) {
    for (const n of nodes) {
      if (n instanceof El) { n.parentNode = this; this.children.push(n); }
    }
  }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(v);
    }
    if (k === 'id') this.id = String(v);
  }
  getAttribute(k) {
    return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
  }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, extra = {}) {
    const event = { target: this, preventDefault() {}, ...extra };
    for (const fn of this.listeners[type] ?? []) fn(event);
    return event;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (node, self) => {
      if (!self && matches(node, sel)) out.push(node);
      for (const child of node.children) walk(child, false);
    };
    for (const child of this.children) walk(child, false);
    return out;
  }
  closest(sel) {
    let node = this;
    while (node) {
      if (matches(node, sel)) return node;
      node = node.parentNode;
    }
    return null;
  }
  focus() { this.focused = true; }
}

function matches(node, selector) {
  for (const part of selector.split(',')) {
    const sel = part.trim();
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const body = sel.slice(1, -1);
      const eq = body.indexOf('=');
      if (eq === -1) {
        if (Object.prototype.hasOwnProperty.call(node.attrs, body) ||
            Object.prototype.hasOwnProperty.call(node.dataset, body)) return true;
      } else {
        const key = body.slice(0, eq);
        const value = body.slice(eq + 1).replace(/^["']|["']$/g, '');
        if (node.getAttribute(key) === value) return true;
      }
    } else if (sel.startsWith('.') && node.classList.contains(sel.slice(1))) return true;
    else if (sel.startsWith('#') && node.id === sel.slice(1)) return true;
    else if (node.tagName === sel.toUpperCase()) return true;
  }
  return false;
}

export function parsePage(relativePath) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const attributes = new Map();
  for (const m of source.matchAll(/<(input|select|button|output|table|tbody|div|section)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    if (attrs.id) attributes.set(attrs.id, { tag: m[1], attrs });
  }
  const actionNames = [...source.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
  const scenarioIds = [...source.matchAll(/data-scenario-id="([^"]+)"/g)].map((m) => m[1]);
  return { source, ids, attributes, actionNames, scenarioIds, relativePath };
}

export function makeDom(page) {
  const elements = new Map();
  for (const id of page.ids) {
    const spec = page.attributes.get(id);
    const el = new El(spec?.tag ?? 'div', id);
    if (spec) {
      for (const [key, value] of Object.entries(spec.attrs)) {
        el.setAttribute(key, value);
        if (key === 'value') el.value = value;
        if (key === 'class') el.className = value;
      }
    }
    elements.set(id, el);
  }

  // Synthetic clickable controls for every data-action and data-scenario-id in
  // the static markup. Their parent is the document body so event delegation
  // and closest() behave like the browser.
  const body = new El('body');
  const controls = [];
  for (const [i, name] of page.actionNames.entries()) {
    const btn = new El('button', `action-${i}`);
    btn.setAttribute('data-action', name);
    btn.parentNode = body;
    body.children.push(btn);
    controls.push(btn);
  }
  const scenarios = [];
  for (const [i, id] of page.scenarioIds.entries()) {
    const btn = new El('button', `scenario-${i}`);
    btn.setAttribute('data-scenario-id', id);
    btn.className = i === 0 ? 'scenario-btn active' : 'scenario-btn';
    btn.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    btn.parentNode = body;
    body.children.push(btn);
    scenarios.push(btn);
  }

  const documentListeners = {};
  const document = {
    documentElement: new El('html'),
    body,
    readyState: 'complete',
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tag) => new El(tag),
    createElementNS: (_ns, tag) => new El(tag),
    querySelector: (sel) => body.querySelector(sel) ?? [...elements.values()].find((el) => matches(el, sel)) ?? null,
    querySelectorAll: (sel) => {
      const fromBody = body.querySelectorAll(sel);
      const fromElements = [...elements.values()].filter((el) => matches(el, sel));
      return [...new Set([...fromBody, ...fromElements])];
    },
    addEventListener: (type, fn) => (documentListeners[type] ??= []).push(fn),
    fire: (type, extra = {}) => {
      const event = { target: body, preventDefault() {}, ...extra };
      for (const fn of documentListeners[type] ?? []) fn(event);
      return event;
    }
  };
  const window = { print() { window.printed = true; }, printed: false, matchMedia: () => ({ matches: false }) };
  const globals = { document, window, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {} };
  return { document, window, elements, controls, scenarios, globals, getEl: (id) => elements.get(id) ?? null };
}

export async function runAppModule(env) {
  const appPath = path.join(repoRoot, 'js', 'app.js');
  const source = fs.readFileSync(appPath, 'utf8');
  const moduleUrl = pathToFileURL(appPath).href;
  const context = vm.createContext(env.globals);
  const syntheticFor = async (specifier, referencing) => {
    const resolved = new URL(specifier, referencing);
    const namespace = await import(resolved.href);
    const keys = Object.keys(namespace);
    return new vm.SyntheticModule(keys, function () {
      for (const key of keys) this.setExport(key, namespace[key]);
    }, { context, identifier: resolved.href });
  };
  const mod = new vm.SourceTextModule(source, {
    context,
    identifier: moduleUrl,
    initializeImportMeta(meta) { meta.url = moduleUrl; },
    // app.js lazily imports the lab module so the page still works when the
    // file is missing. The shim resolves that dynamic import to the real
    // module through the same synthetic-module path used for static imports.
    importModuleDynamically: async (specifier) => {
      const dynamic = await syntheticFor(specifier, moduleUrl);
      await dynamic.link(() => syntheticFor('', moduleUrl));
      await dynamic.evaluate();
      return dynamic;
    }
  });
  await mod.link((spec, ref) => syntheticFor(spec, ref.identifier ?? moduleUrl));
  await mod.evaluate();
  return mod;
}

