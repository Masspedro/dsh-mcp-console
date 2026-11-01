// Controller persistence seams are synthetic/in-memory only. Native registration
// and dispatch use real installed Cordis + ToolRuntime + tool-policy adapter.
// No executable, endpoint, profile, filesystem store or real credential is used.
// Run: node --import ./test/register.js --test test/controller-tool-policy.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ConsoleController, validateServer } from '../src/controller.js';
import { ConsoleError } from '../src/storage.js';
import { createToolPolicyScope } from '../src/tool-policy.js';
import { AUTOMATIC_KDF, seal } from '../src/vault.js';
import { makeSchemas, makeRemoteSpec, METHODS, NAMESPACE } from '../src/contract.js';

const owner = { kind: 'owner' };
const A = 'a'.repeat(24), B = 'b'.repeat(24);
const name = (suffix, id = A) => 'mcp__pc_' + id + '__' + suffix;
const siblingName = name('untouched_native_sibling', 'c'.repeat(24));
const secret = 'SYNTHETIC-POLICY-SECRET-NEVER-REAL';
const base = { label: 'Owned controller policy fixture', transport: 'stdio', command: '/synthetic/no-execution', args: [], cwd: '', envRefs: {} };
const config = (id = A, extra = {}) => ({ ...base, id, ...extra });
const data = (servers = [config()], enabledIds = []) => ({ version: 1, revision: 1, servers, enabledIds, vault: null });
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof ConsoleError && error.code === code && error.message === code);
const policy = (mode, names = []) => ({ mode, names });
const definition = (publicName, execute = () => 'owned fixed result') => ({ name: publicName, description: 'Owned fixture description must not appear in snapshot inventory', parameters: { type: 'object', properties: {}, additionalProperties: false }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute });
const nativeNames = ctx => [...ctx.tools.view().visible.keys()].sort();
const callTool = (ctx, publicName) => ctx.tools.execute({ callId: 'owned-controller-policy', name: publicName, arguments: {}, signal: new AbortController().signal });
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

class MemoryStore {
  reads = 0; writes = 0; transactions = 0;
  constructor(value, events) { this.data = structuredClone(value); this.events = events; }
  async read() { this.reads++; this.events.push('read'); return structuredClone(this.data); }
  async write(value) { this.writes++; this.events.push('write'); this.data = structuredClone(value); }
  async transaction(fn) { this.transactions++; this.events.push('lock'); try { return await fn(); } finally { this.events.push('release'); } }
}
function fixture({ value = data(), automaticKey, ...options } = {}) {
  const ctx = new Context();
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 });
  new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 1 });
  ctx.tools.register(definition(siblingName));
  const events = [], mounts = [], store = new MemoryStore(value, events);
  const controller = new ConsoleController({ store, automaticKey, ...options, mount: async resolved => {
    events.push('mount');
    const entry = { resolved, initialResolved: structuredClone(resolved), scope: createToolPolicyScope(ctx, resolved.serverName, resolved.toolPolicy), disposals: 0, businessCalls: 0, failPause: false, failApply: false, failResume: false, failDispose: false };
    const id = resolved.serverName.slice(3);
    for (const suffix of ['blocked', 'alpha']) entry.scope.context.tools.register(definition(name(suffix, id), () => { entry.businessCalls++; return 'owned fixed result'; }));
    entry.handle = {
      initialVerified: true, verifiedAt: 1000 + mounts.length,
      getToolNames: () => entry.scope.getToolNames(), toolsBlocked: () => entry.scope.isBlocked(),
      pauseTools() { events.push('pause'); entry.scope.pause(); if (entry.failPause) throw new Error(secret); },
      applyToolPolicy(value) { events.push('apply'); if (entry.failApply) throw new Error(secret); entry.scope.setPolicy(value); },
      resumeTools() { events.push('resume'); entry.scope.resume(); if (entry.failResume) throw new Error(secret); },
      async dispose() { events.push('dispose'); entry.disposals++; entry.scope.close(); if (entry.failDispose) throw new Error(secret); }
    };
    mounts.push(entry);
    return entry.handle;
  } });
  const invoke = (method, fields = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: store.data?.revision ?? 0, ...fields }, owner);
  const set = value => invoke('setToolPolicy', { id: A, toolPolicy: value });
  const start = (id = A) => invoke('start', { id, confirmation: 'START THIS SERVER' });
  const stop = (id = A) => invoke('stop', { id });
  const cleanup = async () => {
    for (const entry of mounts) { entry.failPause = false; entry.failApply = false; entry.failResume = false; entry.failDispose = false; }
    try { await controller.dispose(); } finally { for (const entry of mounts) entry.scope.close(); await ctx.fiber.dispose(); }
  };
  return { ctx, events, mounts, store, controller, invoke, set, start, stop, cleanup };
}
const rowFor = (snapshot, id = A) => snapshot.servers.find(row => row.config.id === id);

