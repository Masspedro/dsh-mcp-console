import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { z } from 'zod';
import { METHODS, makeClientContribution, makeSchemas } from '../src/contract.js';

// Source-only VM tests: no lib build, host activation, real server or network.
const raw = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
const contract = (await readFile(new URL('../src/contract.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
const source = raw.replace('/* BUILD_SHARED_CONTRACT */', contract);
const plain = (value) => JSON.parse(JSON.stringify(value));
const id = 'a'.repeat(24), otherId = 'b'.repeat(24);
const name = (suffix, owner = id) => 'mcp__pc_' + owner + '__' + suffix;
const alpha = name('alpha'), beta = name('h_opaque_sdk_suffix'), missing = name('missing');
const config = { id, label: 'Local policy test', transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: {} };
const caps = { saveAndActivate: true, persistentActivation: true, toolPolicy: true, configurableTimeout: true };
const row = (saved = config, changes = {}) => ({ config: saved, serverName: 'pc_' + saved.id, state: 'activation-verified', enabled: true, lastVerifiedAt: 1760000000000, tools: { names: [alpha, beta], source: 'mounted' }, ...changes });
const snapshot = (changes = {}) => ({ revision: 4, capabilities: caps, servers: [row()], vault: { mode: 'automatic', initialized: false, locked: false, expiresAt: 0, refs: [] }, external: [], externalInventory: 'unavailable', ...changes });
const primitives = { Button: function Button() {}, Modal: function Modal() {}, Checkbox: function Checkbox() {}, Switch: function Switch() {} };
function runtime() {
  const hooks = []; let cursor = 0, effects = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const React = {
    Fragment: Symbol('Fragment'), createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, (next) => { hooks[i].value = typeof next === 'function' ? next(hooks[i].value) : next; }]; },
    useRef(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { current: initial }; return hooks[i]; },
    useId() { const i = cursor++; if (!hooks[i]) hooks[i] = { value: ':policy:' + i }; return hooks[i].value; },
    useCallback(fn, deps) { const i = cursor++; if (!hooks[i] || changed(hooks[i].deps, deps)) hooks[i] = { fn, deps }; return hooks[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || changed(hooks[i].deps, deps)) { const old = hooks[i], next = { deps }; hooks[i] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = fn(); }); } },
    useLayoutEffect(fn, deps) { this.useEffect(fn, deps); }
  };
  return { React, begin() { cursor = 0; }, effects() { const pending = effects; effects = []; for (const effect of pending) effect(); }, values: () => hooks.map((hook) => hook?.value), dispose() { for (const hook of hooks) hook?.cleanup?.(); } };
}
function walk(node, list = []) {
  if (Array.isArray(node)) { for (const child of node) walk(child, list); return list; }
  if (!node || typeof node !== 'object' || !node.type) return list;
  list.push(node); for (const child of node.children ?? []) walk(child, list);
  if (typeof node.type === 'function' && !Object.values(primitives).includes(node.type)) walk(node.type(node.props), list);
  if (node.props.footer) walk(node.props.footer, list); return list;
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? (node.children ?? []).map(text).join(' ') : String(node);
}
async function setup(options = {}) {
  const hooks = runtime(), dictionaries = {}, requests = [], warnings = [], timers = new Map(), cleanups = [], listeners = new Set();
  let definition, contribution, entry, tree, timerId = 0, current = options.snapshot ?? snapshot();
  const document = { head: { appendChild() {} }, createElement: () => ({ dataset: {}, remove() {} }), addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(source, { URL, document, window: { crypto: webcrypto, __ModuleLoader__: { load: (value) => { definition = value; } } }, console: { warn: (...value) => warnings.push(value), info() {} }, setInterval: (fn) => { timers.set(++timerId, fn); return timerId; }, clearInterval: (id) => timers.delete(id), setTimeout: () => ++timerId, clearTimeout() {} }, { timeout: 1000 });
  const plugin = definition.factory((module) => module === 'react' ? hooks.React : module === 'zod' ? { z } : primitives);
  const ctx = {
    remote: { $mount: async (value) => { contribution = value; }, personalMcpConsole: Object.fromEntries(METHODS.map((method) => [method, async (request) => {
      requests.push({ method, request: plain(request) });
      if (options.respond) return options.respond(method, request, current);
      if (method === 'setToolPolicy') current = { ...current, revision: current.revision + 1, servers: current.servers.map((entry) => entry.config.id === request.id ? { ...entry, config: { ...entry.config, toolPolicy: plain(request.toolPolicy) } } : entry) };
      if (method === 'saveAndActivate') { const saved = { ...plain(request.server), id: request.server.id ?? otherId }; current = { ...current, revision: current.revision + 1, servers: [...current.servers.filter((entry) => entry.config.id !== saved.id), row(saved, { tools: { names: [], source: 'mounted' } })] }; }
      if (method === 'setSecret') current = { ...current, revision: current.revision + 1, vault: { ...current.vault, initialized: true, refs: [...current.vault.refs, request.ref] } };
      return { ok: true, value: current };
    }])) },
    locale: { register: (namespace, values) => { dictionaries[namespace] = values; return () => {}; }, bind: () => (key) => key },
    connection: { generation: { subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } } },
    slots: { register: (meta, component) => { entry = { meta, component }; return () => {}; }, inject: (_, fn) => fn(), entries: () => [], subscribe: () => () => {} },
    effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); }, inject: (_, fn) => fn(ctx)
  };
  await plugin.apply(ctx);
  const injected = entry.meta.inject(), root = { querySelectorAll: () => [] }, t = (key) => options.language ? dictionaries['personal.mcpConsole'][options.language][key] ?? key : key;
  function render() { hooks.begin(); tree = entry.component({ ...injected, ...(options.panelApi ? { api: options.panelApi } : {}), t }); tree.props.ref.current = root; return tree; }
  async function settle() { for (let i = 0; i < 5; i++) { await Promise.resolve(); render(); hooks.effects(); } await Promise.resolve(); render(); }
  const nodes = () => walk(tree);
  const button = (key) => { const found = nodes().find((node) => node.type === primitives.Button && (text(node).trim() === key || node.props['aria-label'] === key)); assert.ok(found, 'Button ' + key); return found; };
  const input = (key) => { const found = nodes().find((node) => ['select', 'input'].includes(node.type) && node.props.name === key); assert.ok(found, 'Input ' + key); return found; };
  const checkbox = (key) => { const found = nodes().find((node) => node.type === primitives.Checkbox && node.props.label === key.replace(/^mcp__pc_[a-f0-9]{24}__/, '')); assert.ok(found, 'Checkbox ' + key); return found; };
  const form = () => { const found = nodes().find((node) => node.type === 'form' && node.props['data-server-editor']); assert.ok(found); return found; };
  render(); hooks.effects(); await settle();
  return { plugin, dictionaries: dictionaries['personal.mcpConsole'], contribution, api: injected.api, requests, warnings, nodes, button, input, checkbox, form, hooks, render, settle, tree: () => tree, setSnapshot: (next) => { current = next; }, poll: async () => { for (const fn of timers.values()) fn(); await settle(); }, dispose() { hooks.dispose(); for (const cleanup of cleanups.reverse()) cleanup(); } };
}
const change = (node, value) => node.props.onChange({ target: { value } });
const event = (elements = {}) => ({ preventDefault() {}, currentTarget: { elements } });
const mutations = (app) => app.requests.filter(({ method }) => method !== 'snapshot');
async function open(app, mode = 'include') { app.button('policyManage').props.onClick(); await app.settle(); change(app.input('policy-' + id + '-mode'), mode); await app.settle(); }
async function newServer(app) { app.button('add').props.onClick(); await app.settle(); change(app.input('label'), 'New safe server'); change(app.input('url'), 'https://example.invalid/new'); await app.settle(); }

