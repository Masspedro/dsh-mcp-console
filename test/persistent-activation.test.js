// Synthetic backend seams only: no endpoint, executable, credential or real store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { ConsoleController } from '../src/controller.js';
import { ConsoleError } from '../src/storage.js';
import { makeSchemas, METHODS, makeRemoteSpec } from '../src/contract.js';
import { AUTOMATIC_KDF, seal } from '../src/vault.js';

const owner = { kind: 'owner' };
const A = 'a'.repeat(24), B = 'b'.repeat(24);
const base = { label: 'Synthetic persistent activation', transport: 'stdio', command: '/synthetic/no-execution', args: [], cwd: '', envRefs: {} };
const token = 'SYNTHETIC-PERSISTENCE-TOKEN-NEVER-REAL';
const passphrase = 'SYNTHETIC-PERSISTENCE-PASSPHRASE';
const config = (id, extra = {}) => ({ ...base, id, ...extra });
const data = (servers = [config(A)], enabledIds = []) => ({ version: 1, revision: 1, servers, vault: null, enabledIds });
const reject = (promise, code) => assert.rejects(promise, error => error.code === code && error.message === code);
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
class MemoryStore {
  data = null; reads = 0; startupReads = 0; writes = 0; transactions = 0;
  constructor(value = null) { this.data = structuredClone(value); }
  async read() { this.reads++; return structuredClone(this.data); }
  async readForStartup() { this.startupReads++; return this.read(); }
  async write(value) { this.writes++; this.data = structuredClone(value); }
  async transaction(fn) { this.transactions++; return fn(); }
}
function fixture({ store = new MemoryStore(), mount, ...options } = {}) {
  const mounts = []; let toolsCalled = 0;
  const controller = new ConsoleController({ store, mount: async settings => {
    const call = { settings, disposals: 0 }; mounts.push(call);
    if (mount) { call.handle = await mount(settings, call); return call.handle; }
    call.handle = { initialVerified: true, verifiedAt: 42 + mounts.length, tool: () => { toolsCalled++; }, dispose: async () => { call.disposals++; } };
    return call.handle;
  }, ...options });
  const invoke = (method, fields = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: store.data?.revision ?? 0, ...fields }, owner);
  return { store, controller, mounts, invoke, toolsCalled: () => toolsCalled };
}
const on = (f, id = A) => f.invoke('start', { id, confirmation: 'START THIS SERVER' });
const off = (f, id = A) => f.invoke('stop', { id });

test('optional persistentActivation is literal true, enabled is boolean, cap requires every row, legacy output remains accepted', async () => {
  const { result, schemas } = makeSchemas(z); const f = fixture({ store: new MemoryStore(data()) });
  const snapshot = await f.invoke('snapshot'); assert.equal(result.safeParse(snapshot).success, true);
  assert.equal(snapshot.capabilities.persistentActivation, true); assert.equal(snapshot.servers[0].enabled, false);
  assert.equal(Object.hasOwn(snapshot.servers[0].config, 'enabled'), false);
  const legacy = structuredClone(snapshot); delete legacy.capabilities; delete legacy.servers[0].enabled;
  assert.equal(result.safeParse(legacy).success, true);
  assert.equal(result.safeParse({ ...legacy, capabilities: { saveAndActivate: true } }).success, true);
  assert.equal(result.safeParse({ ...legacy, capabilities: { saveAndActivate: true, persistentActivation: true } }).success, false);
  for (const value of [false, 'true', 1, null]) assert.equal(result.safeParse({ ...snapshot, capabilities: { saveAndActivate: true, persistentActivation: value } }).success, false);
  for (const value of ['false', 0, null, undefined]) {
    const malformed = structuredClone(snapshot); malformed.servers[0].enabled = value;
    assert.equal(result.safeParse(malformed).success, false);
  }
  const mixed = structuredClone(snapshot); mixed.servers.push({ ...structuredClone(mixed.servers[0]), config: config(B), serverName: 'pc_' + B }); delete mixed.servers[1].enabled;
  assert.equal(result.safeParse(mixed).success, false);
  assert.equal(result.safeParse({ ...snapshot, capabilities: { ...snapshot.capabilities, autostart: true } }).success, false);
  assert.equal(METHODS.length, 13); assert.equal(Object.keys(makeRemoteSpec(z).methods).length, 13);
  assert.equal(METHODS.includes('startup'), false); assert.equal(Object.hasOwn(schemas, 'startup'), false);
  for (const method of ['start', 'reconnect', 'stop']) {
    const request = { revision: 1, id: A, ...(method === 'start' ? { confirmation: 'START THIS SERVER' } : method === 'reconnect' ? { confirmation: 'RECONNECT THIS SERVER' } : {}) };
    assert.equal(schemas[method].safeParse(request).success, true);
    for (const name of ['enabled', 'enabledIds', 'persistentActivation', 'autostart']) assert.equal(schemas[method].safeParse({ ...request, [name]: true }).success, false);
  }
  await f.controller.dispose();
});