// Legacy records keep defaults implicit in storage/snapshot, only mount config
// resolves the official SDK's 60-second default.
test('legacy omission means all/60000; strict new endpoint/capabilities accept old records without rewriting defaults', async () => {
  const f = fixture();
  try {
    const { schemas, result, server } = makeSchemas(z);
    assert.ok(METHODS.includes('setToolPolicy'));
    assert.ok(makeRemoteSpec(z).methods[NAMESPACE + '/setToolPolicy']);
    assert.equal(schemas.setToolPolicy.safeParse({ revision: 1, id: A, toolPolicy: policy('include') }).success, true);
    assert.equal(server.safeParse(config()).success, true);
    const before = structuredClone(f.store.data);
    const snapshot = await f.invoke('snapshot');
    assert.equal(snapshot.capabilities.toolPolicy, true); assert.equal(snapshot.capabilities.configurableTimeout, true);
    assert.equal(result.safeParse(snapshot).success, true);
    assert.equal(Object.hasOwn(rowFor(snapshot).config, 'toolPolicy'), false);
    assert.equal(Object.hasOwn(rowFor(snapshot).config, 'toolCallTimeoutMs'), false);
    assert.deepEqual(f.store.data, before); assert.equal(f.store.writes, 0); assert.equal(f.mounts.length, 0);
    const on = await f.start();
    assert.equal(f.mounts[0].resolved.toolCallTimeoutMs, 60000);
    assert.equal(Object.hasOwn(f.mounts[0].resolved, 'toolPolicy'), false);
    assert.deepEqual(nativeNames(f.ctx), [name('alpha'), name('blocked'), siblingName].sort());
    assert.equal(rowFor(on).state, 'activation-verified');
    assert.equal(Object.hasOwn(rowFor(on).config, 'toolPolicy'), false);
    assert.equal(Object.hasOwn(rowFor(on).config, 'toolCallTimeoutMs'), false);
    assert.deepEqual(Object.keys(rowFor(on).tools).sort(), ['names', 'source']);
    assert.deepEqual(rowFor(on).tools.names, [name('alpha'), name('blocked')].sort());
    assert.equal(rowFor(on).tools.source, 'mounted');
  } finally { await f.cleanup(); }
});

test('live update pauses native exposure before write/readback and applies/resumes only after exact publication, without remount or config mutation', async () => {
  const f = fixture();
  try {
    await f.start();
    const entry = f.mounts[0], handle = entry.handle, heldTime = f.controller.lastVerifiedAt.get(A);
    const old = f.ctx.tools.get(name('alpha'));
    const before = structuredClone(f.store.data), resolved = entry.resolved;
    const originalWrite = f.store.write.bind(f.store), originalRead = f.store.read.bind(f.store);
    let published = false;
    f.events.length = 0;
    f.store.write = async next => {
      assert.equal(entry.scope.isBlocked(), true);
      assert.deepEqual(nativeNames(f.ctx), [siblingName]);
      assert.deepEqual(rowFor(f.controller.snapshot(f.store.data)).tools.names, [name('alpha'), name('blocked')].sort());
      assert.equal(rowFor(f.controller.snapshot(f.store.data)).state, 'mounted-status-unavailable');
      await assert.rejects(old.execute({}, { signal: new AbortController().signal }), error => error.code === 'invalid-tool-policy');
      assert.equal(next.revision, before.revision + 1); assert.deepEqual(next.enabledIds, before.enabledIds);
      await originalWrite(next); published = true;
    };
    f.store.read = async () => {
      if (published) { assert.equal(entry.scope.isBlocked(), true); assert.deepEqual(nativeNames(f.ctx), [siblingName]); assert.equal(f.events.includes('apply'), false); }
      return originalRead();
    };
    const snapshot = await f.set(policy('exclude', [name('blocked')]));
    assert.deepEqual(f.events, ['lock', 'read', 'pause', 'write', 'read', 'apply', 'resume', 'release']);
    assert.equal(entry.scope.isBlocked(), false);
    assert.deepEqual(nativeNames(f.ctx), [name('alpha'), siblingName].sort());
    assert.equal((await callTool(f.ctx, name('blocked'))).isError, true);
    assert.equal(entry.businessCalls, 0);
    assert.equal(f.mounts.length, 1); assert.equal(entry.disposals, 0); assert.equal(f.controller.live.get(A), handle);
    assert.equal(entry.resolved, resolved); assert.deepEqual(entry.resolved, entry.initialResolved);
    assert.equal(f.controller.lastVerifiedAt.get(A), heldTime);
    assert.equal(rowFor(snapshot).enabled, true); assert.deepEqual(f.store.data.enabledIds, [A]);
    assert.deepEqual(rowFor(snapshot).tools, { names: [name('alpha'), name('blocked')].sort(), source: 'mounted' });
    assert.deepEqual(rowFor(snapshot).config.toolPolicy, policy('exclude', [name('blocked')]));
    assert.equal(Object.hasOwn(rowFor(snapshot).config, 'toolCallTimeoutMs'), false);
  } finally { await f.cleanup(); }
});