test('tool policy details preserve the compact heading and open/check/search/poll/cancel are read-only', async () => {
  const app = await setup(); const heading = app.nodes().find((node) => node.props.className === 'mcp-compact-row');
  assert.equal(walk(heading).filter((node) => node.type === primitives.Button).length, 2);
  assert.equal(walk(heading).filter((node) => node.type === primitives.Switch).length, 1);
  assert.equal(walk(heading).some((node) => node.props.className === 'mcp-tag'), false);
  const details = app.nodes().find((node) => node.props['data-tool-policy'] === id); assert.equal(details.type, 'details'); assert.equal(details.props.open, undefined);
  await open(app); app.checkbox(alpha).props.onChange(true); await app.settle();
  change(app.input('policy-' + id + '-search'), 'opaque'); await app.settle(); assert.equal(app.nodes().some((node) => node.type === primitives.Checkbox && node.props.label === 'alpha'), false); assert.ok(app.checkbox(beta));
  await app.poll(); change(app.input('policy-' + id + '-search'), ''); await app.settle(); assert.equal(app.checkbox(alpha).props.checked, true);
  app.button('cancel').props.onClick(); await app.settle(); assert.equal(mutations(app).length, 0); app.dispose();
});

test('tool choices keep complete visible names and use a bounded native checkbox row', async () => {
  const longest = name('x'.repeat(30));
  assert.equal(longest.length, 64);
  const app = await setup({ snapshot: snapshot({ servers: [row(config, { tools: { names: [alpha, longest], source: 'mounted' } })] }) });
  await open(app);
  for (const exact of [alpha, longest]) {
    const choice = app.checkbox(exact);
    assert.equal(choice.props.className, 'mcp-tool-choice');
    const display = exact.replace(/^mcp__pc_[a-f0-9]{24}__/, '');
    assert.equal(choice.props.label, display, 'Only the tool name is visible');
    assert.equal(choice.props.title, display, 'Hover text also omits the MCP identifier');
    assert.ok(!choice.props.label.includes(id));
    assert.equal(choice.props.checked, false);
  }
  app.checkbox(longest).props.onChange(true); await app.settle();
  assert.equal(app.checkbox(longest).props.checked, true);
  assert.equal(mutations(app).length, 0, 'Layout/selection still require explicit Apply');
  app.dispose();
});