for (const kind of ['missing', 'legacy', 'disabled']) test(kind + ' startup does only one private metadata read, no IO/mount/key/writes/timers', async () => {
  const value = kind === 'missing' ? null : data(); if (kind === 'legacy') delete value.enabledIds;
  const f = fixture({ store: new MemoryStore(value), automaticKey: () => assert.fail('no key IO'), mount: () => assert.fail('no mount'), setTimer: () => assert.fail('no timer') });
  await f.controller.startup(); assert.equal(f.store.reads, 1); assert.equal(f.store.startupReads, 1); assert.equal(f.store.transactions, 0); assert.equal(f.store.writes, 0);
  assert.deepEqual(f.store.data, value); await f.controller.startup(); assert.equal(f.store.reads, 1); await f.controller.dispose();
});

test('OFF is durable before teardown and a fresh controller restores nothing', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); const started = await on(f);
  assert.equal(started.servers[0].enabled, true); assert.deepEqual(f.store.data.enabledIds, [A]);
  f.mounts[0].handle.dispose = async () => { assert.deepEqual(f.store.data.enabledIds, []); f.mounts[0].disposals++; };
  const stopped = await off(f); assert.equal(stopped.servers[0].enabled, false); assert.equal(stopped.servers[0].state, 'unmounted-shutdown-unverified');
  const before = structuredClone(f.store.data); const restart = fixture({ store: f.store, mount: () => assert.fail('OFF must not restore') });
  await restart.controller.startup(); assert.deepEqual(f.store.data, before); assert.equal(restart.mounts.length, 0);
  await restart.controller.dispose(); await f.controller.dispose();
});

test('ON and disposal preserve durable intent; fresh idempotent startup verifies exactly once with no business-tool calls', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); await on(f); const before = structuredClone(f.store.data);
  await f.controller.dispose(); assert.deepEqual(f.store.data, before);
  const restart = fixture({ store: f.store }); const first = restart.controller.startup(); assert.equal(first, restart.controller.startup());
  await first; await restart.controller.startup(); assert.equal(restart.mounts.length, 1); assert.equal(restart.toolsCalled(), 0);
  const snapshot = await restart.invoke('snapshot'); assert.equal(snapshot.servers[0].enabled, true); assert.equal(snapshot.servers[0].state, 'activation-verified'); assert.equal(snapshot.servers[0].lastVerifiedAt, 43);
  assert.equal(restart.mounts[0].settings.failOnStartupError, true); assert.equal(restart.mounts[0].settings.reconnect.enabled, false);
  assert.deepEqual(f.store.data, before); await restart.controller.dispose(); assert.deepEqual(f.store.data, before);
});

test('saveAndActivate only enables after genuine verification and exact saved publication', async () => {
  const f = fixture(); let observedWrite = false; const write = f.store.write.bind(f.store);
  f.store.write = async value => { assert.equal(f.mounts[0].handle.initialVerified, true); assert.deepEqual(value.enabledIds, [value.servers[0].id]); observedWrite = true; return write(value); };
  const saved = await f.invoke('saveAndActivate', { server: base, confirmation: 'SAVE AND ACTIVATE THIS SERVER' });
  assert.equal(observedWrite, true); assert.equal(saved.servers[0].enabled, true); assert.deepEqual(f.store.data.enabledIds, [saved.servers[0].config.id]); await f.controller.dispose();
  for (const failure of ['reject', 'unverified']) {
    const broken = fixture({ mount: async () => { if (failure === 'reject') throw new Error(token); return { initialVerified: false, dispose: async () => {} }; } });
    await reject(broken.invoke('saveAndActivate', { server: base, confirmation: 'SAVE AND ACTIVATE THIS SERVER' }), 'mount-failed');
    assert.equal(broken.store.data, null); assert.equal(broken.store.writes, 0); await broken.controller.dispose();
  }
});

