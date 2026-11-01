import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { z } from 'zod';
import { makeClientContribution, makeSchemas, METHODS } from '../src/contract.js';

// Exercise the owned frontend source, embedding the exact build contract in memory.
// Focused frontend tests never publish lib artifacts, start servers, or contact MCP.
const rawSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
const contractSource = (await readFile(new URL('../src/contract.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
const source = rawSource.replace('/* BUILD_SHARED_CONTRACT */', contractSource);
const plain = (value) => JSON.parse(JSON.stringify(value));
const serverId = 'a'.repeat(24);
const httpConfig = { id: serverId, label: 'Servidor de teste', transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: { Authorization: 'api_token' } };
const makeSnapshot = (overrides = {}) => ({ revision: 4, capabilities: { saveAndActivate: true }, servers: [], vault: { mode: 'passphrase', initialized: false, locked: true, expiresAt: 0, refs: [] }, external: [], externalInventory: 'unavailable', ...overrides });
const automatic = (refs = [], initialized = refs.length > 0) => ({ mode: 'automatic', initialized, locked: false, expiresAt: 0, refs });
const unlocked = (refs = []) => ({ initialized: true, locked: false, expiresAt: Date.now() + 300000, refs });
const rowFor = (config = httpConfig, state = 'disabled', enabled) => ({ config, serverName: 'pc_' + config.id, state, ...(enabled === undefined ? {} : { enabled }) });
const persistentCapabilities = { saveAndActivate: true, persistentActivation: true };

function hookRuntime() {
  const hooks = []; let cursor = 0; let effects = [], layoutEffects = [];
  const changed = (previous, next) => !previous || !next || previous.length !== next.length || previous.some((v, i) => v !== next[i]);
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const i = cursor++;
      if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, (next) => { hooks[i].value = typeof next === 'function' ? next(hooks[i].value) : next; }];
    },
    useRef(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { current: initial }; return hooks[i]; },
    useId() { const i = cursor++; if (!hooks[i]) hooks[i] = { value: ':mcp-test:' + i }; return hooks[i].value; },
    useCallback(fn, deps) { const i = cursor++; if (!hooks[i] || changed(hooks[i].deps, deps)) hooks[i] = { fn, deps }; return hooks[i].fn; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || changed(hooks[i].deps, deps)) {
        const previous = hooks[i]; const record = { deps }; hooks[i] = record;
        effects.push(() => { previous?.cleanup?.(); record.cleanup = fn(); });
      }
    },
    useLayoutEffect(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || changed(hooks[i].deps, deps)) {
        const previous = hooks[i]; const record = { deps }; hooks[i] = record;
        layoutEffects.push(() => { previous?.cleanup?.(); record.cleanup = fn(); });
      }
    }
  };
  return { React, begin: () => { cursor = 0; }, effects: () => { const queue = [...layoutEffects, ...effects]; layoutEffects = []; effects = []; for (const fn of queue) fn(); }, dispose: () => { for (const hook of hooks) hook?.cleanup?.(); }, values: () => hooks.map((hook) => hook?.value) };
}
const primitives = { Button: function NativeButton() {}, Modal: function NativeModal() {}, Checkbox: function NativeCheckbox() {}, Switch: function NativeSwitch() {} };
function walk(node, result = []) {
  if (Array.isArray(node)) { for (const child of node) walk(child, result); return result; }
  if (!node || typeof node !== 'object' || !node.type) return result;
  result.push(node);
  for (const child of node.children ?? []) walk(child, result);
  if (typeof node.type === 'function' && !Object.values(primitives).includes(node.type)) walk(node.type(node.props), result);
  if (node.props.footer) walk(node.props.footer, result);
  return result;
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return (node.children ?? []).map(text).join(' ');
}
// Synthetic rectangles exercise geometry math and event/lifecycle wiring only.
// This is deliberately NOT a browser renderer or proof of real pixel stability.
function popupGeometryFixture({ native = false, showFails = false, viewport = { width: 480, height: 640 } } = {}) {
  const target = () => {
    const listeners = new Map();
    return { listeners, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, dispatch(name, event = {}) { for (const fn of listeners.get(name) ?? []) fn(event); } };
  };
  const view = { ...target(), innerWidth: viewport.width, innerHeight: viewport.height, visualViewport: { ...target(), offsetLeft: 0, offsetTop: 0, ...viewport }, getComputedStyle: (node) => ({ overflowX: 'visible', overflowY: 'visible', getPropertyValue: (name) => node.computed?.[name] ?? ({ '--mcp-info-max-width': '340px', '--mcp-info-max-height': '360px' })[name] ?? '', ...node.computed }) };
  const observers = [];
  view.ResizeObserver = class { constructor(callback) { this.callback = callback; this.nodes = new Set(); observers.push(this); } observe(node) { this.nodes.add(node); } disconnect() { this.nodes.clear(); } deliver() { if (this.nodes.size) this.callback([]); } };
  const node = (rect, parentElement = null, computed = {}) => ({ rect, parentElement, computed: { ...computed }, style: {}, clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0, offsetWidth: rect.right - rect.left, offsetHeight: rect.bottom - rect.top, clientWidth: rect.right - rect.left, clientHeight: rect.bottom - rect.top, getBoundingClientRect() { return this.rect; }, contains(value) { for (let current = value; current; current = current.parentElement) if (current === this) return true; return false; } });
  const clip = node({ left: 20, top: 60, right: 460, bottom: 560 }, null, { overflowX: 'hidden', overflowY: 'auto' });
  const card = node({ left: 32, top: 90, right: 448, bottom: 250 }, clip);
  const row = node({ left: 44, top: 130, right: 436, bottom: 174 }, card);
  const trigger = node({ left: 44, top: 130, right: 88, bottom: 174 }, row);
  trigger.closest = (selector) => selector === '[data-server-id]' ? card : selector === '.mcp-compact-row' ? row : null;
  let focused = 0; trigger.querySelector = () => ({ focus: () => focused++ });
  const popup = node({ left: 0, top: 0, right: 1, bottom: 1 }, trigger);
  popup.offsetParent = row; popup.firstElementChild = { scrollHeight: 800 }; popup.attributes = new Map();
  popup.setAttribute = (name, value) => popup.attributes.set(name, value); popup.removeAttribute = (name) => popup.attributes.delete(name);
  const shows = [], hides = [];
  if (native) { popup.showPopover = () => { shows.push({ ...popup.style }); if (showFails) throw Error('Synthetic unsupported popover context'); }; popup.hidePopover = () => hides.push({ ...popup.style }); }
  const attach = (document) => { document.defaultView = view; document.documentElement = { clientWidth: viewport.width, clientHeight: viewport.height }; for (const item of [clip, card, row, trigger, popup]) item.ownerDocument = document; };
  return { view, clip, card, row, trigger, popup, observers, shows, hides, attach, makeNode: node, focused: () => focused };
}
async function setup(options = {}) {
  let definition; const hooks = hookRuntime(); const dictionaries = {}; const styles = options.document?.styles ?? []; const cleanups = []; const registrations = [];
  const requests = [], warnings = [], infos = [], iconWarnings = [], subscriptions = new Set(), timers = new Map(); let timerId = 0, requires = 0;
  let snapshot = makeSnapshot(options.snapshot), tree;
  const root = { passwords: [], querySelectorAll: () => root.passwords };
  const document = options.document ?? { createElement: () => ({ dataset: {}, remove() { this.removed = true; } }), head: { appendChild: (node) => styles.push(node) } };
  const geometry = options.geometry === null ? null : options.geometry ?? popupGeometryFixture(); geometry?.attach(document);
  const domListeners = new Map();
  document.addEventListener = (name, listener, capture) => { assert.equal(capture, true); if (!domListeners.has(name)) domListeners.set(name, new Set()); domListeners.get(name).add(listener); };
  document.removeEventListener = (name, listener, capture) => { assert.equal(capture, true); domListeners.get(name)?.delete(listener); };
  const dispatch = (name, event) => { for (const listener of domListeners.get(name) ?? []) listener(event); };
  const slotListeners = new Map();
  const evaluatedSource = options.unsupportedReconnect ? source.replace('const { schemas, result: snapshotSchema } = makeSchemas(z);', 'const { schemas, result: snapshotSchema } = makeSchemas(z); delete schemas.reconnect;') : source;
  vm.runInNewContext(evaluatedSource, {
    URL,
    window: { crypto: options.crypto === null ? undefined : options.crypto ?? webcrypto, __DSH_BOOT__: { release: { version: options.bootVersion ?? '0.2.1-rc.2' }, entries: options.bootEntries === undefined ? [{ id: '@deepseek-ai/dsh-client-ui-settings-general', url: '/public-native-test.js', rev: 'opaque-public-test-revision' }] : options.bootEntries }, __ModuleLoader__: { load: (value) => { definition = value; } } }, document, MutationObserver: options.MutationObserver, console: { warn: (...args) => (args[0]?.startsWith('[personal-mcp-console] nav icon category=') ? iconWarnings : warnings).push(args), info: (...args) => infos.push(args) },
    setInterval: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay, interval: true }); return id; },
    clearInterval: (id) => timers.delete(id),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: (id) => timers.delete(id)
  }, { timeout: 1000 });
  assert.equal(requires, 0, 'loader declaration stays inert until factory activation');
  const required = [];
  const plugin = definition.factory((name) => {
    requires++; required.push(name);
    if (name === 'react') return hooks.React;
    if (name === 'zod') return { z };
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error('Unexpected browser external: ' + name);
  });
  let contribution;
  const ctx = {
    remote: {
      $mount: async (value) => { contribution = value; },
      personalMcpConsole: options.missingService ? undefined : Object.fromEntries(METHODS.map((method) => [method, async (request) => {
        requests.push({ method, request: plain(request) });
        if (options.respond) return options.respond(method, request, snapshot);
        if (method !== 'snapshot') snapshot = { ...snapshot, revision: snapshot.revision + 1 };
        if (method === 'saveAndActivate') { const saved = { ...plain(request.server), id: request.server.id ?? 'b'.repeat(24) }; snapshot = { ...snapshot, servers: [...snapshot.servers.filter(({ config }) => config.id !== saved.id), { ...rowFor(saved, 'activation-verified', snapshot.capabilities?.persistentActivation === true ? true : undefined), lastVerifiedAt: 1760000000000 }] }; }
        return { ok: true, value: snapshot };
      }]))
    },
    effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
    inject: (dependencies, callback) => { assert.deepEqual(plain(dependencies), ['remote.personalMcpConsole', 'slots', 'locale', 'connection']); callback(ctx); return () => {}; },
    locale: {
      register: (namespace, entries) => { dictionaries[namespace] = entries; return () => {}; },
      bind: (namespace) => (key) => key === 'nav' ? dictionaries[namespace]['pt-BR'].nav : key
    },
    connection: { generation: { subscribe: (listener) => { subscriptions.add(listener); return () => subscriptions.delete(listener); } } },
    slots: {
      inject: (name, callback) => { assert.equal(name, 'settings.section'); const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup); return cleanup; },
      register: (meta, component) => { registrations.push({ meta, component }); return () => {}; },
      entries: (name) => name === 'settings.section' ? [...registrations.map(({ meta, component }) => ({ options: meta, component })), ...(options.extraRows ?? [])] : name === 'sidebar.settings' ? [...(options.nativeSettings ? [options.nativeSettings] : []), ...(options.extraNativeSettings ?? [])] : [],
      subscribe: (name, callback) => { assert.ok(['settings.section', 'sidebar.settings'].includes(name)); if (!slotListeners.has(name)) slotListeners.set(name, new Set()); const listeners = slotListeners.get(name); listeners.add(callback); return () => listeners.delete(callback); }
    }
  };
  await plugin.apply(ctx);
  const row = registrations[0], injected = row.meta.inject(), t = (key) => options.language ? dictionaries['personal.mcpConsole'][options.language][key] ?? key : key;
  let popupMounted = false;
  function render() {
    hooks.begin(); tree = row.component({ ...injected, ...(options.panelApi ? { api: options.panelApi } : {}), t }); tree.props.ref.current = root;
    if (geometry) {
      const nodes = walk(tree), wrapper = nodes.find((node) => node.props.className === 'mcp-info' && node.props.ref), bubble = nodes.find((node) => node.props.className === 'mcp-info-bubble');
      if (wrapper) wrapper.props.ref.current = geometry.trigger;
      if (bubble) { bubble.props.ref.current = geometry.popup; if (!popupMounted) Object.assign(geometry.popup.style, bubble.props.style); }
      popupMounted = Boolean(bubble);
    }
    return tree;
  }
  async function settle() {
    // Flush mocked effect/microtask turns, never wall-clock timers or external IO.
    for (let i = 0; i < 4; i++) { await Promise.resolve(); render(); hooks.effects(); }
    await Promise.resolve(); render();
    return tree;
  }
  const nodes = () => walk(tree);
  const buttons = (key) => nodes().filter((node) => node.type === primitives.Button && (text(node).trim() === key || node.props['aria-label'] === key || (key === 'reconnect' && node.props['aria-label']?.startsWith('reconnectAction: '))));
  const card = (id = serverId) => nodes().find((node) => node.props['data-server-id'] === id);
  const info = (id = serverId) => walk(card(id)).find((node) => node.type === primitives.Button && node.props['aria-label']?.startsWith('serverInfo: '));
  const button = (key) => { const found = buttons(key)[0]; assert.ok(found, 'Missing native button: ' + key); return found; };
  const input = (name) => { const found = nodes().find((node) => ['input', 'textarea', 'select'].includes(node.type) && node.props.name === name); assert.ok(found, 'Missing field: ' + name); return found; };
  const form = (label) => { const found = nodes().find((node) => node.type === 'form' && node.props['aria-label'] === label); assert.ok(found, 'Missing form: ' + label); return found; };
  const integration = (id = serverId) => { const card = nodes().find((node) => node.props['data-server-id'] === id); const found = walk(card).find((node) => node.type === primitives.Switch); assert.ok(found, 'Missing native integration switch: ' + id); return found; };
  return { definition, plugin, ctx, dictionaries, styles, cleanups, required, contribution, row, requests, warnings, infos, iconWarnings, root, geometry, timers, hooks, render, settle, nodes, button, buttons, input, form, integration, notifySlots: (name) => { for (const callback of slotListeners.get(name) ?? []) callback(); }, slotListeners, domListeners, dispatch, card, info, tree: () => tree, setSnapshot: (next) => { snapshot = next; }, reset: () => { for (const fn of subscriptions) fn(); }, dispose: () => { hooks.dispose(); for (const cleanup of cleanups.reverse()) cleanup(); } };
}

function change(field, value) { field.props.onChange({ target: { value } }); }
function event(elements = {}) { return { preventDefault() {}, currentTarget: { elements } }; }

test('owned Panel retains its inline MCP mark without reading, observing or mutating native navigation', async () => {
  let observers = 0;
  class ForbiddenObserver { constructor() { observers++; assert.fail('Native navigation observation is not supported'); } }
  const document = { styles: [], createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild: (node) => document.styles.push(node) },
    get body() { assert.fail('Native navigation body lookup is forbidden'); },
    querySelector() { assert.fail('Native navigation queries are forbidden'); } };
  const app = await setup({ document, geometry: null, bootVersion: 'SYNTHETIC-PRIVATE-HOST-RELEASE', bootEntries: null, MutationObserver: ForbiddenObserver });
  assert.deepEqual(app.iconWarnings, []);
  assert.equal(observers, 0);
  assert.equal(app.slotListeners.size, 0, 'No subscriptions to native sidebar/settings ledgers');
  assert.ok(!/installSettingsNavMark|nativeGearPaths|data-personal-mcp-tab|__DSH_BOOT__|VOzbGW_|MutationObserver|ctx\.slots\.(?:entries|subscribe)/.test(rawSource));
  assert.ok(!app.styles[0].textContent.includes('data-personal-mcp-tab'));
  assert.equal(app.requests.length, 0, 'Activation does not contact a server');
  app.render();
  const mark = app.nodes().find((node) => node.type === 'svg' && node.props.viewBox === '0 0 195 195');
  assert.ok(mark); assert.equal(mark.props['aria-hidden'], true); assert.equal(mark.props.stroke, 'currentColor');
  assert.equal(mark.children.length, 3); assert.ok(mark.children.every((node) => node.type === 'path' && typeof node.props.d === 'string'));
  assert.ok(!Object.hasOwn(mark.props, 'dangerouslySetInnerHTML'), 'Only owned React SVG/path elements, no native nav replacement');
  app.dispose();
});

test('lazy factory contributes a localized official Settings page between Models and Built-in plugins', async () => {
  const app = await setup();
  assert.equal(app.definition.id, '@masspedro/dsh-mcp-console');
  assert.deepEqual(app.required, ['react', 'zod', '@deepseek-ai/dsh-client-ui-primitives']);
  assert.equal(app.requests.length, 0, 'plugin activation must not read snapshots, unlock, test, or start');
  assert.equal(app.row.meta.name, 'settings.section'); assert.equal(app.row.meta.id, 'personal-mcp-console');
  assert.ok(app.row.meta.order > 10 && app.row.meta.order < 15); assert.equal(app.row.meta.label(), 'MCP');
  assert.equal(app.row.meta.locale, 'personal.mcpConsole');
  assert.deepEqual(plain(app.plugin.inject), ['remote', 'slots', 'locale', 'connection']);
  const entries = app.dictionaries['personal.mcpConsole'];
  assert.deepEqual(Object.keys(entries.en).sort(), Object.keys(entries['pt-BR']).sort());
  assert.equal(entries.en.errors, undefined, 'Native locale dictionaries contain flat string keys only');
  assert.ok(Object.keys(entries.en).some((key) => key.startsWith('errors.')));
  assert.ok(Object.values(entries.en).every((value) => typeof value === 'string'));
  assert.match(entries['pt-BR']['unmounted-shutdown-unverified'], /encerramento do servidor não confirmado/);
  assert.match(entries['pt-BR'].externalNote, /sem copiar, importar, editar, parar ou excluir/);
  assert.equal(entries.pt, entries['pt-BR']);
  for (const method of METHODS) {
    const host = makeClientContribution(z).descriptors.find((d) => d.method === method);
    const browser = app.contribution.descriptors.find((d) => d.method === method);
    assert.equal(browser.id, host.id); assert.equal(browser.result.mode, 'strict'); assert.equal(browser.parameters[0].codec.mode, 'strict');
  }
  assert.ok(app.styles[0].textContent.includes('--dsw-alias-settings-card-fill'));
  app.dispose(); assert.equal(app.styles[0].removed, true);
});

test('browser API sanitizes diagnostics, unknown error codes, undefined responses and corrupt output', async () => {
  let response = { ok: false, error: { code: 'gateway/internal', message: 'SYNTHETIC-PRIVATE-TOKEN' } };
  const app = await setup({ respond: () => response }); const { api } = app.row.meta.inject();
  await assert.rejects(api('snapshot', {}), (e) => e.consoleCode === 'operation-failed' && !JSON.stringify(e).includes('PRIVATE'));
  response = { ok: false, error: { message: 'MCP console: synthetic-private-token' } };
  await assert.rejects(api('snapshot', {}), (e) => e.consoleCode === 'operation-failed');
  response = undefined; await assert.rejects(api('snapshot', {}), (e) => e.consoleCode === 'operation-failed');
  response = { ok: true, value: { revision: 0, secret: 'SYNTHETIC-PRIVATE-TOKEN' } };
  await assert.rejects(api('snapshot', {}), (e) => e.consoleCode === 'snapshot-contract-failed');
  response = { ok: false, error: { code: 'remote-access/denied', message: 'private owner info' } };
  await assert.rejects(api('snapshot', {}), (e) => e.consoleCode === 'owner-required');
  const count = app.requests.length;
  await assert.rejects(api('start', { revision: 0, id: serverId }), (e) => e.consoleCode === 'invalid-input');
  assert.equal(app.requests.length, count, 'unconfirmed start is rejected before RPC'); app.dispose();
});

test('preference quarantine diagnostic is exactly allowlisted without exposing provider values or inventing RPC categories', async () => {
  let response = { ok: false, error: { code: 'gateway/internal', message: 'MCP console: preference-state-ambiguous', details: { token: 'SYNTHETIC_PRIVATE_QUARANTINE_DETAIL' }, result: { password: 'SYNTHETIC_PRIVATE_QUARANTINE_VALUE' } } };
  const app = await setup({ respond: () => response }); const { api } = app.row.meta.inject();
  for (const method of ['start', 'reconnect', 'stop']) await assert.rejects(api(method, { revision: 4, id: serverId, ...(method === 'start' ? { confirmation: 'START THIS SERVER' } : method === 'reconnect' ? { confirmation: 'RECONNECT THIS SERVER' } : {}) }), (error) => {
    assert.deepEqual(plain(error), { consoleCode: 'preference-state-ambiguous', rpcCategory: 'gateway/internal' }); return !JSON.stringify(error).includes('SYNTHETIC_PRIVATE');
  });
  response = { ok: false, error: { code: 'SYNTHETIC_PRIVATE_UNKNOWN_CODE', message: 'MCP console: preference-state-ambiguous' } }; await assert.rejects(api('snapshot', {}), (error) => error.consoleCode === 'preference-state-ambiguous' && error.rpcCategory === 'uncategorized-rpc');
  for (const message of ['MCP console: preference-state-ambiguous SYNTHETIC_PRIVATE_TRAILER', 'MCP console: preference-state-ambiguous\nSYNTHETIC_PRIVATE_TRAILER', 'preference-state-ambiguous', 'MCP console: unknown-preference-state']) {
    response = { ok: false, error: { message } }; await assert.rejects(api('snapshot', {}), (error) => error.consoleCode === 'operation-failed' && !JSON.stringify(error).includes('SYNTHETIC_PRIVATE'));
  }
  assert.ok(!JSON.stringify([app.warnings, app.infos, app.hooks.values()]).includes('SYNTHETIC_PRIVATE')); app.dispose();
});

test('preference quarantine EN/PT notice explains conditional OFF or backend-only reload while normal OFF-unmounted UI stays inert', async () => {
  for (const language of ['en', 'pt-BR']) {
    const snapshot = makeSnapshot({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, 'disabled', false)] });
    const app = await setup({ language, snapshot, respond: (method) => method === 'snapshot' ? { ok: true, value: snapshot } : { ok: false, error: { message: 'MCP console: preference-state-ambiguous', details: 'SYNTHETIC_PRIVATE_QUARANTINE_DETAIL' } } }); app.render(); app.hooks.effects(); await app.settle();
    await app.integration().props.onChange(true); await app.settle(); const copy = app.dictionaries['personal.mcpConsole'][language]['errors.preference-state-ambiguous'];
    assert.ok(text(app.tree()).includes(copy)); assert.ok(!text(app.tree()).includes('SYNTHETIC_PRIVATE')); assert.equal(app.integration().props.checked, false); assert.equal(recoveryIcon(app).props.disabled, true);
    assert.ok(copy.includes(language === 'en' ? 'if available' : 'se disponível')); assert.ok(copy.includes(language === 'en' ? 'backend MCP console plugin' : 'plugin Console MCP no backend')); assert.ok(copy.includes(language === 'en' ? 'refreshing this page does not clear' : 'atualizar esta página não limpa'));
    const credentialNotice = app.dictionaries['personal.mcpConsole'][language]['errors.secret-state-ambiguous']; assert.ok(credentialNotice.includes(language === 'en' ? 'Reload may clean up or restore explicitly enabled console servers; credential writes are not replayed automatically.' : 'Recarregar pode limpar ou restaurar servidores do console explicitamente habilitados; gravações de credenciais não são repetidas automaticamente.'));
    const scope = app.dictionaries['personal.mcpConsole'][language].scopeNote; assert.ok(scope.startsWith(language === 'en' ? 'Save validates and activates; opening or refreshing this screen does not connect.' : 'Salvar valida e ativa; abrir ou atualizar esta tela não conecta.')); assert.ok(scope.includes(language === 'en' ? 'active profile' : 'perfil ativo')); assert.ok(scope.includes(language === 'en' ? 'remote shutdown and credential revocation' : 'encerramento remoto e revogação de credenciais')); assert.ok(!rawSource.includes('Saving does not connect.') && !rawSource.includes('Salvar não conecta.'));
    await app.integration().props.onChange(false); await recoveryIcon(app).props.onClick(); await app.button(language === 'en' ? 'Refresh saved list' : 'Atualizar lista salva').props.onClick(); await app.settle(); for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle();
    assert.deepEqual(mutations(app).map(({ method }) => method), ['start']); assert.equal(recoveryIcon(app).props.disabled, true); assert.equal(app.integration().props.checked, false); assert.ok(text(app.tree()).includes(copy)); assert.ok(!JSON.stringify([app.tree(), app.warnings, app.infos, app.hooks.values()]).includes('SYNTHETIC_PRIVATE')); app.dispose();
  }
});

test('safe RPC diagnostics preserve only actual allowlisted SDK codes for replies and thrown pipeline errors', async () => {
  const known = ['gateway/service-unavailable', 'gateway/method-unavailable', 'gateway/definition-unavailable', 'gateway/invocation-unavailable', 'gateway/ambiguous-endpoint', 'gateway/input-invalid', 'gateway/result-invalid', 'gateway/binding-invalid', 'gateway/signature-invalid', 'gateway/arguments-invalid', 'gateway/internal', 'remote-access/denied'];
  let code, throwing = false;
  const app = await setup({ respond: () => {
    const error = { code, message: 'SYNTHETIC-PRIVATE-PROVIDER', details: { token: 'SYNTHETIC-PRIVATE-CREDENTIAL' } };
    if (throwing) throw error;
    return { ok: false, error };
  } });
  const { api } = app.row.meta.inject();
  for (code of known) {
    for (throwing of [false, true]) await assert.rejects(api('snapshot', {}), (error) => {
      assert.deepEqual(plain(error), { consoleCode: code === 'remote-access/denied' ? 'owner-required' : 'operation-failed', rpcCategory: code });
      return !JSON.stringify(error).includes('PRIVATE');
    });
  }
  assert.deepEqual(app.warnings, known.map((category) => ['[personal-mcp-console] snapshot category=' + category]), 'Only fixed category strings, with repeats deduplicated');
  const diagnosticKeys = (copy) => Object.keys(copy).filter((key) => key.startsWith('rpcDiagnostics.')).sort();
  assert.deepEqual(diagnosticKeys(app.dictionaries['personal.mcpConsole'].en), diagnosticKeys(app.dictionaries['personal.mcpConsole']['pt-BR']));
  assert.equal(diagnosticKeys(app.dictionaries['personal.mcpConsole'].en).length, known.length + 3);
  app.dispose();
});

test('unknown RPC codes, provider messages, and transport payloads cannot leak to UI or Android console', async () => {
  let error = { code: 'gateway/not-found', message: 'SYNTHETIC-PRIVATE-PROVIDER', result: { password: 'SYNTHETIC-PRIVATE-CREDENTIAL' } }, throwing = false;
  const app = await setup({ respond: () => { if (throwing) throw error; return { ok: false, error }; } });
  app.render(); app.hooks.effects(); await app.settle();
  assert.ok(text(app.tree()).includes('[uncategorized-rpc]')); assert.ok(!text(app.tree()).includes('gateway/not-found'));
  assert.deepEqual(app.warnings, [['[personal-mcp-console] snapshot category=uncategorized-rpc']]);
  error = { code: 'SYNTHETIC-PRIVATE-CODE', message: 'SYNTHETIC-PRIVATE-MESSAGE' }; throwing = true;
  await app.button('refresh').props.onClick(); await app.settle();
  assert.ok(text(app.tree()).includes('[uncategorized-transport]'));
  assert.deepEqual(app.warnings.at(-1), ['[personal-mcp-console] snapshot category=uncategorized-transport']);
  assert.ok(!JSON.stringify({ tree: app.tree(), warnings: app.warnings, hooks: app.hooks.values() }).includes('PRIVATE'));
  throwing = false; error = { code: 'gateway/service-unavailable', message: 'SYNTHETIC-PRIVATE-DETAILS' };
  await app.button('refresh').props.onClick(); await app.settle();
  assert.ok(text(app.tree()).includes('rpcDiagnostics.gateway/service-unavailable [gateway/service-unavailable]'));
  assert.ok(!text(app.tree()).includes('PRIVATE')); assert.equal(app.requests.every(({ method }) => method === 'snapshot'), true); app.dispose();
});

test('snapshot failure warnings are deduplicated until recovery and never log mutation failures', async () => {
  let response = { ok: false, error: { code: 'gateway/internal', message: 'SYNTHETIC-PRIVATE-MESSAGE' } };
  const app = await setup({ respond: () => response }); const { api } = app.row.meta.inject();
  for (let i = 0; i < 3; i++) await assert.rejects(api('snapshot', {}));
  assert.equal(app.warnings.length, 1);
  await assert.rejects(api('lock', { revision: 4 })); assert.equal(app.warnings.length, 1, 'Mutation path never logs request/payload/error');
  response = { ok: true, value: makeSnapshot() }; await api('snapshot', {});
  response = { ok: false, error: { code: 'gateway/internal', message: 'SYNTHETIC-PRIVATE-NEW' } }; await assert.rejects(api('snapshot', {}));
  assert.equal(app.warnings.length, 2, 'A new failed load after successful recovery is visible');
  response = { ok: true, value: { secret: 'SYNTHETIC-PRIVATE-RESULT' } }; await assert.rejects(api('snapshot', {}), (error) => error.rpcCategory === 'snapshot-contract-failed');
  assert.deepEqual(app.warnings.at(-1), ['[personal-mcp-console] snapshot category=snapshot-contract-failed']);
  assert.ok(!JSON.stringify(app.warnings).includes('PRIVATE')); app.dispose();
});