test('text-input styles exclude checkbox/radio and tool rows reserve space for full names', () => {
  assert.match(raw, /\.personal-mcp-console input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),\.personal-mcp-console select/);
  assert.doesNotMatch(raw, /\.personal-mcp-console input,\.personal-mcp-console select/);
  const choice = raw.match(/\.personal-mcp-console \.mcp-tool-choice\{([^}]+)\}/)[1];
  assert.match(choice, /display:grid/);
  assert.match(choice, /grid-template-columns:18px minmax\(0,1fr\)/);
  assert.match(choice, /min-height:44px/);
  const indicator = raw.match(/\.personal-mcp-console \.mcp-tool-choice>input\[type="checkbox"\]\{([^}]+)\}/)[1];
  for (const declaration of ['width:18px', 'min-width:18px', 'max-width:18px', 'height:18px', 'min-height:18px', 'max-height:18px', 'padding:0']) assert.ok(indicator.includes(declaration));
  assert.ok(!indicator.includes('100%'));
  const caption = raw.match(/\.personal-mcp-console \.mcp-tool-choice>span\{([^}]+)\}/)[1];
  assert.match(caption, /min-width:0/);
  assert.match(caption, /white-space:normal/);
  assert.match(caption, /overflow-wrap:anywhere/);
  assert.match(caption, /font-size:13px/);
  assert.doesNotMatch(caption, /display:none|visibility:hidden|text-overflow:ellipsis/);
});

test('Apply uses only exact setToolPolicy RPC and preserves active mount, credentials and verification', async () => {
  const saved = { ...config, headerRefs: { Authorization: 'kept_ref' } }, app = await setup({ snapshot: snapshot({ servers: [row(saved)], vault: { mode: 'automatic', initialized: true, locked: false, expiresAt: 0, refs: ['kept_ref'] } }) });
  await open(app); app.checkbox(beta).props.onChange(true); await app.settle(); await app.button('policyApply').props.onClick(); await app.settle();
  assert.deepEqual(mutations(app), [{ method: 'setToolPolicy', request: { revision: 4, id, toolPolicy: { mode: 'include', names: [beta] } } }]);
  assert.equal(app.nodes().find((node) => node.type === primitives.Switch).props.checked, true);
  assert.equal(app.nodes().some((node) => node.props['data-policy-manager']), false); app.dispose();
});