test('metadata Save never enables, leaves unchanged approval, and clears enabled preference on every changed config', async () => {
  const f = fixture({ store: new MemoryStore(data([config(A)], [A])) });
  const unchanged = await f.invoke('save', { server: config(A) }); assert.equal(unchanged.servers[0].enabled, true); assert.equal(f.mounts.length, 0);
  const changed = await f.invoke('save', { server: config(A, { command: '/synthetic/changed' }) });
  assert.equal(changed.servers[0].enabled, false); assert.deepEqual(f.store.data.enabledIds, []);
  await f.invoke('save', { server: base }); assert.deepEqual(f.store.data.enabledIds, []);
  await f.controller.startup(); assert.equal(f.mounts.length, 0);
  f.store.data.enabledIds = [A]; await f.invoke('deleteServer', { id: A }); assert.deepEqual(f.store.data.enabledIds, []); assert.equal(f.store.data.servers.some(row => row.id === A), false);
  await f.controller.dispose();
});

test('failed explicit ON and startup preserve enabled intent, generic mount-failed, and sibling progress', async () => {
  const f = fixture({ store: new MemoryStore(data([config(A), config(B)])), mount: async () => { throw new Error(token); } });
  await reject(on(f), 'mount-failed'); assert.deepEqual(f.store.data.enabledIds, [A]); assert.equal((await f.invoke('snapshot')).servers[0].enabled, true);
  f.store.data.enabledIds = [A, B]; const before = structuredClone(f.store.data);
  const restart = fixture({ store: f.store, mount: async (settings, call) => { if (settings.serverName === 'pc_' + A) throw new Error(token); return { initialVerified: true, verifiedAt: 100, dispose: async () => { call.disposals++; } }; } });
  await restart.controller.startup(); assert.equal(restart.mounts.length, 2); assert.deepEqual(f.store.data, before);
  const result = await restart.invoke('snapshot'); assert.deepEqual(result.servers.map(row => [row.enabled, row.state]), [[true, 'mount-failed'], [true, 'activation-verified']]); assert.ok(!JSON.stringify(result).includes(token));
  await restart.controller.startup(); assert.equal(restart.mounts.length, 2); await restart.controller.dispose(); await f.controller.dispose();
});

test('automatic encrypted bindings rehydrate existing key only, no startup store changes or secret output', async () => {
  const key = Buffer.alloc(32, 7); const value = data([config(A, { envRefs: { API_TOKEN: 'token' } })], [A]); value.vault = seal({ token }, key, Buffer.alloc(16, 3), AUTOMATIC_KDF);
  const keyCalls = []; const returned = []; const f = fixture({ store: new MemoryStore(value), automaticKey: async options => { keyCalls.push(options); const bytes = Buffer.from(key); returned.push(bytes); return bytes; } });
  const before = structuredClone(f.store.data); await f.controller.startup(); assert.deepEqual(keyCalls, [{ create: false }]); assert.equal(f.mounts[0].settings.env.API_TOKEN, token);
  const snapshot = f.controller.snapshot(f.store.data); assert.equal(snapshot.servers[0].state, 'activation-verified'); assert.ok(!JSON.stringify(snapshot).includes(token)); assert.ok(!JSON.stringify(f.store.data).includes(token));
  assert.deepEqual(f.store.data, before); assert.equal(f.store.writes, 0); assert.equal(f.store.transactions, 0); await f.controller.dispose(); assert.ok(returned.every(bytes => bytes.every(byte => byte === 0))); key.fill(0);
});