test('snapshot success marker is fixed, deduplicated, and reappears only after a failed snapshot recovers', async () => {
  let response = { ok: true, value: makeSnapshot() };
  const app = await setup({ respond: () => response }); const { api } = app.row.meta.inject();
  assert.deepEqual(app.infos, []);
  await api('snapshot', {}); await api('snapshot', {}); await api('lock', { revision: 4 });
  assert.deepEqual(app.infos, [['[personal-mcp-console] snapshot verified']]);
  response = { ok: false, error: { code: 'gateway/internal', message: 'SYNTHETIC-PRIVATE' } };
  await assert.rejects(api('snapshot', {})); await assert.rejects(api('snapshot', {}));
  response = { ok: true, value: makeSnapshot() };
  await api('snapshot', {}); await api('snapshot', {});
  assert.deepEqual(app.infos, [['[personal-mcp-console] snapshot verified'], ['[personal-mcp-console] snapshot verified']]);
  app.dispose();
});

test('strict contracts never accept plaintext env/header settings or secret-returning snapshots', async () => {
  const { schemas, result } = makeSchemas(z);
  assert.equal(schemas.save.safeParse({ revision: 0, server: { label: 'x', transport: 'streamable-http', url: 'https://example.invalid', headers: { Authorization: 'synthetic' }, headerRefs: {} } }).success, false);
  assert.equal(schemas.save.safeParse({ revision: 0, server: { label: 'x', transport: 'stdio', command: '/bin/example', args: [], cwd: '', env: { TOKEN: 'synthetic' }, envRefs: {} } }).success, false);
  assert.equal(result.safeParse(makeSnapshot({ vault: { initialized: true, locked: true, expiresAt: 0, refs: [], value: 'synthetic' } })).success, false);
  assert.ok(!/localStorage|sessionStorage|console\.(?:log|error)|fetch\(|XMLHttpRequest|iframe/.test(rawSource));
  assert.equal((rawSource.match(/console\.warn\(/g) ?? []).length, 1, 'Only allowlisted snapshot categories use visible warnings');
  assert.equal((rawSource.match(/console\.info\(/g) ?? []).length, 1, 'Only the fixed snapshot verification marker uses info');
  assert.ok(!rawSource.includes('nav icon category='));
  assert.ok(rawSource.includes("console.warn('[personal-mcp-console] snapshot category=' + rpcCategory)"));
  assert.ok(rawSource.includes("console.info('[personal-mcp-console] snapshot verified')"));
  assert.ok(rawSource.includes("type: 'password'")); assert.ok(rawSource.includes("'aria-live': 'polite'"));
  assert.ok(!rawSource.includes('JSON.stringify(config, null'));
});

test('structured mapping keep/replace/clear retains references only and rejects duplicates or plaintext fields', async () => {
  const app = await setup(); const { createServerDraft, serverFromDraft } = app.plugin;
  const draft = createServerDraft(httpConfig, 4);
  assert.equal(draft.headerRows[0].action, 'keep'); assert.equal(draft.headerRows[0].savedRef, 'api_token');
  draft.headerRows[0].ref = 'ignored_change';
  assert.equal(serverFromDraft(draft).headerRefs.Authorization, 'api_token');
  draft.headerRows[0].action = 'replace'; draft.headerRows[0].ref = 'replacement_ref';
  assert.equal(serverFromDraft(draft).headerRefs.Authorization, 'replacement_ref');
  draft.headerRows[0].action = 'clear'; assert.deepEqual(plain(serverFromDraft(draft).headerRefs), {});
  draft.headerRows = [{ name: 'Authorization', ref: 'one', action: 'replace' }, { name: 'authorization', ref: 'two', action: 'replace' }];
  assert.throws(() => serverFromDraft(draft), (e) => e.consoleCode === 'invalid-headers');
  draft.headerRows = [{ name: 'Authorization', ref: 'Bearer SYNTHETIC', action: 'replace' }];
  assert.throws(() => serverFromDraft(draft), (e) => e.consoleCode === 'invalid-input');
  const stdio = createServerDraft({ label: 'local', transport: 'stdio', command: '/bin/example', args: ['--read-only'], cwd: '', envRefs: { TOKEN: 'api_token', PASSWORD: 'pw_ref' } }, 9);
  stdio.envRows[1].action = 'clear'; assert.deepEqual(plain(serverFromDraft(stdio).envRefs), { TOKEN: 'api_token' });
  stdio.args = '["one"]'; assert.deepEqual(plain(serverFromDraft(stdio).args), ['one']);
  stdio.args = '{}'; assert.throws(() => serverFromDraft(stdio)); app.dispose();
});

test('manager render, list refresh, and polling only load redacted snapshots and never activate or reconnect', async () => {
  const app = await setup({ snapshot: { servers: [rowFor()], external: [{ serverName: 'native_existing', readOnly: true }], externalInventory: 'mounted-only' } });
  app.render(); assert.equal(app.requests.length, 0); app.hooks.effects(); await app.settle();
  assert.equal(app.requests[0].method, 'snapshot'); assert.equal(app.buttons('test').length, 0, 'No dead standalone Test action masquerading as activation');
  assert.equal(app.button('refresh').props.title, 'refreshNote'); await app.button('refresh').props.onClick(); await app.settle();
  assert.equal(app.button('reconnect').props.disabled, true, 'Inactive servers are activated, not silently reconnected');
  for (const timer of app.timers.values()) if (timer.interval) timer.fn();
  await app.settle(); assert.ok(app.requests.every((request) => request.method === 'snapshot'));
  assert.ok(text(app.tree()).includes('ownedSource')); assert.ok(text(app.tree()).includes('externalSource'));
  const external = app.nodes().find((node) => node.type === 'li' && text(node).includes('native_existing'));
  assert.ok(external); assert.equal(walk(external).filter((node) => node.type === primitives.Button || node.type === primitives.Switch).length, 0);
  app.dispose(); assert.equal(app.timers.size, 0);
});

test('controlled configuration edits survive transport switching; credential DOM clears and no aliases appear', async () => {
  const app = await tokenHarness(); change(app.input('label'), 'Meu MCP'); app.render();
  const value = headerPassword(app, 0); value.value = 'SYNTHETIC_EPHEMERAL_HEADER';
  app.button('stdio').props.onClick(); app.render(); change(app.input('command'), 'node'); app.render();
  assert.equal(value.value, ''); assert.equal(app.input('label').props.value, 'Meu MCP');
  app.button('http').props.onClick(); app.render(); assert.equal(app.input('url').props.value, httpConfig.url);
  assert.equal(app.button('http').props['aria-pressed'], true); assert.equal(app.button('stdio').props['aria-pressed'], false);
  assert.equal(app.nodes().some((node) => node.props.name === 'mapping-ref-0'), false);
  await app.submit(); assert.deepEqual(mutations(app).map(({method})=>method), ['saveAndActivate']);
  assert.deepEqual(mutations(app)[0].request.server.headerRefs, httpConfig.headerRefs); assert.equal(app.requests.some(({method})=>method==='start'), false); app.dispose();
});

test('editor keeps its original revision across refresh so stale saves fail closed at the backend', async () => {
  const app = await setup({ snapshot: { servers: [rowFor()] } }); app.render(); app.hooks.effects(); await app.settle();
  app.button('edit').props.onClick(); app.render(); change(app.input('label'), 'Changed locally'); app.render();
  app.setSnapshot(makeSnapshot({ revision: 5, servers: [rowFor()] })); await app.button('refresh').props.onClick(); await app.settle();
  await app.form('edit').props.onSubmit(event());
  assert.equal(app.requests.find((request) => request.method === 'saveAndActivate').request.revision, 4); app.dispose();
});

test('manager cards report last handshake and tool-sync verification, never continuous connected health', async () => {
  const timestamp = 1760000000000;
  const app = await setup({ snapshot: { servers: [{ ...rowFor(httpConfig, 'activation-verified'), lastVerifiedAt: timestamp }] } });
  app.render(); app.hooks.effects(); await app.settle();
  const card = app.nodes().find((node) => node.type === 'li' && node.props['data-server-id'] === serverId);
  assert.ok(card, 'Verified result must pass the actual shared wire contract'); assert.ok(text(card).includes(httpConfig.label));
  assert.ok(!text(card.children.find((node) => node.props?.className === 'mcp-compact-row')).includes('http'), 'Transport is not repeated in the compact header');
  assert.ok(walk(card.children.find((node) => node.type === 'details')).some((node) => node.type === 'dd' && text(node) === 'http'), 'Full transport remains in rendered configuration details');
  assert.ok(walk(card).some((node) => node.type === 'span' && node.props['data-state'] === 'activation-verified'));
  const time = walk(card).find((node) => node.type === 'time'); assert.equal(time.props.dateTime, new Date(timestamp).toISOString());
  assert.ok(!text(card).includes('verificationNote'), 'Long verification explanation is not in the closed compact card');
  assert.ok(app.styles[0].textContent.includes('.mcp-status[data-state="activation-verified"]{color:var(--dsw-alias-state-success-primary)}'));
  app.info().props.onClick(); app.render(); app.hooks.effects(); assert.ok(text(app.card()).includes('verificationNote'));
  assert.equal(app.integration().props.checked, true); assert.equal(app.integration().props.disabled, false); assert.equal(app.button('reconnect').props.disabled, false);
  assert.equal(app.button('edit').props.disabled, true); assert.equal(app.button('remove').props.disabled, true);
  const copy = app.dictionaries['personal.mcpConsole'];
  assert.match(copy.en['activation-verified'], /last verification/i); assert.match(copy.en.verificationNote, /handshake and tool sync.*not continuous/i);
  assert.match(copy['pt-BR']['activation-verified'], /última verificação/); assert.match(copy['pt-BR'].verificationNote, /handshake MCP.*sincronização de ferramentas.*não há monitoramento contínuo/);
  await app.button('refresh').props.onClick(); await app.settle();
  for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle();
  assert.ok(app.requests.every(({ method }) => method === 'snapshot'), 'Saved-list refresh/polling never reconnect or resync tools'); app.dispose();
});

test('mounted unknown handles remain unverified even if older verification metadata exists', async () => {
  const app = await setup({ snapshot: { servers: [{ ...rowFor(httpConfig, 'mounted-status-unavailable'), lastVerifiedAt: 1760000000000 }] } });
  app.render(); app.hooks.effects(); await app.settle();
  const card = app.nodes().find((node) => node.type === 'li' && node.props['data-server-id'] === serverId);
  assert.ok(text(card).includes('compactUnknown')); assert.ok(walk(card).some((node) => node.props['aria-label'] === 'mounted-status-unavailable')); assert.equal(walk(card).some((node) => node.props['data-state'] === 'activation-verified' || node.type === 'time'), false);
  assert.equal(app.integration().props.checked, true); assert.equal(app.integration().props.disabled, false); assert.equal(app.button('reconnect').props.disabled, false);
  app.dispose();
});

test('verified cards tolerate missing or out-of-range optional verification timestamps without fabricating a time', async () => {
  for (const lastVerifiedAt of [undefined, Number.MAX_SAFE_INTEGER]) {
    const row = { ...rowFor(httpConfig, 'activation-verified'), ...(lastVerifiedAt === undefined ? {} : { lastVerifiedAt }) };
    const app = await setup({ snapshot: { servers: [row] } }); app.render(); app.hooks.effects(); await app.settle();
    const card = app.nodes().find((node) => node.type === 'li' && node.props['data-server-id'] === serverId); assert.ok(card);
    assert.ok(walk(card).some((node) => text(node).includes('verificationTimeUnavailable'))); assert.equal(walk(card).some((node) => node.type === 'time'), false);
    app.dispose();
  }
});

test('explicit reconnect button directly sends reviewed acknowledgement without a modal and clears info/editor/passwords', async () => {
  let snapshot = makeSnapshot({ servers: [rowFor(httpConfig, 'mounted-status-unavailable')] });
  const app = await setup({ snapshot, respond: (method) => {
    if (method === 'reconnect') snapshot = { ...snapshot, revision: 5, servers: [{ ...rowFor(httpConfig, 'activation-verified'), lastVerifiedAt: 1760000000000 }] };
    return { ok: true, value: snapshot };
  } });
  app.render(); app.hooks.effects(); await app.settle(); assert.equal(app.button('reconnect').props.disabled, false);
  app.button('add').props.onClick(); app.render();
  const password = { value: 'SYNTHETIC-EPHEMERAL-SECRET' }, portalPassword = { value: 'SYNTHETIC-PORTAL-SECRET' };
  app.root.passwords = [password]; app.input('token').props.ref.current = portalPassword;
  app.info().props.onClick(); app.render(); app.hooks.effects();
  const pending = app.button('reconnect').props.onClick(); app.render(); app.hooks.effects();
  assert.equal(password.value, ''); assert.equal(portalPassword.value, ''); assert.equal(app.info().props['aria-expanded'], false);
  assert.equal(app.nodes().some((node) => node.type === 'form' && node.props['aria-label'] === 'add'), false);
  assert.equal(app.nodes().find((node) => node.type === primitives.Modal).props.open, false); assert.equal(app.buttons('confirmReconnect').length, 0); assert.equal(app.nodes().some((node) => node.type === primitives.Checkbox), false);
  await pending; await app.settle();
  assert.deepEqual(app.requests.find(({ method }) => method === 'reconnect').request, { revision: 4, id: serverId, confirmation: 'RECONNECT THIS SERVER' });
  assert.equal(app.requests.filter(({ method }) => method === 'reconnect').length, 1); assert.equal(app.requests.some(({ method }) => method === 'start' || method === 'test'), false);
  assert.ok(app.nodes().some((node) => node.props['data-state'] === 'activation-verified')); app.dispose();
});

test('stale reconnect clicks reject changed revision, state, every saved config field, or missing row', async () => {
  const stdio = { id: serverId, label: httpConfig.label, transport: 'stdio', command: 'node', args: ['--safe'], cwd: '/tmp', envRefs: { TOKEN: 'api_token' } };
  const changes = [
    { revision: 5 }, { state: 'stop-failed' }, { config: { ...httpConfig, label: 'Changed label' } },
    { config: { ...httpConfig, url: 'https://different.invalid/mcp' } }, { config: { ...httpConfig, headerRefs: { Authorization: 'different_ref' } } },
    { config: stdio }, { base: stdio, config: { ...stdio, command: 'python' } }, { base: stdio, config: { ...stdio, args: ['--changed'] } },
    { base: stdio, config: { ...stdio, cwd: '/different' } }, { base: stdio, config: { ...stdio, envRefs: { TOKEN: 'different_ref' } } }, { missing: true }
  ];
  for (const changed of changes) {
    const app = await setup({ snapshot: { servers: [rowFor(changed.base ?? httpConfig, 'mounted-status-unavailable')] } }); app.render(); app.hooks.effects(); await app.settle();
    const stale = app.button('reconnect');
    app.setSnapshot(makeSnapshot({ revision: changed.revision ?? 4, servers: changed.missing ? [] : [rowFor(changed.config ?? httpConfig, changed.state ?? 'mounted-status-unavailable')] }));
    await app.button('refresh').props.onClick(); // latest observed ref changes even before a React render
    await stale.props.onClick(); app.render();
    assert.equal(app.requests.some(({ method }) => method === 'reconnect'), false); assert.ok(text(app.tree()).includes('conflict')); app.dispose();
  }
});

test('reconnect config guard treats reordered equivalent reference mappings as unchanged', async () => {
  const config = { ...httpConfig, headerRefs: { Authorization: 'api_token', 'X-Service': 'service_ref' } };
  const app = await setup({ snapshot: { servers: [rowFor(config, 'mounted-status-unavailable')] } }); app.render(); app.hooks.effects(); await app.settle(); const old = app.button('reconnect');
  app.setSnapshot(makeSnapshot({ servers: [rowFor({ ...config, headerRefs: { 'X-Service': 'service_ref', Authorization: 'api_token' } }, 'mounted-status-unavailable')] })); await app.button('refresh').props.onClick();
  await old.props.onClick(); await app.settle(); assert.deepEqual(mutations(app).map(({ method }) => method), ['reconnect']); app.dispose();
});

test('fresh reconnect click uses latest observed revision and rejects inactive, unsupported, failed-load and reset snapshots', async () => {
  const app = await setup({ snapshot: { servers: [rowFor(httpConfig, 'mounted-status-unavailable')] } }); app.render(); app.hooks.effects(); await app.settle();
  app.setSnapshot(makeSnapshot({ revision: 9, servers: [rowFor(httpConfig, 'stop-failed')] })); await app.button('refresh').props.onClick(); await app.settle();
  await app.button('reconnect').props.onClick(); await app.settle(); assert.deepEqual(mutations(app)[0].request, { revision: 9, id: serverId, confirmation: 'RECONNECT THIS SERVER' }); app.dispose();
  for (const state of ['disabled', 'mount-failed', 'unmounted-shutdown-unverified']) {
    const inactive = await setup({ snapshot: { servers: [rowFor(httpConfig, state)] } }); inactive.render(); inactive.hooks.effects(); await inactive.settle();
    assert.equal(inactive.button('reconnect').props.disabled, true); await inactive.button('reconnect').props.onClick(); assert.equal(mutations(inactive).length, 0); inactive.dispose();
  }
  const unsupported = await setup({ unsupportedReconnect: true, snapshot: { servers: [rowFor(httpConfig, 'mounted-status-unavailable')] } }); unsupported.render(); unsupported.hooks.effects(); await unsupported.settle();
  assert.equal(unsupported.button('reconnect').props.disabled, true); await unsupported.button('reconnect').props.onClick(); assert.equal(mutations(unsupported).length, 0); unsupported.dispose();
  let failed = false;
  const broken = await setup({ snapshot: { servers: [rowFor(httpConfig, 'mounted-status-unavailable')] }, respond: (method, request, snapshot) => failed ? Promise.reject(Error('SYNTHETIC_FAILURE')) : { ok: true, value: snapshot } }); broken.render(); broken.hooks.effects(); await broken.settle();
  const stale = broken.button('reconnect'); failed = true; await broken.button('refresh').props.onClick(); await stale.props.onClick(); broken.render();
  assert.equal(broken.button('reconnect').props.disabled, true); assert.equal(mutations(broken).length, 0); broken.dispose();
  const reset = await setup({ snapshot: { servers: [rowFor(httpConfig, 'mounted-status-unavailable')] } }); reset.render(); reset.hooks.effects(); await reset.settle(); const old = reset.button('reconnect'); reset.reset(); await old.props.onClick(); assert.equal(mutations(reset).length, 0); await reset.settle(); reset.dispose();
});

test('direct reconnect clears legitimate secret editor and Delete confirmation while Delete itself remains confirmed', async () => {
  for (const kind of ['secret', 'remove']) {
    const app = await setup({ snapshot: { servers: [rowFor()], vault: unlocked(['unused_ref']) } }); app.render(); app.hooks.effects(); await app.settle();
    if (kind === 'secret') { app.button('editSecret').props.onClick(); app.render(); change(app.input('secretAction'), 'replace'); app.render(); }
    else { app.button('remove').props.onClick(); app.render(); assert.equal(app.nodes().find((node) => node.type === primitives.Modal).props.open, true); assert.equal(mutations(app).length, 0); }
    const value = { value: 'SYNTHETIC-DRAFT' }; app.root.passwords = [value];
    app.setSnapshot(makeSnapshot({ revision: 5, servers: [rowFor(httpConfig, 'mounted-status-unavailable')], vault: unlocked(['unused_ref']) })); await app.button('refresh').props.onClick(); await app.settle();
    await app.button('reconnect').props.onClick(); await app.settle(); assert.equal(value.value, '');
    assert.equal(app.nodes().some((node) => node.type === 'form' && node.props['aria-label'] === 'editSecret'), false); assert.equal(app.nodes().find((node) => node.type === primitives.Modal).props.open, false);
    assert.deepEqual(mutations(app).map(({ method }) => method), ['reconnect']); app.dispose();
  }
});

test('pending Save or credential reconciliation disables reconnect and blocks even a stale pre-save click', async () => {
  for (const credential of [false, true]) {
    const other = { ...httpConfig, id: 'e'.repeat(24), label: 'Active other server' };
    const app = await tokenHarness({ servers: [rowFor(), rowFor(other, 'mounted-status-unavailable')], respond(method) { if (method === 'saveAndActivate') return { ok: false, error: { message: 'SYNTHETIC_UNCERTAIN_SAVE' } }; } });
    const old = app.buttons('reconnect')[1]; assert.equal(old.props.disabled, false);
    // Use a synthetic ambiguous metadata reply. For credential reconciliation,
    // create the pending token while all rows are inactive, then observe activation.
    if (credential) { app.setCurrent({ ...app.current(), servers: [rowFor(), rowFor(other)] }); await app.button('refresh').props.onClick(); await app.settle(); }
    await app.submit(credential ? 'SYNTHETIC_NEW_TOKEN' : ''); await app.settle();
    if (credential) { app.setCurrent({ ...app.current(), servers: [rowFor(), rowFor(other, 'mounted-status-unavailable')] }); await app.button('refresh').props.onClick(); await app.settle(); }
    assert.equal(app.buttons('reconnect')[1].props.disabled, true); const before = mutations(app).length;
    await old.props.onClick(); await app.buttons('reconnect')[1].props.onClick(); assert.equal(mutations(app).length, before); assert.equal(mutations(app).some(({ method }) => method === 'reconnect'), false); app.dispose();
  }
});

test('Local and HTTP native transport choices save configurations only, including safe basename executables', async () => {
  const app = await setup(); app.render(); app.hooks.effects(); await app.settle(); app.button('add').props.onClick(); app.render();
  assert.ok(app.nodes().some((node) => node.props.role === 'group' && node.props['aria-label'] === 'transport'));
  assert.equal(app.button('http').props['aria-pressed'], true); app.button('stdio').props.onClick(); app.render(); assert.equal(app.button('stdio').props['aria-pressed'], true);
  change(app.input('label'), 'Local MCP'); app.render(); change(app.input('command'), 'node'); app.render(); change(app.input('args'), '["/path/to/server.js"]'); app.render();
  await app.form('add').props.onSubmit(event()); await app.settle();
  assert.deepEqual(app.requests.find(({ method }) => method === 'saveAndActivate').request, { revision: 4, server: { label: 'Local MCP', transport: 'stdio', command: 'node', args: ['/path/to/server.js'], cwd: '', envRefs: {} }, confirmation: 'SAVE AND ACTIVATE THIS SERVER' });
  assert.equal(app.requests.some(({ method }) => method === 'start' || method === 'reconnect'), false);
  const draft = app.plugin.createServerDraft({ label: 'Local MCP', transport: 'stdio', command: '/bin/example', args: [], cwd: '', envRefs: {} }, 4);
  for (const command of ['node', 'npx', 'python', '/bin/example']) assert.equal(app.plugin.serverFromDraft({ ...draft, command }).command, command);
  for (const command of ['./node', 'bin/node', 'node -e inline', 'node | sh', 'node;id', 'node && sh', '$(id)', 'node\nsh']) assert.throws(() => app.plugin.serverFromDraft({ ...draft, command }), undefined, command);
  const copy = app.dictionaries['personal.mcpConsole']; assert.match(copy.en.commandNote, /node, npx or python.*No inline shell/); assert.match(copy['pt-BR'].commandNote, /node, npx ou python.*Sem shell inline/);
  app.dispose();
});

test('Activate shows only the backend handshake/tool-sync outcome, never infers verification from a mounted handle', async () => {
  for (const outcome of ['activation-verified', 'mounted-status-unavailable']) {
    let snapshot = makeSnapshot({ servers: [rowFor()] });
    const app = await setup({ snapshot, respond: (method) => {
      if (method === 'start') snapshot = { ...snapshot, revision: 5, servers: [{ ...rowFor(httpConfig, outcome), ...(outcome === 'activation-verified' ? { lastVerifiedAt: 1760000000000 } : {}) }] };
      return { ok: true, value: snapshot };
    } });
    app.render(); app.hooks.effects(); await app.settle();
    assert.equal(app.integration().props.checked, false); await app.integration().props.onChange(true); await app.settle();
    assert.deepEqual(app.requests.find(({ method }) => method === 'start').request, { revision: 4, id: serverId, confirmation: 'START THIS SERVER' });
    assert.ok(app.nodes().some((node) => node.props['data-state'] === outcome));
    assert.equal(app.nodes().some((node) => node.type === 'time'), outcome === 'activation-verified');
    assert.equal(app.nodes().some((node) => node.props['data-state'] === 'activation-verified'), outcome === 'activation-verified');
    assert.equal(app.integration().props.checked, true); assert.equal(app.integration().props.disabled, false); assert.equal(app.requests.some(({ method }) => method === 'reconnect'), false); app.dispose();
  }
});

test('Deactivate keeps the saved server editable and never claims remote shutdown or triggers another activation', async () => {
  let snapshot = makeSnapshot({ servers: [{ ...rowFor(httpConfig, 'activation-verified'), lastVerifiedAt: 1760000000000 }] });
  const app = await setup({ snapshot, respond: (method) => {
    if (method === 'stop') snapshot = { ...snapshot, revision: 5, servers: [rowFor(httpConfig, 'unmounted-shutdown-unverified')] };
    return { ok: true, value: snapshot };
  } });
  app.render(); app.hooks.effects(); await app.settle(); await app.integration().props.onChange(false); await app.settle();
  assert.deepEqual(app.requests.find(({ method }) => method === 'stop').request, { revision: 4, id: serverId });
  const card = app.nodes().find((node) => node.type === 'li' && node.props['data-server-id'] === serverId);
  assert.ok(card); assert.ok(text(card).includes(httpConfig.label)); assert.ok(walk(card).some((node) => node.props['aria-label'] === 'unmounted-shutdown-unverified')); assert.ok(!text(card).includes('stoppingNote'));
  app.info().props.onClick(); app.render(); app.hooks.effects(); assert.ok(text(app.card()).includes('stoppingNote'));
  assert.equal(app.integration().props.checked, false); assert.equal(app.integration().props.disabled, false); assert.equal(app.button('reconnect').props.disabled, true);
  assert.equal(app.button('edit').props.disabled, false); assert.equal(app.button('remove').props.disabled, false);
  assert.equal(app.requests.some(({ method }) => ['start', 'reconnect', 'deleteServer'].includes(method)), false); app.dispose();
});

test('native controlled switch ON itself authorizes exact START without a redundant acknowledgement modal', async () => {
  const app = await setup({ snapshot: { servers: [rowFor()] } }); app.render(); app.hooks.effects(); await app.settle();
  const control = app.integration(); assert.equal(control.props.checked, false); assert.equal(control.props['aria-checked'], false); assert.equal(control.props.label, 'integration: ' + httpConfig.label);
  assert.equal(app.buttons('start').length, 0); assert.equal(app.buttons('stop').length, 0); assert.ok(!text(app.card()).includes('integrationNote'));
  app.info().props.onClick(); app.render(); app.hooks.effects(); assert.ok(text(app.card()).includes('integrationNote'));
  await control.props.onChange(true); await app.settle();
  assert.deepEqual(app.requests.find((call) => call.method === 'start').request, { revision: 4, id: serverId, confirmation: 'START THIS SERVER' });
  assert.equal(app.nodes().find((node) => node.type === primitives.Modal).props.open, false); assert.equal(app.integration().props.checked, false, 'Backend returned inactive: no optimistic checked state'); assert.ok(!text(app.tree()).includes('success'));
  const copy = app.dictionaries['personal.mcpConsole']; assert.match(copy.en.integrationNote, /Turning on authorizes.*command.*URL.*snapshot.*not continuous/); assert.match(copy['pt-BR'].integrationNote, /Ligar autoriza.*comando.*URL.*não monitoramento contínuo/);
  app.dispose();
});

test('stale switch event cannot approve a changed configuration after snapshot revision refresh', async () => {
  const app = await setup({ snapshot: { servers: [rowFor()] } }); app.render(); app.hooks.effects(); await app.settle();
  const oldControl = app.integration();
  app.setSnapshot(makeSnapshot({ revision: 5, servers: [rowFor({ ...httpConfig, url: 'https://other.invalid' })] }));
  await app.button('refresh').props.onClick(); await app.settle(); await oldControl.props.onChange(true); app.render();
  assert.equal(app.requests.some((request) => request.method === 'start'), false); assert.ok(text(app.tree()).includes('conflict')); app.dispose();
});

test('credential Keep never sends a secret or write RPC and saved values never prepopulate password inputs', async () => {
  const app = await setup({ snapshot: { vault: unlocked(['api_token']) } }); app.render(); app.hooks.effects(); await app.settle();
  app.button('editSecret').props.onClick(); app.render(); assert.equal(app.input('secretAction').props.value, 'keep');
  assert.equal(app.nodes().some((node) => node.type === 'input' && node.props.name === 'secret'), false);
  await app.form('editSecret').props.onSubmit(event()); app.render(); assert.ok(text(app.tree()).includes('kept'));
  assert.equal(app.requests.some((request) => request.method === 'setSecret' || request.method === 'deleteSecret'), false);
  app.button('editSecret').props.onClick(); app.render(); change(app.input('secretAction'), 'replace'); app.render();
  const input = app.input('secret'); assert.equal(input.props.type, 'password'); assert.equal(input.props.autoComplete, 'new-password');
  assert.equal(input.props.value, undefined); assert.equal(input.props.defaultValue, undefined); app.dispose();
});

test('replacement sends only the new write-only value, Bearer prefix is explicit, inputs clear before awaiting RPC', async () => {
  let finish; const deferred = new Promise((resolve) => { finish = resolve; });
  const snapshot = makeSnapshot({ vault: unlocked(['api_token']) });
  const app = await setup({ snapshot, respond: (method) => method === 'setSecret' ? deferred : { ok: true, value: snapshot } });
  app.render(); app.hooks.effects(); await app.settle(); app.button('editSecret').props.onClick(); app.render();
  change(app.input('secretAction'), 'replace'); app.render(); change(app.input('secretFormat'), 'bearer'); app.render();
  const input = { value: 'SYNTHETIC-NEW-TOKEN' }; app.root.passwords = [input];
  const request = app.form('editSecret').props.onSubmit(event({ secret: input }));
  assert.equal(input.value, ''); assert.equal(app.requests.at(-1).method, 'setSecret');
  assert.deepEqual(app.requests.at(-1).request, { revision: 4, ref: 'api_token', value: 'Bearer SYNTHETIC-NEW-TOKEN' });
  assert.equal(JSON.stringify(app.hooks.values()).includes('SYNTHETIC-NEW-TOKEN'), false, 'secret must not enter React state');
  finish({ ok: true, value: { ...snapshot, revision: 5 } }); await request; await app.settle();
  assert.equal(app.nodes().some((node) => node.type === 'input' && node.props.name === 'secret'), false); app.dispose();
});

test('Bearer replacement refuses pasted prefixes and whitespace without submitting or retaining the value', async () => {
  const app = await setup({ snapshot: { vault: unlocked([]) } }); app.render(); app.hooks.effects(); await app.settle();
  app.button('addSecret').props.onClick(); app.render(); change(app.input('ref'), 'new_token'); app.render(); change(app.input('secretFormat'), 'bearer'); app.render();
  for (const value of ['Bearer SYNTHETIC', ' SYNTHETIC', 'SYNTHETIC\nTOKEN']) {
    const input = { value }; await app.form('addSecret').props.onSubmit(event({ secret: input })); app.render(); assert.equal(input.value, '');
  }
  assert.equal(app.requests.some((request) => request.method === 'setSecret'), false); app.dispose();
});

test('add-credential rejects overwriting an existing reference without entering explicit Edit semantics', async () => {
  const app = await setup({ snapshot: { vault: unlocked(['existing_ref']) } }); app.render(); app.hooks.effects(); await app.settle();
  app.button('addSecret').props.onClick(); app.render(); change(app.input('ref'), 'existing_ref'); app.render();
  const input = { value: 'SYNTHETIC-REPLACEMENT' }; await app.form('addSecret').props.onSubmit(event({ secret: input })); app.render();
  assert.equal(input.value, ''); assert.equal(app.requests.some((request) => request.method === 'setSecret'), false); app.dispose();
});

test('credential Clear requires native confirmation and refuses a still-referenced secret', async () => {
  const app = await setup({ snapshot: { vault: unlocked(['unused_ref']) } }); app.render(); app.hooks.effects(); await app.settle();
  app.button('editSecret').props.onClick(); app.render(); change(app.input('secretAction'), 'clear'); app.render();
  await app.form('editSecret').props.onSubmit(event()); app.render();
  assert.equal(app.requests.some((call) => call.method === 'deleteSecret'), false);
  assert.equal(app.nodes().find((node) => node.type === primitives.Modal).props.title, 'deleteSecretTitle');
  await app.button('remove').props.onClick(); await app.settle();
  assert.deepEqual(app.requests.find((call) => call.method === 'deleteSecret').request, { revision: 4, ref: 'unused_ref' }); app.dispose();
  const used = await setup({ snapshot: { servers: [rowFor()], vault: unlocked(['api_token']) } }); used.render(); used.hooks.effects(); await used.settle();
  used.button('editSecret').props.onClick(); used.render(); change(used.input('secretAction'), 'clear'); used.render();
  assert.equal(used.button('saveSecret').props.disabled, true); assert.ok(text(used.tree()).includes('inUse')); used.dispose();
});

test('emergency Lock remains callable with no snapshot, clears inputs immediately, and refreshes after failure', async () => {
  const app = await setup({ respond: (method) => ({ ok: false, error: { message: method === 'lock' ? 'MCP console: store-invalid' : 'SYNTHETIC-PRIVATE-ERROR' } }) });
  app.render(); app.hooks.effects(); await app.settle(); assert.ok(text(app.tree()).includes('serviceTitle'));
  assert.equal(app.button('lock').props.disabled, false); assert.equal(app.button('add').props.disabled, true);
  const input = { value: 'SYNTHETIC-EPHEMERAL' }; app.root.passwords = [input];
  const request = app.button('lock').props.onClick(); assert.equal(input.value, ''); await request; await app.settle();
  assert.deepEqual(app.requests.find((call) => call.method === 'lock').request, { revision: 0 });
  assert.ok(app.requests.filter((call) => call.method === 'snapshot').length >= 2); assert.ok(!text(app.tree()).includes('PRIVATE')); app.dispose();
});

test('missing backend renders a useful unavailable state without mutating native settings or crashing', async () => {
  const app = await setup({ missingService: true }); app.render(); app.hooks.effects(); await app.settle();
  assert.ok(text(app.tree()).includes('serviceTitle')); assert.ok(text(app.tree()).includes('serviceNote'));
  assert.equal(app.requests.length, 0); assert.equal(app.button('lock').props.disabled, false);
  await app.button('lock').props.onClick(); await app.settle(); assert.ok(text(app.tree()).includes('serviceNote')); app.dispose();
});

test('vault submission, observed lock, expiration, reconnect and unmount clear ephemeral password DOM inputs', async () => {
  const locked = makeSnapshot(); const app = await setup({ snapshot: locked }); app.render(); app.hooks.effects(); await app.settle();
  const phrase = { value: 'SYNTHETIC-PASSPHRASE-ONLY' }; app.root.passwords = [phrase];
  const submit = app.form('initialize').props.onSubmit(event({ passphrase: phrase })); assert.equal(phrase.value, ''); await submit; await app.settle();
  assert.equal(app.requests.find((request) => request.method === 'initializeVault').request.passphrase, 'SYNTHETIC-PASSPHRASE-ONLY');
  app.setSnapshot(makeSnapshot({ vault: unlocked(['api_token']) })); await app.button('refresh').props.onClick(); await app.settle();
  app.button('editSecret').props.onClick(); app.render(); change(app.input('secretAction'), 'replace'); app.render();
  const draft = { value: 'SYNTHETIC-DRAFT' }; app.root.passwords = [draft];
  const expiration = [...app.timers.values()].find((timer) => !timer.interval); assert.ok(expiration);
  expiration.fn(); assert.equal(draft.value, ''); await app.settle();
  assert.equal(app.nodes().some((node) => node.type === 'input' && node.props.name === 'secret'), false);
  app.button('editSecret').props.onClick(); app.render(); change(app.input('secretAction'), 'replace'); app.render(); draft.value = 'SYNTHETIC-DRAFT';
  app.setSnapshot(makeSnapshot({ vault: { initialized: true, locked: true, expiresAt: 0, refs: [] } })); await app.button('refresh').props.onClick(); await app.settle();
  assert.equal(draft.value, ''); assert.equal(app.nodes().some((node) => node.type === 'input' && node.props.name === 'secret'), false);
  draft.value = 'SYNTHETIC-DRAFT'; app.reset(); assert.equal(draft.value, ''); await app.settle();
  draft.value = 'SYNTHETIC-DRAFT'; app.dispose(); assert.equal(draft.value, '');
});

test('stable password refs reach portal fields outside the section, survive polling, and clear synchronously on Lock', async () => {
  const app = await setup({ snapshot: { vault: unlocked(['api_token']) } }); app.render(); app.hooks.effects(); await app.settle();
  app.button('editSecret').props.onClick(); app.render(); change(app.input('secretAction'), 'replace'); app.render();
  const portalPassword = { value: 'SYNTHETIC-PORTAL-DRAFT' }, stableRef = app.input('secret').props.ref;
  assert.ok(stableRef && typeof stableRef === 'object'); stableRef.current = portalPassword;
  assert.deepEqual(app.root.passwords, [], 'portal field intentionally lies outside querySelectorAll fallback');
  await app.button('refresh').props.onClick(); await app.settle();
  assert.equal(app.input('secret').props.ref, stableRef); assert.equal(portalPassword.value, 'SYNTHETIC-PORTAL-DRAFT', 'unlocked polling must not clear typed input');
  const lock = app.button('lock').props.onClick(); assert.equal(portalPassword.value, '', 'direct ref is cleared before the async lock finishes');
  await lock; await app.settle(); app.dispose();
  const locked = await setup(); locked.render(); locked.hooks.effects(); await locked.settle();
  const passphrase = { value: 'SYNTHETIC-PORTAL-PASSPHRASE' }; locked.input('passphrase').props.ref.current = passphrase;
  locked.reset(); assert.equal(passphrase.value, '', 'generation invalidation clears an out-of-root passphrase too'); await locked.settle(); locked.dispose();
});

test('connection reset during a mutation discards the old response and cannot revive an unlocked view', async () => {
  let finish; const deferred = new Promise((resolve) => { finish = resolve; });
  let current = makeSnapshot({ vault: unlocked(['api_token']) });
  const app = await setup({ snapshot: current, respond: (method) => method === 'setSecret' ? deferred : { ok: true, value: current } });
  app.render(); app.hooks.effects(); await app.settle(); app.button('editSecret').props.onClick(); app.render(); change(app.input('secretAction'), 'replace'); app.render();
  const input = { value: 'SYNTHETIC-REPLACEMENT' }; app.root.passwords = [input]; const submit = app.form('editSecret').props.onSubmit(event({ secret: input }));
  app.reset(); current = makeSnapshot({ revision: 7 });
  finish({ ok: true, value: makeSnapshot({ revision: 6, vault: unlocked(['api_token']) }) });
  await submit; await app.settle(); assert.ok(app.nodes().some((node) => node.type === 'input' && node.props.name === 'passphrase'));
  assert.equal(app.nodes().some((node) => node.type === 'input' && node.props.name === 'secret'), false); assert.equal(input.value, ''); app.dispose();
});

test('mounted servers block edits, starts, deletes and vault changes while keeping explicit Stop available', async () => {
  const app = await setup({ snapshot: { servers: [rowFor(httpConfig, 'mounted-status-unavailable')], vault: unlocked(['api_token']) } });
  app.render(); app.hooks.effects(); await app.settle();
  for (const name of ['edit', 'remove', 'addSecret', 'editSecret']) assert.equal(app.button(name).props.disabled, true, name);
  assert.equal(app.integration().props.checked, true); assert.equal(app.integration().props.disabled, false);
  assert.ok(app.nodes().some((node) => node.props['data-state'] === 'mounted-status-unavailable' && node.props['aria-label'] === 'mounted-status-unavailable')); app.dispose();
});

test('successful app unmount never claims shutdown and restarting still requires a fresh deliberate confirmation', async () => {
  const app = await setup({ snapshot: { servers: [rowFor(httpConfig, 'unmounted-shutdown-unverified')] } });
  app.render(); app.hooks.effects(); await app.settle();
  assert.ok(app.nodes().some((node) => node.props['data-state'] === 'unmounted-shutdown-unverified' && node.props['aria-label'] === 'unmounted-shutdown-unverified'));
  app.info().props.onClick(); app.render(); app.hooks.effects(); assert.ok(text(app.card()).includes('stoppingNote'));
  assert.equal(app.integration().props.checked, false); assert.equal(app.integration().props.disabled, false);
  assert.equal(app.requests.some((request) => request.method === 'start'), false);
  const control = app.integration(); assert.equal(control.props['aria-checked'], false); await control.props.onChange(true); await app.settle(); assert.equal(app.requests.filter(({ method }) => method === 'start').length, 1); assert.equal(app.integration().props.checked, false); app.dispose();
});

// Private values live only in this synthetic in-memory backend and password DOM.
// No real vault/profile/files/network is touched by the HTTP-token regressions.
async function tokenHarness(options = {}) {
  const config = options.config === null ? null : options.config ?? httpConfig;
  let current = makeSnapshot({ servers: options.servers ?? (config ? [rowFor(config)] : []), vault: options.vault ?? unlocked(config ? Object.values(config.headerRefs) : []), ...(Object.hasOwn(options, 'capabilities') ? { capabilities: options.capabilities } : {}) });
  const secretValues = new Map(current.vault.refs.map((ref) => [ref, 'SYNTHETIC_OLD_VALUE']));
  const app = await setup({ snapshot: current, crypto: options.crypto, respond(method, request) {
    const commit = () => {
      if (['setSecret','saveAndActivate','start','stop','initializeVault','unlock','lock'].includes(method)) {
        if (request.revision !== current.revision) return { ok: false, error: { code: 'revision-conflict' } };
        current = { ...current, revision: current.revision + 1 };
      }
      if (method === 'setSecret') { secretValues.set(request.ref, request.value); current = { ...current, vault: { ...current.vault, ...(current.vault.mode === 'automatic' ? { initialized: true } : {}), refs: [...new Set([...current.vault.refs, request.ref])] } }; }
      if (method === 'initializeVault') current = { ...current, vault: { mode: 'passphrase', initialized: true, locked: true, expiresAt: 0, refs: [] } };
      if (method === 'unlock') current = { ...current, vault: { ...current.vault, locked: false, expiresAt: Date.now() + 300000 } };
      if (method === 'lock') current = { ...current, vault: { ...current.vault, locked: true, expiresAt: 0 } };
      if (method === 'stop') current = { ...current, servers: current.servers.map((row) => row.config.id === request.id ? rowFor(row.config, 'unmounted-shutdown-unverified', current.capabilities?.persistentActivation === true ? false : undefined) : row) };
      if (method === 'start') current = { ...current, servers: current.servers.map((row) => row.config.id === request.id ? { ...rowFor(row.config, 'activation-verified', current.capabilities?.persistentActivation === true ? true : undefined), lastVerifiedAt: 1760000000000 } : row) };
      if (method === 'saveAndActivate') {
        const saved = { ...plain(request.server), id: request.server.id ?? 'b'.repeat(24) };
        current = { ...current, servers: [...current.servers.filter(({ config }) => config.id !== saved.id), { ...rowFor(saved, 'activation-verified', current.capabilities?.persistentActivation === true ? true : undefined), lastVerifiedAt: 1760000000000 }] };
      }
      return { ok: true, value: current };
    };
    const override = options.respond?.(method, request, { commit, current: () => current, setCurrent: (next) => { current = next; } });
    return override === undefined ? commit() : override;
  } });
  app.render(); app.hooks.effects(); await app.settle();
  app.button(config ? 'edit' : 'add').props.onClick(); app.render();
  if (!config) { change(app.input('label'), 'Synthetic new server'); app.render(); change(app.input('url'), 'https://example.invalid/new'); app.render(); }
  const password = { value: '' }; app.input('token').props.ref.current = password;
  return { ...app, password, secretValues, current: () => current, setCurrent: (next) => { current = next; }, submit: async (value = '') => { password.value = value; return app.form(config ? 'edit' : 'add').props.onSubmit(event({ token: password })); } };
}
const mutations = (app) => app.requests.filter(({ method }) => method !== 'snapshot');
function headerPassword(app,index){const node=app.nodes().filter((node)=>node.type==='input'&&node.props.name?.startsWith('header-value-'))[index];assert.ok(node,'Missing direct header value');if(!node.props.ref.current)node.props.ref.current={value:''};return node.props.ref.current;}
function addHeader(app,name){app.button('addHeader').props.onClick();app.render();const count=app.nodes().filter((node)=>node.type==='select'&&node.props.name?.startsWith('mapping-header-')).length,index=count-1;const common=['Authorization','X-API-Key','X-Auth-Token','X-Client-ID','X-Correlation-ID','X-Organization-ID','X-Request-ID'].includes(name);change(app.input('mapping-header-'+index),common?name:'custom');app.render();if(!common){change(app.input('mapping-name-'+index),name);app.render();}return index;}


test('kept opaque header references cannot be silently moved to a different name; case-only changes remain safe', async () => {
  const app = await tokenHarness(); const draft = app.plugin.createServerDraft(httpConfig, 4);
  draft.headerRows[0].name = 'X-API-Key'; assert.throws(() => app.plugin.serverFromDraft(draft), (error) => error.consoleCode === 'invalid-headers');
  draft.headerRows[0].name = 'authorization'; assert.deepEqual(plain(app.plugin.serverFromDraft(draft).headerRefs), { authorization: 'api_token' });
  change(app.input('mapping-header-0'), 'X-API-Key'); app.render(); await app.submit(); assert.equal(mutations(app).length, 0); app.dispose();
});

test('HTTP token is optional, masked, write-only and alias-free; vault credentials stay advanced', async () => {
  const app = await tokenHarness();
  const token = app.input('token'); assert.equal(token.props.type, 'password'); assert.equal(token.props.required, undefined);
  assert.equal(token.props.value, undefined); assert.equal(token.props.defaultValue, undefined); assert.equal(token.props.onChange, undefined);
  assert.equal(app.buttons('addBearer').length, 0); assert.equal(app.nodes().some((node) => node.props.name === 'ref'), false);
  const advanced = app.nodes().find((node) => node.type === 'details' && text(node.children[0]) === 'advancedVault');
  assert.ok(advanced && !advanced.props.open); assert.ok(text(app.tree()).includes('tokenAndHeaders')); assert.ok(text(app.tree()).includes('tokenNote'));
  for (const key of ['tokenMode','tokenFormat','tokenHeader','mapping-action-0','mapping-ref-0']) assert.equal(app.nodes().some((node)=>node.props.name===key),false);
  assert.equal(app.nodes().some((node)=>node.type==='details' && text(node.children[0])==='advancedHeaders'),false);
  await app.submit(); assert.deepEqual(mutations(app).map(({ method }) => method), ['saveAndActivate']);
  assert.deepEqual(app.current().servers[0].config.headerRefs, httpConfig.headerRefs); app.dispose();
});

test('HTTP headers have alphabetized safe suggestions, custom preservation and explicit binding-only deletion', async () => {
  const config = { ...httpConfig, headerRefs: { Authorization: 'api_token', 'X-Customer-Plan': 'plan_ref' } };
  const app = await tokenHarness({ config });
  const names = app.input('mapping-header-0').children.flat().filter((node) => node.props.value && node.props.value !== 'custom').map((node) => node.props.value);
  assert.deepEqual(names, [...names].sort());
  for (const forbidden of ['Host', 'Connection', 'Content-Length', 'Transfer-Encoding', 'Upgrade', 'Proxy-Authorization', 'Proxy-Connection', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'TE', 'Trailer']) assert.ok(!names.some((name) => name.toLowerCase() === forbidden.toLowerCase()));
  assert.equal(app.input('mapping-header-1').props.value, 'custom'); assert.equal(app.input('mapping-name-1').props.value, 'X-Customer-Plan');
  app.buttons('removeHeader')[0].props.onClick(); app.render(); await app.submit();
  assert.deepEqual(app.current().servers[0].config.headerRefs, { 'X-Customer-Plan': 'plan_ref' });
  assert.equal(app.secretValues.get('api_token'), 'SYNTHETIC_OLD_VALUE'); assert.deepEqual(mutations(app).map(({ method }) => method), ['saveAndActivate']); app.dispose();
});

test('HTTP TOKEN writes a fresh 128-bit reference then metadata at the returned revision, never an old shared reference', async () => {
  const bytes = []; const app = await tokenHarness({ crypto: { getRandomValues(value) { bytes.push(value.byteLength); return webcrypto.getRandomValues(value); } } });
  const submit = app.submit('SYNTHETIC_NEW_TOKEN'); assert.equal(app.password.value, '', 'DOM clears before the first await');
  await submit; await app.settle();
  const writes = mutations(app); assert.deepEqual(writes.map(({ method }) => method), ['setSecret', 'saveAndActivate']); assert.deepEqual(bytes, [16]);
  assert.match(writes[0].request.ref, /^mcp_token_[0-9a-f]{32}$/); assert.notEqual(writes[0].request.ref, 'api_token');
  assert.equal(writes[0].request.value, 'Bearer SYNTHETIC_NEW_TOKEN'); assert.equal(writes[1].request.revision, 5);
  assert.equal(writes[1].request.server.headerRefs.Authorization, writes[0].request.ref); assert.equal(app.secretValues.get('api_token'), 'SYNTHETIC_OLD_VALUE');
  for (const value of [writes[1].request, app.hooks.values(), app.tree(), app.warnings, app.iconWarnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_NEW_TOKEN'));
  assert.equal(app.nodes().some((node) => node.type === 'form' && node.props['aria-label'] === 'edit'), false); app.dispose();
});

test('a NEW primary Token affects Authorization only; API-key and custom headers remain independent', async () => {
  const config = { ...httpConfig, headerRefs: { 'X-API-Key': 'key_ref', 'X-Auth-Token': 'auth_ref', 'X-Customer-Plan': 'plan_ref' } };
  const app = await tokenHarness({config}); await app.submit('SYNTHETIC_PRIMARY'); await app.settle();
  const writes=mutations(app); assert.equal(writes[0].request.value,'Bearer SYNTHETIC_PRIMARY');
  assert.deepEqual(writes[1].request.server.headerRefs,{...config.headerRefs,Authorization:writes[0].request.ref}); app.dispose();
});

test('blank Token and direct header values preserve exact saved opaque bindings with no auth/format selectors', async () => {
  const config={...httpConfig,headerRefs:{authorization:'unknown_full_header','X-OPAQUE-CUSTOM':'opaque_ref'}};
  const app=await tokenHarness({config}); await app.submit(); assert.deepEqual(mutations(app).map(({method})=>method),['saveAndActivate']); assert.deepEqual(app.current().servers[0].config.headerRefs,config.headerRefs); app.dispose();
});

test('all invalid metadata, values, duplicate/control/unsupported headers and auth ambiguity fail BEFORE any vault write', async () => {
  const cases=[
    app=>change(app.input('url'),'http://remote.example.invalid/mcp'),
    app=>change(app.input('url'),'https://name:password@example.invalid/mcp'),
    app=>change(app.input('url'),'https://example.invalid/mcp?token=no'),
    app=>change(app.input('label'),''),
    app=>{addHeader(app,'Connection'); headerPassword(app,1).value='SYNTHETIC_HEADER';},
    app=>{addHeader(app,'authorization'); headerPassword(app,1).value='SYNTHETIC_HEADER';},
    app=>{headerPassword(app,0).value='Bearer SYNTHETIC_DIRECT';},
    app=>{addHeader(app,'X-API-Key'); headerPassword(app,1).value='SYNTHETIC\nINVALID';},
    app=>{addHeader(app,'X-API-Key'); headerPassword(app,1).value='SYNTHETIC\tINVALID';},
    app=>{addHeader(app,'X-API-Key'); headerPassword(app,1).value='SYNTHETIC_漢';},
    app=>{addHeader(app,'X-API-Key'); headerPassword(app,1).value='SYNTHETIC_😀';},
    app=>{addHeader(app,'X-API-Key'); headerPassword(app,1).value='x'.repeat(8193);}
  ];
  for(const update of cases){const app=await tokenHarness();update(app);app.render();await app.submit('SYNTHETIC_TOKEN');assert.equal(mutations(app).length,0);assert.equal(app.password.value,'');for(const n of app.nodes().filter(n=>n.type==='input'&&n.props.name?.startsWith('header-value-')))assert.equal(n.props.ref.current?.value??'','');app.dispose();}
  for(const value of ['Bearer SYNTHETIC','bearer SYNTHETIC',' SYNTHETIC','SYNTHETIC TOKEN','SYNTHETIC\nTOKEN']){const app=await tokenHarness();await app.submit(value);assert.equal(mutations(app).length,0);app.dispose();}
  const absent=await tokenHarness({crypto:null});await absent.submit('SYNTHETIC_TOKEN');absent.render();assert.equal(mutations(absent).length,0);assert.ok(text(absent.tree()).includes('errors.secure-random-unavailable'));absent.dispose();
});

test('legacy locked/uninitialized permits DOM typing but Save preserves it and requests explicit setup; owned mounts still block', async () => {
  for (const vault of [{ mode: 'passphrase', initialized: false, locked: true, expiresAt: 0, refs: [] }, { initialized: true, locked: true, expiresAt: 0, refs: [] }]) {
    const app = await tokenHarness({ vault }); assert.equal(app.input('token').props.disabled, false); assert.ok(text(app.tree()).includes('tokenLocked'));
    await app.submit('SYNTHETIC_TOKEN'); app.render(); assert.equal(mutations(app).length, 0); assert.equal(app.password.value, 'SYNTHETIC_TOKEN'); assert.ok(app.nodes().some((node) => node.props['data-editor-vault'])); app.dispose();
  }
  const other = { ...httpConfig, id: 'c'.repeat(24), label: 'Other mounted server' };
  const app = await tokenHarness({ servers: [rowFor(), rowFor(other, 'mounted-status-unavailable')] });
  assert.equal(app.input('token').props.disabled, true); assert.ok(text(app.tree()).includes('tokenMounted')); await app.submit('SYNTHETIC_TOKEN'); assert.equal(mutations(app).length, 0); app.dispose();
});

test('encrypted token survives definite metadata failure with pending ref/revision and safe metadata-only retry', async () => {
  let failed = false; const app = await tokenHarness({ respond(method) { if (method === 'saveAndActivate' && !failed) { failed = true; return { ok: false, error: { code: 'store-write-failed' } }; } } });
  await app.submit('SYNTHETIC_PENDING_TOKEN'); await app.settle();
  const ref = mutations(app)[0].request.ref; assert.deepEqual(app.current().servers[0].config.headerRefs, httpConfig.headerRefs);
  assert.equal(app.secretValues.get(ref), 'Bearer SYNTHETIC_PENDING_TOKEN'); assert.ok(text(app.tree()).includes('tokenPending')); assert.ok(!text(app.form('edit')).includes(ref));
  assert.equal(app.input('token').props.disabled, true); await app.submit(); await app.settle();
  assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret', 'saveAndActivate', 'saveAndActivate']); assert.equal(mutations(app)[2].request.revision, 5);
  assert.equal(app.current().servers[0].config.headerRefs.Authorization, ref); assert.equal(app.secretValues.get('api_token'), 'SYNTHETIC_OLD_VALUE'); app.dispose();
});

test('uncertain NEW-server save that committed is reconciled without duplicate server or another write', async () => {
  let failed = false; const app = await tokenHarness({ config: null, respond(method, request, control) { if (method === 'saveAndActivate' && !failed) { failed = true; control.commit(); return Promise.reject(new Error('SYNTHETIC_PRIVATE_FAILURE')); } } });
  await app.submit('SYNTHETIC_TOKEN'); await app.settle(); assert.equal(app.current().servers.length, 1); assert.ok(text(app.tree()).includes('tokenPending'));
  await app.submit(); await app.settle(); assert.equal(app.current().servers.length, 1); assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret', 'saveAndActivate']);
  assert.equal(app.nodes().some((node) => node.type === 'form' && node.props['aria-label'] === 'add'), false); assert.ok(!JSON.stringify([app.tree(), app.warnings, app.infos]).includes('SYNTHETIC_PRIVATE_FAILURE')); app.dispose();
});

test('uncertain credential write that committed is reconciled without a second secret write or deletion', async () => {
  let failed = false; const app = await tokenHarness({ respond(method, request, control) { if (method === 'setSecret' && !failed) { failed = true; control.commit(); return Promise.reject(new Error('SYNTHETIC_PRIVATE_FAILURE')); } } });
  await app.submit('SYNTHETIC_TOKEN'); await app.settle(); assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret']); assert.ok(text(app.tree()).includes('tokenUncertain'));
  await app.submit(); await app.settle(); assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret', 'saveAndActivate']); assert.equal(mutations(app)[1].request.revision, 5); app.dispose();
});

test('uncertain uncommitted secret requires reentry and a DIFFERENT fresh reference, never a blind overwrite', async () => {
  let failed = false; const app = await tokenHarness({ respond(method) { if (method === 'setSecret' && !failed) { failed = true; return Promise.reject(new Error('SYNTHETIC_PRIVATE_FAILURE')); } } });
  await app.submit('SYNTHETIC_TOKEN'); await app.settle(); const first = mutations(app)[0].request.ref;
  await app.submit(); await app.settle(); assert.ok(text(app.tree()).includes('tokenMissing')); assert.equal(mutations(app).length, 1); assert.equal(app.input('token').props.disabled, false);
  await app.submit('SYNTHETIC_REENTERED_TOKEN'); await app.settle(); const writes = mutations(app); assert.deepEqual(writes.map(({ method }) => method), ['setSecret', 'setSecret', 'saveAndActivate']); assert.notEqual(writes[1].request.ref, first);
  assert.equal(app.secretValues.get('api_token'), 'SYNTHETIC_OLD_VALUE'); app.dispose();
});

test('pending retry refuses to overwrite an externally changed target configuration', async () => {
  let failed = false; const app = await tokenHarness({ respond(method) { if (method === 'saveAndActivate' && !failed) { failed = true; return { ok: false, error: { code: 'store-write-failed' } }; } } });
  await app.submit('SYNTHETIC_TOKEN'); await app.settle(); const before = mutations(app).length;
  app.setCurrent({ ...app.current(), revision: 6, servers: [rowFor({ ...httpConfig, url: 'https://example.invalid/changed' })] });
  await app.submit(); await app.settle(); assert.equal(mutations(app).length, before); assert.ok(text(app.tree()).includes('tokenPending')); assert.ok(text(app.tree()).includes('conflict')); app.dispose();
});

test('server/header/vault limits and random-reference collisions all fail before a credential write', async () => {
  const full = await tokenHarness({ config: null });
  full.setCurrent({ ...full.current(), servers: Array.from({ length: 32 }, (_, i) => rowFor({ ...httpConfig, id: i.toString(16).padStart(24, '0'), label: 'Limit ' + i })) });
  await full.button('refresh').props.onClick(); await full.settle(); await full.submit('SYNTHETIC_TOKEN'); assert.equal(mutations(full).length, 0); full.dispose();
  const headers = Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['X-Allowed-' + i, 'ref_' + i]));
  const wide = await tokenHarness({ config: { ...httpConfig, headerRefs: headers } }); await wide.submit('SYNTHETIC_TOKEN'); assert.equal(mutations(wide).length, 0); wide.dispose();
  const capped = await tokenHarness({ vault: unlocked(['api_token', ...Array.from({ length: 127 }, (_, i) => 'ref_' + i)]) }); await capped.submit('SYNTHETIC_TOKEN'); assert.equal(mutations(capped).length, 0); capped.dispose();
  let attempts = 0; const repeated = await tokenHarness({ vault: unlocked(['api_token', 'mcp_token_' + '0'.repeat(32)]), crypto: { getRandomValues(bytes) { attempts++; bytes.fill(0); return bytes; } } });
  await repeated.submit('SYNTHETIC_TOKEN'); assert.equal(attempts, 4); assert.equal(mutations(repeated).length, 0); repeated.dispose();
});

test('direct complete Authorization and custom Authentication values retain literal prefixes/spaces and never use primary Token', async () => {
  for(const name of ['Authorization','Authentication']){
    const app=await tokenHarness({config:{...httpConfig,headerRefs:{}}});addHeader(app,name);headerPassword(app,0).value='  Bearer SYNTHETIC FULL VALUE  ';await app.submit();await app.settle();
    assert.equal(mutations(app)[0].request.value,'  Bearer SYNTHETIC FULL VALUE  ');assert.deepEqual(mutations(app).map(({method})=>method),['setSecret','saveAndActivate']);
    assert.deepEqual(mutations(app)[1].request.server.headerRefs,{[name]:mutations(app)[0].request.ref});app.dispose();
  }
});

test('late metadata reply cannot close or revive a replacement editor', async () => {
  let finish, saved; const pending = new Promise((resolve) => { finish = resolve; });
  const app = await tokenHarness({ respond(method, request, control) { if (method === 'saveAndActivate') { saved = control.commit(); return pending; } } });
  const submit = app.submit('SYNTHETIC_TOKEN'); await app.settle(); assert.equal(mutations(app).length, 2);
  app.button('add').props.onClick(); app.render(); change(app.input('label'), 'A different draft'); app.render();
  finish(saved); await submit; await app.settle(); assert.equal(app.form('add').props['aria-label'], 'add'); assert.equal(app.input('label').props.value, 'A different draft');
  assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret', 'saveAndActivate']); app.dispose();
});

test('token stable DOM ref survives polling and clears on lock, expiry, transport change, connection reset and unmount', async () => {
  for (const action of ['lock', 'expiry', 'transport', 'reset', 'unmount']) {
    const app = await tokenHarness(); const ref = app.input('token').props.ref; app.password.value = 'SYNTHETIC_DOM_TOKEN';
    await app.button('refresh').props.onClick(); await app.settle(); assert.equal(app.input('token').props.ref, ref); assert.equal(app.password.value, 'SYNTHETIC_DOM_TOKEN');
    if (action === 'lock') { const pending = app.button('lock').props.onClick(); assert.equal(app.password.value, ''); await pending; }
    else if (action === 'expiry') [...app.timers.values()].find((timer) => !timer.interval).fn();
    else if (action === 'transport') app.button('stdio').props.onClick();
    else if (action === 'reset') app.reset(); else app.dispose();
    assert.equal(app.password.value, ''); if (action !== 'unmount') app.dispose();
  }
});

test('transport/editor changes and connection reset during setSecret prevent stale metadata follow-up', async () => {
  for (const action of ['transport', 'cancel', 'reset', 'unmount']) {
    let finish; const deferred = new Promise((resolve) => { finish = resolve; });
    const app = await tokenHarness({ respond: (method) => method === 'setSecret' ? deferred : undefined });
    const submit = app.submit('SYNTHETIC_TOKEN'); assert.equal(app.password.value, '');
    if (action === 'transport') app.button('stdio').props.onClick(); else if (action === 'cancel') app.button('cancel').props.onClick(); else if (action === 'reset') app.reset(); else app.dispose();
    const ref = mutations(app)[0].request.ref;
    finish({ ok: true, value: makeSnapshot({ revision: 5, servers: [rowFor()], vault: unlocked(['api_token', ref]) }) });
    await submit; if (action !== 'unmount') await app.settle(); assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret']);
    if (action === 'transport') assert.ok(app.nodes().some((node) => node.props.name === 'command'));
    if (action !== 'unmount') app.dispose();
  }
});


test('Token and multiple direct headers write sequential returned revisions and persist metadata only after every write', async()=>{
 const app=await tokenHarness();addHeader(app,'X-API-Key');addHeader(app,'Authentication');headerPassword(app,1).value='SYNTHETIC_KEY';headerPassword(app,2).value='Literal SYNTHETIC Authentication';
 const submit=app.submit('SYNTHETIC_TOKEN');assert.equal(app.password.value,'');assert.equal(headerPassword(app,1).value,'');assert.equal(headerPassword(app,2).value,'');await submit;await app.settle();
 const writes=mutations(app);assert.deepEqual(writes.map(({method})=>method),['setSecret','setSecret','setSecret','saveAndActivate']);assert.deepEqual(writes.map(({request})=>request.revision),[4,5,6,7]);assert.equal(new Set(writes.slice(0,3).map(({request})=>request.ref)).size,3);
 assert.deepEqual(writes.slice(0,3).map(({request})=>request.value),['Bearer SYNTHETIC_TOKEN','SYNTHETIC_KEY','Literal SYNTHETIC Authentication']);for(const value of [app.hooks.values(),app.tree(),writes[3].request,app.warnings,app.infos])assert.ok(!JSON.stringify(value).includes('SYNTHETIC_KEY'));app.dispose();
});

test('add/delete/rename preserve independently typed Token and rows, stable IDs and DOM refs; only removed/renamed input clears',async()=>{
 const app=await tokenHarness();const first=headerPassword(app,0);first.value='SYNTHETIC_FIRST';app.password.value='SYNTHETIC_TOKEN';addHeader(app,'X-API-Key');const second=headerPassword(app,1);second.value='SYNTHETIC_SECOND';
 assert.equal(first.value,'SYNTHETIC_FIRST');assert.equal(app.password.value,'SYNTHETIC_TOKEN');const before=app.nodes().filter(n=>n.props['data-header-id']).map(n=>n.props['data-header-id']);
 app.buttons('removeHeader')[0].props.onClick();app.render();assert.equal(first.value,'');assert.equal(second.value,'SYNTHETIC_SECOND');assert.equal(app.password.value,'SYNTHETIC_TOKEN');assert.equal(headerPassword(app,0),second);assert.equal(app.nodes().find(n=>n.props['data-header-id']).props['data-header-id'],before[1]);
 change(app.input('mapping-header-0'),'X-Auth-Token');app.render();assert.equal(second.value,'');assert.equal(app.password.value,'SYNTHETIC_TOKEN');for(const key of ['addHeader','removeHeader']){const b=app.button(key);assert.equal(b.props['aria-label'],key);assert.equal(b.props.title,key);assert.ok(walk(b).some(n=>n.type==='svg'&&n.props['aria-hidden']));}assert.match(app.styles[0].textContent,/mcp-header-action\{min-width:44px;min-height:44px/);app.dispose();
});

test('renaming a saved header requires new explicit value and fresh alias without moving or deleting the old opaque secret',async()=>{
 const app=await tokenHarness();change(app.input('mapping-header-0'),'X-API-Key');app.render();await app.submit();app.render();assert.equal(mutations(app).length,0);assert.ok(text(app.tree()).includes('errors.header-reentry-required'));
 headerPassword(app,0).value='SYNTHETIC_REENTERED';await app.submit();await app.settle();assert.equal(mutations(app)[0].request.value,'SYNTHETIC_REENTERED');assert.deepEqual(mutations(app)[1].request.server.headerRefs,{'X-API-Key':mutations(app)[0].request.ref});assert.equal(app.secretValues.get('api_token'),'SYNTHETIC_OLD_VALUE');app.dispose();
});

test('partially committed sequential writes stop, wipe remaining values and reconcile missing values with DIFFERENT fresh aliases',async()=>{
 let count=0;const app=await tokenHarness({respond(method){if(method==='setSecret'&&++count===2)return Promise.reject(Error('SYNTHETIC_PRIVATE_FAILURE'));}});
 addHeader(app,'X-API-Key');addHeader(app,'Authentication');headerPassword(app,1).value='SYNTHETIC_KEY';headerPassword(app,2).value='SYNTHETIC_AUTH';await app.submit('SYNTHETIC_TOKEN');await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['setSecret','setSecret']);
 const old=mutations(app)[1].request.ref;for(const value of [app.hooks.values(),app.tree(),app.warnings])assert.ok(!JSON.stringify(value).includes('SYNTHETIC_AUTH'));await app.submit();await app.settle();assert.ok(text(app.form('edit')).includes('tokenMissing'));assert.ok(!text(app.form('edit')).includes(old));assert.equal(mutations(app).length,2);
 headerPassword(app,1).value='SYNTHETIC_REENTERED_KEY';headerPassword(app,2).value='SYNTHETIC_REENTERED_AUTH';await app.submit();await app.settle();const writes=mutations(app);assert.deepEqual(writes.map(({method})=>method),['setSecret','setSecret','setSecret','setSecret','saveAndActivate']);assert.notEqual(writes[2].request.ref,old);assert.deepEqual(writes.map(({request})=>request.revision),[4,5,5,6,7]);app.dispose();
});

test('uncertain second write that committed is not blindly resent; only missing third value is freshly written on retry',async()=>{
 let count=0;const app=await tokenHarness({respond(method,request,control){if(method==='setSecret'&&++count===2){control.commit();return Promise.reject(Error('SYNTHETIC_PRIVATE_FAILURE'));}}});addHeader(app,'X-API-Key');addHeader(app,'Authentication');headerPassword(app,1).value='SYNTHETIC_KEY';headerPassword(app,2).value='SYNTHETIC_AUTH';await app.submit('SYNTHETIC_TOKEN');await app.settle();await app.submit();await app.settle();assert.equal(mutations(app).length,2);headerPassword(app,2).value='SYNTHETIC_REENTERED_AUTH';await app.submit();await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['setSecret','setSecret','setSecret','saveAndActivate']);assert.deepEqual(mutations(app).map(({request})=>request.revision),[4,5,6,7]);app.dispose();
});

test('uncertain NEW metadata commit then externally removed generated refs never creates a duplicate',async()=>{
 let once=false;const app=await tokenHarness({config:null,respond(method,request,control){if(method==='saveAndActivate'&&!once){once=true;control.commit();const now=control.current();control.setCurrent({...now,revision:now.revision+1,servers:now.servers.map(row=>({...row,config:{...row.config,label:'External edit',headerRefs:{}}}))});return Promise.reject(Error('SYNTHETIC_PRIVATE_FAILURE'));}}});await app.submit('SYNTHETIC_TOKEN');await app.settle();const before=mutations(app).length;await app.submit();await app.settle();assert.equal(mutations(app).length,before);assert.equal(app.current().servers.length,1);assert.ok(text(app.tree()).includes('conflict'));app.dispose();
});

test('uncertain NEW metadata after all fresh rows deleted fails closed rather than blindly creating an existing-header-only server',async()=>{
 let once=false;const app=await tokenHarness({config:null,respond(method){if(method==='saveAndActivate'&&!once){once=true;return Promise.reject(Error('SYNTHETIC_PRIVATE_FAILURE'));}}});addHeader(app,'X-API-Key');headerPassword(app,0).value='SYNTHETIC_KEY';await app.submit();await app.settle();app.button('removeHeader').props.onClick();app.render();const before=mutations(app).length;await app.submit();await app.settle();assert.equal(mutations(app).length,before);assert.ok(text(app.tree()).includes('conflict'));app.dispose();
});

test('per-row password refs clear on lock/expiry/transport/reset/unmount and remain stable during safe refresh',async()=>{
 for(const action of ['lock','expiry','transport','reset','unmount']){const app=await tokenHarness();const p=headerPassword(app,0);p.value='SYNTHETIC_ROW';await app.button('refresh').props.onClick();await app.settle();assert.equal(headerPassword(app,0),p);assert.equal(p.value,'SYNTHETIC_ROW');if(action==='lock')await app.button('lock').props.onClick();else if(action==='expiry')[...app.timers.values()].find(t=>!t.interval).fn();else if(action==='transport')app.button('stdio').props.onClick();else if(action==='reset')app.reset();else app.dispose();assert.equal(p.value,'');if(action!=='unmount')app.dispose();}
});


test('automatic fresh-empty DTO enables Token Save with no Lock/password/reference UI or initialization/unlock RPC', async()=>{
 const app=await tokenHarness({config:null,vault:automatic()});assert.equal(app.input('token').props.disabled,false);assert.equal(app.input('token').props.value,undefined);assert.equal(app.input('token').props.defaultValue,undefined);
 for(const key of ['lock','unlock','initialize','addSecret','editSecret','createAndUnlock','editorUnlock'])assert.equal(app.buttons(key).length,0);
 assert.equal(app.nodes().some(n=>n.type==='input'&&['passphrase','editor-passphrase','ref'].includes(n.props.name)),false);assert.equal(app.nodes().some(n=>n.props['data-legacy-vault']||n.props['data-editor-vault']),false);assert.ok(text(app.tree()).includes('automaticSecurityNote'));assert.equal([...app.timers.values()].some(timer=>!timer.interval),false);
 await app.submit('SYNTHETIC_AUTO_TOKEN');await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['setSecret','saveAndActivate']);assert.deepEqual(mutations(app).map(({request})=>request.revision),[4,5]);assert.equal(mutations(app)[0].request.value,'Bearer SYNTHETIC_AUTO_TOKEN');assert.equal(app.current().vault.initialized,true);assert.equal(app.current().vault.expiresAt,0);assert.equal(app.current().vault.locked,false);assert.equal(app.buttons('lock').length,0);for(const value of [app.hooks.values(),app.tree(),app.warnings,app.infos])assert.ok(!JSON.stringify(value).includes('SYNTHETIC_AUTO_TOKEN'));app.dispose();
});

test('automatic empty Token and Headers save without auth, secret RPC, crypto generation or initialization; blank NEW rows ignored',async()=>{
 for(const row of [null,'Authorization','Authentication']){let cryptoCalls=0;const app=await tokenHarness({config:null,vault:automatic(),crypto:{getRandomValues(bytes){cryptoCalls++;return webcrypto.getRandomValues(bytes);}}});if(row)addHeader(app,row);await app.submit();await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['saveAndActivate']);assert.deepEqual(mutations(app)[0].request.server.headerRefs,{});assert.equal(app.current().vault.initialized,false);assert.equal(cryptoCalls,0);app.dispose();}
});

