import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { ConsoleController } from '../src/controller.js';
import { ConsoleError } from '../src/storage.js';
import { makeSchemas, makeRemoteSpec, METHODS, NAMESPACE } from '../src/contract.js';
import { seal, AUTOMATIC_KDF } from '../src/vault.js';

const owner = { kind: 'owner' };
const confirmation = 'SAVE AND ACTIVATE THIS SERVER';
const secret = 'SYNTHETIC-VERIFIED-SAVE-SECRET-DO-NOT-USE';
const base = { label: 'Synthetic verified save', transport: 'stdio', command: '/synthetic/no-execution', args: [], cwd: '', envRefs: {} };
const http = { label: 'Synthetic HTTP', transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: {} };
const id = 'a'.repeat(24);
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code && error.message === code);

class MemoryStore {
  data = null; reads = 0; writes = 0; transactions = 0; failWrite = false;
  async read() { this.reads++; return structuredClone(this.data); }
  async transaction(fn) { this.transactions++; return fn(); }
  async write(value) { this.writes++; if (this.failWrite) throw new ConsoleError('store-write-failed'); this.data = structuredClone(value); }
}
function fixture({ store = new MemoryStore(), mount, ...options } = {}) {
  const mounts = [];
  const controller = new ConsoleController({ store, mount: async config => {
    const call = { config, stopped: false }; mounts.push(call);
    if (mount) return mount(config, call);
    return { initialVerified: true, verifiedAt: 123, dispose: async () => { call.stopped = true; } };
  }, ...options });
  const invoke = (method, fields = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: store.data?.revision ?? 0, ...fields }, owner);
  const save = (server = base) => invoke('saveAndActivate', { server, confirmation });
  return { controller, store, mounts, invoke, save };
}
function automaticStore(servers = []) {
  const store = new MemoryStore(); const key = Buffer.alloc(32, 7);
  store.data = { version: 1, revision: 1, servers: structuredClone(servers), vault: seal({ token: secret }, key, Buffer.alloc(16, 1), AUTOMATIC_KDF) };
  return { store, key };
}

// All mounts below are in-memory seams. No executable or network is invoked.
test('explicit saveAndActivate contract and optional strict capability preserve legacy requests/results', async () => {
  const { schemas, result } = makeSchemas(z);
  assert.equal(METHODS.length, 13); assert.deepEqual(Object.keys(schemas), METHODS);
  assert.equal(schemas.saveAndActivate.safeParse({ revision: 0, server: base, confirmation }).success, true);
  for (const extra of [{}, { confirmation: 'START THIS SERVER' }, { confirmation, enabled: true }]) {
    assert.equal(schemas.saveAndActivate.safeParse({ revision: 0, server: base, ...extra }).success, false);
  }
  assert.equal(schemas.save.safeParse({ revision: 0, server: base }).success, true);
  assert.equal(schemas.save.safeParse({ revision: 0, server: base, confirmation }).success, false);
  const spec = makeRemoteSpec(z).methods[NAMESPACE + '/saveAndActivate'];
  assert.equal(spec.parameters[0].codec.mode, 'strict');
  const f = fixture(); const snapshot = await f.invoke('snapshot');
  assert.deepEqual(snapshot.capabilities, { saveAndActivate: true, persistentActivation: true, toolPolicy: true, configurableTimeout: true });
  assert.equal(result.safeParse(snapshot).success, true);
  delete snapshot.capabilities; assert.equal(result.safeParse(snapshot).success, true);
  for (const capabilities of [{ saveAndActivate: false }, {}, { saveAndActivate: true, another: true }]) {
    assert.equal(result.safeParse({ ...snapshot, capabilities }).success, false);
  }
  assert.equal(f.store.writes, 0); assert.equal(f.mounts.length, 0); await f.controller.dispose();
});