test('manual vault startup stays locked with no automatic key, unlock, passphrase persistence or migration', async () => {
  const store = new MemoryStore(); const manual = fixture({ store }); await manual.invoke('initializeVault', { passphrase }); await manual.invoke('unlock', { passphrase, ttlSeconds: 30 });
  await manual.invoke('setSecret', { ref: 'token', value: token }); const id = (await manual.invoke('save', { server: { ...base, envRefs: { API_TOKEN: 'token' } } })).servers[0].config.id;
  await on(manual, id); await manual.controller.dispose(); const before = structuredClone(store.data);
  const restart = fixture({ store, automaticKey: () => assert.fail('manual vault never reads automatic key'), setTimer: () => assert.fail('startup must not unlock'), mount: () => assert.fail('locked refs cannot mount') });
  await restart.controller.startup(); const snapshot = await restart.invoke('snapshot'); assert.equal(snapshot.vault.mode, 'passphrase'); assert.equal(snapshot.vault.locked, true);
  assert.equal(snapshot.servers[0].enabled, true); assert.equal(snapshot.servers[0].state, 'mount-failed'); assert.equal(restart.controller.key, null); assert.deepEqual(store.data, before); assert.ok(!JSON.stringify(store.data).includes(passphrase)); await restart.controller.dispose();
});

for (const enabledIds of [true, 'a'.repeat(24), null, undefined, [A, A], [B], ['A'.repeat(24)], [1], [null], [{}], Array(1), Array(33).fill(A)]) test('strict persisted enabledIds rejects malformed value ' + JSON.stringify(enabledIds), async () => {
  const f = fixture({ store: new MemoryStore(data()) }); f.store.data.enabledIds = enabledIds;
  await reject(f.controller.startup(), 'store-invalid'); await reject(f.invoke('snapshot'), 'store-invalid'); assert.equal(f.store.writes, 0); assert.equal(f.store.transactions, 0); assert.equal(f.mounts.length, 0); await f.controller.dispose();
});
for (const mutate of [value => { value.extra = true; }, value => { value.enabled = true; }, value => { delete value.vault; }, value => { value.version = 2; }]) test('strict top-level store shape rejects extra or missing metadata', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); mutate(f.store.data); await reject(f.controller.startup(), 'store-invalid'); assert.equal(f.mounts.length, 0); await f.controller.dispose();
});

test('stale/worker/input/unknown target guards retain identical no-IO and no-cleanup protections', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); await on(f); const before = structuredClone(f.store.data); const reads = f.store.reads, writes = f.store.writes, transactions = f.store.transactions;
  for (const method of ['start', 'reconnect', 'stop']) {
    const confirmation = method === 'start' ? 'START THIS SERVER' : method === 'reconnect' ? 'RECONNECT THIS SERVER' : undefined;
    const request = { revision: before.revision, id: A, ...(confirmation ? { confirmation } : {}) };
    await reject(f.controller.invoke(method, request, { kind: 'worker' }), 'owner-required');
    await reject(f.controller.invoke(method, { ...request, enabled: false }, owner), 'invalid-input');
  }
  assert.equal(f.store.reads, reads); assert.equal(f.store.writes, writes); assert.equal(f.store.transactions, transactions);
  await reject(f.controller.invoke('stop', { revision: before.revision - 1, id: A }, owner), 'revision-conflict'); await reject(off(f, B), 'not-owned');
  assert.equal(f.mounts[0].disposals, 0); assert.equal(f.mounts.length, 1); assert.deepEqual(f.store.data, before); await f.controller.dispose();
});

test('startup yields queue boundaries so OFF/delete/config edit suppress later candidates without key IO or mount', async () => {
  for (const method of ['stop', 'deleteServer', 'save']) {
    const entered = gate(), release = gate(); const f = fixture({ store: new MemoryStore(data([config(A), config(B)], [A, B])), mount: async (_settings, call) => { entered.release(); await release.promise; return { initialVerified: true, verifiedAt: 1, dispose: async () => { call.disposals++; } }; } });
    const startup = f.controller.startup(); await entered.promise;
    const mutation = f.invoke(method, method === 'save' ? { server: config(B, { command: '/synthetic/changed' }) } : { id: B });
    release.release(); await mutation; await startup; assert.equal(f.mounts.length, 1); assert.equal(f.controller.live.has(B), false); assert.equal(f.store.data.enabledIds.includes(B), false); await f.controller.dispose();
  }
});