test('missing selections persist for include/exclude and unavailable inventory invents no names', async () => {
  for (const mode of ['include', 'exclude']) {
    const app = await setup({ snapshot: snapshot({ servers: [row({ ...config, toolPolicy: { mode, names: [missing] } }, { state: 'disabled', enabled: false, tools: { names: [], source: 'unavailable' } })] }) });
    await open(app, mode); assert.equal(app.checkbox(missing).props.checked, true); assert.equal(app.nodes().filter((node) => node.type === primitives.Checkbox).length, 1);
    await app.poll(); assert.equal(app.checkbox(missing).props.checked, true); change(app.input('policy-' + id + '-mode'), mode === 'include' ? 'exclude' : 'include'); await app.settle();
    await app.button('policyApply').props.onClick(); await app.settle(); assert.deepEqual(mutations(app)[0].request.toolPolicy.names, [missing]); app.dispose();
  }
});

test('all/include/exclude semantics are explicit and switching through all does not erase draft selections', async () => {
  const app = await setup({ language: 'en' });
  app.button('Manage tool access').props.onClick(); await app.settle(); change(app.input('policy-' + id + '-mode'), 'include'); await app.settle();
  assert.match(text(app.tree()), /empty selection exposes no tools/); assert.match(text(app.tree()), /NOT added automatically/);
  app.checkbox(alpha).props.onChange(true); await app.settle(); change(app.input('policy-' + id + '-mode'), 'all'); await app.settle(); change(app.input('policy-' + id + '-mode'), 'exclude'); await app.settle();
  assert.equal(app.checkbox(alpha).props.checked, true); assert.match(text(app.tree()), /New tools not in this list are allowed/); app.dispose();
});

test('capabilities fail closed, including live capability loss and stale callbacks', async () => {
  const initial = snapshot({ capabilities: { saveAndActivate: true, persistentActivation: true } }); const app = await setup({ snapshot: initial });
  assert.equal(app.button('policyManage').props.disabled, true); await app.button('policyManage').props.onClick(); await app.settle(); assert.equal(mutations(app).length, 0);
  await newServer(app); assert.equal(app.nodes().some((node) => node.props.name === 'tool-policy-mode' || node.props.name === 'timeoutSeconds'), false); app.dispose();
  const live = await setup(); await open(live); live.checkbox(alpha).props.onChange(true); await live.settle(); const stale = live.button('policyApply'); live.setSnapshot(initial); await live.poll(); await stale.props.onClick(); await live.settle(); assert.equal(mutations(live).length, 0); live.dispose();
});

test('stale revision, removed target and changed live activation require explicit Refresh before Apply', async () => {
  for (const next of [snapshot({ revision: 5 }), snapshot({ revision: 5, servers: [] }), snapshot({ servers: [row(config, { state: 'disabled', enabled: false })] })]) {
    const app = await setup(); await open(app); app.checkbox(alpha).props.onChange(true); await app.settle(); const stale = app.button('policyApply'); app.setSnapshot(next); await app.poll(); await stale.props.onClick(); await app.settle();
    assert.equal(mutations(app).length, 0); assert.ok(text(app.tree()).includes('policyRefreshRequired')); app.dispose();
  }
});

test('local stale-target Apply stays blocked through cancel/reopen until explicit Refresh', async () => {
  const app = await setup(); await open(app); app.checkbox(alpha).props.onChange(true); await app.settle(); app.setSnapshot(snapshot({ revision: 5 })); await app.poll(); await app.button('policyApply').props.onClick(); await app.settle();
  assert.equal(app.button('policyApply').props.disabled, true); app.button('cancel').props.onClick(); await app.settle(); await open(app); assert.equal(app.button('policyApply').props.disabled, true);
  await app.button('refresh').props.onClick(); await app.settle(); assert.equal(app.button('policyApply').props.disabled, false); assert.equal(mutations(app).length, 0); app.dispose();
});