test('automatic headers-only retains exact complete Authorization/custom values; absent Token is ignored, not double-prefixed',async()=>{
 const app=await tokenHarness({config:null,vault:automatic()});addHeader(app,'Authorization');addHeader(app,'Authentication');headerPassword(app,0).value='  Bearer SYNTHETIC FULL TOKEN  ';headerPassword(app,1).value='Exact SYNTHETIC Custom';await app.submit();await app.settle();const writes=mutations(app);assert.deepEqual(writes.map(({method})=>method),['setSecret','setSecret','saveAndActivate']);assert.deepEqual(writes.map(({request})=>request.revision),[4,5,6]);assert.deepEqual(writes.slice(0,2).map(({request})=>request.value),['  Bearer SYNTHETIC FULL TOKEN  ','Exact SYNTHETIC Custom']);assert.deepEqual(writes[2].request.server.headerRefs,{Authorization:writes[0].request.ref,Authentication:writes[1].request.ref});app.dispose();
});

test('automatic blank existing values preserve opaque aliases and truthful saved status without fake password stars or alias display',async()=>{
 const config={...httpConfig,headerRefs:{Authorization:'opaque_auth','X-API-Key':'opaque_key'}};const app=await tokenHarness({config,vault:automatic(['opaque_auth','opaque_key'])});assert.ok(text(app.tree()).includes('savedAuthentication'));assert.ok(text(app.tree()).includes('savedHeaderValue'));assert.ok(!text(app.tree()).includes('opaque_auth'));assert.ok(!text(app.tree()).includes('opaque_key'));
 for(const input of app.nodes().filter(n=>n.type==='input'&&n.props.type==='password')){assert.equal(input.props.value,undefined);assert.equal(input.props.defaultValue,undefined);assert.equal(input.props.placeholder?.includes('*')??false,false);}
 await app.submit();assert.deepEqual(mutations(app).map(({method})=>method),['saveAndActivate']);assert.deepEqual(mutations(app)[0].request.server.headerRefs,config.headerRefs);app.dispose();
});