test('verified Save persists once after initial sync and retains only the verified owned mount', async () => {
  const f = fixture(); const result = await f.save();
  assert.equal(result.revision, 1); assert.equal(f.store.writes, 1); assert.equal(f.store.transactions, 1);
  assert.equal(result.servers.length, 1); const saved = result.servers[0];
  assert.equal(saved.state, 'activation-verified'); assert.equal(saved.lastVerifiedAt, 123);
  assert.match(saved.config.id, /^[a-f0-9]{24}$/); assert.equal(f.controller.live.size, 1);
  assert.equal(f.controller.pendingSaves.size, 0); assert.equal(f.mounts[0].stopped, false);
  assert.equal(f.mounts[0].config.serverName, saved.serverName);
  assert.equal(f.mounts[0].config.failOnStartupError, true); assert.equal(f.mounts[0].config.reconnect.enabled, false);
  assert.equal(Object.hasOwn(f.mounts[0].config, 'cwd'), false);
  assert.deepEqual(Object.keys(f.store.data).sort(), ['enabledIds', 'revision', 'servers', 'vault', 'version']);
  assert.deepEqual(f.store.data.servers, [saved.config]);
  assert.deepEqual(f.store.data.enabledIds, [saved.config.id]); assert.equal(saved.enabled, true);
  assert.equal(Object.hasOwn(saved.config, 'enabled'), false); assert.ok(!JSON.stringify(f.store.data).includes('lastVerifiedAt')); assert.ok(!JSON.stringify(f.store.data).includes('activation-verified'));
  const restart = fixture({ store: f.store, mount: () => assert.fail('restart must not mount') });
  assert.equal((await restart.invoke('snapshot')).servers[0].state, 'disabled');
  await restart.controller.dispose(); await f.controller.dispose(); assert.equal(f.mounts[0].stopped, true);
});

test('deferred initial readiness never prematurely persists and serialized racing Save cannot duplicate', async () => {
  let release; let entered;
  const ready = new Promise(resolve => { release = resolve; });
  const inside = new Promise(resolve => { entered = resolve; });
  const f = fixture({ mount: async (_config, call) => { entered(); await ready; return { initialVerified: true, verifiedAt: 0, dispose: async () => { call.stopped = true; } }; } });
  const first = f.save(); await inside;
  const second = f.controller.invoke('saveAndActivate', { revision: 0, server: base, confirmation }, owner);
  const rejected = rejectsCode(second, 'revision-conflict');
  assert.equal(f.store.data, null); assert.equal(f.store.writes, 0); assert.equal(f.controller.live.size, 0); assert.equal(f.mounts.length, 1);
  release(); const saved = await first; await rejected;
  assert.equal(saved.servers[0].lastVerifiedAt, 0); assert.equal(f.store.writes, 1); assert.equal(f.mounts.length, 1);
  await f.controller.dispose();
});

test('mount rejection has no new server record and never exposes adapter errors', async () => {
  const f = fixture({ mount: async () => { throw new Error(secret); } });
  await rejectsCode(f.save(), 'mount-failed');
  assert.equal(f.store.data, null); assert.equal(f.store.writes, 0); assert.equal(f.controller.live.size, 0);
  assert.equal((await f.invoke('snapshot')).servers.length, 0); await f.controller.dispose();
});

for (const metadata of [{}, { initialVerified: false, verifiedAt: 123 }, { initialVerified: 'true', verifiedAt: 123 }]) {
  test('unverified/unknown handle is disposed without publication: ' + JSON.stringify(metadata), async () => {
    let disposals = 0;
    const f = fixture({ mount: async () => ({ ...metadata, dispose: async () => { disposals++; } }) });
    await rejectsCode(f.save(), 'mount-failed'); assert.equal(disposals, 1);
    assert.equal(f.store.data, null); assert.equal(f.store.writes, 0); assert.equal(f.controller.live.size, 0);
    assert.equal(f.controller.pendingSaves.size, 0); await f.controller.dispose();
  });
}
for (const verifiedAt of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, secret]) {
  test('bad verification timestamp fails Save and disposes handle: ' + String(verifiedAt), async () => {
    let disposals = 0;
    const f = fixture({ mount: async () => ({ initialVerified: true, verifiedAt, dispose: async () => { disposals++; } }) });
    await rejectsCode(f.save(), 'mount-failed'); assert.equal(disposals, 1);
    assert.equal(f.store.data, null); assert.equal(f.controller.live.size, 0); await f.controller.dispose();
  });
}

test('null handle cannot be accepted as verified', async () => {
  const f = fixture({ mount: async () => null }); await rejectsCode(f.save(), 'mount-failed');
  assert.equal(f.store.data, null); assert.equal(f.controller.live.size, 0); await f.controller.dispose();
});