for (const boundary of ['write', 'readback']) test('native and retained tool dispatch stay closed while asynchronous policy ' + boundary + ' is in flight', { timeout: 3000 }, async () => {
  const f = fixture(), entered = gate(), release = gate();
  const write = f.store.write.bind(f.store), read = f.store.read.bind(f.store);
  let update;
  try {
    await f.start();
    const entry = f.mounts[0], retained = f.ctx.tools.get(name('alpha'));
    let published = false;
    f.store.write = async next => {
      if (boundary === 'write') { entered.release(); await release.promise; }
      await write(next); published = true;
    };
    f.store.read = async () => {
      if (boundary === 'readback' && published) { entered.release(); await release.promise; }
      return read();
    };
    update = f.set(policy('exclude', [name('blocked')]));
    await entered.promise;
    assert.equal(entry.scope.isBlocked(), true); assert.deepEqual(nativeNames(f.ctx), [siblingName]);
    assert.equal((await callTool(f.ctx, name('alpha'))).isError, true);
    await assert.rejects(retained.execute({}, { signal: new AbortController().signal }), error => error.code === 'invalid-tool-policy');
    assert.equal(entry.businessCalls, 0); assert.equal(f.events.includes('apply'), false); assert.equal(f.events.includes('resume'), false);
    release.release();
    const snapshot = await update;
    assert.equal(rowFor(snapshot).state, 'activation-verified'); assert.equal(entry.scope.isBlocked(), false);
    assert.equal((await callTool(f.ctx, name('alpha'))).isError, false); assert.equal(entry.businessCalls, 1);
    assert.equal((await callTool(f.ctx, name('blocked'))).isError, true); assert.equal(entry.businessCalls, 1);
  } finally { release.release(); await update?.catch(() => {}); f.store.write = write; f.store.read = read; await f.cleanup(); }
});

test('include-empty stays verification-valid and advertises names-only full inventory; unknown future selection never expands to other tools', async () => {
  const f = fixture({ value: data([config(A, { toolPolicy: policy('include') })]) });
  try {
    const initial = await f.start();
    assert.equal(rowFor(initial).state, 'activation-verified'); assert.equal(rowFor(initial).lastVerifiedAt, 1000);
    assert.deepEqual(nativeNames(f.ctx), [siblingName]);
    assert.deepEqual(rowFor(initial).tools.names, [name('alpha'), name('blocked')].sort());
    assert.equal(f.mounts[0].scope.isBlocked(), false);
    const future = name('future');
    const next = await f.set(policy('include', [future]));
    assert.deepEqual(rowFor(next).config.toolPolicy, policy('include', [future]));
    assert.deepEqual(nativeNames(f.ctx), [siblingName]);
    f.mounts[0].scope.context.tools.register(definition(future));
    const snapshot = await f.invoke('snapshot');
    assert.deepEqual(nativeNames(f.ctx), [future, siblingName].sort());
    assert.deepEqual(rowFor(snapshot).tools.names, [name('alpha'), name('blocked'), future].sort());
    assert.equal(Object.hasOwn(rowFor(snapshot).tools, 'descriptions'), false);
    assert.equal(JSON.stringify(snapshot).includes('Owned fixture description'), false);
    assert.equal((await callTool(f.ctx, name('alpha'))).isError, true);
    assert.equal((await callTool(f.ctx, future)).isError, false);
  } finally { await f.cleanup(); }
});