test('automatic zero expiry and repeated polls preserve stable Token/header DOM values until explicit context change',async()=>{
 const app=await tokenHarness({vault:automatic(['api_token'])});const tokenRef=app.input('token').props.ref,row=headerPassword(app,0);app.password.value='SYNTHETIC_TYPED_TOKEN';row.value='SYNTHETIC_TYPED_HEADER';for(let i=0;i<3;i++){await app.button('refresh').props.onClick();await app.settle();assert.equal(app.password.value,'SYNTHETIC_TYPED_TOKEN');assert.equal(row.value,'SYNTHETIC_TYPED_HEADER');assert.equal(app.input('token').props.ref,tokenRef);assert.equal(headerPassword(app,0),row);}assert.equal([...app.timers.values()].some(t=>!t.interval),false);app.button('cancel').props.onClick();assert.equal(row.value,'');assert.equal(app.password.value,'');app.dispose();
});

test('automatic respects owned-mount and metadata/value preflight gates without initializing or unlocking anything',async()=>{
 for(const update of [app=>change(app.input('url'),'http://unsafe.invalid'),app=>{headerPassword(app,0).value='Bearer SYNTHETIC_DIRECT';},app=>{addHeader(app,'Connection');headerPassword(app,1).value='SYNTHETIC_CONTROL';}]){const app=await tokenHarness({vault:automatic(['api_token'])});update(app);app.render();await app.submit('SYNTHETIC_AUTO');assert.equal(mutations(app).length,0);app.dispose();}
 const other={...httpConfig,id:'c'.repeat(24)};const app=await tokenHarness({vault:automatic(['api_token']),servers:[rowFor(),rowFor(other,'mounted-status-unavailable')]});assert.equal(app.input('token').props.disabled,true);assert.equal(app.nodes().filter(n=>n.type==='input'&&n.props.name?.startsWith('header-value-'))[0].props.disabled,true);await app.submit('SYNTHETIC_AUTO');assert.equal(mutations(app).length,0);app.dispose();
});

test('automatic uncertain sequential writes preserve reconciliation, missing values need DIFFERENT fresh aliases',async()=>{
 let count=0;const app=await tokenHarness({vault:automatic(['api_token']),respond(method){if(method==='setSecret'&&++count===2)return Promise.reject(Error('SYNTHETIC_PRIVATE_ERROR'));}});addHeader(app,'X-API-Key');headerPassword(app,1).value='SYNTHETIC_AUTO_KEY';await app.submit('SYNTHETIC_AUTO_TOKEN');await app.settle();const old=mutations(app)[1].request.ref;await app.submit();await app.settle();assert.equal(mutations(app).length,2);assert.ok(text(app.form('edit')).includes('tokenMissing'));headerPassword(app,1).value='SYNTHETIC_REENTERED';await app.submit();await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['setSecret','setSecret','setSecret','saveAndActivate']);assert.notEqual(mutations(app)[2].request.ref,old);app.dispose();
});

test('automatic key failure has fixed localized diagnostics and no initialization, unlock or plaintext metadata fallback',async()=>{
 const app=await tokenHarness({vault:automatic(['api_token']),respond(method){if(method==='setSecret')return {ok:false,error:{code:'vault-key-unavailable',message:'MCP console: vault-key-unavailable',details:'SYNTHETIC_PRIVATE_ERROR'}};}});await app.submit('SYNTHETIC_AUTO_TOKEN');await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['setSecret']);assert.ok(text(app.tree()).includes('errors.vault-key-unavailable'));assert.ok(!text(app.form('edit')).includes('savedAuthentication'));assert.ok(!text(app.form('edit')).includes('savedHeaderValue'));for(const value of [app.tree(),app.hooks.values(),app.warnings,app.infos])assert.ok(!JSON.stringify(value).includes('SYNTHETIC_PRIVATE_ERROR'));assert.deepEqual(app.current().servers[0].config.headerRefs,httpConfig.headerRefs);app.dispose();
});

test('automatic late setSecret reply after close/transport/reset/unmount cannot trigger metadata writes',async()=>{
 for(const action of ['cancel','transport','reset','unmount']){let finish;const deferred=new Promise(resolve=>{finish=resolve});const app=await tokenHarness({vault:automatic(['api_token']),respond:method=>method==='setSecret'?deferred:undefined});const submit=app.submit('SYNTHETIC_AUTO');const ref=mutations(app)[0].request.ref;if(action==='cancel')app.button('cancel').props.onClick();else if(action==='transport')app.button('stdio').props.onClick();else if(action==='reset')app.reset();else app.dispose();finish({ok:true,value:makeSnapshot({revision:5,servers:[rowFor()],vault:automatic(['api_token',ref])})});await submit;if(action!=='unmount')await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['setSecret']);if(action!=='unmount')app.dispose();}
});

test('trash is caption-right above header selector, visually 16px with transparent 44px touch target, not beside value',async()=>{
 const app=await tokenHarness({vault:automatic(['api_token'])});const row=app.nodes().find(n=>n.props['data-header-id']);const caption=walk(row).find(n=>n.props.className==='mcp-header-caption');assert.ok(caption);assert.equal(caption.children[0].type,'label');assert.equal(text(caption.children[0]),'headerName');assert.equal(caption.children[1].type,primitives.Button);assert.equal(caption.children[1].props['aria-label'],'removeHeader');assert.ok(caption.children[0].props.htmlFor);assert.equal(walk(caption.children[1]).find(n=>n.type==='svg').props.width,16);assert.equal(walk(caption.children[1]).find(n=>n.type==='svg').props.height,16);assert.equal(row.children.length,2);assert.match(app.styles[0].textContent,/mcp-header-caption\{display:flex;justify-content:flex-start;[^}]*gap:8px/);assert.match(app.styles[0].textContent,/mcp-header-caption>.mcp-header-trash\{[^}]*min-width:44px;min-height:44px[^}]*border:0;background:transparent/);app.dispose();
});

test('legacy repeated locked polls preserve typed values; explicit Lock still clears every credential DOM ref',async()=>{
 const app=await tokenHarness({vault:{mode:'passphrase',initialized:true,locked:true,expiresAt:0,refs:['api_token']}});const row=headerPassword(app,0);row.value='SYNTHETIC_LEGACY_ROW';app.password.value='SYNTHETIC_LEGACY_TOKEN';for(let i=0;i<2;i++){await app.button('refresh').props.onClick();await app.settle();assert.equal(row.value,'SYNTHETIC_LEGACY_ROW');assert.equal(app.password.value,'SYNTHETIC_LEGACY_TOKEN');}await app.button('lock').props.onClick();assert.equal(row.value,'');assert.equal(app.password.value,'');app.dispose();
});

test('legacy explicit create/unlock preserves typed values and safely rebases ONLY own revisions; manual UI is advanced and never auto-saves',async()=>{
 const app=await tokenHarness({config:null,vault:{mode:'passphrase',initialized:false,locked:true,expiresAt:0,refs:[]}});addHeader(app,'X-API-Key');const row=headerPassword(app,0);row.value='SYNTHETIC_LEGACY_KEY';await app.submit('SYNTHETIC_LEGACY_TOKEN');app.render();assert.equal(mutations(app).length,0);assert.equal(row.value,'SYNTHETIC_LEGACY_KEY');assert.equal(app.password.value,'SYNTHETIC_LEGACY_TOKEN');const prompt=app.nodes().find(n=>n.props['data-editor-vault']);assert.equal(prompt.type,'details');assert.equal(walk(prompt).some(n=>n.type==='form'),false);const phrase={value:'SYNTHETIC_USER_PASSPHRASE'};app.input('editor-passphrase').props.ref.current=phrase;const setup=app.button('createAndUnlock').props.onClick();assert.equal(phrase.value,'');await setup;await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['initializeVault','unlock']);assert.deepEqual(mutations(app).map(({request})=>request.revision),[4,5]);assert.equal(mutations(app)[1].request.ttlSeconds,300);assert.equal(row.value,'SYNTHETIC_LEGACY_KEY');assert.equal(app.password.value,'SYNTHETIC_LEGACY_TOKEN');assert.ok(text(app.tree()).includes('editorVaultReady'));assert.equal(app.nodes().some(n=>n.props['data-editor-vault']),false);await app.submit('SYNTHETIC_LEGACY_TOKEN');await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['initializeVault','unlock','setSecret','setSecret','saveAndActivate']);assert.deepEqual(mutations(app).map(({request})=>request.revision),[4,5,6,7,8]);app.dispose();
});

test('legacy malformed metadata prevents setup and preserves DOM; stale configuration prevents any revision adoption',async()=>{
 const app=await tokenHarness({vault:{mode:'passphrase',initialized:true,locked:true,expiresAt:0,refs:['api_token']}});change(app.input('url'),'http://bad.invalid');app.render();await app.submit('SYNTHETIC_LEGACY');app.render();assert.equal(mutations(app).length,0);assert.equal(app.password.value,'SYNTHETIC_LEGACY');assert.equal(app.nodes().some(n=>n.props['data-editor-vault']),false);change(app.input('url'),httpConfig.url);app.render();await app.submit('SYNTHETIC_LEGACY');app.render();app.setCurrent({...app.current(),revision:5,servers:[rowFor({...httpConfig,label:'Externally changed'})]});const phrase={value:'SYNTHETIC_PASSPHRASE'};app.input('editor-passphrase').props.ref.current=phrase;await app.button('editorUnlock').props.onClick();await app.settle();assert.equal(mutations(app).length,0);assert.equal(app.password.value,'SYNTHETIC_LEGACY');assert.ok(text(app.tree()).includes('conflict'));app.dispose();
});

test('legacy setup close/reset/transport/Lock invalidates late initialize reply and never follows with unlock or credential writes',async()=>{
 for(const action of ['cancel','reset','transport','lock']){let finish;const deferred=new Promise(resolve=>{finish=resolve});const app=await tokenHarness({config:null,vault:{mode:'passphrase',initialized:false,locked:true,expiresAt:0,refs:[]},respond:method=>method==='initializeVault'?deferred:undefined});await app.submit('SYNTHETIC_LEGACY');app.render();const phrase={value:'SYNTHETIC_USER_PASSPHRASE'};app.input('editor-passphrase').props.ref.current=phrase;const setup=app.button('createAndUnlock').props.onClick();await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['initializeVault']);if(action==='cancel')app.button('cancel').props.onClick();else if(action==='reset')app.reset();else if(action==='transport')app.button('stdio').props.onClick();else app.button('lock').props.onClick();finish({ok:true,value:makeSnapshot({revision:5,vault:{mode:'passphrase',initialized:true,locked:true,expiresAt:0,refs:[]}})});await setup;await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['initializeVault']);assert.equal(app.password.value,'');app.dispose();}
});