test('ambiguous Apply is never replayed by polling, repeated Apply or cancel/reopen; explicit Refresh reconciles', async () => {
  let saved = snapshot(), lose = true;
  const app = await setup({ respond(method, request) {
    if (method === 'setToolPolicy') { saved = { ...saved, revision: saved.revision + 1, servers: [row({ ...config, toolPolicy: plain(request.toolPolicy) })] }; if (lose) throw { code: 'gateway/internal', message: 'PRIVATE_REMOTE_SECRET' }; }
    return { ok: true, value: saved };
  } });
  await open(app); app.checkbox(alpha).props.onChange(true); await app.settle(); await app.button('policyApply').props.onClick(); await app.settle(); assert.equal(app.button('policyApply').props.disabled, true);
  await app.poll(); await app.button('policyApply').props.onClick(); assert.equal(mutations(app).length, 1); assert.ok(!text(app.tree()).includes('PRIVATE_REMOTE_SECRET'));
  app.button('cancel').props.onClick(); await app.settle(); await open(app); assert.equal(app.button('policyApply').props.disabled, true);
  await app.button('refresh').props.onClick(); await app.settle(); assert.equal(app.button('policyApply').props.disabled, false); await app.button('policyApply').props.onClick(); await app.settle(); assert.equal(mutations(app).length, 1); lose = false; app.dispose();
});

test('new include-empty is preserved before first verified Save and advanced defaults do not pollute configuration', async () => {
  for (const mode of ['all', 'include', 'exclude']) {
    const app = await setup({ snapshot: snapshot({ servers: [] }) }); await newServer(app);
    const advanced = app.nodes().find((node) => node.props['data-advanced-server']); assert.equal(advanced.type, 'details'); assert.equal(advanced.props.open, undefined);
    change(app.input('tool-policy-mode'), mode); await app.settle(); await app.form().props.onSubmit(event()); await app.settle();
    const request = mutations(app).find(({ method }) => method === 'saveAndActivate').request; assert.equal(Object.hasOwn(request.server, 'toolCallTimeoutMs'), false);
    if (mode === 'all') assert.equal(Object.hasOwn(request.server, 'toolPolicy'), false); else assert.deepEqual(request.server.toolPolicy, { mode, names: [] });
    assert.equal(Object.hasOwn(request.server, 'serverName'), false); app.dispose();
  }
});

test('timeout range, integer validation and preservation keep old config reconciliation stable', async () => {
  const app = await setup(), { createServerDraft, serverFromDraft } = app.plugin;
  const old = plain(serverFromDraft(createServerDraft(config, 4))); assert.deepEqual(old, config);
  for (const seconds of ['0', '3601', '1.5', '', 'NaN', '-1', '1e3']) assert.throws(() => serverFromDraft({ ...createServerDraft(config, 4), timeoutSeconds: seconds, _timeoutEdited: true }), (error) => error.consoleCode === 'invalid-tool-timeout');
  for (const seconds of ['1', '60', '3600']) { const result = plain(serverFromDraft({ ...createServerDraft(config, 4), timeoutSeconds: seconds, _timeoutEdited: true })); assert.equal(result.toolCallTimeoutMs, seconds === '60' ? undefined : Number(seconds) * 1000); }
  for (const milliseconds of [60000, 1500, 3600000]) { const original = { ...config, toolCallTimeoutMs: milliseconds, toolPolicy: { mode: 'all', names: [] } }; assert.deepEqual(plain(serverFromDraft(createServerDraft(original, 4))), original); }
  const inactive = { ...config, toolCallTimeoutMs: 120000 }; app.setSnapshot(snapshot({ servers: [row(inactive, { state: 'disabled', enabled: false })] })); await app.poll(); app.button('edit').props.onClick(); await app.settle(); assert.equal(app.input('timeoutSeconds').props.value, '120'); assert.equal(app.form().props['data-editor-placement'], 'inline'); app.dispose();
});

test('intentional reset-to-all/reset-to60 removes defaults while untouched explicit fields remain equal', async () => {
  const app = await setup({ snapshot: snapshot({ servers: [row({ ...config, toolPolicy: { mode: 'exclude', names: [alpha] }, toolCallTimeoutMs: 120000 }, { state: 'disabled', enabled: false })] }) });
  app.button('edit').props.onClick(); await app.settle(); change(app.input('tool-policy-mode'), 'all'); change(app.input('timeoutSeconds'), '60'); await app.settle(); await app.form().props.onSubmit(event()); await app.settle();
  const saved = mutations(app).find(({ method }) => method === 'saveAndActivate').request.server; assert.equal(Object.hasOwn(saved, 'toolPolicy'), false); assert.equal(Object.hasOwn(saved, 'toolCallTimeoutMs'), false); app.dispose();
});