test('all mode removes stored policy instead of adding explicit defaults, preserving timeout and enabled intent', async () => {
  const f = fixture({ value: data([config(A, { toolPolicy: policy('include'), toolCallTimeoutMs: 17000 })]) });
  try {
    await f.start();
    const before = structuredClone(f.store.data);
    const snapshot = await f.set(policy('all'));
    assert.equal(Object.hasOwn(f.store.data.servers[0], 'toolPolicy'), false);
    assert.equal(Object.hasOwn(rowFor(snapshot).config, 'toolPolicy'), false);
    assert.equal(rowFor(snapshot).config.toolCallTimeoutMs, 17000);
    assert.deepEqual(f.store.data.enabledIds, before.enabledIds);
    assert.equal(rowFor(snapshot).enabled, true);
    assert.equal(f.mounts.length, 1);
    assert.deepEqual(nativeNames(f.ctx), [name('alpha'), name('blocked'), siblingName].sort());
    assert.deepEqual(f.mounts[0].resolved, f.mounts[0].initialResolved, 'live native resolved config is never edited');
  } finally { await f.cleanup(); }
});

test('offline policy updates are metadata-only and retain enabled intent without any native/key/mount IO', async () => {
  for (const enabledIds of [[], [A]]) {
    let keyCalls = 0;
    const f = fixture({ value: data([config()], enabledIds), automaticKey: async () => { keyCalls++; throw new Error(secret); } });
    try {
      const before = structuredClone(f.store.data);
      const snapshot = await f.set(policy('exclude', [name('blocked'), name('future')]));
      assert.equal(f.mounts.length, 0); assert.equal(keyCalls, 0);
      assert.deepEqual(f.store.data.enabledIds, before.enabledIds); assert.equal(rowFor(snapshot).enabled, enabledIds.includes(A));
      assert.deepEqual(f.store.data.servers[0].toolPolicy, policy('exclude', [name('blocked'), name('future')]));
      assert.deepEqual(nativeNames(f.ctx), [siblingName]);
      assert.deepEqual(rowFor(snapshot).tools, { names: [], source: 'unavailable' });
      assert.deepEqual(f.events, ['lock', 'read', 'write', 'read', 'release']);
      await f.set(policy('all')); assert.equal(Object.hasOwn(f.store.data.servers[0], 'toolPolicy'), false);
    } finally { await f.cleanup(); }
  }
});

test('policy ownership, strict public names, duplicate/limit bounds and principals fail before persistence or gating', async () => {
  const f = fixture();
  try {
    await f.start();
    const writes = f.store.writes, count = f.events.length;
    for (const who of [undefined, { kind: 'remote' }, { kind: 'worker' }]) {
      await rejects(f.controller.invoke('setToolPolicy', { revision: f.store.data.revision, id: A, toolPolicy: policy('include') }, who), 'owner-required');
    }
    for (const bad of [policy('all', [name('alpha')]), policy('include', [name('alpha'), name('alpha')]), policy('include', ['alpha']), policy('include', [name('bad name')]), policy('include', [name('x'.repeat(65))]), policy('include', Array.from({ length: 513 }, (_v, i) => name('t' + i))), { mode: 'include', names: [], extra: true }]) await rejects(f.set(bad), 'invalid-input');
    assert.equal(f.events.length, count, 'schema/principal rejection is pre-IO');
    await rejects(f.set(policy('include', [name('alpha', B)])), 'invalid-tool-policy');
    await rejects(f.invoke('setToolPolicy', { id: B, toolPolicy: policy('include') }), 'not-owned');
    await rejects(f.invoke('setToolPolicy', { revision: 0, id: A, toolPolicy: policy('include') }), 'revision-conflict');
    assert.equal(f.store.writes, writes); assert.equal(f.events.includes('pause'), false);
    assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].scope.isBlocked(), false);
    assert.deepEqual(nativeNames(f.ctx), [name('alpha'), name('blocked'), siblingName].sort());
    assert.throws(() => validateServer(config(A, { toolPolicy: policy('include', [name('alpha', B)]) })), error => error.code === 'invalid-tool-policy');
  } finally { await f.cleanup(); }
});