test('automatic stdio alone exposes collapsed write-only credential tools, first ENV secret initializes directly and survives AddSecret closing the draft',async()=>{
 const app=await tokenHarness({config:null,vault:automatic()});assert.equal(app.buttons('addSecret').length,0);app.button('stdio').props.onClick();app.render();let advanced=app.nodes().find(n=>n.props['data-automatic-secrets']);assert.equal(advanced.type,'details');assert.equal(advanced.props.open,undefined);assert.equal(app.button('addSecret').props.disabled,false);
 for(const key of ['lock','initialize','unlock','createAndUnlock','editorUnlock'])assert.equal(app.buttons(key).length,0);
 app.button('addSecret').props.onClick();app.render();assert.equal(app.nodes().some(n=>n.type==='form'&&n.props['aria-label']==='add'),false);assert.ok(app.form('addSecret'));assert.ok(app.nodes().some(n=>n.props['data-automatic-secrets']));change(app.input('ref'),'stdio_env');app.render();const field=app.input('secret');assert.equal(field.props.type,'password');assert.equal(field.props.value,undefined);assert.equal(field.props.defaultValue,undefined);const value={value:'SYNTHETIC_STDIO_ENV_VALUE'};field.props.ref.current=value;await app.form('addSecret').props.onSubmit(event({secret:value}));await app.settle();assert.equal(value.value,'');assert.deepEqual(mutations(app).map(({method})=>method),['setSecret']);assert.deepEqual(mutations(app)[0].request,{revision:4,ref:'stdio_env',value:'SYNTHETIC_STDIO_ENV_VALUE'});assert.equal(app.current().vault.initialized,true);assert.equal(app.buttons('addSecret').length,0,'no stdio draft or saved stdio: automatic HTTP tools stay hidden');
 for(const output of [app.tree(),app.hooks.values(),app.warnings,app.infos])assert.ok(!JSON.stringify(output).includes('SYNTHETIC_STDIO_ENV_VALUE'));
 app.button('add').props.onClick();app.render();app.button('stdio').props.onClick();app.render();change(app.input('label'),'Synthetic local ENV server');app.render();change(app.input('command'),'node');app.render();change(app.input('args'),'["/path/to/server.js"]');app.render();app.button('addRef').props.onClick();app.render();change(app.input('mapping-name-0'),'API_TOKEN');app.render();change(app.input('mapping-ref-0'),'stdio_env');app.render();await app.form('add').props.onSubmit(event());await app.settle();assert.deepEqual(mutations(app).map(({method})=>method),['setSecret','saveAndActivate']);assert.equal(mutations(app)[1].request.revision,5);assert.deepEqual(app.current().servers[0].config.envRefs,{API_TOKEN:'stdio_env'});assert.equal(Object.hasOwn(app.current().servers[0].config,'env'),false);assert.ok(app.nodes().some(n=>n.props['data-automatic-secrets']),'saved stdio retains edit/cleanup route');
 app.button('editSecret').props.onClick();app.render();assert.equal(app.nodes().some(n=>n.type==='input'&&n.props.name==='secret'),false);await app.form('editSecret').props.onSubmit(event());await app.settle();assert.equal(mutations(app).length,2);app.button('editSecret').props.onClick();app.render();change(app.input('secretAction'),'clear');app.render();assert.equal(app.button('saveSecret').props.disabled,true);assert.ok(text(app.tree()).includes('inUse'));app.button('cancel').props.onClick();app.render();app.button('add').props.onClick();app.render();assert.ok(app.nodes().some(n=>n.props['data-automatic-secrets']),'saved stdio keeps advanced tools even with HTTP editor');app.setCurrent({...app.current(),revision:7,servers:[]});await app.button('refresh').props.onClick();await app.settle();assert.equal(app.buttons('addSecret').length,0);assert.equal(app.nodes().some(n=>n.props['data-automatic-secrets']),false);assert.ok(!text(app.tree()).includes('stdio_env'));assert.equal(mutations(app).length,2);app.dispose();
});

test('automatic planned unknown credential aliases never claim saved before snapshot confirms their write',async()=>{
 let finish;const deferred=new Promise(resolve=>{finish=resolve});const app=await tokenHarness({config:null,vault:automatic(),respond:method=>method==='setSecret'?deferred:undefined});const saving=app.submit('SYNTHETIC_PENDING_TOKEN');app.render();assert.deepEqual(mutations(app).map(({method})=>method),['setSecret']);assert.ok(!text(app.form('add')).includes('savedAuthentication'));assert.ok(!text(app.form('add')).includes('savedHeaderValue'));finish({ok:false,error:{code:'vault-key-unavailable',message:'MCP console: vault-key-unavailable'}});await saving;await app.settle();assert.ok(!text(app.form('add')).includes('savedAuthentication'));assert.ok(!text(app.form('add')).includes('savedHeaderValue'));assert.deepEqual(mutations(app).map(({method})=>method),['setSecret']);app.dispose();
});

test('old host without validated-save capability preserves typed values and requests reload, never metadata fallback',async()=>{
 const app=await tokenHarness({config:null,capabilities:undefined,vault:{initialized:false,locked:true,expiresAt:0,refs:[]}});addHeader(app,'X-API-Key');const row=headerPassword(app,0);row.value='SYNTHETIC_OLD_HOST_KEY';await app.submit('SYNTHETIC_OLD_HOST_TOKEN');await app.settle();assert.equal(mutations(app).length,0);assert.equal(row.value,'SYNTHETIC_OLD_HOST_KEY');assert.equal(app.password.value,'SYNTHETIC_OLD_HOST_TOKEN');assert.ok(text(app.tree()).includes('reloadSaveHost'));for(const key of ['initialize','unlock','createAndUnlock','editorUnlock'])assert.equal(app.buttons(key).length,0);assert.equal(app.nodes().some(n=>n.type==='input'&&n.props.name?.includes('passphrase')),false);await app.button('refresh').props.onClick();await app.settle();assert.equal(row.value,'SYNTHETIC_OLD_HOST_KEY');app.dispose();
 const empty=await tokenHarness({config:null,capabilities:undefined,vault:{initialized:false,locked:true,expiresAt:0,refs:[]}});await empty.submit();await empty.settle();assert.deepEqual(mutations(empty),[]);assert.ok(text(empty.tree()).includes('reloadSaveHost'));assert.ok(empty.form('add'));empty.dispose();
});

test('absent Save capability guards every credential/vault variant before DOM clearing, randomness, or RPC', async () => {
  for (const vault of [{ initialized: true, locked: true, expiresAt: 0, refs: [] }, unlocked(['api_token']), automatic(), automatic(['api_token'])]) {
    let randomCalls = 0; const app = await tokenHarness({ config: null, capabilities: undefined, vault, crypto: { getRandomValues(bytes) { randomCalls++; return webcrypto.getRandomValues(bytes); } } });
    addHeader(app, 'X-API-Key'); const row = headerPassword(app, 0); row.value = 'SYNTHETIC_OLD_HOST_HEADER';
    const before = app.requests.length; await app.submit('SYNTHETIC_OLD_HOST_TOKEN'); await app.settle();
    assert.equal(app.requests.length, before, 'Unsupported Save makes no RPC, even snapshot or vault setup'); assert.equal(mutations(app).length, 0); assert.equal(randomCalls, 0);
    assert.equal(row.value, 'SYNTHETIC_OLD_HOST_HEADER'); assert.equal(app.password.value, 'SYNTHETIC_OLD_HOST_TOKEN'); assert.equal(app.input('token').props.type, 'password'); assert.equal(app.input('label').props.value, 'Synthetic new server');
    assert.ok(text(app.tree()).includes('reloadSaveHost')); assert.equal(app.nodes().some((node) => node.props['data-editor-vault']), false);
    for (const input of app.nodes().filter((node) => node.type === 'input' && node.props.type === 'password')) { assert.equal(input.props.value, undefined); assert.equal(input.props.defaultValue, undefined); }
    await app.button('refresh').props.onClick(); await app.settle(); assert.equal(row.value, 'SYNTHETIC_OLD_HOST_HEADER'); assert.equal(app.password.value, 'SYNTHETIC_OLD_HOST_TOKEN'); app.dispose();
  }
  const stdio = await tokenHarness({ config: null, capabilities: undefined, vault: automatic() }); stdio.button('stdio').props.onClick(); stdio.render(); change(stdio.input('command'), 'node'); stdio.render();
  const before = stdio.requests.length; await stdio.form('add').props.onSubmit(event()); await stdio.settle(); assert.equal(stdio.requests.length, before); assert.equal(mutations(stdio).length, 0); assert.equal(stdio.input('command').props.value, 'node'); assert.ok(text(stdio.tree()).includes('reloadSaveHost')); stdio.dispose();
});

test('Save can only close as success for matching activation-verified state with a valid verification timestamp', async () => {
  for (const outcome of ['no-record', 'disabled', 'mounted-status-unavailable', 'missing-time', 'invalid-time', 'wrong-config']) {
    const app = await tokenHarness({ config: null, vault: automatic(), respond(method, request, control) {
      if (method !== 'saveAndActivate') return;
      const committed = control.commit(); const row = committed.value.servers[0];
      let servers = [row];
      if (outcome === 'no-record') servers = [];
      if (['disabled', 'mounted-status-unavailable'].includes(outcome)) servers = [{ ...row, state: outcome }];
      if (outcome === 'missing-time') { const { lastVerifiedAt, ...rest } = row; servers = [rest]; }
      if (outcome === 'invalid-time') servers = [{ ...row, lastVerifiedAt: Number.MAX_SAFE_INTEGER }];
      if (outcome === 'wrong-config') servers = [{ ...row, config: { ...row.config, url: 'https://different.invalid/mcp' } }];
      control.setCurrent({ ...committed.value, servers }); return { ok: true, value: control.current() };
    } });
    await app.submit(); await app.settle(); assert.ok(app.form('add'), outcome); assert.ok(text(app.tree()).includes('savePending'), outcome); assert.ok(!text(app.tree()).includes('success'), outcome);
    assert.deepEqual(mutations(app).map(({ method }) => method), ['saveAndActivate']); assert.equal(mutations(app)[0].request.confirmation, 'SAVE AND ACTIVATE THIS SERVER');
    for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle(); assert.equal(mutations(app).length, 1, 'Polling never replays activation'); app.dispose();
  }
});

test('Save validates and activates as one explicit action, with execution/URL context and no redundant modal', async () => {
  const app = await tokenHarness({ config: null, vault: automatic() }); assert.ok(text(app.form('add')).includes('saveActivationNote'));
  const copy = app.dictionaries['personal.mcpConsole']; assert.match(copy.en.saveActivationNote, /Save validates and activates.*stdio command.*URL.*handshake.*sync tools.*verified/); assert.match(copy['pt-BR'].saveActivationNote, /Salvar valida e ativa.*stdio.*URL.*handshake.*sincronizar/);
  await app.submit(); await app.settle(); assert.equal(app.nodes().some((node) => node.type === 'form' && ['add', 'edit'].includes(node.props['aria-label'])), false); assert.ok(text(app.tree()).includes('success'));
  const control = app.integration('b'.repeat(24)); assert.equal(control.props.checked, true); assert.equal(control.props['aria-checked'], true); assert.equal(app.nodes().find((node) => node.type === primitives.Modal).props.open, false);
  assert.deepEqual(mutations(app).map(({ method }) => method), ['saveAndActivate']); app.dispose();
});

test('confirmed validation failure adds no record and retains editable nonsecret draft and saved credential references without restoring values', async () => {
  const app = await tokenHarness({ config: null, vault: automatic(), respond(method) { if (method === 'saveAndActivate') return { ok: false, error: { message: 'MCP console: mount-failed' } }; } });
  addHeader(app, 'X-API-Key'); headerPassword(app, 0).value = 'SYNTHETIC_HEADER'; await app.submit('SYNTHETIC_TOKEN'); await app.settle();
  assert.equal(app.current().servers.length, 0); assert.equal(app.input('label').props.value, 'Synthetic new server'); assert.equal(app.input('url').props.value, 'https://example.invalid/new');
  const writes = mutations(app); assert.deepEqual(writes.map(({ method }) => method), ['setSecret', 'setSecret', 'saveAndActivate']); assert.equal(new Set(writes.slice(0, 2).map(({ request }) => request.ref)).size, 2);
  assert.ok(!text(app.tree()).includes('tokenPending')); assert.ok(text(app.tree()).includes('errors.mount-failed')); assert.ok(!text(app.tree()).includes('success')); assert.equal(app.input('token').props.disabled, false); assert.equal(headerPassword(app, 0).value, ''); assert.equal(app.nodes().filter((node) => node.type === 'input' && node.props.name?.startsWith('header-value-'))[0].props.disabled, false);
  assert.equal(app.password.value, ''); assert.equal(headerPassword(app, 0).value, '');
  for (const input of app.nodes().filter((node) => node.type === 'input' && node.props.type === 'password')) { assert.equal(input.props.value, undefined); assert.equal(input.props.defaultValue, undefined); assert.ok(!input.props.placeholder?.includes('*')); }
  for (const value of [app.tree(), app.hooks.values(), writes.at(-1).request, app.warnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_TOKEN') && !JSON.stringify(value).includes('SYNTHETIC_HEADER'));
  for (const { request } of writes.slice(0, 2)) { assert.ok(app.current().vault.refs.includes(request.ref)); assert.ok(!text(app.form('add')).includes(request.ref)); }
  for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle(); assert.equal(mutations(app).length, 3); app.dispose();
});

test('no-secret HTTP and stdio lost Save replies first reconcile verified activation, never blindly resubmit', async () => {
  for (const transport of ['http', 'stdio']) {
    let once = false; const app = await tokenHarness({ config: null, vault: automatic(), respond(method, request, control) { if (method === 'saveAndActivate' && !once) { once = true; control.commit(); return Promise.reject(Error('SYNTHETIC_PRIVATE_REPLY')); } } });
    if (transport === 'stdio') { app.button('stdio').props.onClick(); app.render(); change(app.input('command'), 'node'); app.render(); }
    await app.form('add').props.onSubmit(event()); await app.settle(); assert.equal(app.current().servers.length, 1); assert.ok(app.form('add')); assert.ok(text(app.tree()).includes('savePending'));
    const before = app.requests.length; await app.form('add').props.onSubmit(event()); await app.settle(); assert.equal(app.requests[before].method, 'snapshot'); assert.deepEqual(mutations(app).map(({ method }) => method), ['saveAndActivate']);
    assert.equal(app.nodes().some((node) => node.type === 'form' && ['add', 'edit'].includes(node.props['aria-label'])), false); assert.ok(text(app.tree()).includes('success')); assert.ok(!JSON.stringify([app.tree(), app.warnings, app.infos]).includes('SYNTHETIC_PRIVATE_REPLY')); app.dispose();
  }
});

test('matching inactive commit is never saved-active success and requires a subsequent explicit Save after reconciliation', async () => {
  for (const token of ['', 'SYNTHETIC_TOKEN']) {
    let once = false; const app = await tokenHarness({ config: null, vault: automatic(), respond(method, request, control) { if (method === 'saveAndActivate' && !once) { once = true; const result = control.commit(); control.setCurrent({ ...result.value, servers: result.value.servers.map(({ config }) => rowFor(config)) }); return Promise.reject(Error('SYNTHETIC_PRIVATE_COMMIT')); } } });
    await app.submit(token); await app.settle(); const expectedMutations = token ? 2 : 1; assert.equal(mutations(app).length, expectedMutations); assert.ok(app.form('add')); assert.ok(!text(app.tree()).includes('success'));
    const before = app.requests.length; await app.submit(); await app.settle(); assert.equal(app.requests[before].method, 'snapshot'); assert.equal(mutations(app).length, expectedMutations); assert.ok(app.form('edit')); assert.ok(text(app.tree()).includes('activationUnconfirmed')); assert.equal(app.integration('b'.repeat(24)).props.checked, false); assert.equal(app.integration('b'.repeat(24)).props.disabled, true, 'Pending validation cannot be sidestepped through switch');
    for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle(); assert.equal(mutations(app).length, expectedMutations);
    await app.form('edit').props.onSubmit(event()); await app.settle(); assert.equal(mutations(app).length, expectedMutations + 1); assert.equal(mutations(app).at(-1).method, 'saveAndActivate'); assert.equal(mutations(app).at(-1).request.server.id, 'b'.repeat(24)); assert.equal(app.current().servers.length, 1); assert.ok(text(app.tree()).includes('success')); assert.equal(app.integration('b'.repeat(24)).props.checked, true); app.dispose();
  }
});

test('duplicate Save click is ignored while credential or validated activation RPC is pending', async () => {
  for (const stage of ['setSecret', 'saveAndActivate']) {
    let finish; const deferred = new Promise((resolve) => { finish = resolve; }); let committed;
    const app = await tokenHarness({ config: null, vault: automatic(), respond(method, request, control) { if (method === stage) { committed = control.commit(); return deferred; } } });
    const form = app.form('add'); app.password.value = stage === 'setSecret' ? 'SYNTHETIC_TOKEN' : '';
    const first = form.props.onSubmit(event({ token: app.password })); await app.settle(); const count = mutations(app).length; assert.equal(mutations(app).at(-1).method, stage);
    const second = form.props.onSubmit(event({ token: app.password })); await second; assert.equal(mutations(app).length, count); assert.equal(app.tree().props['aria-busy'], true);
    finish(committed); await first; await app.settle(); assert.deepEqual(mutations(app).map(({ method }) => method), stage === 'setSecret' ? ['setSecret', 'saveAndActivate'] : ['saveAndActivate']); app.dispose();
  }
});

test('switch ON/OFF stays snapshot-controlled and disabled while pending; duplicate events and failed operations never fake checked success', async () => {
  for (const checked of [false, true]) {
    let finish; const deferred = new Promise((resolve) => { finish = resolve; });
    const snapshot = makeSnapshot({ servers: [{ ...rowFor(httpConfig, checked ? 'activation-verified' : 'disabled'), ...(checked ? { lastVerifiedAt: 1760000000000 } : {}) }] });
    const app = await setup({ snapshot, respond: (method) => ['start', 'stop'].includes(method) ? deferred : { ok: true, value: snapshot } }); app.render(); app.hooks.effects(); await app.settle();
    const control = app.integration(), first = control.props.onChange(!checked); app.render(); assert.equal(app.integration().props.checked, checked); assert.equal(app.integration().props['aria-checked'], checked); assert.equal(app.integration().props.disabled, true);
    await control.props.onChange(!checked); await app.integration().props.onChange(checked); assert.equal(mutations(app).length, 1);
    assert.deepEqual(mutations(app)[0].request, { revision: 4, id: serverId, ...(!checked ? { confirmation: 'START THIS SERVER' } : {}) });
    finish({ ok: false, error: { message: 'SYNTHETIC_PRIVATE_FAILURE' } }); await first; await app.settle(); assert.equal(app.integration().props.checked, checked); assert.equal(app.integration().props.disabled, false); assert.equal(mutations(app).length, 1); assert.ok(!text(app.tree()).includes('success')); assert.ok(!JSON.stringify([app.tree(), app.warnings]).includes('SYNTHETIC_PRIVATE_FAILURE')); app.dispose();
  }
});

test('new credential values entered after an ambiguous committed Save are not silently ignored as old verified success', async () => {
  for (const initialToken of ['', 'SYNTHETIC_FIRST_TOKEN']) {
    let once = false; const app = await tokenHarness({ config: null, vault: automatic(), respond(method, request, control) { if (method === 'saveAndActivate' && !once) { once = true; control.commit(); return Promise.reject(Error('SYNTHETIC_PRIVATE_REPLY')); } } });
    await app.submit(initialToken); await app.settle(); const before = mutations(app).length; assert.ok(app.form('add'));
    await app.submit('SYNTHETIC_REVISED_TOKEN'); await app.settle(); assert.equal(mutations(app).length, before, 'No new secret write or activation replay'); assert.ok(app.form('add')); assert.ok(text(app.tree()).includes('conflict')); assert.ok(!text(app.tree()).includes('success')); assert.equal(app.password.value, '');
    for (const value of [app.tree(), app.hooks.values(), app.warnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_REVISED_TOKEN'));
    assert.equal(app.current().servers.length, 1); app.dispose();
  }
});

test('old host capability gate also retains explicitly typed advanced credentials and passphrases without writes', async () => {
  const app = await tokenHarness({ config: null, capabilities: undefined, vault: automatic() }); app.button('stdio').props.onClick(); app.render(); app.button('addSecret').props.onClick(); app.render(); change(app.input('ref'), 'explicit_env'); app.render();
  const value = { value: 'SYNTHETIC_ADVANCED_SECRET' }; app.input('secret').props.ref.current = value; const before = app.requests.length;
  await app.form('addSecret').props.onSubmit(event({ secret: value })); await app.settle(); assert.equal(app.requests.length, before); assert.equal(value.value, 'SYNTHETIC_ADVANCED_SECRET'); assert.ok(text(app.tree()).includes('reloadSaveHost')); app.dispose();
  const legacy = await setup({ snapshot: { capabilities: undefined, vault: { mode: 'passphrase', initialized: true, locked: true, expiresAt: 0, refs: [] } } }); legacy.render(); legacy.hooks.effects(); await legacy.settle();
  const phrase = { value: 'SYNTHETIC_ADVANCED_PASSPHRASE' }; legacy.input('passphrase').props.ref.current = phrase; const requests = legacy.requests.length;
  await legacy.form('unlock').props.onSubmit(event({ passphrase: phrase })); await legacy.settle(); assert.equal(legacy.requests.length, requests); assert.equal(phrase.value, 'SYNTHETIC_ADVANCED_PASSPHRASE'); assert.ok(text(legacy.tree()).includes('reloadSaveHost')); legacy.dispose();
});

test('confirmed mount-failed permits corrected URL Save retry without pending-config conflict or automatic replay', async () => {
  let failed = false; const app = await tokenHarness({ config: null, vault: automatic(), respond(method) { if (method === 'saveAndActivate' && !failed) { failed = true; return { ok: false, error: { message: 'MCP console: mount-failed' } }; } } });
  await app.submit(); await app.settle(); assert.equal(app.current().servers.length, 0); assert.ok(app.form('add')); assert.ok(text(app.tree()).includes('errors.mount-failed')); assert.ok(!text(app.tree()).includes('savePending')); assert.ok(!text(app.tree()).includes('success')); assert.equal(mutations(app).length, 1);
  change(app.input('url'), 'https://example.invalid/corrected'); app.render(); const before = app.requests.length;
  await app.submit(); await app.settle(); assert.equal(app.requests[before].method, 'saveAndActivate', 'Confirmed no-commit failure needs no ambiguous reconciliation'); assert.deepEqual(mutations(app).map(({ method }) => method), ['saveAndActivate', 'saveAndActivate']);
  assert.equal(mutations(app)[1].request.server.url, 'https://example.invalid/corrected'); assert.equal(app.current().servers.length, 1); assert.equal(app.current().servers[0].state, 'activation-verified'); assert.ok(text(app.tree()).includes('success')); app.dispose();
});

test('pure viewport/bounds geometry intersects visual viewport, card width and each ancestor clipping axis', async () => {
  const app = await setup(), { infoViewport, infoBounds } = app.plugin;
  assert.deepEqual(plain(infoViewport(800, 600, { offsetLeft: 120, offsetTop: 90, width: 340, height: 300 })), { left: 120, top: 90, right: 460, bottom: 390 });
  assert.equal(infoViewport(0, 600), null); assert.equal(infoViewport(800, NaN), null);
  assert.deepEqual(plain(infoViewport(400, 300, { offsetLeft: 900, offsetTop: 0, width: 50, height: 50 })), null);
  assert.deepEqual(plain(infoViewport(400, 300, { offsetLeft: NaN, offsetTop: 0, width: 50, height: 50 })), { left: 0, top: 0, right: 400, bottom: 300 });
  const viewport = infoViewport(500, 700), card = { left: 30, top: 130, right: 480, bottom: 200 };
  const clips = [{ rect: { left: 0, top: 70, right: 500, bottom: 600 }, x: false, y: true }, { rect: { left: 60, top: 0, right: 430, bottom: 700 }, x: true, y: false }];
  assert.deepEqual(plain(infoBounds(viewport, card, clips)), { left: 64, top: 74, right: 426, bottom: 596 });
  assert.equal(infoBounds(viewport, card, [{ rect: { left: 0, top: 0, right: 0, bottom: 20 }, x: true, y: true }]), null);
  assert.equal(infoBounds(viewport, { ...card, left: 494, right: 500 }), null, 'Insufficient inset space fails closed'); app.dispose();
});

test('pure popup geometry prefers below when content fits, otherwise above/larger side, always wholly bounded', async () => {
  const app = await setup(), { infoGeometry } = app.plugin, bounds = { left: 40, top: 60, right: 400, bottom: 500 };
  assert.deepEqual(plain(infoGeometry({ left: 50, top: 100, right: 94, bottom: 144 }, bounds, 100)), { left: 40, top: 144, width: 360, height: 100, placement: 'below' });
  assert.deepEqual(plain(infoGeometry({ left: 50, top: 430, right: 94, bottom: 474 }, bounds, 200)), { left: 40, top: 230, width: 360, height: 200, placement: 'above' });
  assert.equal(infoGeometry({ left: 50, top: 520, right: 94, bottom: 564 }, bounds), null, 'Offscreen trigger does not spawn an unrelated popup');
  assert.equal(infoGeometry({ left: NaN, top: 100, right: 94, bottom: 144 }, bounds), null);
  assert.equal(infoGeometry({ left: 50, top: 60, right: 94, bottom: 500 }, bounds), null, 'No side space fails closed');
  for (const bottom of [160, 250, 500, 740]) for (const top of [64, 100, 200, 430, 600]) for (const content of [30, 100, 900, Infinity]) {
    const area = { ...bounds, bottom }, geometry = infoGeometry({ left: 50, top, right: 94, bottom: top + 44 }, area, content);
    if (!geometry) continue;
    assert.ok(geometry.left >= area.left && geometry.left + geometry.width <= area.right);
    assert.ok(geometry.top >= area.top && geometry.top + geometry.height <= area.bottom);
  }
  app.dispose();
});

test('pure absolute fallback conversion accounts for containing-block borders, scrolling and transform scale', async () => {
  const app = await setup(), { absoluteInfoGeometry } = app.plugin;
  const geometry = { left: 100, top: 220, width: 300, height: 150 };
  for (const scale of [0.75, 1, 1.5, 2]) {
    const parent = { rect: { left: 40, top: 80, right: 40 + 400 * scale, bottom: 80 + 88 * scale }, width: 400, height: 88, clientLeft: 2, clientTop: 3, scrollLeft: 10, scrollTop: 20 };
    const local = absoluteInfoGeometry(geometry, parent), x = parent.rect.left + (parent.clientLeft - parent.scrollLeft) * scale, y = parent.rect.top + (parent.clientTop - parent.scrollTop) * scale;
    for (const [actual, expected] of [[x + local.left * scale, geometry.left], [y + local.top * scale, geometry.top], [local.width * scale, geometry.width], [local.height * scale, geometry.height]]) assert.ok(Math.abs(actual - expected) < 0.00001);
  }
  assert.equal(absoluteInfoGeometry(geometry, { rect: { left: 0, top: 0, right: 1, bottom: 1 }, width: 0, height: 1 }), null); app.dispose();
});

test('native manual popover is bounded before reveal, updates on external viewport changes and cleans up without focus reopening', async () => {
  const geometry = popupGeometryFixture({ native: true }); const app = await setup({ geometry, snapshot: { servers: [rowFor()] } }); app.render(); app.hooks.effects(); await app.settle();
  app.info().props.onClick(); app.render(); assert.equal(geometry.popup.style.display, 'none', 'First render never paints an unmeasured bubble'); app.hooks.effects();
  assert.equal(geometry.popup.attributes.get('popover'), 'manual'); assert.equal(geometry.popup.style.position, 'fixed', 'Fixed positioning is used ONLY in feature-detected top layer');
  assert.equal(geometry.shows.length, 1); assert.equal(geometry.shows[0].visibility, 'hidden'); assert.equal(geometry.shows[0].left, '48px'); assert.equal(geometry.shows[0].width, '340px'); assert.equal(geometry.shows[0].maxHeight, '320px');
  assert.equal(geometry.popup.style.visibility, 'visible'); assert.equal(geometry.popup.style.top, '174px');
  const openShows = geometry.shows.length, openHides = geometry.hides.length, openObservers = geometry.observers.length;
  geometry.popup.scrollTop = 80; await app.button('refresh').props.onClick(); await app.settle();
  assert.equal(geometry.shows.length, openShows); assert.equal(geometry.hides.length, openHides); assert.equal(geometry.observers.length, openObservers); assert.equal(geometry.popup.scrollTop, 80, 'Snapshot polling remeasures without hide/reopen or losing keyboard scroll');
  geometry.popup.scrollTop = 120; const before = { ...geometry.popup.style }; app.dispatch('scroll', { target: geometry.popup }); assert.deepEqual(geometry.popup.style, before); assert.equal(geometry.popup.scrollTop, 120, 'Keyboard/content scrolling is not a reposition operation');
  geometry.trigger.rect = { left: 44, top: 490, right: 88, bottom: 534 }; app.dispatch('scroll', { target: geometry.clip });
  assert.equal(geometry.popup.style.top, '170px'); assert.equal(geometry.popup.style.height, '320px'); assert.equal(geometry.popup.scrollTop, 120);
  geometry.view.visualViewport.height = 400; geometry.view.visualViewport.dispatch('resize'); assert.equal(geometry.popup.style.display, 'none', 'Clipped trigger hides safely instead of overflowing');
  geometry.trigger.rect = { left: 44, top: 270, right: 88, bottom: 314 }; geometry.view.visualViewport.dispatch('scroll'); assert.equal(geometry.popup.style.visibility, 'visible'); assert.equal(geometry.popup.style.top, '70px');
  geometry.clip.rect.bottom = 320; geometry.clip.offsetHeight = geometry.clip.clientHeight = 260; geometry.view.dispatch('resize'); assert.ok(parseFloat(geometry.popup.style.top) + parseFloat(geometry.popup.style.height) <= 316);
  geometry.row.rect.right = 300; geometry.row.offsetWidth = geometry.row.clientWidth = 256; geometry.observers.at(-1).deliver(); assert.equal(geometry.popup.style.width, '248px');
  const hide = geometry.popup.hidePopover; geometry.popup.hidePopover = () => { hide(); walk(app.card()).find((node) => node.props.className === 'mcp-info').props.onFocus(); };
  app.dispatch('pointerdown', { target: {} }); app.render(); app.hooks.effects(); app.render(); assert.equal(app.info().props['aria-expanded'], false, 'Native focus restoration cannot reopen outside-dismissed info');
  for (const listeners of app.domListeners.values()) assert.equal(listeners.size, 0); for (const listeners of geometry.view.listeners.values()) assert.equal(listeners.size, 0); for (const listeners of geometry.view.visualViewport.listeners.values()) assert.equal(listeners.size, 0); for (const observer of geometry.observers) assert.equal(observer.nodes.size, 0);
  app.info().props.onClick(); app.render(); app.hooks.effects(); app.dispose(); assert.equal(geometry.popup.style.display, 'none'); for (const observer of geometry.observers) assert.equal(observer.nodes.size, 0); assert.ok(app.requests.every(({ method }) => method === 'snapshot'));
});

test('zero-height hidden document roots and unrelated portal parents cannot clip a viewport-fixed overlay', async () => {
  for (const native of [false, true]) {
    const geometry = popupGeometryFixture({ native }), app = await setup({ geometry, snapshot: { servers: [rowFor()] } }); app.render(); app.hooks.effects(); await app.settle();
    const owner = geometry.trigger.ownerDocument, hidden = { overflowX: 'hidden', overflowY: 'hidden' }, zero = { left: 0, top: 0, right: 480, bottom: 0 };
    const html = geometry.makeNode(zero, null, hidden), body = geometry.makeNode(zero, html, hidden);
    html.clientWidth = 480; html.clientHeight = 640; owner.documentElement = html; owner.body = body;
    geometry.clip.parentElement = body;
    app.info().props.onClick(); app.render(); app.hooks.effects(); assert.equal(geometry.popup.style.display, 'block'); assert.equal(geometry.popup.style.visibility, 'visible', 'Root clipping uses viewport dimensions, not zero-height root content');
    assert.equal(geometry.popup.style.width, '340px'); assert.equal(geometry.popup.style.height, '320px');
    app.info().props.onClick(); app.render(); app.hooks.effects();
    const portal = geometry.makeNode(zero, body, hidden), overlay = geometry.makeNode({ left: 0, top: 0, right: 480, bottom: 640 }, portal, { position: 'fixed', ...hidden });
    geometry.clip.parentElement = overlay;
    app.info().props.onClick(); app.render(); app.hooks.effects(); assert.equal(geometry.popup.style.display, 'block'); assert.equal(geometry.popup.style.visibility, 'visible', 'Unrelated zero-sized portal mount above viewport-fixed overlay is not a clipping box');
    assert.equal(geometry.popup.style.width, '340px'); assert.equal(geometry.popup.style.height, '320px');
    portal.computed.transform = 'translateZ(0)'; geometry.view.dispatch('resize'); assert.equal(geometry.popup.style.display, 'none', 'An actual fixed containing block still enforces its hidden zero-height clip');
    portal.rect = { left: 20, top: 40, right: 300, bottom: 340 }; portal.offsetWidth = portal.clientWidth = 280; portal.offsetHeight = portal.clientHeight = 300;
    const unrelated = geometry.makeNode(zero, portal, hidden); overlay.parentElement = unrelated;
    geometry.view.dispatch('resize'); assert.equal(geometry.popup.style.display, 'block'); assert.equal(geometry.popup.style.visibility, 'visible', 'Overflow between fixed overlay and its containing block does not clip the overlay');
    assert.equal(geometry.popup.style.width, '248px'); assert.equal(geometry.popup.style.height, '162px', 'Actual containing-block bounds remain applied');
    portal.computed.transform = 'none'; geometry.view.dispatch('resize'); assert.equal(geometry.popup.style.width, '340px'); assert.equal(geometry.popup.style.height, '320px');
    assert.ok(app.requests.every(({ method }) => method === 'snapshot')); app.dispose(); for (const observer of geometry.observers) assert.equal(observer.nodes.size, 0);
  }
});

test('roomy desktop keeps prior preferred size caps and row-content alignment; narrow viewport shrinks then regrows', async () => {
  const geometry = popupGeometryFixture({ native: true, viewport: { width: 1280, height: 1000 } });
  geometry.clip.rect.right = 1240; geometry.clip.rect.bottom = 940; geometry.clip.offsetWidth = geometry.clip.clientWidth = 1220; geometry.clip.offsetHeight = geometry.clip.clientHeight = 880;
  geometry.card.rect.right = 1228; geometry.card.offsetWidth = geometry.card.clientWidth = 1196;
  geometry.row.rect.right = 1216; geometry.row.offsetWidth = geometry.row.clientWidth = 1172;
  const app = await setup({ geometry, snapshot: { servers: [rowFor()] } }); app.render(); app.hooks.effects(); await app.settle(); app.info().props.onClick(); app.render(); app.hooks.effects();
  assert.equal(geometry.popup.style.left, '48px', 'Alignment is inside row content, not the card border/padding'); assert.equal(geometry.popup.style.width, '340px'); assert.equal(geometry.popup.style.height, '360px');
  geometry.view.visualViewport.width = 240; geometry.view.visualViewport.dispatch('resize'); assert.equal(geometry.popup.style.width, '188px'); assert.ok(parseFloat(geometry.popup.style.left) + parseFloat(geometry.popup.style.width) <= 236);
  geometry.view.visualViewport.width = 1280; geometry.view.visualViewport.dispatch('resize'); assert.equal(geometry.popup.style.width, '340px', 'Design cap is immutable, not a previously written inline maxWidth');
  geometry.popup.firstElementChild.scrollHeight = 48; geometry.observers.at(-1).deliver(); assert.equal(geometry.popup.style.height, '50px', 'Short content uses natural height');
  app.dispose();
});

test('unsupported or throwing native popover uses bounded absolute fallback and invalid geometry remains hidden', async () => {
  for (const options of [{ native: false }, { native: true, showFails: true }]) {
    const geometry = popupGeometryFixture(options), app = await setup({ geometry, snapshot: { servers: [rowFor()] } }); app.render(); app.hooks.effects(); await app.settle();
    app.info().props.onClick(); app.render(); assert.equal(geometry.popup.style.display, 'none'); app.hooks.effects();
    assert.equal(geometry.popup.style.position, 'absolute'); assert.equal(geometry.popup.attributes.has('popover'), false); assert.equal(geometry.popup.style.left, '4px'); assert.equal(geometry.popup.style.top, '44px'); assert.equal(geometry.popup.style.width, '340px'); assert.equal(geometry.popup.style.maxHeight, '320px');
    geometry.row.rect = { left: 44, top: 130, right: 828, bottom: 218 }; // scaled containing block; no fixed-inside-transformed-Modal shortcut
    geometry.view.dispatch('resize'); assert.equal(geometry.popup.style.width, '170px'); assert.equal(geometry.popup.style.top, '22px'); assert.equal(geometry.popup.style.maxHeight, '160px');
    geometry.trigger.rect.left = NaN; app.dispatch('scroll', { target: geometry.clip }); assert.equal(geometry.popup.style.display, 'none');
    app.dispose(); for (const listeners of app.domListeners.values()) assert.equal(listeners.size, 0); for (const observer of geometry.observers) assert.equal(observer.nodes.size, 0);
  }
  const missing = await setup({ geometry: null, snapshot: { servers: [rowFor()] } }); missing.render(); missing.hooks.effects(); await missing.settle(); missing.info().props.onClick(); missing.render(); missing.hooks.effects();
  assert.deepEqual(plain(walk(missing.card()).find((node) => node.props.className === 'mcp-info-bubble').props.style), { display: 'none' }); missing.dispose();
});

test('compact summary tree orders name, info, short status/time, reconnect icon and native switch above Details', async () => {
  const timestamp = 1760000000000;
  const app = await setup({ snapshot: { servers: [{ ...rowFor(httpConfig, 'activation-verified'), lastVerifiedAt: timestamp }] } });
  app.render(); app.hooks.effects(); await app.settle();
  const card = app.card(), row = card.children.find((node) => node.props?.className === 'mcp-compact-row'), details = card.children.find((node) => node.type === 'details');
  assert.equal(card.children.length, 2); assert.equal(card.children[0], row); assert.equal(card.children[1], details);
  assert.equal(row.children.length, 5); assert.equal(row.children[0].type, 'h3'); assert.equal(row.children[0].props.className, 'mcp-server-name'); assert.equal(text(row.children[0]), httpConfig.label);
  assert.equal(row.children[1].props.className, 'mcp-info'); assert.equal(row.children[2].type, 'span'); assert.equal(row.children[2].props.className, 'mcp-status');
  assert.equal(row.children[3], app.button('reconnect')); assert.equal(row.children[4].props.className, 'mcp-integration'); assert.ok(walk(row.children[4]).includes(app.integration()));
  assert.equal(walk(card).some((node) => node.props.className === 'mcp-head' || node.props.className === 'mcp-tag'), false, 'No separate heading or redundant transport badge');
  assert.ok(walk(details).some((node) => node.type === 'dt' && text(node) === 'transport')); assert.ok(walk(details).some((node) => node.type === 'dd' && text(node) === 'http'), 'Transport remains in configuration details');
  assert.equal(text(app.button('reconnect')), '', 'Refresh is a symbol, not a large text button');
  assert.equal(text(row.children.find((node) => node.props.className === 'mcp-status')).includes('compactVerified'), true);
  for (const key of ['integrationNote', 'verificationNote', 'stoppingNote']) assert.ok(!text(card).includes(key));
  const time = walk(card).find((node) => node.type === 'time'); const full = new Date(timestamp).toLocaleString('en');
  assert.equal(time.props.title, 'verifiedAt: ' + full); assert.equal(time.props['aria-label'], time.props.title);
  assert.equal(text(time).trim(), new Date(timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }));
  assert.equal(time.props.dateTime, new Date(timestamp).toISOString());
  assert.equal(app.info().props['aria-expanded'], false); assert.ok(app.info().props['aria-label'].includes(httpConfig.label));
  assert.equal(app.button('reconnect').props['aria-label'], 'reconnectAction: ' + httpConfig.label);
  const copy = app.dictionaries['personal.mcpConsole']; assert.equal(copy['pt-BR'].dateLocale, 'pt-BR');
  assert.match(copy.en.reconnectAction, /Reconnect and refresh MCP tools.*command.*HTTP server/); assert.match(copy['pt-BR'].reconnectAction, /Reconectar.*ferramentas MCP.*comando.*HTTP/);
  assert.match(app.styles[0].textContent, /mcp-info\{[^}]*flex:0 0 44px;[^}]*width:44px;[^}]*height:44px/);
  assert.match(app.styles[0].textContent, /mcp-info-bubble\{[^}]*display:none;[^}]*overflow:auto;[^}]*overscroll-behavior:contain/);
  assert.ok(!/;width:340px;/.test(app.styles[0].textContent), 'Geometry shrinks the prior preferred maximum instead of forcing a cosmetic width');
  assert.match(app.styles[0].textContent, /--mcp-info-max-width:340px;--mcp-info-max-height:360px/);
  assert.ok(app.styles[0].textContent.includes('.personal-mcp-console .mcp-info-bubble::backdrop{background:transparent;pointer-events:none}'), 'Own nonmodal top-layer backdrop cannot eat outside clicks');
  assert.match(app.styles[0].textContent, /mcp-integration\{[^}]*margin-left:auto;flex:none/); app.dispose();
});