test('missing dispose keeps returned object quarantined and prevents silent duplicate saves', async () => {
  const handle = { initialVerified: true, verifiedAt: 123 };
  const f = fixture({ mount: async () => handle });
  await rejectsCode(f.save(), 'save-cleanup-required');
  assert.equal(f.store.data, null); assert.equal(f.store.writes, 0);
  assert.equal(f.controller.live.size, 1); assert.equal([...f.controller.live.values()][0], handle);
  await rejectsCode(f.save({ ...base, label: 'Retry with a new label' }), 'save-cleanup-required');
  assert.equal(f.mounts.length, 1);
  await rejectsCode(f.controller.dispose(), 'stop-failed'); assert.equal(f.controller.live.size, 1);
  let disposals = 0; handle.dispose = async () => { disposals++; };
  await f.controller.dispose(); assert.equal(disposals, 1); assert.equal(f.controller.live.size, 0);
});

test('owner and exact inputs reject before store/key IO or mount', async () => {
  let keyIO = 0; const f = fixture({ automaticKey: async () => { keyIO++; return Buffer.alloc(32, 7); } });
  const request = { revision: 0, server: base, confirmation };
  for (const principal of [undefined, { kind: 'remote' }, { kind: 'worker' }]) await rejectsCode(f.controller.invoke('saveAndActivate', request, principal), 'owner-required');
  for (const fields of [{ confirmation: undefined }, { confirmation: 'START THIS SERVER' }, { extra: true }, { server: { ...base, enabled: true } }, { server: { ...base, env: { TOKEN: secret } } }]) {
    await rejectsCode(f.controller.invoke('saveAndActivate', { ...request, ...fields }, owner), 'invalid-input');
  }
  assert.equal(f.store.reads, 0); assert.equal(f.store.transactions, 0); assert.equal(keyIO, 0); assert.equal(f.mounts.length, 0);
  await f.controller.dispose();
});

test('revision, ownership, invalid URL/headers/arguments and capacity guard before automatic key IO and mount', async () => {
  const { store, key } = automaticStore(); let keyIO = 0;
  const f = fixture({ store, automaticKey: async () => { keyIO++; return Buffer.from(key); } });
  await rejectsCode(f.controller.invoke('saveAndActivate', { revision: 0, server: base, confirmation }, owner), 'revision-conflict');
  await rejectsCode(f.save({ ...base, id }), 'not-owned');
  for (const [server, code] of [
    [{ ...http, url: 'not a url' }, 'invalid-url'],
    [{ ...http, url: 'http://example.invalid/mcp' }, 'unsafe-url'],
    [{ ...http, url: 'https://example.invalid/mcp?token=value' }, 'unsafe-url'],
    [{ ...http, headerRefs: { Host: 'token' } }, 'invalid-headers'],
    [{ ...base, args: ['--token=synthetic'] }, 'credential-argument']
  ]) await rejectsCode(f.save(server), code);
  store.data.servers = Array.from({ length: 32 }, (_, index) => ({ ...base, id: index.toString(16).padStart(24, '0') }));
  await rejectsCode(f.save({ ...http, headerRefs: { Authorization: 'token' } }), 'server-limit');
  assert.equal(keyIO, 0); assert.equal(f.mounts.length, 0); assert.equal(store.writes, 0); await f.controller.dispose(); key.fill(0);
});

test('active edited server rejects before automatic key IO and retains its mount and stored config', async () => {
  const { store, key } = automaticStore(); let keyIO = 0;
  const f = fixture({ store, automaticKey: async () => { keyIO++; return Buffer.from(key); } });
  const saved = await f.save({ ...http, headerRefs: { Authorization: 'token' } }); const config = saved.servers[0].config;
  const before = structuredClone(store.data); const calls = keyIO;
  await rejectsCode(f.save({ ...config, label: 'Forbidden active edit' }), 'stop-before-edit');
  assert.deepEqual(store.data, before); assert.equal(keyIO, calls); assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].stopped, false);
  await f.controller.dispose(); key.fill(0);
});