for (const race of ['disable', 'delete', 'config', 'revision', 'vault']) test('startup late ' + race + ' change disposes only its provisional mount and cannot publish activation', async () => {
  const value = data([config(A), config(B)], [A, B]); const f = fixture({ store: new MemoryStore(value), mount: async (settings, call) => {
    if (settings.serverName === 'pc_' + A) {
      if (race === 'disable') f.store.data.enabledIds = [B];
      if (race === 'delete') { f.store.data.servers = [config(B)]; f.store.data.enabledIds = [B]; }
      if (race === 'config') { f.store.data.servers[0].command = '/synthetic/changed'; f.store.data.enabledIds = [B]; }
      if (race === 'vault') f.store.data.vault = seal({}, Buffer.alloc(32, 7), Buffer.alloc(16, 2), AUTOMATIC_KDF);
      f.store.data.revision++;
    }
    return { initialVerified: true, verifiedAt: 1, dispose: async () => { call.disposals++; } };
  } });
  await f.controller.startup(); assert.equal(f.mounts[0].disposals, 1); assert.equal(f.controller.live.has(A), false); assert.equal(f.controller.lastVerifiedAt.has(A), false);
  // A changed vault cannot be blessed from retained old credentials; this test
  // has no credentials, so unaffected B is independently eligible after re-read.
  assert.equal(f.controller.live.has(B), true); assert.equal(f.mounts[1].disposals, 0); assert.equal(f.store.writes, 0); await f.controller.dispose();
});

for (const race of ['disable', 'config', 'revision', 'vault', 'lock']) test('startup async key ' + race + ' change rechecks store/lock before mount', async () => {
  const key = Buffer.alloc(32, 7); const value = data([config(A, { envRefs: { API_TOKEN: 'token' } })], [A]); value.vault = seal({ token }, key, Buffer.alloc(16, 3), AUTOMATIC_KDF);
  let locked = false; const f = fixture({ store: new MemoryStore(value), automaticKey: async options => {
    assert.equal(options.create, false);
    if (race === 'disable') f.store.data.enabledIds = [];
    if (race === 'config') f.store.data.servers[0].command = '/synthetic/changed';
    if (race === 'vault') f.store.data.vault = seal({ token: 'SYNTHETIC-CHANGED' }, key, Buffer.alloc(16, 4), AUTOMATIC_KDF);
    if (race === 'lock') locked = true; else f.store.data.revision++;
    return Buffer.from(key);
  }, mount: () => assert.fail('changed approval cannot mount') });
  const read = f.store.readForStartup.bind(f.store); f.store.readForStartup = async () => { if (locked) throw new ConsoleError('store-busy'); return read(); };
  await f.controller.startup(); assert.equal(f.mounts.length, 0); assert.equal(f.store.writes, 0); assert.equal(f.store.transactions, 0); await f.controller.dispose(); key.fill(0);
});

test('already mounted is skipped; closed before startup does not even read metadata', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); await on(f); const count = f.mounts.length; await f.controller.startup(); assert.equal(f.mounts.length, count); await f.controller.dispose();
  const closed = fixture({ mount: () => assert.fail('closed never mounts') }); await closed.controller.dispose(); await closed.controller.startup(); assert.equal(closed.store.reads, 0);
});

test('close during deferred startup mount cleans the late owned handle, never publishes verification, no sibling mounts', async () => {
  const entered = gate(), release = gate(); const f = fixture({ store: new MemoryStore(data([config(A), config(B)], [A, B])), mount: async (_settings, call) => { entered.release(); await release.promise; return { initialVerified: true, verifiedAt: 100, dispose: async () => { call.disposals++; } }; } });
  const startup = f.controller.startup(); await entered.promise; const disposal = f.controller.dispose(); release.release(); await startup; await disposal;
  assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].disposals, 1); assert.equal(f.controller.live.size, 0); assert.equal(f.controller.lastVerifiedAt.size, 0); assert.deepEqual(f.store.data.enabledIds, [A, B]);
});