// Tree, hook and declared-CSS regressions only: not a browser/pixel or rendered mobile-width proof.
test('long owned names retain full accessible titles while summary CSS declares one horizontal ellipsized line', async () => {
  const label = 'Very long owned MCP name '.repeat(4).slice(0, 80);
  const local = { id: serverId, label, transport: 'stdio', command: 'node', args: [], cwd: '', envRefs: {} };
  for (const config of [{ ...httpConfig, label }, local]) {
    const app = await setup({ snapshot: { servers: [rowFor(config)], vault: automatic(['api_token']) } }); app.render(); app.hooks.effects(); await app.settle();
    const card = app.card(), row = card.children.find((node) => node.props?.className === 'mcp-compact-row'), name = row.children.find((node) => node.type === 'h3');
    assert.equal(name.props.className, 'mcp-server-name'); assert.equal(text(name), label); assert.equal(name.props.title, label);
    assert.equal(app.info().props['aria-label'], 'serverInfo: ' + label); assert.equal(app.button('reconnect').props['aria-label'], 'reconnectAction: ' + label); assert.equal(app.integration().props.label, 'integration: ' + label);
    assert.equal(walk(row).some((node) => node.props.className === 'mcp-tag'), false);
    const details = card.children.find((node) => node.type === 'details'); assert.ok(walk(details).some((node) => node.type === 'dd' && text(node) === (config.transport === 'stdio' ? 'stdio' : 'http')));
    const css = app.styles[0].textContent;
    assert.match(css, /\.mcp-compact-row\{[^}]*display:flex;[^}]*align-items:center;[^}]*flex-wrap:nowrap;[^}]*min-width:0/);
    assert.match(css, /\.mcp-server-name\{[^}]*min-width:0;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
    assert.match(css, /\.mcp-compact-row>\.mcp-status\{[^}]*overflow:hidden;[^}]*white-space:nowrap/);
    assert.match(css, /\.mcp-status-label\{[^}]*min-width:0;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
    assert.ok(app.requests.every(({ method }) => method === 'snapshot')); app.dispose();
  }
});

test('Edit renders exactly one inline form inside only the selected owned card Details and Cancel restores its read-only content', async () => {
  const other = { ...httpConfig, id: 'c'.repeat(24), label: 'Other owned MCP', url: 'https://example.invalid/other' };
  const app = await tokenHarness({ servers: [rowFor(), rowFor(other)], vault: automatic(['api_token']) });
  const form = app.form('edit'), details = app.card().children.find((node) => node.type === 'details'), otherDetails = app.card(other.id).children.find((node) => node.type === 'details');
  assert.equal(app.nodes().filter((node) => node.type === 'form').length, 1); assert.equal(form.props.className, 'mcp-fields mcp-inline-editor'); assert.equal(form.props['data-server-editor'], serverId); assert.equal(form.props['data-editor-placement'], 'inline');
  assert.equal(details.props.open, true); assert.ok(walk(details).includes(form)); assert.ok(walk(app.card()).includes(form)); assert.equal(walk(otherDetails).includes(form), false); assert.equal(otherDetails.props.open, undefined);
  assert.equal(walk(details).some((node) => node.type === 'dl' && node.props.className === 'mcp-detail'), false);
  assert.equal(walk(details).some((node) => node.type === primitives.Button && ['edit', 'remove'].includes(text(node).trim())), false);
  assert.ok(walk(otherDetails).some((node) => node.type === 'dl' && node.props.className === 'mcp-detail')); assert.ok(walk(otherDetails).some((node) => node.type === primitives.Button && text(node).trim() === 'edit'));
  assert.equal(app.input('label').props.value, httpConfig.label); assert.equal(app.input('url').props.value, httpConfig.url); assert.equal(app.input('token').props.type, 'password');
  assert.equal(app.input('token').props.value, undefined); assert.equal(app.input('token').props.defaultValue, undefined);
  change(app.input('label'), 'Unsaved local label'); app.render(); const header = headerPassword(app, 0); header.value = 'SYNTHETIC_INLINE_HEADER'; app.password.value = 'SYNTHETIC_INLINE_TOKEN';
  walk(app.form('edit')).find((node) => node.type === primitives.Button && text(node).trim() === 'cancel').props.onClick(); app.render();
  assert.equal(header.value, ''); assert.equal(app.password.value, ''); assert.equal(app.nodes().filter((node) => node.type === 'form').length, 0);
  const restored = app.card().children.find((node) => node.type === 'details'); assert.equal(restored.props.open, undefined);
  assert.ok(walk(restored).some((node) => node.type === 'dl' && node.props.className === 'mcp-detail')); assert.ok(walk(restored).some((node) => node.type === primitives.Button && text(node).trim() === 'remove'));
  walk(restored).find((node) => node.type === primitives.Button && text(node).trim() === 'edit').props.onClick(); app.render();
  assert.equal(app.input('label').props.value, httpConfig.label); assert.equal(app.input('url').props.value, httpConfig.url); assert.equal(mutations(app).length, 0); app.dispose();
});

test('Add stays before the owned list outside every card; switching existing editors and Add clears synthetic password values', async () => {
  const other = { ...httpConfig, id: 'c'.repeat(24), label: 'Second owned MCP', url: 'https://example.invalid/second' };
  const app = await tokenHarness({ servers: [rowFor(), rowFor(other)], vault: automatic(['api_token']) });
  const header = headerPassword(app, 0), detached = { value: 'SYNTHETIC_DETACHED_PASSWORD' }; app.root.passwords = [detached];
  header.value = 'SYNTHETIC_FIRST_HEADER'; app.password.value = 'SYNTHETIC_FIRST_TOKEN'; change(app.input('label'), 'Unsaved first draft'); app.render();
  walk(app.card(other.id)).find((node) => node.type === primitives.Button && text(node).trim() === 'edit').props.onClick(); app.render();
  assert.equal(header.value, ''); assert.equal(app.password.value, ''); assert.equal(detached.value, ''); assert.equal(app.nodes().filter((node) => node.type === 'form').length, 1);
  assert.equal(app.form('edit').props['data-server-editor'], other.id); assert.ok(walk(app.card(other.id).children.find((node) => node.type === 'details')).includes(app.form('edit'))); assert.equal(walk(app.card()).includes(app.form('edit')), false);
  assert.equal(app.input('label').props.value, other.label); assert.equal(app.input('url').props.value, other.url);
  const secondHeader = headerPassword(app, 0); secondHeader.value = 'SYNTHETIC_SECOND_HEADER'; app.input('token').props.ref.current.value = 'SYNTHETIC_SECOND_TOKEN'; change(app.input('label'), 'Unsaved second draft'); app.render();
  app.button('add').props.onClick(); app.render();
  assert.equal(secondHeader.value, ''); assert.equal(app.password.value, ''); assert.equal(app.nodes().filter((node) => node.type === 'form').length, 1);
  const form = app.form('add'), nodes = app.nodes(), owned = nodes.find((node) => node.type === 'ul' && node.props['aria-label'] === 'ownedTitle'), heading = nodes.find((node) => node.type === 'h3' && text(node) === 'ownedTitle');
  assert.equal(form.props['data-editor-placement'], 'new'); assert.equal(form.props['data-server-editor'], 'new'); assert.equal(walk(owned).includes(form), false);
  for (const id of [serverId, other.id]) { assert.equal(walk(app.card(id)).includes(form), false); assert.equal(app.card(id).children.find((node) => node.type === 'details').props.open, undefined); }
  assert.ok(nodes.indexOf(app.button('add')) < nodes.indexOf(form)); assert.ok(nodes.indexOf(form) < nodes.indexOf(heading)); assert.ok(nodes.indexOf(form) < nodes.indexOf(owned)); assert.equal(app.input('label').props.value, '');
  for (const value of [app.tree(), app.hooks.values(), app.warnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_'));
  assert.equal(mutations(app).length, 0); app.dispose();
});

test('a disappeared existing target retains a labeled conflict Edit draft, including pending quarantine and credential history, never Add', async () => {
  for (const stage of ['ordinary', 'pending-save', 'pending-token', 'credential-history']) {
    const app = await tokenHarness({ vault: automatic(['api_token']), respond(method) {
      if (method === 'saveAndActivate') return { ok: false, error: stage === 'credential-history' ? { message: 'MCP console: mount-failed' } : stage === 'pending-save' ? { message: 'MCP console: preference-state-ambiguous' } : { code: 'store-write-failed' } };
    } });
    change(app.input('label'), 'Retained local ' + stage); app.render();
    if (stage !== 'ordinary') { await app.submit(stage === 'pending-save' ? '' : 'SYNTHETIC_MISSING_TARGET_TOKEN'); await app.settle(); }
    const draft = () => app.hooks.values().find((value) => value?.id === serverId && Array.isArray(value.headerRows));
    const retained = plain(draft()), before = mutations(app).length;
    if (stage === 'pending-save') assert.ok(retained._pendingSave); if (stage === 'pending-token') assert.ok(retained._pendingToken);
    if (stage === 'credential-history') { assert.equal(retained._pendingSave, undefined); assert.equal(retained._pendingToken, undefined); assert.ok(retained.headerRows.some((row) => row.savedRef !== 'api_token' && app.current().vault.refs.includes(row.savedRef))); }
    app.setCurrent({ ...app.current(), revision: app.current().revision + 1, servers: [] }); await app.button('refresh').props.onClick(); await app.settle();
    const form = app.form('edit'), fallback = app.nodes().find((node) => node.props['data-missing-editor-target'] === serverId);
    assert.ok(fallback); assert.ok(walk(fallback).includes(form)); assert.ok(walk(fallback).some((node) => node.props.role === 'alert' && text(node) === 'conflict'));
    assert.equal(form.props['data-server-editor'], serverId); assert.equal(form.props['data-editor-placement'], 'missing'); assert.equal(app.input('label').props.value, 'Retained local ' + stage);
    assert.equal(app.nodes().filter((node) => node.type === 'form').length, 1); assert.equal(app.nodes().some((node) => node.type === 'form' && node.props['aria-label'] === 'add'), false); assert.deepEqual(plain(draft()), retained);
    await app.submit(); await app.settle(); assert.equal(mutations(app).length, before); assert.ok(text(app.tree()).includes('conflict')); assert.deepEqual(plain(draft()), retained);
    for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle(); assert.ok(app.form('edit')); assert.equal(mutations(app).length, before); assert.deepEqual(plain(draft()), retained);
    walk(app.form('edit')).find((node) => node.type === primitives.Button && text(node).trim() === 'cancel').props.onClick(); app.render(); assert.equal(app.nodes().some((node) => node.type === 'form'), false); app.dispose();
  }
});

// Synthetic ref/focus-call wiring only; these fixtures do not establish real browser focus.
test('explicit Add/Edit openings focus the stable first-field ref once, never on typing, polling or transport changes', async () => {
  const other = { ...httpConfig, id: 'c'.repeat(24), label: 'Second focus target' };
  const app = await setup({ snapshot: { servers: [rowFor(), rowFor(other)], vault: automatic(['api_token']) } }); app.render(); app.hooks.effects(); await app.settle();
  const focused = []; let firstRef;
  const mount = (target) => {
    app.render(); const ref = app.input('label').props.ref; assert.ok(ref, 'First editor field exposes the reviewed focus ref');
    if (firstRef) assert.equal(ref, firstRef, 'Draft/target changes retain the stable first-field ref'); else firstRef = ref;
    ref.current = { focus: () => focused.push(target) }; app.hooks.effects(); app.render();
  };
  const edit = (id) => walk(app.card(id)).find((node) => node.type === primitives.Button && text(node).trim() === 'edit').props.onClick();
  const cancel = () => walk(app.form('edit')).find((node) => node.type === primitives.Button && text(node).trim() === 'cancel').props.onClick();
  app.button('add').props.onClick(); mount('new'); await app.settle(); assert.deepEqual(focused, ['new']);
  change(app.input('label'), 'Typed Add label'); app.render(); app.hooks.effects(); assert.equal(app.input('label').props.ref, firstRef);
  await app.button('refresh').props.onClick(); await app.settle(); for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle();
  app.button('stdio').props.onClick(); app.render(); app.hooks.effects(); change(app.input('command'), 'node'); app.render(); app.hooks.effects();
  app.button('http').props.onClick(); app.render(); app.hooks.effects(); assert.equal(app.input('label').props.ref, firstRef); assert.deepEqual(focused, ['new']);
  const repeatedAddToken = { value: 'SYNTHETIC_REPEAT_ADD_TOKEN' }; app.input('token').props.ref.current = repeatedAddToken;
  app.button('add').props.onClick(); assert.equal(repeatedAddToken.value, ''); mount('new-replaced'); await app.settle(); assert.deepEqual(focused, ['new', 'new-replaced'], 'Repeated Add requests focus immediately despite the unchanged new-server target');
  edit(serverId); mount('first'); await app.settle(); assert.deepEqual(focused, ['new', 'new-replaced', 'first']);
  change(app.input('label'), 'Typed Edit label'); app.render(); app.hooks.effects(); await app.button('refresh').props.onClick(); await app.settle(); assert.deepEqual(focused, ['new', 'new-replaced', 'first']);
  edit(other.id); mount('second'); await app.settle(); assert.deepEqual(focused, ['new', 'new-replaced', 'first', 'second']);
  cancel(); app.render(); app.hooks.effects(); edit(other.id); mount('second-reopened'); await app.settle(); assert.deepEqual(focused, ['new', 'new-replaced', 'first', 'second', 'second-reopened']);
  cancel(); app.render(); app.hooks.effects(); app.button('add').props.onClick(); mount('new-reopened'); await app.settle();
  assert.deepEqual(focused, ['new', 'new-replaced', 'first', 'second', 'second-reopened', 'new-reopened']); assert.equal(mutations(app).length, 0); app.dispose();
});

test('pending Save reconciliation changing Add into an existing inline Edit never requests field focus again', async () => {
  let once = false;
  const app = await tokenHarness({ config: null, vault: automatic(), respond(method, request, control) {
    if (method === 'saveAndActivate' && !once) { once = true; const committed = control.commit(); control.setCurrent({ ...committed.value, servers: committed.value.servers.map(({ config }) => rowFor(config)) }); return Promise.reject(Error('SYNTHETIC_FOCUS_REPLY_LOST')); }
  } });
  let focused = 0; const ref = app.input('label').props.ref; ref.current = { focus: () => focused++ }; app.hooks.effects(); assert.equal(focused, 1);
  await app.submit(); await app.settle(); assert.ok(app.form('add')); assert.equal(focused, 1);
  await app.submit(); await app.settle(); assert.equal(app.form('edit').props['data-server-editor'], 'b'.repeat(24)); assert.equal(app.form('edit').props['data-editor-placement'], 'inline'); assert.equal(app.input('label').props.ref, ref);
  assert.equal(focused, 1, 'Reconciliation/id assignment is not an explicit Add or Edit action'); assert.deepEqual(mutations(app).map(({ method }) => method), ['saveAndActivate']);
  await app.button('refresh').props.onClick(); await app.settle(); assert.equal(focused, 1); app.dispose();
});

test('Cancel focuses only the selected surviving Details summary after clearing its synthetic password refs and draft', async () => {
  const other = { ...httpConfig, id: 'c'.repeat(24), label: 'Selected Cancel target' };
  const app = await setup({ snapshot: { servers: [rowFor(), rowFor(other)], vault: automatic(['api_token']) } }); app.render(); app.hooks.effects(); await app.settle();
  walk(app.card(other.id)).find((node) => node.type === primitives.Button && text(node).trim() === 'edit').props.onClick(); app.render();
  let fieldFocus = 0; app.input('label').props.ref.current = { focus: () => fieldFocus++ }; app.hooks.effects(); assert.equal(fieldFocus, 1);
  const token = { value: 'SYNTHETIC_CANCEL_TOKEN' }, detached = { value: 'SYNTHETIC_CANCEL_DETACHED' }, header = headerPassword(app, 0); header.value = 'SYNTHETIC_CANCEL_HEADER';
  app.input('token').props.ref.current = token; app.root.passwords = [detached];
  const queries = [], focused = [], expected = `[data-server-id="${other.id}"] > details > summary`;
  app.root.querySelector = (selector) => {
    queries.push(selector); return { focus: () => {
      focused.push(selector); assert.equal(token.value, ''); assert.equal(header.value, ''); assert.equal(detached.value, '');
      assert.equal(app.hooks.values().some((value) => value?.headerRows), false, 'Cancel drops the draft before summary focus');
    } };
  };
  assert.ok(app.card(other.id).children.find((node) => node.type === 'details').children.some((node) => node.type === 'summary'));
  walk(app.form('edit')).find((node) => node.type === primitives.Button && text(node).trim() === 'cancel').props.onClick(); app.render(); app.hooks.effects(); await app.settle();
  assert.deepEqual(queries, [expected]); assert.deepEqual(focused, [expected]); assert.equal(fieldFocus, 1, 'Cancel never refocuses the removed field');
  assert.equal(app.nodes().some((node) => node.type === 'form'), false); assert.equal(app.card(other.id).children.find((node) => node.type === 'details').props.open, undefined); assert.equal(mutations(app).length, 0); app.dispose();
});

test('missing-target Cancel tolerates a null summary or absent query API, wipes values and never focuses another row', async () => {
  const other = { ...httpConfig, id: 'c'.repeat(24), label: 'Unrelated surviving Cancel row' };
  for (const queryAvailable of [true, false]) {
    const app = await tokenHarness({ servers: [rowFor(), rowFor(other)], vault: automatic(['api_token']) }); let fieldFocus = 0, otherFocus = 0;
    app.input('label').props.ref.current = { focus: () => fieldFocus++ }; app.hooks.effects(); assert.equal(fieldFocus, 1);
    const header = headerPassword(app, 0), detached = { value: 'SYNTHETIC_MISSING_DETACHED' }; header.value = 'SYNTHETIC_MISSING_HEADER'; app.password.value = 'SYNTHETIC_MISSING_TOKEN'; app.root.passwords = [detached];
    app.setCurrent({ ...app.current(), revision: app.current().revision + 1, servers: [rowFor(other)] }); await app.button('refresh').props.onClick(); await app.settle(); assert.ok(app.card(other.id)); assert.equal(fieldFocus, 1, 'Target disappearance is not an explicit editor opening');
    const queries = [], expected = `[data-server-id="${serverId}"] > details > summary`;
    app.root.querySelector = queryAvailable ? (selector) => { queries.push(selector); return selector === expected ? null : { focus: () => otherFocus++ }; } : undefined;
    const cancel = walk(app.form('edit')).find((node) => node.type === primitives.Button && text(node).trim() === 'cancel'); assert.doesNotThrow(() => cancel.props.onClick()); app.render(); app.hooks.effects(); await app.settle();
    assert.deepEqual(queries, queryAvailable ? [expected] : []); assert.equal(otherFocus, 0); assert.equal(fieldFocus, 1); assert.equal(header.value, ''); assert.equal(app.password.value, ''); assert.equal(detached.value, '');
    assert.equal(app.nodes().some((node) => node.type === 'form'), false); assert.equal(mutations(app).length, 0); app.dispose();
  }
});

test('compact verification time follows native Portuguese locale and retains the full localized date in accessibility', async () => {
  const timestamp = 1760000000000;
  for (const language of ['pt-BR', 'pt']) {
    const app = await setup({ language, snapshot: { servers: [{ ...rowFor(httpConfig, 'activation-verified'), lastVerifiedAt: timestamp }] } }); app.render(); app.hooks.effects(); await app.settle();
    const time = walk(app.card()).find((node) => node.type === 'time'); const date = new Date(timestamp);
    assert.equal(time.props.title, 'Última verificação: ' + date.toLocaleString('pt-BR')); assert.equal(time.props['aria-label'], time.props.title);
    assert.equal(text(time).trim(), date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })); assert.equal(time.props.dateTime, date.toISOString()); app.dispose();
  }
});