test('automatic ciphertext drift fails before protected-key IO or mounting', async () => {
  const { store, key } = automaticStore(); let keyIO = 0;
  const f = fixture({ store, automaticKey: async () => { keyIO++; return Buffer.from(key); } });
  await f.invoke('snapshot'); const calls = keyIO;
  store.data.vault = seal({ token: secret }, key, Buffer.alloc(16, 2), AUTOMATIC_KDF);
  await rejectsCode(f.save({ ...http, headerRefs: { Authorization: 'token' } }), 'vault-drift');
  assert.equal(keyIO, calls); assert.equal(f.mounts.length, 0); assert.equal(store.writes, 0); await f.controller.dispose(); key.fill(0);
});

test('new endpoint automatically rehydrates configured refs without a prior snapshot or key creation', async () => {
  const { store, key } = automaticStore(); const keyCalls = [];
  const f = fixture({ store, automaticKey: async options => { keyCalls.push(options); return Buffer.from(key); } });
  assert.equal(f.controller.key, null);
  const saved = await f.save({ ...http, headerRefs: { Authorization: 'token' } });
  assert.deepEqual(keyCalls, [{ create: false }]); assert.equal(f.mounts[0].config.headers.Authorization, secret);
  assert.equal(saved.servers[0].state, 'activation-verified'); assert.equal(saved.vault.mode, 'automatic');
  assert.ok(!JSON.stringify(saved).includes(secret)); assert.ok(!JSON.stringify(store.data).includes(secret));
  await f.controller.dispose(); key.fill(0);
});

test('credential-free new endpoint avoids unnecessary automatic key IO even with persisted vault', async () => {
  const { store, key } = automaticStore();
  const f = fixture({ store, automaticKey: async () => assert.fail('no refs need no key IO') });
  await f.save(); assert.equal(f.controller.key, null); await f.controller.dispose(); key.fill(0);
});

test('missing, unreadable and locked credentials fail Save before mount', async () => {
  for (const failure of ['missing', 'key', 'locked']) {
    const { store, key } = automaticStore();
    const f = fixture({ store, automaticKey: async () => { if (failure === 'key') throw new Error(secret); return Buffer.from(key); } });
    if (failure === 'locked') { store.data.vault = null; f.controller.automaticKey = null; }
    await rejectsCode(f.save({ ...http, headerRefs: { Authorization: failure === 'missing' ? 'absent' : 'token' } }), failure === 'missing' ? 'secret-missing' : failure === 'key' ? 'vault-key-unavailable' : 'vault-locked');
    assert.equal(f.mounts.length, 0); assert.equal(store.writes, 0); await f.controller.dispose(); key.fill(0);
  }
});

test('manual expiry boundary cannot mount Save with plaintext bindings captured before cleanup', async () => {
  let clockReads = 0;
  const f = fixture({ now: () => ++clockReads === 1 ? 1000 : 32000 });
  f.controller.key = Buffer.alloc(32, 7); f.controller.secrets = { token: secret };
  f.controller.envelope = 'null'; f.controller.expiresAt = 2000;
  await rejectsCode(f.save({ ...http, headerRefs: { Authorization: 'token' } }), 'vault-locked');
  assert.equal(f.mounts.length, 0); assert.equal(f.store.writes, 0); assert.equal(f.store.data, null);
  await f.controller.dispose();
});

test('failed edited Save preserves exact old config and revision across adapter/verification/storage failures', async () => {
  for (const failure of ['mount', 'verification', 'timestamp', 'storage']) {
    const f = fixture({ mount: async (_config, call) => {
      if (failure === 'mount') throw new Error(secret);
      return { initialVerified: failure !== 'verification', verifiedAt: failure === 'timestamp' ? -1 : 123, dispose: async () => { call.stopped = true; } };
    } });
    await f.invoke('save', { server: base }); const before = structuredClone(f.store.data);
    if (failure === 'storage') f.store.failWrite = true;
    await rejectsCode(f.save({ ...base, id: before.servers[0].id, label: 'Changed', command: 'node' }), failure === 'storage' ? 'store-write-failed' : 'mount-failed');
    assert.deepEqual(f.store.data, before); assert.equal(f.controller.live.size, 0);
    if (failure !== 'mount') assert.equal(f.mounts[0].stopped, true);
    await f.controller.dispose();
  }
});

test('persistence failure disposes its newly verified mount with no new record', async () => {
  const f = fixture(); f.store.failWrite = true;
  await rejectsCode(f.save(), 'store-write-failed');
  assert.equal(f.mounts[0].stopped, true); assert.equal(f.controller.live.size, 0); assert.equal(f.store.data, null);
  assert.equal(f.controller.pendingSaves.size, 0); await f.controller.dispose();
});