test('error-only Confirm OFF recovery supports already-OFF rows without start/reconnect or blind policy replay', async () => {
  for (const code of ['tool-policy-state-ambiguous', 'tool-policy-apply-failed']) {
    let state = snapshot({ servers: [row(config, { state: 'disabled', enabled: false, lastFailure: code, tools: { names: [alpha], source: 'last-known' } })] });
    const app = await setup({ snapshot: state, respond(method, request) {
      if (method === 'stop') { const { lastFailure, ...remaining } = state.servers[0]; state = { ...state, revision: state.revision + 1, servers: [{ ...remaining, state: 'unmounted-shutdown-unverified', enabled: false }] }; }
      if (method === 'setToolPolicy') state = { ...state, revision: state.revision + 1, servers: [{ ...state.servers[0], config: { ...config, toolPolicy: plain(request.toolPolicy) } }] };
      return { ok: true, value: state };
    } });
    await open(app); assert.equal(app.button('policyApply').props.disabled, true); await app.poll(); assert.equal(mutations(app).length, 0);
    const recovery = app.nodes().find((node) => node.props['data-policy-recovery']); assert.equal(walk(recovery).some((node) => node.type === primitives.Button && text(node) === 'policyRecoverOff'), true);
    const heading = app.nodes().find((node) => node.props.className === 'mcp-compact-row'); assert.equal(walk(heading).some((node) => text(node) === 'policyRecoverOff'), false);
    await app.button('policyRecoverOff').props.onClick(); await app.settle(); assert.deepEqual(mutations(app), [{ method: 'stop', request: { revision: 4, id } }]); assert.equal(app.button('policyApply').props.disabled, true);
    await app.button('refresh').props.onClick(); await app.settle(); assert.equal(app.button('policyApply').props.disabled, false); await app.button('policyApply').props.onClick(); await app.settle(); assert.deepEqual(mutations(app).map(({ method }) => method), ['stop', 'setToolPolicy']); app.dispose();
  }
  const normal = await setup(); assert.equal(normal.nodes().some((node) => node.props['data-policy-recovery']), false); normal.dispose();
  const stale = await setup({ snapshot: snapshot({ servers: [row(config, { state: 'disabled', enabled: false, lastFailure: 'tool-policy-state-ambiguous' })] }) }); const oldButton = stale.button('policyRecoverOff'); stale.setSnapshot(snapshot({ revision: 5, servers: [] })); await stale.poll(); await oldButton.props.onClick(); assert.equal(mutations(stale).length, 0); stale.dispose();
});

test('unavailable inventory and provider description/schema fields cannot create rendered tool names or markup', async () => {
  const state = snapshot({ servers: [row(config, { tools: { names: [alpha], source: 'unavailable', descriptions: ['PRIVATE_PROVIDER_DESCRIPTION'], schema: { text: 'PRIVATE_PROVIDER_SCHEMA' } } })] });
  const app = await setup({ panelApi: async () => state }); await open(app); assert.equal(app.nodes().filter((node) => node.type === primitives.Checkbox).length, 0); assert.ok(!text(app.tree()).includes('PRIVATE_PROVIDER')); app.dispose();
});

test('invalid timeout blocks before credential writes and mounted configuration stays OFF-before-edit', async () => {
  const app = await setup({ snapshot: snapshot({ servers: [] }) }); await newServer(app); change(app.input('timeoutSeconds'), '0'); await app.settle(); const secret = { value: 'WRITE_ONLY_PRIVATE_TEST' }; app.input('token').props.ref.current = secret;
  await app.form().props.onSubmit(event({ token: secret })); await app.settle(); assert.equal(mutations(app).length, 0); assert.ok(!JSON.stringify(app.hooks.values()).includes('WRITE_ONLY_PRIVATE_TEST')); app.dispose();
  const mounted = await setup(); assert.equal(mounted.button('edit').props.disabled, true); await mounted.button('edit').props.onClick(); await mounted.settle(); assert.equal(mounted.nodes().some((node) => node.props['data-server-editor']), false); mounted.dispose();
});