test('new no-ID Save cannot persist selected names from another namespace after allocating its owned id', async () => {
  const f = fixture({ value: data([]) });
  try {
    const before = structuredClone(f.store.data), writes = f.store.writes;
    for (const mode of ['include', 'exclude']) {
      await rejects(f.invoke('save', { server: { ...base, toolPolicy: policy(mode, [name('alpha')]) } }), 'invalid-tool-policy');
      assert.deepEqual(f.store.data, before); assert.equal(f.store.writes, writes); assert.equal(f.mounts.length, 0);
    }
    const saved = await f.invoke('save', { server: { ...base, toolPolicy: policy('include') } });
    assert.equal(saved.servers.length, 1); assert.deepEqual(saved.servers[0].config.toolPolicy, policy('include'));
    assert.equal((await f.invoke('snapshot')).servers.length, 1, 'generated-id empty policy remains a valid saved store');
  } finally { await f.cleanup(); }
});

test('mounted credential policy update does not reopen/reseal vault, remount, or change plaintext/native config bindings', async () => {
  const key = Buffer.alloc(32, 0x37), keyCalls = [];
  const value = data([config(A, { envRefs: { OWNED_TOKEN: 'token' }, toolCallTimeoutMs: 11000 })]);
  value.vault = seal({ token: secret }, key, Buffer.alloc(16, 0x42), AUTOMATIC_KDF);
  const f = fixture({ value, automaticKey: async options => { keyCalls.push(options); return Buffer.from(key); } });
  try {
    await f.start();
    const calls = keyCalls.length, vault = structuredClone(f.store.data.vault), oldKey = f.controller.key, oldSecrets = f.controller.secrets, oldEnvelope = f.controller.envelope;
    const held = f.mounts[0].resolved;
    assert.equal(held.env.OWNED_TOKEN, secret);
    const snapshot = await f.set(policy('include', [name('alpha')]));
    assert.equal(keyCalls.length, calls); assert.equal(f.controller.key, oldKey); assert.equal(f.controller.secrets, oldSecrets); assert.equal(f.controller.envelope, oldEnvelope);
    assert.deepEqual(f.store.data.vault, vault); assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].disposals, 0);
    assert.equal(f.mounts[0].resolved, held); assert.deepEqual(held, f.mounts[0].initialResolved); assert.equal(held.env.OWNED_TOKEN, secret);
    assert.equal(rowFor(snapshot).config.toolCallTimeoutMs, 11000); assert.deepEqual(rowFor(snapshot).config.envRefs, { OWNED_TOKEN: 'token' });
    assert.equal(JSON.stringify(snapshot).includes(secret), false); assert.deepEqual(snapshot.vault.refs, ['token']);
    assert.equal(rowFor(snapshot).enabled, true);
  } finally { await f.cleanup(); key.fill(0); }
});