test('cleanup failure keeps owned provisional handle and blocks retries before key IO or duplicate mounts', async () => {
  const { store, key } = automaticStore(); let keyIO = 0; let failDispose = true; let disposals = 0;
  const handle = { initialVerified: false, dispose: async () => { disposals++; if (failDispose) throw new Error(secret); } };
  const f = fixture({ store, automaticKey: async () => { keyIO++; return Buffer.from(key); }, mount: async () => handle });
  const before = structuredClone(store.data);
  await rejectsCode(f.save({ ...http, headerRefs: { Authorization: 'token' } }), 'save-cleanup-required');
  assert.deepEqual(store.data, before); assert.equal(f.controller.live.size, 1); assert.equal([...f.controller.live.values()][0], handle);
  const calls = keyIO;
  await rejectsCode(f.save({ ...http, headerRefs: { Authorization: 'token' } }), 'save-cleanup-required');
  assert.equal(keyIO, calls); assert.equal(disposals, 1); assert.equal(f.mounts.length, 1);
  failDispose = false; await f.controller.dispose(); assert.equal(disposals, 2); assert.equal(f.controller.live.size, 0); key.fill(0);
});

test('failed edited cleanup preserves old config and explicit stop recovers retained owned handle', async () => {
  let failDispose = true;
  const f = fixture({ mount: async () => ({ initialVerified: false, dispose: async () => { if (failDispose) throw new Error(secret); } }) });
  const saved = await f.invoke('save', { server: base }); const config = saved.servers[0].config; const before = structuredClone(f.store.data);
  await rejectsCode(f.save({ ...config, label: 'Changed' }), 'save-cleanup-required');
  assert.deepEqual(f.store.data, before); assert.equal((await f.invoke('snapshot')).servers[0].state, 'stop-failed');
  await rejectsCode(f.save({ ...config, label: 'Retry' }), 'stop-before-edit'); assert.equal(f.mounts.length, 1);
  failDispose = false; await f.invoke('stop', { id: config.id });
  assert.equal(f.controller.pendingSaves.size, 0); assert.equal(f.controller.live.size, 0); await f.controller.dispose();
});

test('failed storage rollback cleanup retains its verified child and rejects a new Save without remounting', async () => {
  let failDispose = true; let disposals = 0;
  const handle = { initialVerified: true, verifiedAt: 123, dispose: async () => { disposals++; if (failDispose) throw new Error(secret); } };
  const f = fixture({ mount: async () => handle }); f.store.failWrite = true;
  await rejectsCode(f.save(), 'save-cleanup-required');
  assert.equal(f.store.data, null); assert.equal(f.controller.live.size, 1); assert.equal([...f.controller.live.values()][0], handle);
  await rejectsCode(f.save(), 'save-cleanup-required'); assert.equal(f.mounts.length, 1); assert.equal(disposals, 1);
  failDispose = false; await f.controller.dispose(); assert.equal(disposals, 2); assert.equal(f.controller.live.size, 0);
});

test('unreadable publication read-back reports ambiguity instead of claiming the edited record is unchanged', async () => {
  const f = fixture(); await f.invoke('save', { server: base }); const before = structuredClone(f.store.data);
  const read = f.store.read.bind(f.store); let failRead = false;
  f.store.read = async () => { if (failRead) throw new Error(secret); return read(); };
  f.store.write = async () => { failRead = true; throw new ConsoleError('store-write-failed'); };
  await rejectsCode(f.save({ ...base, id: before.servers[0].id, label: 'Changed' }), 'save-state-ambiguous');
  assert.deepEqual(f.store.data, before); assert.equal(f.mounts[0].stopped, true); assert.equal(f.controller.live.size, 0);
  await f.controller.dispose();
});