test('info hover and focus stay inside the bubble, close on leave/blur, and never invoke RPC', async () => {
  const app = await setup({ snapshot: { servers: [rowFor()] } }); app.render(); app.hooks.effects(); await app.settle(); const before = app.requests.length;
  const inside = {}, outside = {}, boundary = { contains: (target) => target === inside };
  const infoWrapper = () => walk(app.card()).find((node) => node.props.className === 'mcp-info');
  infoWrapper().props.onMouseEnter(); app.render(); app.hooks.effects();
  assert.equal(app.info().props['aria-expanded'], true); assert.ok(text(app.card()).includes('integrationNote')); assert.ok(text(app.card()).includes('verificationNote'));
  const bubble = walk(app.card()).find((node) => node.props.className === 'mcp-info-bubble'); assert.equal(bubble.props.role, 'note'); assert.equal(app.info().props['aria-controls'], bubble.props.id);
  infoWrapper().props.onMouseLeave({ currentTarget: boundary, relatedTarget: inside }); app.render(); assert.equal(app.info().props['aria-expanded'], true);
  infoWrapper().props.onMouseLeave({ currentTarget: boundary, relatedTarget: outside }); app.render(); app.hooks.effects(); assert.equal(app.info().props['aria-expanded'], false);
  infoWrapper().props.onFocus(); app.render(); app.hooks.effects(); assert.equal(app.info().props['aria-expanded'], true);
  infoWrapper().props.onBlur({ currentTarget: boundary, relatedTarget: inside }); app.render(); assert.equal(app.info().props['aria-expanded'], true);
  infoWrapper().props.onBlur({ currentTarget: boundary, relatedTarget: null }); app.render(); app.hooks.effects(); assert.equal(app.info().props['aria-expanded'], false);
  assert.equal(app.requests.length, before); for (const listeners of app.domListeners.values()) assert.equal(listeners.size, 0); app.dispose();
});

test('info click/touch toggles, outside events and Escape close, and all listeners clean up on close/unmount', async () => {
  const app = await setup({ snapshot: { servers: [rowFor()] } }); app.render(); app.hooks.effects(); await app.settle(); const before = app.requests.length;
  const wrapper = () => walk(app.card()).find((node) => node.props.className === 'mcp-info'); const inside = app.geometry.popup; let focused = 0;
  const mount = () => { app.render(); app.geometry.trigger.querySelector = () => ({ focus: () => focused++ }); app.hooks.effects(); };
  wrapper().props.onFocus(); app.render(); app.info().props.onClick(); mount(); assert.equal(app.info().props['aria-expanded'], true, 'Focus-before-click must not cancel the first tap');
  for (const name of ['pointerdown', 'click', 'keydown']) assert.equal(app.domListeners.get(name).size, 1);
  const boundary = { contains: (target) => target === inside };
  wrapper().props.onBlur({ currentTarget: boundary, relatedTarget: null }); app.render(); assert.equal(app.info().props['aria-expanded'], true, 'Pinned touch popup survives nonfocusable bubble text taps');
  wrapper().props.onMouseLeave({ currentTarget: boundary, relatedTarget: null }); app.render(); assert.equal(app.info().props['aria-expanded'], true, 'Pinned click popup stays until dismissal, unlike hover-only info');
  assert.equal(walk(app.card()).find((node) => node.props.className === 'mcp-info-bubble').props.tabIndex, 0, 'Long bubble can receive keyboard focus and scroll');
  app.dispatch('pointerdown', { target: inside, pointerType: 'touch' }); app.render(); assert.equal(app.info().props['aria-expanded'], true);
  app.info().props.onClick(); app.render(); app.hooks.effects(); assert.equal(app.info().props['aria-expanded'], false);
  for (const name of ['pointerdown', 'click']) {
    app.info().props.onClick(); mount(); app.dispatch(name, { target: {}, pointerType: 'touch' }); app.render(); app.hooks.effects(); assert.equal(app.info().props['aria-expanded'], false);
    for (const listeners of app.domListeners.values()) assert.equal(listeners.size, 0);
  }
  app.info().props.onClick(); mount(); let prevented = false, stopped = false;
  app.dispatch('keydown', { key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } }); app.render(); app.hooks.effects();
  assert.equal(app.info().props['aria-expanded'], false); assert.equal(focused, 1); assert.ok(prevented && stopped); assert.equal(app.requests.length, before);
  app.info().props.onClick(); mount(); app.dispose(); for (const listeners of app.domListeners.values()) assert.equal(listeners.size, 0); assert.equal(app.timers.size, 0);
});

test('grey accessible verification symbol starts only after guarded reconnect RPC and only on its own row', async () => {
  const other = { ...httpConfig, id: 'c'.repeat(24), label: 'Other server' }; let finish;
  const snapshot = makeSnapshot({ servers: [{ ...rowFor(httpConfig, 'activation-verified'), lastVerifiedAt: 1760000000000 }, rowFor(other)] });
  const deferred = new Promise((resolve) => { finish = resolve; });
  const app = await setup({ snapshot, respond: (method) => method === 'reconnect' ? deferred : { ok: true, value: snapshot } }); app.render(); app.hooks.effects(); await app.settle();
  app.info().props.onClick(); app.render(); app.hooks.effects(); assert.equal(app.nodes().some((node) => node.props['data-state'] === 'verifying'), false);
  assert.ok(app.requests.every(({ method }) => method === 'snapshot')); const reconnect = app.button('reconnect'), pending = reconnect.props.onClick(); app.render(); app.hooks.effects();
  assert.equal(app.nodes().find((node) => node.type === primitives.Modal).props.open, false); assert.equal(app.info().props['aria-expanded'], false);
  assert.equal(app.button('reconnect').props.disabled, true);
  const status = walk(app.card()).find((node) => node.props['data-state'] === 'verifying'); assert.equal(status.props.role, 'status'); assert.equal(status.props['aria-label'], 'verifying'); assert.equal(text(status).trim(), 'verifying', 'Only visually hidden label accompanies the spinner symbol');
  assert.equal(walk(app.card(other.id)).some((node) => node.props['data-state'] === 'verifying'), false); assert.equal(app.integration(other.id).props.disabled, true);
  await reconnect.props.onClick(); await app.integration(other.id).props.onChange(true); assert.equal(app.requests.filter(({ method }) => method === 'reconnect').length, 1); assert.equal(app.requests.some(({ method }) => method === 'start'), false);
  for (const timer of app.timers.values()) if (timer.interval) timer.fn(); assert.equal(app.requests.filter(({ method }) => method === 'reconnect').length, 1);
  assert.deepEqual(app.requests.at(-1).request, { revision: 4, id: serverId, confirmation: 'RECONNECT THIS SERVER' });
  assert.match(app.styles[0].textContent, /mcp-spinner\{[^}]*border:2px solid #888[^}]*animation:personal-mcp-spin/); assert.match(app.styles[0].textContent, /prefers-reduced-motion:reduce.*mcp-spinner\{animation:none/);
  finish({ ok: true, value: { ...snapshot, revision: 5, servers: [{ ...rowFor(httpConfig, 'activation-verified'), lastVerifiedAt: 1760000001000 }, rowFor(other)] } }); await pending; await app.settle();
  assert.equal(app.nodes().some((node) => node.props['data-state'] === 'verifying'), false); assert.ok(walk(app.card()).some((node) => node.props['data-state'] === 'activation-verified')); assert.equal(app.integration().props.disabled, false); app.dispose();
});

test('start verification spinner is scoped and unrelated stop requests never display it', async () => {
  for (const start of [true, false]) {
    const other = { ...httpConfig, id: 'd'.repeat(24), label: 'Other row' }; let finish;
    const snapshot = makeSnapshot({ servers: [rowFor(httpConfig, start ? 'disabled' : 'mounted-status-unavailable'), rowFor(other)] });
    const deferred = new Promise((resolve) => { finish = resolve; });
    const app = await setup({ snapshot, respond: (method) => method === (start ? 'start' : 'stop') ? deferred : { ok: true, value: snapshot } }); app.render(); app.hooks.effects(); await app.settle();
    const control = app.integration(), pending = control.props.onChange(start); app.render();
    assert.equal(walk(app.card()).some((node) => node.props['data-state'] === 'verifying'), start); assert.equal(walk(app.card(other.id)).some((node) => node.props['data-state'] === 'verifying'), false);
    await control.props.onChange(start); assert.equal(mutations(app).length, 1);
    finish({ ok: false, error: { message: 'SYNTHETIC_AMBIGUOUS_REPLY' } }); await pending; await app.settle();
    assert.equal(app.nodes().some((node) => node.props['data-state'] === 'verifying'), false); assert.equal(app.integration().props.disabled, false); assert.ok(!JSON.stringify(app.tree()).includes('SYNTHETIC_AMBIGUOUS_REPLY')); app.dispose();
  }
});

test('failed and ambiguous reconnect completion never fabricate verification or reuse stale green as a new outcome', async () => {
  for (const confirmedFailure of [true, false]) {
    let snapshot = makeSnapshot({ servers: [{ ...rowFor(httpConfig, 'activation-verified'), lastVerifiedAt: 1760000000000 }] });
    const app = await setup({ snapshot, respond: (method) => {
      if (method === 'reconnect') { if (confirmedFailure) snapshot = { ...snapshot, revision: 5, servers: [rowFor(httpConfig, 'mount-failed')] }; return { ok: false, error: { message: confirmedFailure ? 'MCP console: mount-failed' : 'SYNTHETIC_AMBIGUOUS_REPLY' } }; }
      return { ok: true, value: snapshot };
    } }); app.render(); app.hooks.effects(); await app.settle(); await app.button('reconnect').props.onClick(); await app.settle();
    const card = app.card(), status = walk(card).find((node) => node.props.className === 'mcp-status'); assert.equal(status.props['data-state'], confirmedFailure ? 'mount-failed' : 'mounted-status-unavailable');
    assert.equal(walk(card).some((node) => node.type === 'time'), false); assert.equal(app.nodes().some((node) => node.props['data-state'] === 'verifying'), false); assert.equal(app.integration().props.disabled, false); assert.ok(!text(app.tree()).includes('success'));
    if (!confirmedFailure) {
      assert.equal(status.props['aria-label'], 'statusUnconfirmed'); app.info().props.onClick(); app.render(); app.hooks.effects(); assert.ok(text(app.card()).includes('statusUnconfirmed'));
      snapshot = { ...snapshot, revision: 5, servers: [{ ...rowFor(httpConfig, 'activation-verified'), lastVerifiedAt: 1760000001000 }] }; await app.button('refresh').props.onClick(); await app.settle(); assert.ok(walk(app.card()).some((node) => node.props['data-state'] === 'activation-verified'));
    }
    for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle();
    app.info().props.onClick(); app.render(); app.hooks.effects(); app.geometry.view.dispatch('resize'); app.dispatch('scroll', { target: app.geometry.clip }); await app.settle();
    assert.equal(app.requests.filter(({ method }) => method === 'reconnect').length, 1); app.dispose();
  }
});

test('confirmed validation failure unlocks new masked token retry with a fresh alias and preserves previously saved credentials, even with obsolete missing history', async () => {
  for (const obsoleteMissingHistory of [false, true]) {
    let lostWrite = false, failedValidation = false;
    const app = await tokenHarness({ config: null, vault: automatic(), respond(method) {
      if (method === 'setSecret' && obsoleteMissingHistory && !lostWrite) { lostWrite = true; return Promise.reject(Error('SYNTHETIC_UNCERTAIN_OLD_WRITE')); }
      if (method === 'saveAndActivate' && !failedValidation) { failedValidation = true; return { ok: false, error: { message: 'MCP console: mount-failed' } }; }
    } });
    await app.submit('SYNTHETIC_FAILED_TOKEN'); await app.settle();
    if (obsoleteMissingHistory) { await app.submit(); await app.settle(); assert.ok(text(app.tree()).includes('tokenMissing')); await app.submit('SYNTHETIC_FAILED_TOKEN'); await app.settle(); }
    assert.equal(app.current().servers.length, 0); assert.ok(text(app.tree()).includes('errors.mount-failed')); assert.ok(!text(app.tree()).includes('tokenPending')); assert.equal(app.input('token').props.disabled, false); assert.equal(app.password.value, '');
    const savedWrite = mutations(app).filter(({ method }) => method === 'setSecret').at(-1); assert.ok(app.current().vault.refs.includes(savedWrite.request.ref)); assert.equal(app.secretValues.get(savedWrite.request.ref), 'Bearer SYNTHETIC_FAILED_TOKEN');
    change(app.input('url'), 'https://example.invalid/corrected-token'); app.render(); await app.submit('SYNTHETIC_CORRECTED_TOKEN'); await app.settle();
    const writes = mutations(app).filter(({ method }) => method === 'setSecret'), replacement = writes.at(-1); assert.notEqual(replacement.request.ref, savedWrite.request.ref); assert.equal(new Set(writes.map(({ request }) => request.ref)).size, writes.length);
    assert.equal(app.secretValues.get(savedWrite.request.ref), 'Bearer SYNTHETIC_FAILED_TOKEN'); assert.equal(app.secretValues.get(replacement.request.ref), 'Bearer SYNTHETIC_CORRECTED_TOKEN'); assert.equal(app.current().servers[0].config.headerRefs.Authorization, replacement.request.ref); assert.equal(app.current().servers[0].config.url, 'https://example.invalid/corrected-token'); assert.equal(app.current().servers.length, 1);
    assert.deepEqual(mutations(app).map(({ method }) => method), obsoleteMissingHistory ? ['setSecret', 'setSecret', 'saveAndActivate', 'setSecret', 'saveAndActivate'] : ['setSecret', 'saveAndActivate', 'setSecret', 'saveAndActivate']); assert.ok(text(app.tree()).includes('success'));
    for (const value of [app.tree(), app.hooks.values(), app.warnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_FAILED_TOKEN') && !JSON.stringify(value).includes('SYNTHETIC_CORRECTED_TOKEN'));
    app.dispose();
  }
});


const mountedAppendCapabilities = { saveAndActivate: true, appendSecretsWhileMounted: true };
const otherMountedConfig = { ...httpConfig, id: 'c'.repeat(24), label: 'Other active MCP', headerRefs: { Authorization: 'shared_ref' } };
const otherMountedRow = () => ({ ...rowFor(otherMountedConfig, 'activation-verified'), lastVerifiedAt: 1760000000000 });

test('mounted append: NEW and inactive HTTP forms save sequential fresh Token/directHeaders while preserving OTHER mounted credentials', async () => {
  for (const config of [null, { ...httpConfig, headerRefs: { Authorization: 'shared_ref', 'X-Old': 'keep_ref' } }]) {
    const originalRefs = config ? ['shared_ref', 'keep_ref'] : ['shared_ref'];
    const app = await tokenHarness({ config, capabilities: mountedAppendCapabilities, vault: automatic(originalRefs), servers: [...(config ? [rowFor(config)] : []), otherMountedRow()] });
    assert.equal(app.input('token').props.disabled, false); assert.ok(text(app.tree()).includes('appendSecretsNote')); assert.ok(!text(app.form(config ? 'edit' : 'add')).includes('targetEditBlocked'));
    const keyIndex = addHeader(app, 'X-API-Key'), customIndex = addHeader(app, 'Authentication');
    const key = headerPassword(app, keyIndex), custom = headerPassword(app, customIndex); key.value = 'SYNTHETIC_MOUNTED_KEY'; custom.value = 'Exact SYNTHETIC_MOUNTED_HEADER';
    assert.ok(app.nodes().filter((node) => node.type === 'input' && node.props.name?.startsWith('header-value-')).every((node) => node.props.disabled === false));
    const saving = app.submit('SYNTHETIC_MOUNTED_TOKEN'); assert.equal(app.password.value, ''); assert.equal(key.value, ''); assert.equal(custom.value, ''); await saving; await app.settle();
    const writes = mutations(app); assert.deepEqual(writes.map(({ method }) => method), ['setSecret', 'setSecret', 'setSecret', 'saveAndActivate']); assert.deepEqual(writes.map(({ request }) => request.revision), [4, 5, 6, 7]);
    const fresh = writes.slice(0, 3).map(({ request }) => request.ref); assert.equal(new Set(fresh).size, 3); for (const ref of fresh) { assert.match(ref, /^mcp_token_[0-9a-f]{32}$/); assert.ok(!originalRefs.includes(ref)); }
    assert.deepEqual(writes.slice(0, 3).map(({ request }) => request.value), ['Bearer SYNTHETIC_MOUNTED_TOKEN', 'SYNTHETIC_MOUNTED_KEY', 'Exact SYNTHETIC_MOUNTED_HEADER']);
    const saved = app.current().servers.find(({ config: saved }) => saved.id !== otherMountedConfig.id); assert.deepEqual(saved.config.headerRefs, { ...(config ? { 'X-Old': 'keep_ref' } : {}), Authorization: fresh[0], 'X-API-Key': fresh[1], Authentication: fresh[2] });
    assert.deepEqual(app.current().servers.find(({ config }) => config.id === otherMountedConfig.id), otherMountedRow());
    for (const ref of originalRefs) assert.equal(app.secretValues.get(ref), 'SYNTHETIC_OLD_VALUE');
    for (const value of [app.tree(), app.hooks.values(), writes.at(-1).request, app.warnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_MOUNTED_'));
    app.dispose();
  }
});

test('mounted append: missing capability and legacy/manual modes stay globally blocked without ANY secret or setup write', async () => {
  for (const variant of [
    { capabilities: { saveAndActivate: true }, vault: automatic(['shared_ref']), notice: 'reloadMountedSecretsHost' },
    { capabilities: undefined, vault: automatic(['shared_ref']), notice: 'reloadSaveHost' },
    { capabilities: mountedAppendCapabilities, vault: unlocked(['shared_ref']), notice: 'errors.stop-before-secret-change' },
    { capabilities: mountedAppendCapabilities, vault: { mode: 'passphrase', initialized: true, locked: true, expiresAt: 0, refs: ['shared_ref'] }, notice: 'errors.stop-before-secret-change' }
  ]) {
    let randomCalls = 0; const app = await tokenHarness({ config: null, ...variant, servers: [otherMountedRow()], crypto: { getRandomValues(bytes) { randomCalls++; return webcrypto.getRandomValues(bytes); } } });
    addHeader(app, 'X-API-Key'); const header = headerPassword(app, 0); header.value = 'SYNTHETIC_BLOCKED_HEADER';
    assert.equal(app.input('token').props.disabled, true); await app.submit('SYNTHETIC_BLOCKED_TOKEN'); await app.settle();
    assert.equal(mutations(app).length, 0); assert.equal(randomCalls, 0); assert.ok(text(app.tree()).includes(variant.notice)); assert.equal(app.nodes().some((node) => node.props['data-editor-vault']), false); assert.ok(!text(app.form('add')).includes('targetEditBlocked')); app.dispose();
  }
});

test('mounted append: exact false capability fails closed in direct Panel input even with automatic mode', async () => {
  const requests = [], ledger = makeSnapshot({ capabilities: { saveAndActivate: true, appendSecretsWhileMounted: false }, vault: automatic(['shared_ref']), servers: [otherMountedRow()] });
  const app = await setup({ panelApi: async (method, request) => { requests.push({ method, request }); return ledger; } }); app.render(); app.hooks.effects(); await app.settle(); app.button('add').props.onClick(); app.render();
  change(app.input('label'), 'Synthetic false capability'); app.render(); change(app.input('url'), 'https://example.invalid/new'); app.render(); addHeader(app, 'X-API-Key');
  const token = { value: 'SYNTHETIC_FALSE_TOKEN' }, header = headerPassword(app, 0); header.value = 'SYNTHETIC_FALSE_HEADER'; app.input('token').props.ref.current = token;
  assert.equal(app.input('token').props.disabled, true); assert.equal(app.nodes().find((node) => node.props.name?.startsWith('header-value-')).props.disabled, true);
  await app.form('add').props.onSubmit(event({ token })); await app.settle(); assert.ok(requests.every(({ method }) => method === 'snapshot')); assert.ok(text(app.tree()).includes('reloadMountedSecretsHost')); assert.ok(!text(app.form('add')).includes('targetEditBlocked')); app.dispose();
});

test('mounted append: edited target becoming mounted or stop-failed blocks stale Save before setSecret and adds only target field helpers', async () => {
  for (const state of ['activation-verified', 'mounted-status-unavailable', 'stop-failed']) {
    const app = await tokenHarness({ capabilities: mountedAppendCapabilities, vault: automatic(['api_token', 'shared_ref']), servers: [rowFor(), otherMountedRow()] });
    const staleForm = app.form('edit'), header = headerPassword(app, 0); header.value = 'SYNTHETIC_TARGET_HEADER'; app.password.value = 'SYNTHETIC_TARGET_TOKEN';
    app.setCurrent({ ...app.current(), servers: [rowFor(httpConfig, state), otherMountedRow()] }); await app.button('refresh').props.onClick();
    await staleForm.props.onSubmit(event({ token: app.password })); await app.settle(); assert.equal(mutations(app).length, 0); assert.ok(text(app.tree()).includes('errors.stop-before-edit'));
    assert.equal(app.input('token').props.disabled, true); assert.equal(app.nodes().find((node) => node.props.name?.startsWith('header-value-')).props.disabled, true);
    const helpers = app.nodes().filter((node) => node.type === 'span' && text(node) === 'targetEditBlocked'); assert.equal(helpers.length, 2); for (const helper of helpers) assert.equal(helper.props.className, 'mcp-muted');
    for (const field of [app.input('token'), app.nodes().find((node) => node.props.name?.startsWith('header-value-'))]) assert.ok(field.props['aria-describedby'].split(' ').some((id) => helpers.some((helper) => helper.props.id === id)));
    const details = app.card().children.find((node) => node.type === 'details'); assert.equal(details.props.open, true); assert.ok(walk(details).includes(app.form('edit'))); assert.equal(walk(details).some((node) => node.type === primitives.Button && text(node).trim() === 'edit'), false, 'Selected editor replaces the redundant Edit action; stale Save remains blocked above'); assert.equal(app.dictionaries['personal.mcpConsole'].en.targetEditBlocked, 'Disable this MCP to edit.'); assert.equal(app.dictionaries['personal.mcpConsole']['pt-BR'].targetEditBlocked, 'Para editar, desative este MCP.'); app.dispose();
  }
});

test('mounted append: stale callback observes withdrawn capability before capture, randomness or any write', async () => {
  let randomCalls = 0; const app = await tokenHarness({ config: null, capabilities: mountedAppendCapabilities, vault: automatic(['shared_ref']), servers: [otherMountedRow()], crypto: { getRandomValues(bytes) { randomCalls++; return webcrypto.getRandomValues(bytes); } } });
  const staleForm = app.form('add'); app.password.value = 'SYNTHETIC_WITHDRAWN_TOKEN'; app.setCurrent({ ...app.current(), capabilities: { saveAndActivate: true } }); await app.button('refresh').props.onClick();
  await staleForm.props.onSubmit(event({ token: app.password })); await app.settle(); assert.equal(mutations(app).length, 0); assert.equal(randomCalls, 0); assert.equal(app.password.value, 'SYNTHETIC_WITHDRAWN_TOKEN'); assert.ok(text(app.tree()).includes('reloadMountedSecretsHost')); app.dispose();
});

test('mounted append: each sequential reply rechecks target state, capability, revision and queued-alias freshness', async () => {
  for (const changeState of ['target-mounted', 'target-stop-failed', 'capability-lost', 'revision-jump', 'alias-collision']) {
    let serial = 0, first = true; const app = await tokenHarness({ capabilities: mountedAppendCapabilities, vault: automatic(['api_token', 'shared_ref']), servers: [rowFor(), otherMountedRow()], crypto: { getRandomValues(bytes) { bytes.fill(++serial); return bytes; } }, respond(method, request, control) {
      if (method !== 'setSecret' || !first) return; first = false; const committed = control.commit(), ledger = committed.value;
      const next = changeState === 'target-mounted' || changeState === 'target-stop-failed' ? { ...ledger, servers: [rowFor(httpConfig, changeState === 'target-mounted' ? 'mounted-status-unavailable' : 'stop-failed'), otherMountedRow()] }
        : changeState === 'capability-lost' ? { ...ledger, capabilities: { saveAndActivate: true } }
        : changeState === 'revision-jump' ? { ...ledger, revision: ledger.revision + 1 }
        : { ...ledger, vault: automatic([...ledger.vault.refs, 'mcp_token_' + '02'.repeat(16)]) };
      control.setCurrent(next); return { ok: true, value: next };
    } });
    addHeader(app, 'X-API-Key'); const header = headerPassword(app, 1); header.value = 'SYNTHETIC_QUEUED_HEADER'; await app.submit('SYNTHETIC_FIRST_ONLY'); await app.settle();
    assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret'], changeState); assert.equal(header.value, ''); assert.equal(app.secretValues.get('api_token'), 'SYNTHETIC_OLD_VALUE'); assert.equal(app.secretValues.get('shared_ref'), 'SYNTHETIC_OLD_VALUE'); assert.ok(app.form('edit'));
    for (const value of [app.tree(), app.hooks.values(), app.warnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_QUEUED_HEADER'));
    if (changeState.startsWith('target-') || changeState === 'capability-lost') { const before = mutations(app).length; await app.submit(); await app.settle(); assert.equal(mutations(app).length, before, 'Pending retry must also refuse further secret/activation writes'); }
    app.dispose();
  }
});

test('mounted append: uncertain sequential retry writes only reentered missing values with DIFFERENT aliases while OTHER mount stays untouched', async () => {
  let count = 0; const app = await tokenHarness({ capabilities: mountedAppendCapabilities, vault: automatic(['api_token', 'shared_ref']), servers: [rowFor(), otherMountedRow()], respond(method) { if (method === 'setSecret' && ++count === 2) return Promise.reject(Error('SYNTHETIC_PRIVATE_WRITE')); } });
  addHeader(app, 'X-API-Key'); const header = headerPassword(app, 1); header.value = 'SYNTHETIC_UNCERTAIN_KEY'; await app.submit('SYNTHETIC_CONFIRMED_TOKEN'); await app.settle(); const retained = mutations(app)[1].request.ref;
  await app.submit(); await app.settle(); assert.equal(mutations(app).length, 2); assert.ok(text(app.tree()).includes('tokenMissing')); headerPassword(app, 1).value = 'SYNTHETIC_REENTERED_KEY'; await app.submit(); await app.settle();
  const writes = mutations(app); assert.deepEqual(writes.map(({ method }) => method), ['setSecret', 'setSecret', 'setSecret', 'saveAndActivate']); assert.notEqual(writes[2].request.ref, retained); assert.deepEqual(writes.map(({ request }) => request.revision), [4, 5, 5, 6]);
  assert.equal(app.secretValues.get('api_token'), 'SYNTHETIC_OLD_VALUE'); assert.equal(app.secretValues.get('shared_ref'), 'SYNTHETIC_OLD_VALUE'); assert.deepEqual(app.current().servers.find(({ config }) => config.id === otherMountedConfig.id), otherMountedRow()); app.dispose();
});

test('mounted append: ambiguous pending Save reconciles active success without replay and rejects NEW values even though append is supported', async () => {
  for (const reenter of [false, true]) {
    let once = false; const app = await tokenHarness({ config: null, capabilities: mountedAppendCapabilities, vault: automatic(['shared_ref']), servers: [otherMountedRow()], respond(method, request, control) { if (method === 'saveAndActivate' && !once) { once = true; control.commit(); return Promise.reject(Error('SYNTHETIC_PRIVATE_SAVE')); } } });
    await app.submit('SYNTHETIC_FIRST_TOKEN'); await app.settle(); assert.equal(mutations(app).length, 2); await app.submit(reenter ? 'SYNTHETIC_REVISED_TOKEN' : ''); await app.settle();
    assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret', 'saveAndActivate']); assert.equal(app.current().servers.length, 2);
    if (reenter) { assert.ok(app.form('add')); assert.ok(text(app.tree()).includes('conflict')); assert.ok(!text(app.tree()).includes('success')); } else assert.ok(text(app.tree()).includes('success'));
    for (const value of [app.tree(), app.hooks.values(), app.warnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_REVISED_TOKEN')); app.dispose();
  }
});

test('mounted append: advanced existing-ref replace/delete remain globally locked including stale enabled callbacks', async () => {
  const local = { id: 'd'.repeat(24), label: 'Synthetic ENV server', transport: 'stdio', command: 'node', args: [], cwd: '', envRefs: {} };
  for (const action of ['replace', 'clear']) {
    const app = await tokenHarness({ capabilities: mountedAppendCapabilities, vault: automatic(['api_token', 'unused_ref']), servers: [rowFor(), rowFor(local)] });
    app.buttons('editSecret')[1].props.onClick(); app.render(); change(app.input('secretAction'), action); app.render(); const staleForm = app.form('editSecret'); let staleConfirm;
    const value = { value: 'SYNTHETIC_ADVANCED_REPLACE' };
    if (action === 'clear') { await staleForm.props.onSubmit(event()); app.render(); staleConfirm = app.buttons('remove').at(-1); } else app.input('secret').props.ref.current = value;
    app.setCurrent({ ...app.current(), servers: [rowFor(httpConfig, 'mounted-status-unavailable'), rowFor(local)] }); await app.button('refresh').props.onClick();
    if (action === 'clear') await staleConfirm.props.onClick(); else await staleForm.props.onSubmit(event({ secret: value })); await app.settle();
    assert.equal(mutations(app).length, 0); assert.equal(app.secretValues.get('unused_ref'), 'SYNTHETIC_OLD_VALUE'); assert.ok(app.buttons('editSecret').every((button) => button.props.disabled)); assert.equal(app.button('addSecret').props.disabled, true); assert.ok(text(app.tree()).includes('errors.stop-before-secret-change')); app.dispose();
  }
});

test('mounted append: backend uncertain-secret guard is localized safely and never falls back to metadata or replay', async () => {
  const app = await tokenHarness({ config: null, capabilities: mountedAppendCapabilities, vault: automatic(['shared_ref']), servers: [otherMountedRow()], respond(method) { if (method === 'setSecret') return { ok: false, error: { message: 'MCP console: secret-state-ambiguous', details: 'SYNTHETIC_PRIVATE_DETAIL' } }; } });
  await app.submit('SYNTHETIC_UNCERTAIN_VALUE'); await app.settle(); assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret']); assert.ok(text(app.tree()).includes('errors.secret-state-ambiguous'));
  for (const copy of [app.dictionaries['personal.mcpConsole'].en, app.dictionaries['personal.mcpConsole']['pt-BR']]) { assert.ok(copy['errors.secret-state-ambiguous']); assert.ok(copy.reloadMountedSecretsHost); }
  for (const value of [app.tree(), app.hooks.values(), app.warnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_PRIVATE_DETAIL')); app.dispose();
});

test('mounted append: EN/PT card Edit actions keep layout and disabled state with a small helper only for their OWN active/retained mount', async () => {
  for (const language of ['en', 'pt-BR']) {
    const inactive = { ...httpConfig, id: 'e'.repeat(24), label: 'Synthetic inactive card' };
    const retained = { ...httpConfig, id: 'f'.repeat(24), label: 'Synthetic retained card' };
    const app = await setup({ language, snapshot: { capabilities: mountedAppendCapabilities, vault: automatic(['shared_ref']), servers: [otherMountedRow(), rowFor(inactive), rowFor(retained, 'stop-failed')] } }); app.render(); app.hooks.effects(); await app.settle();
    const copy = app.dictionaries['personal.mcpConsole'][language], helperText = language === 'en' ? 'Disable this MCP to edit.' : 'Para editar, desative este MCP.';
    for (const [config, blocked] of [[otherMountedConfig, true], [retained, true], [inactive, false]]) {
      const card = app.card(config.id), edit = walk(card).find((node) => node.type === primitives.Button && text(node).trim() === copy.edit), help = walk(card).filter((node) => node.type === 'p' && text(node) === helperText);
      assert.equal(edit.props.disabled, blocked); assert.equal(help.length, blocked ? 1 : 0); if (blocked) { assert.equal(help[0].props.className, 'mcp-muted'); assert.equal(edit.props['aria-describedby'], help[0].props.id); } else assert.equal(edit.props['aria-describedby'], undefined);
      const details = walk(card).find((node) => node.type === 'details'); assert.equal(details.props.open, undefined, 'Helper never auto-expands configuration'); assert.ok(walk(details).some((node) => node.props.className === 'mcp-actions'));
    }
    app.dispose();
  }
});

const recoveryIcon = (app, id = serverId) => walk(app.card(id)).filter((node) => node.type === primitives.Button && node.props.className === 'mcp-row-icon')[1];
const compactStatus = (app, id = serverId) => walk(app.card(id)).find((node) => node.props.className === 'mcp-status');

test('persistent carrier accepts optional old snapshots but rejects malformed flags and incomplete cap-true rows', () => {
  const { result } = makeSchemas(z);
  for (const snapshot of [makeSnapshot({ capabilities: undefined, servers: [rowFor()] }), makeSnapshot({ servers: [rowFor(httpConfig, 'disabled', true)] }), makeSnapshot({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, 'disabled', true), rowFor({ ...httpConfig, id: 'c'.repeat(24) }, 'stop-failed', false)] })]) assert.equal(result.safeParse(snapshot).success, true);
  for (const flag of [false, 'true', 1, null]) assert.equal(result.safeParse(makeSnapshot({ capabilities: { saveAndActivate: true, persistentActivation: flag }, servers: [rowFor(httpConfig, 'disabled', true)] })).success, false);
  for (const enabled of ['true', 1, null]) assert.equal(result.safeParse(makeSnapshot({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, 'disabled', enabled)] })).success, false);
  assert.equal(result.safeParse(makeSnapshot({ capabilities: persistentCapabilities, servers: [rowFor()] })).success, false);
  assert.equal(result.safeParse(makeSnapshot({ servers: [{ ...rowFor(), config: { ...httpConfig, enabled: true } }] })).success, false, 'Preference is outside config; no new RPC inputs');
  assert.deepEqual(METHODS, ['snapshot', 'save', 'saveAndActivate', 'deleteServer', 'start', 'reconnect', 'stop', 'initializeVault', 'unlock', 'lock', 'setSecret', 'deleteSecret', 'setToolPolicy']);
});

test('persistent Switch requires literal true plus boolean row preference; old carriers keep mounted fallback', async () => {
  for (const [capabilities, state, enabled, checked] of [[undefined, 'disabled', undefined, false], [undefined, 'mounted-status-unavailable', undefined, true], [{ saveAndActivate: true }, 'disabled', true, false], [{ saveAndActivate: true }, 'stop-failed', false, true], [persistentCapabilities, 'disabled', true, true], [persistentCapabilities, 'mounted-status-unavailable', false, false]]) {
    const app = await setup({ snapshot: { capabilities, servers: [rowFor(httpConfig, state, enabled)] } }); app.render(); app.hooks.effects(); await app.settle();
    assert.equal(app.integration().props.checked, checked); assert.equal(app.integration().props['aria-checked'], checked); assert.equal(mutations(app).length, 0); app.dispose();
  }
  // Defense in depth for direct Panel injection only: these are rejected by the
  // real strict carrier, never accepted as capability promises from the backend.
  for (const [flag, enabled, state, checked] of [[false, true, 'disabled', false], ['true', true, 'disabled', false], [1, true, 'disabled', false], [true, 'true', 'disabled', false], [true, undefined, 'mounted-status-unavailable', true]]) {
    const snapshot = makeSnapshot({ capabilities: { saveAndActivate: true, persistentActivation: flag }, servers: [rowFor(httpConfig, state, enabled)] }), calls = [];
    const app = await setup({ panelApi: async (method) => { calls.push(method); return snapshot; } }); app.render(); app.hooks.effects(); await app.settle();
    assert.equal(app.integration().props.checked, checked); assert.ok(calls.every((method) => method === 'snapshot')); app.dispose();
  }
});

test('persistent enabled-but-unmounted states stay truthful and never show a verified green connection or old timestamp', async () => {
  for (const state of ['disabled', 'mount-failed', 'unmounted-shutdown-unverified']) {
    const app = await setup({ snapshot: { capabilities: persistentCapabilities, servers: [{ ...rowFor(httpConfig, state, true), lastVerifiedAt: 1760000000000 }] } }); app.render(); app.hooks.effects(); await app.settle();
    assert.equal(app.integration().props.checked, true); assert.equal(compactStatus(app).props['data-state'], state); assert.equal(compactStatus(app).props['aria-label'], state === 'mount-failed' ? 'mount-failed' : 'notConnected');
    assert.equal(walk(app.card()).some((node) => node.type === 'time' || node.props['data-state'] === 'activation-verified'), false); assert.equal(recoveryIcon(app).props.disabled, false); assert.equal(app.button('edit').props.disabled, false);
    app.info().props.onClick(); app.render(); app.hooks.effects(); assert.ok(text(app.card()).includes('persistentIntegrationNote')); assert.ok(text(app.card()).includes('persistentStatusNote')); assert.ok(!text(app.card()).includes('integrationNote')); assert.equal(mutations(app).length, 0); app.dispose();
  }
});

test('persistent OFF with a retained stop-failed mount uses the same icon for explicit retry-stop, never reconnect/start', async () => {
  let snapshot = makeSnapshot({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, 'stop-failed', false)] });
  const app = await setup({ snapshot, respond: (method) => { if (method === 'stop') snapshot = { ...snapshot, revision: 5, servers: [rowFor(httpConfig, 'unmounted-shutdown-unverified', false)] }; return { ok: true, value: snapshot }; } }); app.render(); app.hooks.effects(); await app.settle();
  assert.equal(app.integration().props.checked, false); assert.equal(compactStatus(app).props['data-state'], 'stop-failed'); assert.equal(recoveryIcon(app).props.disabled, false); assert.equal(recoveryIcon(app).props['aria-label'], 'retryStopAction: ' + httpConfig.label); assert.equal(recoveryIcon(app).props.title, 'retryStopAction');
  assert.equal(app.button('edit').props.disabled, true); assert.equal(app.button('remove').props.disabled, true); assert.ok(text(app.card()).includes('targetEditBlocked'));
  const compact = walk(app.card()).find((node) => node.props.className === 'mcp-compact-row'); assert.equal(compact.children.length, 5); assert.equal(compact.children.find((node) => node.type === primitives.Button), recoveryIcon(app)); assert.equal(compact.children[0].props.className, 'mcp-server-name'); assert.equal(walk(app.card()).filter((node) => node.type === primitives.Switch).length, 1); assert.equal(app.nodes().some((node) => node.type === primitives.Checkbox), false);
  app.info().props.onClick(); app.render(); app.hooks.effects(); assert.ok(text(app.card()).includes('stoppingNote')); const value = { value: 'SYNTHETIC_RETRY_STOP_DRAFT' }; app.root.passwords = [value];
  await recoveryIcon(app).props.onClick(); await app.settle(); assert.equal(value.value, ''); assert.deepEqual(mutations(app), [{ method: 'stop', request: { revision: 4, id: serverId } }]);
  assert.equal(app.integration().props.checked, false); assert.equal(compactStatus(app).props['data-state'], 'unmounted-shutdown-unverified'); assert.equal(recoveryIcon(app).props.disabled, true); assert.equal(app.button('edit').props.disabled, false); assert.equal(app.nodes().some((node) => node.type === 'time'), false); app.dispose();
});

test('persistent OFF cleanup failure retains OFF, failure notice and retry-stop without claiming shutdown', async () => {
  let snapshot = makeSnapshot({ capabilities: persistentCapabilities, servers: [{ ...rowFor(httpConfig, 'activation-verified', true), lastVerifiedAt: 1760000000000 }] }); let attempts = 0;
  const app = await setup({ snapshot, respond: (method) => {
    if (method === 'stop') { attempts++; snapshot = { ...snapshot, revision: snapshot.revision + 1, servers: [rowFor(httpConfig, 'stop-failed', false)] }; return { ok: false, error: { message: 'MCP console: stop-failed' } }; }
    return { ok: true, value: snapshot };
  } }); app.render(); app.hooks.effects(); await app.settle(); await app.integration().props.onChange(false); await app.settle();
  assert.equal(app.integration().props.checked, false); assert.equal(compactStatus(app).props['data-state'], 'stop-failed'); assert.equal(recoveryIcon(app).props['aria-label'], 'retryStopAction: ' + httpConfig.label); assert.ok(text(app.tree()).includes('errors.stop-failed')); assert.ok(!text(app.tree()).includes('success')); assert.equal(app.button('edit').props.disabled, true);
  for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle(); assert.equal(attempts, 1);
  await recoveryIcon(app).props.onClick(); await app.settle(); assert.equal(attempts, 2); assert.deepEqual(mutations(app).map(({ method }) => method), ['stop', 'stop']); assert.deepEqual(mutations(app)[1].request, { revision: 5, id: serverId }); assert.equal(app.integration().props.checked, false); app.dispose();
});

test('persistent ON startup failure or legacy locked vault is retried only by deliberate existing reconnect icon', async () => {
  for (const state of ['disabled', 'mount-failed', 'unmounted-shutdown-unverified']) {
    let snapshot = makeSnapshot({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, state, true)], vault: { mode: 'passphrase', initialized: true, locked: true, expiresAt: 0, refs: ['api_token'] } });
    const app = await setup({ snapshot, respond: (method) => { if (method === 'reconnect') snapshot = { ...snapshot, revision: 5, servers: [{ ...rowFor(httpConfig, 'activation-verified', true), lastVerifiedAt: 1760000001000 }] }; return { ok: true, value: snapshot }; } }); app.render(); app.hooks.effects(); await app.settle();
    assert.equal(mutations(app).length, 0); assert.equal(recoveryIcon(app).props.disabled, false); await recoveryIcon(app).props.onClick(); await app.settle();
    assert.deepEqual(mutations(app), [{ method: 'reconnect', request: { revision: 4, id: serverId, confirmation: 'RECONNECT THIS SERVER' } }]); assert.equal(app.integration().props.checked, true); assert.equal(compactStatus(app).props['data-state'], 'activation-verified'); assert.equal(app.nodes().find((node) => node.type === primitives.Modal).props.open, false); app.dispose();
  }
});

test('persistent Switch ON/OFF uses unchanged reviewed RPCs, stays snapshot-controlled while pending and verifies actual state', async () => {
  for (const checked of [false, true]) {
    let finish; const deferred = new Promise((resolve) => { finish = resolve; });
    let snapshot = makeSnapshot({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, checked ? 'mounted-status-unavailable' : 'disabled', checked)] });
    const app = await setup({ snapshot, respond: (method) => ['start', 'stop'].includes(method) ? deferred : { ok: true, value: snapshot } }); app.render(); app.hooks.effects(); await app.settle();
    const old = app.integration(), pending = old.props.onChange(!checked); app.render(); assert.equal(app.integration().props.checked, checked); assert.equal(app.integration().props.disabled, true); await old.props.onChange(!checked); assert.equal(mutations(app).length, 1);
    assert.deepEqual(mutations(app)[0], { method: checked ? 'stop' : 'start', request: { revision: 4, id: serverId, ...(!checked ? { confirmation: 'START THIS SERVER' } : {}) } });
    snapshot = { ...snapshot, revision: 5, servers: [rowFor(httpConfig, checked ? 'unmounted-shutdown-unverified' : 'mounted-status-unavailable', !checked)] }; finish({ ok: true, value: snapshot }); await pending; await app.settle();
    assert.equal(app.integration().props.checked, !checked); assert.equal(app.integration().props['aria-checked'], !checked); assert.ok(text(app.tree()).includes('success')); assert.equal(app.nodes().some((node) => node.type === primitives.Checkbox), false); assert.equal(mutations(app).length, 1); app.dispose();
  }
});

test('persistent ON failure durably observed as enabled is not a connected success and browser never automatically retries', async () => {
  let snapshot = makeSnapshot({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, 'disabled', false)] });
  const app = await setup({ snapshot, respond: (method) => { if (method === 'start') { snapshot = { ...snapshot, revision: 5, servers: [rowFor(httpConfig, 'mount-failed', true)] }; return { ok: false, error: { message: 'MCP console: mount-failed' } }; } return { ok: true, value: snapshot }; } }); app.render(); app.hooks.effects(); await app.settle(); await app.integration().props.onChange(true); await app.settle();
  assert.equal(app.integration().props.checked, true); assert.equal(compactStatus(app).props['data-state'], 'mount-failed'); assert.ok(text(app.tree()).includes('errors.mount-failed')); assert.ok(!text(app.tree()).includes('success')); assert.equal(app.requests.at(-1).method, 'snapshot');
  app.info().props.onClick(); app.render(); app.hooks.effects(); app.geometry.view.dispatch('resize'); app.dispatch('scroll', { target: app.geometry.clip }); await app.button('refresh').props.onClick(); app.reset(); await app.settle(); for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle();
  assert.deepEqual(mutations(app).map(({ method }) => method), ['start']); assert.equal(app.integration().props.checked, true); assert.equal(app.nodes().some((node) => node.type === 'time'), false); app.dispose();
  const reloaded = await setup({ snapshot }); assert.equal(reloaded.requests.length, 0); reloaded.render(); reloaded.hooks.effects(); await reloaded.settle(); assert.equal(reloaded.integration().props.checked, true); assert.equal(mutations(reloaded).length, 0); reloaded.dispose();
});