for (const fault of ['write-before', 'write-after', 'readback-throw', 'readback-mismatch', 'release']) test('live policy ' + fault + ' failure quarantines closed dispatch, suppresses green verification and requires successful OFF to recover', async () => {
  const f = fixture();
  const write = f.store.write.bind(f.store), read = f.store.read.bind(f.store), transaction = f.store.transaction.bind(f.store);
  try {
    await f.start();
    const handle = f.mounts[0].handle, entry = f.mounts[0], before = structuredClone(f.store.data), retained = f.ctx.tools.get(name('alpha'));
    let afterWrite = false;
    if (fault === 'write-before') f.store.write = async () => { assert.equal(entry.scope.isBlocked(), true); throw new Error(secret); };
    if (fault === 'write-after') f.store.write = async next => { await write(next); throw new Error(secret); };
    if (fault.startsWith('readback')) {
      f.store.write = async next => { await write(next); afterWrite = true; };
      f.store.read = async () => { if (afterWrite) { if (fault === 'readback-throw') throw new Error(secret); return { ...structuredClone(f.store.data), revision: f.store.data.revision + 1 }; } return read(); };
    }
    if (fault === 'release') f.store.transaction = async fn => { await transaction(fn); throw new Error(secret); };
    f.events.length = 0;
    await rejects(f.set(policy('include')), 'tool-policy-state-ambiguous');
    assert.equal(entry.scope.isBlocked(), true); assert.deepEqual(nativeNames(f.ctx), [siblingName]);
    assert.equal(f.controller.live.get(A), handle); assert.equal(entry.disposals, 0); assert.equal(f.mounts.length, 1);
    assert.equal(f.controller.toolPolicyStateAmbiguous.has(A), true); assert.equal(f.controller.lastVerifiedAt.has(A), false);
    assert.deepEqual(f.store.data.enabledIds, before.enabledIds);
    await assert.rejects(retained.execute({}, { signal: new AbortController().signal }), error => error.code === 'invalid-tool-policy');
    assert.equal(entry.businessCalls, 0);
    if (fault !== 'release') { assert.equal(f.events.includes('apply'), false); assert.equal(f.events.includes('resume'), false); }
    else assert.deepEqual(f.events.slice(-3), ['resume', 'release', 'pause']);
    f.store.write = write; f.store.read = read; f.store.transaction = transaction;
    const snapshot = await f.invoke('snapshot'), row = rowFor(snapshot);
    assert.equal(row.state, 'mounted-status-unavailable'); assert.equal(Object.hasOwn(row, 'lastVerifiedAt'), false);
    assert.equal(row.lastFailure, 'tool-policy-state-ambiguous'); assert.equal(row.enabled, true);
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    const writes = f.store.writes;
    await rejects(f.set(policy('all')), 'tool-policy-state-ambiguous');
    assert.equal(f.store.writes, writes); assert.equal(entry.scope.isBlocked(), true);
    const off = await f.stop();
    assert.equal(rowFor(off).enabled, false); assert.equal(f.controller.toolPolicyStateAmbiguous.has(A), false);
    assert.equal(f.controller.live.has(A), false); assert.equal(entry.disposals, 1);
    await f.set(policy('all'));
    const recovered = await f.start();
    assert.equal(f.mounts.length, 2); assert.equal(rowFor(recovered).state, 'activation-verified'); assert.equal(rowFor(recovered).lastVerifiedAt, 1001);
    assert.deepEqual(nativeNames(f.ctx), [name('alpha'), name('blocked'), siblingName].sort());
  } finally { f.store.write = write; f.store.read = read; f.store.transaction = transaction; await f.cleanup(); }
});

for (const fault of ['apply', 'resume', 'pause']) test('native policy ' + fault + ' exception leaves the gate closed and never returns activation-verified evidence', async () => {
  const f = fixture();
  try {
    await f.start(); const entry = f.mounts[0], writes = f.store.writes;
    entry['fail' + fault[0].toUpperCase() + fault.slice(1)] = true;
    await rejects(f.set(policy('include')), 'tool-policy-apply-failed');
    assert.equal(entry.scope.isBlocked(), true); assert.deepEqual(nativeNames(f.ctx), [siblingName]);
    assert.equal(f.mounts.length, 1); assert.equal(entry.disposals, 0);
    assert.equal(f.store.writes, writes + (fault === 'pause' ? 0 : 1));
    assert.deepEqual(f.store.data.enabledIds, [A]);
    const row = rowFor(await f.invoke('snapshot'));
    assert.equal(row.state, 'mounted-status-unavailable'); assert.equal(row.lastFailure, 'tool-policy-apply-failed'); assert.equal(Object.hasOwn(row, 'lastVerifiedAt'), false);
    entry.failPause = false; entry.failApply = false; entry.failResume = false;
    await f.stop(); await f.set(policy('all')); await f.start();
    assert.equal(rowFor(await f.invoke('snapshot')).state, 'activation-verified');
  } finally { await f.cleanup(); }
});

test('quarantined live policy cannot bypass explicit OFF via reconnect or via delete/edit/remount paths', async () => {
  const f = fixture(); const write = f.store.write.bind(f.store);
  try {
    await f.start();
    f.store.write = async () => { throw new Error(secret); };
    await rejects(f.set(policy('include')), 'tool-policy-state-ambiguous');
    f.store.write = write;
    const writes = f.store.writes;
    await rejects(f.invoke('reconnect', { id: A, confirmation: 'RECONNECT THIS SERVER' }), 'tool-policy-state-ambiguous');
    assert.equal(f.store.writes, writes); assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].disposals, 0);
    await rejects(f.invoke('saveAndActivate', { server: config(), confirmation: 'SAVE AND ACTIVATE THIS SERVER' }), 'stop-before-edit');
    await rejects(f.invoke('deleteServer', { id: A }), 'stop-before-delete');
    assert.equal(f.mounts[0].scope.isBlocked(), true);
    await f.stop(); await f.start(); assert.equal(f.mounts.length, 2);
  } finally { f.store.write = write; await f.cleanup(); }
});