test('malformed late startup handle remains owned on cleanup failure and explicit later disposal can recover', async () => {
  const held = { initialVerified: true, verifiedAt: 1 }; const f = fixture({ store: new MemoryStore(data([config(A), config(B)], [A, B])), mount: async settings => settings.serverName === 'pc_' + A ? held : { initialVerified: true, verifiedAt: 1, dispose: async () => {} } });
  await f.controller.startup(); assert.equal(f.controller.live.get(A), held); assert.equal(f.controller.states.get(A), 'stop-failed'); assert.equal(f.controller.live.has(B), true); assert.equal(f.controller.lastVerifiedAt.has(A), false);
  await reject(f.controller.dispose(), 'stop-failed'); assert.equal(f.controller.live.get(A), held);
  let disposals = 0; held.dispose = async () => { disposals++; }; await f.controller.dispose(); assert.equal(disposals, 1); assert.equal(f.controller.live.size, 0); assert.deepEqual(f.store.data.enabledIds, [A, B]);
});

test('OFF disposal failure persists disabled and keeps owned handle; fresh boot never retries mount', async () => {
  const held = { initialVerified: true, verifiedAt: 1, dispose: async () => { throw new Error(token); } }; const f = fixture({ store: new MemoryStore(data()), mount: async () => held }); await on(f);
  await reject(off(f), 'stop-failed'); const snapshot = await f.invoke('snapshot'); assert.equal(snapshot.servers[0].enabled, false); assert.equal(snapshot.servers[0].state, 'stop-failed'); assert.equal(f.controller.live.get(A), held);
  const restart = fixture({ store: f.store, mount: () => assert.fail('OFF prevents restore even after cleanup failure') }); await restart.controller.startup(); await restart.controller.dispose();
  held.dispose = async () => {}; await f.controller.dispose();
});

for (const method of ['start', 'reconnect', 'stop']) test(method + ' proven preference prepublication failure performs no teardown/mount', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); if (method !== 'start') await on(f); const before = structuredClone(f.store.data); const count = f.mounts.length;
  f.store.write = async () => { throw new ConsoleError('store-write-failed'); };
  await reject(f.invoke(method, { id: A, ...(method === 'start' ? { confirmation: 'START THIS SERVER' } : method === 'reconnect' ? { confirmation: 'RECONNECT THIS SERVER' } : {}) }), 'store-write-failed');
  assert.deepEqual(f.store.data, before); assert.equal(f.mounts.length, count); assert.ok(f.mounts.every(call => call.disposals === 0)); await f.controller.dispose();
});

for (const fault of ['after-publication', 'unrelated', 'readback']) test('ON ' + fault + ' publication uncertainty never rolls back or mounts and quarantines explicit retries', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); const write = f.store.write.bind(f.store), read = f.store.read.bind(f.store); let unreadable = false;
  f.store.write = async value => { await write(value); if (fault === 'unrelated') { f.store.data.revision++; f.store.data.servers[0].label = 'Synthetic unrelated writer'; } if (fault === 'readback') unreadable = true; throw new ConsoleError('store-write-failed'); };
  f.store.read = async () => { if (unreadable) throw new Error(token); return read(); };
  await reject(on(f), 'preference-state-ambiguous'); assert.equal(f.mounts.length, 0); assert.equal(f.store.writes, 1); assert.deepEqual(f.store.data.enabledIds, [A]);
  f.store.read = read; f.store.write = write; await reject(on(f), 'preference-state-ambiguous'); assert.equal(f.store.writes, 1);
  await reject(f.invoke('saveAndActivate', { server: config(A), confirmation: 'SAVE AND ACTIVATE THIS SERVER' }), 'preference-state-ambiguous'); assert.equal(f.mounts.length, 0);
  await off(f); assert.deepEqual(f.store.data.enabledIds, []); await on(f); assert.equal(f.mounts.length, 1); await f.controller.dispose();
});