test('persistent start/stop success replies require desired preference AND appropriate real handle state and unchanged config', async () => {
  const cases = [
    ['start', 'mount-failed', true], ['start', 'disabled', true], ['start', 'stop-failed', true], ['start', 'mounted-status-unavailable', false], ['start', 'mounted-status-unavailable', true, { saveAndActivate: true }],
    ['stop', 'disabled', true], ['stop', 'stop-failed', false], ['stop', 'mounted-status-unavailable', false], ['stop', 'disabled', false, undefined, { ...httpConfig, url: 'https://changed.invalid/mcp' }]
  ];
  for (const [method, state, enabled, capability, config] of cases) {
    let snapshot = makeSnapshot({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, method === 'start' ? 'disabled' : 'mounted-status-unavailable', method !== 'start')] });
    const app = await setup({ snapshot, respond: (called) => { if (called === method) snapshot = { ...snapshot, revision: 5, capabilities: capability ?? persistentCapabilities, servers: [rowFor(config ?? httpConfig, state, enabled)] }; return { ok: true, value: snapshot }; } }); app.render(); app.hooks.effects(); await app.settle(); await app.integration().props.onChange(method === 'start'); await app.settle();
    assert.deepEqual(mutations(app).map(({ method }) => method), [method]); assert.ok(!text(app.tree()).includes('success'), method + '/' + state + '/' + enabled); assert.ok(text(app.tree()).includes('errors.snapshot-contract-failed')); assert.equal(app.requests.at(-1).method, 'snapshot'); assert.equal(app.nodes().some((node) => node.type === 'time'), false); app.dispose();
  }
});

test('persistent stale Switch, reconnect, retry-stop and edit callbacks guard preference/capability plus revision, config and actual state before writes', async () => {
  for (const action of ['switch', 'reconnect', 'retry-stop', 'edit']) {
    const original = rowFor(httpConfig, action === 'reconnect' ? 'mount-failed' : action === 'retry-stop' ? 'stop-failed' : 'disabled', action === 'reconnect');
    for (const change of ['enabled', 'capability', 'state', 'config', 'revision', 'missing']) {
      const app = await setup({ snapshot: { capabilities: persistentCapabilities, servers: [original] } }); app.render(); app.hooks.effects(); await app.settle();
      const old = action === 'switch' ? app.integration() : action === 'edit' ? app.button('edit') : recoveryIcon(app);
      const row = { ...original, ...(change === 'enabled' ? { enabled: !original.enabled } : {}), ...(change === 'state' ? { state: 'unmounted-shutdown-unverified' } : {}), ...(change === 'config' ? { config: { ...httpConfig, label: 'Synthetic changed label' } } : {}) };
      app.setSnapshot(makeSnapshot({ revision: change === 'revision' ? 5 : 4, capabilities: change === 'capability' ? { saveAndActivate: true } : persistentCapabilities, servers: change === 'missing' ? [] : [row] })); await app.button('refresh').props.onClick();
      if (action === 'switch') await old.props.onChange(true); else await old.props.onClick(); app.render();
      assert.equal(mutations(app).length, 0, action + '/' + change); assert.ok(text(app.tree()).includes('conflict')); if (action === 'edit') assert.equal(app.nodes().some((node) => node.type === 'form' && node.props['aria-label'] === 'edit'), false); app.dispose();
    }
  }
});

test('persistent Delete confirmation rechecks enabled/capability/state/config on the latest observed snapshot', async () => {
  for (const change of ['enabled', 'capability', 'state', 'config']) {
    const original = rowFor(httpConfig, 'disabled', false), app = await setup({ snapshot: { capabilities: persistentCapabilities, servers: [original] } }); app.render(); app.hooks.effects(); await app.settle();
    app.button('remove').props.onClick(); app.render(); const confirm = app.buttons('remove').at(-1);
    app.setSnapshot(makeSnapshot({ capabilities: change === 'capability' ? { saveAndActivate: true } : persistentCapabilities, servers: [{ ...original, ...(change === 'enabled' ? { enabled: true } : {}), ...(change === 'state' ? { state: 'stop-failed' } : {}), ...(change === 'config' ? { config: { ...httpConfig, url: 'https://changed.invalid/mcp' } } : {}) }] })); await app.button('refresh').props.onClick(); await confirm.props.onClick(); app.render();
    assert.equal(mutations(app).length, 0); assert.ok(text(app.tree()).includes('conflict')); app.dispose();
  }
});

test('persistent stale Save and credential callbacks observe enabled/capability changes before capture, randomness or writes', async () => {
  for (const change of ['enabled', 'capability', 'state', 'config']) {
    let randomCalls = 0; const app = await tokenHarness({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, 'disabled', false)], vault: automatic(['api_token']), crypto: { getRandomValues(bytes) { randomCalls++; return webcrypto.getRandomValues(bytes); } } }); const stale = app.form('edit'), header = headerPassword(app, 0); header.value = 'SYNTHETIC_STALE_HEADER'; app.password.value = 'SYNTHETIC_STALE_TOKEN';
    app.setCurrent({ ...app.current(), capabilities: change === 'capability' ? { saveAndActivate: true } : persistentCapabilities, servers: [{ ...app.current().servers[0], ...(change === 'enabled' ? { enabled: true } : {}), ...(change === 'state' ? { state: 'mount-failed' } : {}), ...(change === 'config' ? { config: { ...httpConfig, label: 'Synthetic changed config' } } : {}) }] }); await app.button('refresh').props.onClick(); await stale.props.onSubmit(event({ token: app.password })); await app.settle();
    assert.equal(mutations(app).length, 0); assert.equal(randomCalls, 0); assert.equal(app.password.value, 'SYNTHETIC_STALE_TOKEN'); assert.equal(header.value, 'SYNTHETIC_STALE_HEADER'); assert.ok(text(app.tree()).includes('conflict')); app.dispose();
  }
});

test('persistent sequential credential writes recheck preference/capability after each reply and stop before the next write or activation', async () => {
  for (const change of ['enabled', 'capability']) {
    const app = await tokenHarness({ capabilities: persistentCapabilities, servers: [rowFor(httpConfig, 'disabled', false)], vault: automatic(['api_token']), respond(method, request, control) {
      if (method !== 'setSecret') return; const committed = control.commit(); control.setCurrent({ ...committed.value, capabilities: change === 'capability' ? { saveAndActivate: true } : persistentCapabilities, servers: committed.value.servers.map((row) => ({ ...row, ...(change === 'enabled' ? { enabled: true } : {}) })) }); return { ok: true, value: control.current() };
    } }); addHeader(app, 'X-API-Key'); const header = headerPassword(app, 1); header.value = 'SYNTHETIC_QUEUED_HEADER'; await app.submit('SYNTHETIC_HANDOFF_TOKEN'); await app.settle();
    assert.deepEqual(mutations(app).map(({ method }) => method), ['setSecret']); assert.equal(app.password.value, ''); assert.equal(header.value, ''); assert.ok(text(app.tree()).includes('conflict')); assert.ok(!text(app.tree()).includes('success')); app.dispose();
  }
});

test('persistent Save keeps masked Token/Headers on fresh vault references, preserves mounted append, and confirms matching enabled verified activation', async () => {
  const capabilities = { ...persistentCapabilities, appendSecretsWhileMounted: true };
  const app = await tokenHarness({ config: null, capabilities, vault: automatic(['api_token']), servers: [rowFor(httpConfig, 'mounted-status-unavailable', true)] }); addHeader(app, 'X-API-Key'); const header = headerPassword(app, 0); header.value = 'SYNTHETIC_PERSISTENT_HEADER'; await app.submit('SYNTHETIC_PERSISTENT_TOKEN'); await app.settle();
  const writes = mutations(app); assert.deepEqual(writes.map(({ method }) => method), ['setSecret', 'setSecret', 'saveAndActivate']); assert.notEqual(writes[0].request.ref, writes[1].request.ref); assert.equal(app.secretValues.get('api_token'), 'SYNTHETIC_OLD_VALUE'); assert.equal(app.password.value, ''); assert.equal(header.value, ''); assert.equal(app.integration('b'.repeat(24)).props.checked, true); assert.equal(compactStatus(app, 'b'.repeat(24)).props['data-state'], 'activation-verified'); assert.ok(text(app.tree()).includes('success')); assert.equal(app.current().servers[0].state, 'mounted-status-unavailable'); assert.equal(app.current().servers[0].enabled, true);
  assert.equal(writes[2].request.confirmation, 'SAVE AND ACTIVATE THIS SERVER'); assert.equal(Object.hasOwn(writes[2].request.server, 'enabled'), false); assert.equal(app.nodes().some((node) => node.type === primitives.Checkbox), false); for (const value of [app.tree(), app.hooks.values(), writes[2].request, app.warnings, app.infos]) assert.ok(!JSON.stringify(value).includes('SYNTHETIC_PERSISTENT_')); app.dispose();
  const unchecked = await tokenHarness({ config: null, capabilities: persistentCapabilities, vault: automatic(), respond(method, request, control) { if (method !== 'saveAndActivate') return; const committed = control.commit(); control.setCurrent({ ...committed.value, servers: committed.value.servers.map((row) => ({ ...row, enabled: false })) }); return { ok: true, value: control.current() }; } }); await unchecked.submit(); await unchecked.settle(); assert.ok(unchecked.form('add')); assert.equal(unchecked.integration('b'.repeat(24)).props.checked, false); assert.ok(!text(unchecked.tree()).includes('success')); assert.ok(text(unchecked.tree()).includes('savePending')); assert.deepEqual(mutations(unchecked).map(({ method }) => method), ['saveAndActivate']); unchecked.dispose();
});

test('persistent Save capability drift cannot turn a verified mounted row alone into a saved-preference success or cause activation replay', async () => {
  for (const uncertain of [false, true]) {
    const app = await tokenHarness({ config: null, capabilities: persistentCapabilities, vault: automatic(), respond(method, request, control) {
      if (method !== 'saveAndActivate') return; const committed = control.commit(); control.setCurrent({ ...committed.value, capabilities: { saveAndActivate: true } });
      return uncertain ? Promise.reject(Error('SYNTHETIC_UNCERTAIN_CARRIER')) : { ok: true, value: control.current() };
    } }); await app.submit(); await app.settle(); assert.ok(app.form('add')); assert.ok(!text(app.tree()).includes('success')); assert.deepEqual(mutations(app).map(({ method }) => method), ['saveAndActivate']);
    for (const timer of app.timers.values()) if (timer.interval) timer.fn(); await app.settle(); await app.submit(); await app.settle(); assert.deepEqual(mutations(app).map(({ method }) => method), ['saveAndActivate']); assert.ok(!text(app.tree()).includes('success')); app.dispose();
  }
});

test('persistent localized explanation stays in existing info/scope disclosure and retained mounts keep exact Portuguese edit hint', async () => {
  for (const language of ['en', 'pt-BR']) {
    const app = await setup({ language, snapshot: { capabilities: persistentCapabilities, servers: [rowFor(httpConfig, 'stop-failed', false)] } }); app.render(); app.hooks.effects(); await app.settle(); const copy = app.dictionaries['personal.mcpConsole'][language];
    assert.equal(copy.targetEditBlocked, language === 'pt-BR' ? 'Para editar, desative este MCP.' : 'Disable this MCP to edit.'); assert.ok(!text(app.card()).includes(copy.persistentIntegrationNote)); assert.ok(text(app.card()).includes(copy.targetEditBlocked));
    const icons = walk(app.card()).filter((node) => node.type === primitives.Button && node.props.className === 'mcp-row-icon'); assert.equal(icons.length, 2); assert.equal(icons[1].props.title, copy.retryStopAction); assert.ok(!icons[1].props.title.includes(copy.reconnectAction));
    icons[0].props.onClick(); app.render(); app.hooks.effects(); assert.ok(text(app.card()).includes(copy.persistentIntegrationNote)); assert.ok(text(app.card()).includes(copy.persistentStatusNote)); assert.equal(mutations(app).length, 0); app.dispose();
  }
});