test('offline publication ambiguity also quarantines start until successful OFF; failed OFF does not clear quarantine', async () => {
  const f = fixture(); const write = f.store.write.bind(f.store);
  try {
    f.store.write = async () => { throw new Error(secret); };
    await rejects(f.set(policy('include')), 'tool-policy-state-ambiguous');
    assert.equal(f.controller.toolPolicyStateAmbiguous.has(A), true); assert.equal(f.mounts.length, 0);
    await rejects(f.stop(), 'operation-failed');
    assert.equal(f.controller.toolPolicyStateAmbiguous.has(A), true);
    f.store.write = write;
    await rejects(f.start(), 'tool-policy-state-ambiguous');
    assert.equal(f.mounts.length, 0);
    await f.stop(); assert.equal(f.controller.toolPolicyStateAmbiguous.has(A), false);
    await f.start(); assert.equal(f.mounts.length, 1);
  } finally { f.store.write = write; await f.cleanup(); }
});

test('offline quarantine guards legacy Save, SaveAndActivate, reconnect and startup until durable explicit OFF', async () => {
  const f = fixture({ value: data([config()], [A]) });
  const write = f.store.write.bind(f.store);
  try {
    f.store.write = async () => { throw new Error(secret); };
    await rejects(f.set(policy('include')), 'tool-policy-state-ambiguous');
    f.store.write = write;
    const writes = f.store.writes;
    await rejects(f.invoke('save', { server: config(A, { label: 'Edited but still quarantined' }) }), 'tool-policy-state-ambiguous');
    await rejects(f.invoke('saveAndActivate', { server: config(), confirmation: 'SAVE AND ACTIVATE THIS SERVER' }), 'tool-policy-state-ambiguous');
    await rejects(f.invoke('reconnect', { id: A, confirmation: 'RECONNECT THIS SERVER' }), 'tool-policy-state-ambiguous');
    await f.controller.startup();
    assert.equal(f.mounts.length, 0); assert.equal(f.store.writes, writes); assert.deepEqual(f.store.data.enabledIds, [A]);
    const snapshot = await f.invoke('snapshot');
    assert.equal(rowFor(snapshot).state, 'disabled'); assert.equal(rowFor(snapshot).enabled, true);
    assert.equal(rowFor(snapshot).lastFailure, 'tool-policy-state-ambiguous'); assert.equal(Object.hasOwn(rowFor(snapshot), 'lastVerifiedAt'), false);
    await f.stop();
    assert.equal(f.controller.toolPolicyStateAmbiguous.has(A), false); assert.deepEqual(f.store.data.enabledIds, []);
    await f.invoke('save', { server: config(A, { label: 'Edited after durable OFF' }) });
    await f.start(); assert.equal(f.mounts.length, 1); assert.equal(rowFor(await f.invoke('snapshot')).state, 'activation-verified');
  } finally { f.store.write = write; await f.cleanup(); }
});

test('failed live OFF teardown retains policy quarantine and handle ownership; only successful subsequent OFF recovers', async () => {
  const f = fixture(), write = f.store.write.bind(f.store);
  try {
    await f.start(); const entry = f.mounts[0];
    f.store.write = async () => { throw new Error(secret); };
    await rejects(f.set(policy('include')), 'tool-policy-state-ambiguous');
    f.store.write = write; entry.failDispose = true;
    await rejects(f.stop(), 'stop-failed');
    assert.equal(f.controller.toolPolicyStateAmbiguous.has(A), true);
    assert.equal(f.controller.live.get(A), entry.handle); assert.equal(entry.disposals, 1);
    assert.deepEqual(f.store.data.enabledIds, []); assert.equal(entry.scope.isBlocked(), true);
    const row = rowFor(await f.invoke('snapshot'));
    assert.equal(row.state, 'stop-failed'); assert.equal(row.enabled, false); assert.equal(Object.hasOwn(row, 'lastVerifiedAt'), false);
    await rejects(f.set(policy('all')), 'tool-policy-state-ambiguous');
    await rejects(f.invoke('reconnect', { id: A, confirmation: 'RECONNECT THIS SERVER' }), 'tool-policy-state-ambiguous');
    entry.failDispose = false;
    await f.stop(); assert.equal(entry.disposals, 2); assert.equal(f.controller.live.has(A), false); assert.equal(f.controller.toolPolicyStateAmbiguous.has(A), false);
    await f.set(policy('all')); await f.start(); assert.equal(f.mounts.length, 2);
    assert.equal(rowFor(await f.invoke('snapshot')).state, 'activation-verified');
  } finally { f.store.write = write; await f.cleanup(); }
});