test('public names are exact text, own-namespace ASCII max64, unique and capped at512', async () => {
  const app = await setup(); const { createServerDraft, serverFromDraft } = app.plugin;
  const draft = createServerDraft(config, 4), names = Array.from({ length: 512 }, (_, index) => name('t' + index));
  assert.deepEqual(plain(serverFromDraft({ ...draft, toolPolicy: { mode: 'include', names } })).toolPolicy.names, names);
  for (const invalid of [[alpha, alpha], [...names, name('overflow')], ['alpha'], [name('alpha', otherId)], [name('工具')], [name('x'.repeat(31))], [name('<img>')]]) assert.throws(() => serverFromDraft({ ...draft, toolPolicy: { mode: 'include', names: invalid } }), (error) => error.consoleCode === 'invalid-tool-policy');
  await open(app); assert.equal(app.checkbox(beta).props.label, 'h_opaque_sdk_suffix'); assert.equal(app.nodes().some((node) => node.props.dangerouslySetInnerHTML), false); app.dispose();
});

test('ZH flat catalog is complete with EN/PT key parity and explicit Chinese datetime locale', async () => {
  const app = await setup({ language: 'zh-CN' }), dictionaries = app.dictionaries;
  for (const language of ['pt-BR', 'zh', 'zh-CN', 'zh-Hans']) { assert.deepEqual(Object.keys(dictionaries[language]).sort(), Object.keys(dictionaries.en).sort()); assert.ok(Object.values(dictionaries[language]).every((value) => typeof value === 'string' && value.length > 0)); }
  assert.equal(dictionaries.zh, dictionaries['zh-CN']); assert.equal(dictionaries.zh, dictionaries['zh-Hans']); assert.equal(dictionaries.zh.dateLocale, 'zh-CN');
  assert.match(text(app.tree()), /MCP 服务器/); assert.match(dictionaries.zh.policyIncludeNote, /不会自动加入/); assert.match(dictionaries.zh.policyExcludeNote, /新工具仍被允许/);
  for (const [key, value] of Object.entries(dictionaries.zh)) if (!['nav', 'dateLocale'].includes(key)) assert.match(value, /[\u3400-\u9fff]/u, key + ' requires an actual Chinese translation');
  assert.ok(!raw.includes('Saving does not activate a server.') && !raw.includes('No automatic starts or reconnects.')); app.dispose();
});

test('client contribution exactly matches source contract and safe failure codes never render provider data', async () => {
  let response = { ok: false, error: { code: 'gateway/internal', message: 'MCP console: connection-auth-denied', details: 'PRIVATE_SECRET_DIAGNOSTIC' } };
  const app = await setup({ respond: () => response });
  assert.deepEqual(plain(app.contribution), plain(makeClientContribution(z)));
  for (const code of ['connection-auth-denied', 'connection-endpoint-unavailable', 'connection-rate-limited', 'connection-service-unavailable', 'connection-timeout', 'connection-refused', 'connection-unreachable', 'connection-tls-failed', 'connection-invalid-response', 'tool-policy-unavailable', 'tool-policy-apply-failed', 'tool-policy-state-ambiguous', 'invalid-tool-policy', 'tool-inventory-limit']) {
    response = { ok: false, error: { message: 'MCP console: ' + code, details: 'PRIVATE_SECRET_DIAGNOSTIC' } }; await assert.rejects(app.api('snapshot', {}), (error) => error.consoleCode === code && !JSON.stringify(error).includes('PRIVATE'));
    assert.ok(Object.hasOwn(app.dictionaries.zh, 'errors.' + code));
  }
  for (const message of ['MCP console: connection-auth-denied PRIVATE_SECRET_DIAGNOSTIC', 'MCP console: connection-auth-denied\nPRIVATE_SECRET_DIAGNOSTIC']) { response = { ok: false, error: { message } }; await assert.rejects(app.api('snapshot', {}), (error) => error.consoleCode === 'operation-failed'); }
  assert.ok(!JSON.stringify([app.warnings, app.hooks.values(), app.tree()]).includes('PRIVATE_SECRET_DIAGNOSTIC')); app.dispose();
});