for (const method of ['start', 'stop']) test(method + ' transaction release failure preserves published preference and never loses handle ownership', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); if (method === 'stop') await on(f);
  f.store.transaction = async fn => { await fn(); throw new ConsoleError('SYNTHETIC-LOCK-RELEASE'); };
  await reject(method === 'start' ? on(f) : off(f), 'preference-state-ambiguous');
  assert.deepEqual(f.store.data.enabledIds, method === 'start' ? [A] : []); assert.equal(f.controller.live.size, method === 'start' ? 1 : 0); assert.equal(f.mounts[0].disposals, method === 'start' ? 0 : 1);
  assert.equal(f.controller.preferenceStateAmbiguous.has(A), true); await f.controller.dispose();
});

test('passphrase Lock and TTL cleanup retain enabled preference rather than rewriting intentional ON', async () => {
  let timeout; const f = fixture({ store: new MemoryStore(data()), setTimer: callback => { timeout = callback; return { unref() {} }; }, clearTimer: () => {} });
  await f.invoke('initializeVault', { passphrase }); await f.invoke('unlock', { passphrase, ttlSeconds: 30 }); await on(f); const before = structuredClone(f.store.data);
  timeout(); await f.controller.queue; assert.deepEqual(f.store.data, before); assert.equal(f.controller.live.size, 0);
  await on(f); await f.invoke('lock'); assert.deepEqual(f.store.data.enabledIds, [A]); assert.equal(f.controller.live.size, 0); await f.controller.dispose();
});

test('credential-free first restored mount does not block an enabled encrypted sibling or authenticate ciphertext without a key', async () => {
  const key = Buffer.alloc(32, 7), keyCalls = []; const value = data([config(A), config(B, { envRefs: { API_TOKEN: 'token' } })], [A, B]); value.vault = seal({ token }, key, Buffer.alloc(16, 3), AUTOMATIC_KDF);
  const f = fixture({ store: new MemoryStore(value), automaticKey: async options => { keyCalls.push(options); return Buffer.from(key); } });
  await f.controller.startup(); assert.equal(f.mounts.length, 2); assert.deepEqual(keyCalls, [{ create: false }]); assert.equal(f.mounts[1].settings.env.API_TOKEN, token); assert.equal(f.controller.live.size, 2);
  assert.ok(f.controller.snapshot(f.store.data).servers.every(row => row.state === 'activation-verified')); await f.controller.dispose(); key.fill(0);
});

test('credential-free restoration with persisted automatic vault does not read key unnecessarily and snapshot can later authenticate safely', async () => {
  const key = Buffer.alloc(32, 7), keyCalls = []; const value = data([config(A)], [A]); value.vault = seal({ token }, key, Buffer.alloc(16, 3), AUTOMATIC_KDF);
  const f = fixture({ store: new MemoryStore(value), automaticKey: async options => { keyCalls.push(options); return Buffer.from(key); } });
  await f.controller.startup(); assert.equal(f.mounts.length, 1); assert.deepEqual(keyCalls, []); assert.equal(f.controller.authenticatedEnvelope, null);
  assert.equal((await f.invoke('snapshot')).servers[0].state, 'activation-verified'); assert.deepEqual(keyCalls, [{ create: false }]); await f.controller.dispose(); key.fill(0);
});

test('expired manual OFF cannot tear down any child before durable disabled publication', async () => {
  let now = 1000; const f = fixture({ store: new MemoryStore(data([config(A), config(B)])), now: () => now, setTimer: () => ({ unref() {} }), clearTimer: () => {} });
  await f.invoke('initializeVault', { passphrase }); await f.invoke('unlock', { passphrase, ttlSeconds: 30 }); await on(f, A); await on(f, B); now = 32000;
  f.store.write = async () => { throw new ConsoleError('store-write-failed'); }; const before = structuredClone(f.store.data);
  await reject(off(f), 'store-write-failed'); assert.equal(f.controller.key, null); assert.equal(f.controller.live.size, 2); assert.ok(f.mounts.every(call => call.disposals === 0)); assert.deepEqual(f.store.data, before);
  await f.controller.dispose();
});