test('missing live policy API fails before write and preserves existing verification/tools without remounting', async () => {
  const f = fixture();
  try {
    await f.start(); const entry = f.mounts[0], writes = f.store.writes, before = structuredClone(f.store.data);
    delete entry.handle.applyToolPolicy;
    await rejects(f.set(policy('include')), 'tool-policy-unavailable');
    assert.equal(f.store.writes, writes); assert.deepEqual(f.store.data, before);
    assert.equal(entry.scope.isBlocked(), false); assert.deepEqual(nativeNames(f.ctx), [name('alpha'), name('blocked'), siblingName].sort());
    assert.equal(rowFor(await f.invoke('snapshot')).state, 'activation-verified');
    assert.equal(entry.disposals, 0); assert.equal(f.mounts.length, 1);
  } finally { await f.cleanup(); }
});

test('inventory remains names-only mounted/last-known and rejects malformed, foreign or oversized adapter metadata', async () => {
  const f = fixture();
  try {
    await f.start(); const entry = f.mounts[0];
    for (const malformed of [[{ name: name('alpha'), description: secret }], [name('alpha'), name('alpha')], [name('alpha', B)], Array.from({ length: 513 }, (_v, i) => name('t' + i)), 'not an array']) {
      entry.handle.getToolNames = () => malformed;
      const snapshot = await f.invoke('snapshot');
      assert.deepEqual(rowFor(snapshot).tools, { names: [], source: 'unavailable' });
      assert.equal(JSON.stringify(snapshot).includes(secret), false);
    }
    entry.handle.getToolNames = () => entry.scope.getToolNames();
    await f.set(policy('include'));
    assert.deepEqual(rowFor(await f.invoke('snapshot')).tools, { names: [name('alpha'), name('blocked')].sort(), source: 'mounted' });
    await f.stop();
    const snapshot = await f.invoke('snapshot');
    assert.deepEqual(rowFor(snapshot).tools, { names: [name('alpha'), name('blocked')].sort(), source: 'last-known' });
    assert.equal(Object.hasOwn(rowFor(snapshot).tools, 'schema'), false);
    assert.deepEqual(nativeNames(f.ctx), [siblingName]);
  } finally { await f.cleanup(); }
});

test('configurable timeout validates exact integer bounds, propagates default/custom to both transports, and stays absent when unspecified', async () => {
  const http = { id: A, label: 'Owned timeout HTTP metadata only', transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: {} };
  for (const value of [undefined, 1000, 12345, 3600000]) {
    for (const transport of [config(), http]) {
      const server = { ...transport, ...(value === undefined ? {} : { toolCallTimeoutMs: value }) };
      const f = fixture({ value: data([server]) });
      try {
        const snapshot = await f.start();
        assert.equal(f.mounts[0].resolved.toolCallTimeoutMs, value ?? 60000);
        assert.equal(Object.hasOwn(rowFor(snapshot).config, 'toolCallTimeoutMs'), value !== undefined);
        if (value !== undefined) assert.equal(rowFor(snapshot).config.toolCallTimeoutMs, value);
        assert.equal(Object.hasOwn(rowFor(snapshot).config, 'toolPolicy'), false);
        assert.equal(f.mounts[0].resolved.transport, transport.transport);
      } finally { await f.cleanup(); }
    }
  }
  for (const value of [0, 999, 3600001, -1, 1000.5, Infinity, NaN, '60000', null]) assert.throws(() => validateServer(config(A, { toolCallTimeoutMs: value })), error => error.code === 'invalid-input');
});