test('client RPC diagnostics use own data descriptors without invoking getters or inherited properties', async () => {
  let result, thrown, getterCalls = 0;
  const unsafe = Object.defineProperties({}, { code: { get() { getterCalls++; throw new Error('PRIVATE_ACCESSOR'); } }, message: { get() { getterCalls++; return 'MCP console: connection-auth-denied'; } } });
  const app = await setup({ respond() { if (thrown) throw thrown; return result ?? { ok: true, value: snapshot() }; } });
  thrown = unsafe; await assert.rejects(app.api('snapshot', {}), (error) => error.consoleCode === 'operation-failed' && error.rpcCategory === 'uncategorized-transport');
  thrown = undefined; result = { ok: false, error: unsafe }; await assert.rejects(app.api('snapshot', {}), (error) => error.consoleCode === 'operation-failed');
  result = Object.defineProperty({}, 'ok', { get() { getterCalls++; return true; } }); await assert.rejects(app.api('snapshot', {}));
  result = { ok: false, error: Object.create({ code: 'remote-access/denied', message: 'MCP console: connection-auth-denied' }) }; await assert.rejects(app.api('snapshot', {}), (error) => error.consoleCode === 'operation-failed');
  result = undefined; thrown = new Error('MCP console: connection-timeout'); await assert.rejects(app.api('snapshot', {}), (error) => error.consoleCode === 'connection-timeout');
  assert.equal(getterCalls, 0); assert.ok(!JSON.stringify([app.hooks.values(), app.warnings]).includes('PRIVATE_ACCESSOR')); app.dispose();
});

test('fixed proven connection validation failures release pending Save; write/quarantine failures do not', async () => {
  for (const code of ['connection-auth-denied', 'connection-timeout', 'connection-invalid-response', 'mount-failed', 'save-state-ambiguous', 'store-write-failed', 'save-cleanup-required']) {
    let state = snapshot({ servers: [] });
    const app = await setup({ respond(method) { return method === 'snapshot' ? { ok: true, value: state } : { ok: false, error: { message: 'MCP console: ' + code, details: 'PRIVATE_SAVE_ERROR' } }; } });
    await newServer(app); await app.form().props.onSubmit(event()); await app.settle(); const draft = app.hooks.values().find((value) => value?.timeoutSeconds && value?.label === 'New safe server'); assert.ok(draft);
    assert.equal(Boolean(draft._pendingSave), ['save-state-ambiguous', 'store-write-failed', 'save-cleanup-required'].includes(code)); assert.ok(!JSON.stringify(app.hooks.values()).includes('PRIVATE_SAVE_ERROR')); app.dispose();
  }
});

test('policy opening never clears typed secrets and existing pending secret ledgers survive policy polling', async () => {
  const app = await setup(); await newServer(app); const secret = { value: 'MASKED_WRITE_ONLY_LOCAL' }; app.input('token').props.ref.current = secret;
  await open(app); await app.poll(); assert.equal(secret.value, 'MASKED_WRITE_ONLY_LOCAL'); assert.ok(!JSON.stringify(app.hooks.values()).includes('MASKED_WRITE_ONLY_LOCAL')); app.dispose();
  let state = snapshot({ capabilities: { ...caps, appendSecretsWhileMounted: true } }), committed = false;
  const pending = await setup({ snapshot: state, respond(method, request) {
    if (method === 'setSecret') { state = { ...state, revision: state.revision + 1, vault: { ...state.vault, initialized: true, refs: [...state.vault.refs, request.ref] } }; committed = true; return { ok: true, value: state }; }
    if (method === 'saveAndActivate') return { ok: false, error: { message: 'unknown private failure' } };
    return { ok: true, value: state };
  } });
  await newServer(pending); const token = { value: 'WRITE_ONLY_PRIVATE_TEST' }; pending.input('token').props.ref.current = token; await pending.form().props.onSubmit(event({ token })); await pending.settle();
  assert.equal(committed, true); assert.equal(token.value, '');
  const ledger = pending.hooks.values().find((value) => value?._pendingToken && value?._pendingSave); assert.ok(ledger); const before = plain(ledger);
  const manage = pending.button('policyManage'); assert.equal(manage.props.disabled, true); await manage.props.onClick(); await pending.settle(); await pending.poll();
  assert.deepEqual(plain(pending.hooks.values().find((value) => value?._pendingToken && value?._pendingSave)), before); assert.equal(mutations(pending).filter(({ method }) => method === 'setToolPolicy').length, 0);
  assert.ok(!JSON.stringify(pending.hooks.values()).includes('WRITE_ONLY_PRIVATE_TEST')); pending.dispose();
});