test('post-publication storage failure restores original state only while transaction owns its writer lock', async () => {
  for (const edit of [false, true]) {
    const f = fixture(); if (edit) await f.invoke('save', { server: base });
    const before = structuredClone(f.store.data); let inTransaction = false;
    f.store.transaction = async fn => { inTransaction = true; try { return await fn(); } finally { inTransaction = false; } };
    const write = f.store.write.bind(f.store);
    f.store.write = async value => { assert.equal(inTransaction, true); await write(value); throw new ConsoleError('store-write-failed'); };
    await rejectsCode(f.save(edit ? { ...base, id: before.servers[0].id, label: 'Changed' } : base), 'store-write-failed');
    assert.deepEqual(f.store.data, before ?? { version: 1, revision: 0, servers: [], vault: null });
    assert.equal(f.mounts[0].stopped, true); assert.equal(f.controller.live.size, 0); assert.equal(f.controller.saveStateAmbiguous, false);
    await f.controller.dispose();
  }
});

test('unrestorable publication reports ambiguity, rolls back owned child, and forbids another Save mount', async () => {
  const f = fixture(); const write = f.store.write.bind(f.store); let calls = 0;
  f.store.write = async value => { if (++calls === 1) await write(value); throw new ConsoleError('store-write-failed'); };
  await rejectsCode(f.save(), 'save-state-ambiguous');
  assert.equal(f.store.data.servers.length, 1); assert.equal(f.mounts[0].stopped, true); assert.equal(f.controller.live.size, 0);
  await rejectsCode(f.save(), 'save-state-ambiguous'); assert.equal(f.mounts.length, 1); assert.equal(calls, 2);
  await f.controller.dispose();
});

test('unrelated observed publication is never overwritten by compensation', async () => {
  const f = fixture(); let calls = 0;
  f.store.write = async value => { calls++; f.store.data = { ...structuredClone(value), revision: value.revision + 1, servers: [{ ...base, id, label: 'Unrelated writer' }] }; throw new ConsoleError('store-write-failed'); };
  await rejectsCode(f.save(), 'save-state-ambiguous');
  assert.equal(calls, 1); assert.equal(f.store.data.servers[0].label, 'Unrelated writer'); assert.equal(f.mounts[0].stopped, true);
  await f.controller.dispose();
});

test('transaction-release failure after successful publication is ambiguous and does not leave a falsely successful active child', async () => {
  const f = fixture(); f.store.transaction = async fn => { await fn(); throw new Error(secret); };
  await rejectsCode(f.save(), 'save-state-ambiguous'); assert.equal(f.mounts[0].stopped, true); assert.equal(f.controller.live.size, 0);
  assert.equal(f.store.data.servers.length, 1); await f.controller.dispose();
});

test('reply validation failure occurs before persistence and disposes verified provisional handle', async () => {
  const f = fixture({ inventory: () => ({ servers: ['x'.repeat(33)], available: true }) });
  await rejectsCode(f.save(), 'snapshot-contract-failed');
  assert.equal(f.store.data, null); assert.equal(f.store.writes, 0); assert.equal(f.mounts[0].stopped, true); await f.controller.dispose();
});

test('legacy save remains metadata-only and explicit start/stop/reconnect retain their exact toggle protections', async () => {
  const f = fixture(); const saved = await f.invoke('save', { server: base }); const config = saved.servers[0].config;
  assert.equal(saved.servers[0].state, 'disabled'); assert.equal(f.mounts.length, 0);
  await rejectsCode(f.invoke('start', { id: config.id }), 'invalid-input');
  await rejectsCode(f.invoke('stop', { id }), 'not-owned');
  const started = await f.invoke('start', { id: config.id, confirmation: 'START THIS SERVER' });
  assert.equal(started.servers[0].state, 'activation-verified');
  await rejectsCode(f.invoke('start', { id: config.id, confirmation: 'START THIS SERVER' }), 'already-mounted');
  await rejectsCode(f.invoke('save', { server: { ...config, label: 'Forbidden active edit' } }), 'stop-before-edit');
  await rejectsCode(f.invoke('deleteServer', { id: config.id }), 'stop-before-delete');
  await rejectsCode(f.invoke('reconnect', { id: config.id, confirmation: 'START THIS SERVER' }), 'invalid-input');
  await rejectsCode(f.controller.invoke('stop', { revision: 0, id: config.id }, owner), 'revision-conflict');
  assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].stopped, false);
  const stopped = await f.invoke('stop', { id: config.id }); assert.equal(stopped.servers[0].state, 'unmounted-shutdown-unverified');
  await f.invoke('start', { id: config.id, confirmation: 'START THIS SERVER' }); assert.equal(f.mounts.length, 2);
  await f.invoke('stop', { id: config.id }); await f.controller.dispose();
});