for (const method of ['start', 'reconnect']) test('manual ' + method + ' rechecks credential expiry after preference publication, before teardown/network', async () => {
  let now = 1000; const f = fixture({ store: new MemoryStore(data([config(A, { envRefs: { API_TOKEN: 'token' } })])), now: () => now, setTimer: () => ({ unref() {} }), clearTimer: () => {} });
  await f.invoke('initializeVault', { passphrase }); await f.invoke('unlock', { passphrase, ttlSeconds: 30 }); await f.invoke('setSecret', { ref: 'token', value: token }); if (method === 'reconnect') await on(f);
  const write = f.store.write.bind(f.store); f.store.write = async value => { await write(value); now = 32000; };
  await reject(f.invoke(method, { id: A, confirmation: method === 'start' ? 'START THIS SERVER' : 'RECONNECT THIS SERVER' }), 'vault-locked'); assert.deepEqual(f.store.data.enabledIds, [A]);
  assert.equal(f.mounts.length, method === 'start' ? 0 : 1); assert.ok(f.mounts.every(call => call.disposals === 0)); await f.controller.dispose();
});

test('OFF post-rename/fsync uncertainty retains the live handle while persisted disabled blocks future restoration', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); await on(f); const held = f.controller.live.get(A), write = f.store.write.bind(f.store);
  f.store.write = async value => { await write(value); throw new ConsoleError('store-write-failed'); };
  await reject(off(f), 'preference-state-ambiguous'); assert.deepEqual(f.store.data.enabledIds, []); assert.equal(f.controller.live.get(A), held); assert.equal(f.mounts[0].disposals, 0);
  const restart = fixture({ store: f.store, mount: () => assert.fail('durable OFF must not mount') }); await restart.controller.startup(); await restart.controller.dispose();
  f.store.write = write; await off(f); assert.equal(f.mounts[0].disposals, 1); await f.controller.dispose();
});

test('preference writer success with non-exact read-back never mounts or overwrites unrelated data', async () => {
  const f = fixture({ store: new MemoryStore(data()) }); f.store.write = async value => { f.store.writes++; f.store.data = { ...structuredClone(value), revision: value.revision + 1 }; };
  await reject(on(f), 'preference-state-ambiguous'); assert.equal(f.mounts.length, 0); assert.equal(f.store.writes, 1); assert.equal(f.store.data.revision, 3); assert.deepEqual(f.store.data.enabledIds, [A]); await f.controller.dispose();
});

for (const boundary of ['mount', 'publication']) test('closed SaveAndActivate at ' + boundary + ' boundary cleans its late handle without reporting activation', async () => {
  const entered = gate(), release = gate(); const f = fixture({ mount: async (_settings, call) => {
    if (boundary === 'mount') { entered.release(); await release.promise; }
    return { initialVerified: true, verifiedAt: 1, dispose: async () => { call.disposals++; } };
  } });
  const write = f.store.write.bind(f.store); f.store.write = async value => { if (boundary === 'publication') { entered.release(); await release.promise; } return write(value); };
  const saving = f.invoke('saveAndActivate', { server: base, confirmation: 'SAVE AND ACTIVATE THIS SERVER' }); const rejected = reject(saving, 'disposed');
  await entered.promise; const disposal = f.controller.dispose(); release.release(); await rejected; await disposal;
  assert.equal(f.mounts[0].disposals, 1); assert.equal(f.controller.live.size, 0); assert.equal(f.controller.lastVerifiedAt.size, 0);
  if (boundary === 'mount') assert.equal(f.store.data, null);
  else { assert.equal(f.store.data.servers.length, 1); assert.deepEqual(f.store.data.enabledIds, [f.store.data.servers[0].id]); }
});

test('startup restores maximum 32 enabled records sequentially, once, without preference/vault writes', async () => {
  const servers = Array.from({ length: 32 }, (_, index) => config(index.toString(16).padStart(24, '0'))); let concurrent = 0;
  const f = fixture({ store: new MemoryStore(data(servers, servers.map(row => row.id))), mount: async (_settings, call) => { concurrent++; assert.equal(concurrent, 1); await Promise.resolve(); concurrent--; return { initialVerified: true, verifiedAt: 1, dispose: async () => { call.disposals++; } }; } });
  await f.controller.startup(); await f.controller.startup(); assert.equal(f.mounts.length, 32); assert.equal(f.controller.live.size, 32); assert.equal(f.store.writes, 0); assert.equal(f.store.transactions, 0); await f.controller.dispose();
});
