// Synthetic backend seams only; no user credentials, endpoint or executable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { ConsoleController } from '../src/controller.js';
import { ConsoleError, FileStore } from '../src/storage.js';
import { AUTOMATIC_KDF, seal, unseal } from '../src/vault.js';
import { makeSchemas, METHODS } from '../src/contract.js';

const owner = { kind: 'owner' };
const token = 'Bearer SYNTHETIC-N8N-MOCK-ONLY';
const unused = 'SYNTHETIC-UNUSED-HEADER-ONLY';
const fresh = 'SYNTHETIC-NEW-DIRECT-HEADER-ONLY';
const base = { label: 'N8N synthetic mock', transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: {} };
const reject = (promise, code) => assert.rejects(promise, error => error.code === code && error.message === code);
class MemoryStore {
  data = null; writes = 0; busy = false;
  async read() { return structuredClone(this.data); }
  async write(value) { this.writes++; this.data = structuredClone(value); }
  async transaction(fn) {
    if (this.busy) throw new ConsoleError('store-busy');
    this.busy = true; try { return await fn(); } finally { this.busy = false; }
  }
}
function fixture({ secrets = { n8n: token, unused }, store = new MemoryStore(), automatic = true } = {}) {
  const key = Buffer.alloc(32, 0x5e); const keyCalls = []; const returnedKeys = []; const mounts = [];
  if (secrets !== null && store instanceof MemoryStore) store.data = { version: 1, revision: 1, servers: [], vault: seal(secrets, key, Buffer.alloc(16, 0x19), AUTOMATIC_KDF) };
  let keyFault = null; let stopFault = false;
  const controller = new ConsoleController({ store,
    ...(automatic ? { automaticKey: async options => { keyCalls.push(options); if (keyFault === 'missing') throw new Error('SYNTHETIC-KEY-UNAVAILABLE'); const value = Buffer.from(keyFault === 'tampered' ? Buffer.alloc(32, 0x27) : key); returnedKeys.push(value); return value; } } : {}),
    mount: async config => {
      const tool = { call: () => config.headers.Authorization ?? 'credential-free' };
      const entry = { config, tool, stops: 0 };
      const handle = { initialVerified: true, verifiedAt: 1500 + mounts.length, tool, dispose: async () => { entry.stops++; if (stopFault) throw new Error('SYNTHETIC-STOP-FAULT'); } };
      entry.handle = handle; mounts.push(entry); return handle;
    }
  });
  const invoke = (method, fields = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: store.data?.revision ?? 0, ...fields }, owner);
  const mount = async (credentialed = true) => {
    const result = await invoke('saveAndActivate', { server: { ...base, label: base.label + ' ' + mounts.length, headerRefs: credentialed ? { Authorization: 'n8n' } : {} }, confirmation: 'SAVE AND ACTIVATE THIS SERVER' });
    return result.servers.at(-1).config.id;
  };
  return { controller, store, key, keyCalls, returnedKeys, mounts, invoke, mount, faultKey: fault => { keyFault = fault; }, faultStop: fault => { stopFault = fault; } };
}
async function credentialed(count = 1, options) {
  const f = fixture(options); await f.invoke('snapshot');
  for (let i = 0; i < count; i++) await f.mount();
  return f;
}
function retained(f, handles, times, configs) {
  assert.deepEqual([...f.controller.live.values()], handles);
  assert.deepEqual([...f.controller.lastVerifiedAt], times);
  assert.deepEqual(f.mounts.map(mount => mount.config), configs);
  assert.ok(f.mounts.every(mount => mount.stops === 0));
  assert.ok(f.mounts.every(mount => mount.tool.call() === token));
}
const evidence = f => ({ handles: [...f.controller.live.values()], times: [...f.controller.lastVerifiedAt], configs: structuredClone(f.mounts.map(mount => mount.config)) });
const checkRetained = (f, held) => retained(f, held.handles, held.times, held.configs);

for (const count of [1, 3]) test('fresh Token/direct-Header refs preserve ' + count + ' live credentialed N8N mock handles and authenticated old values', async () => {
  const f = await credentialed(count); const held = evidence(f); const before = structuredClone(f.store.data); const oldKey = Buffer.from(f.controller.key);
  try {
    const appended = await f.invoke('setSecret', { ref: 'newToken', value: fresh });
    assert.equal(appended.revision, before.revision + 1); assert.equal(appended.capabilities.appendSecretsWhileMounted, true);
    assert.deepEqual(appended.vault.refs, ['n8n', 'newToken', 'unused']);
    assert.deepEqual(f.controller.key, oldKey); assert.deepEqual(f.store.data.servers, before.servers);
    assert.equal(f.store.data.vault.salt, before.vault.salt); assert.equal(f.store.data.vault.kdf, before.vault.kdf); assert.notEqual(f.store.data.vault.nonce, before.vault.nonce);
    assert.deepEqual(unseal(f.store.data.vault, f.key), { n8n: token, unused, newToken: fresh });
    const second = await f.invoke('setSecret', { ref: 'directHeader', value: 'SYNTHETIC-SECOND-HEADER' });
    assert.deepEqual(second.vault.refs, ['directHeader', 'n8n', 'newToken', 'unused']);
    assert.ok(!JSON.stringify(second).includes(fresh)); assert.ok(!JSON.stringify(f.store.data).includes(token));
    checkRetained(f, held);
  } finally { await f.controller.dispose(); oldKey.fill(0); f.key.fill(0); }
});

test('referenced AND unused existing ref overwrite/delete, missing delete and all early guards perform no key IO or write', async () => {
  const f = await credentialed(2); const held = evidence(f); const calls = f.keyCalls.length; const writes = f.store.writes; const before = structuredClone(f.store.data); const revision = before.revision;
  try {
    // Cached plaintext absence is not proof of fresh membership.
    delete f.controller.secrets.unused;
    for (const ref of ['n8n', 'unused']) {
      await reject(f.invoke('setSecret', { ref, value: 'SYNTHETIC-REPLACEMENT' }), 'stop-before-secret-change');
      await reject(f.invoke('deleteSecret', { ref }), 'stop-before-secret-change');
    }
    await reject(f.invoke('deleteSecret', { ref: 'absent' }), 'stop-before-secret-change');
    await reject(f.controller.invoke('setSecret', { revision, ref: 'fresh', value: fresh }, { kind: 'worker' }), 'owner-required');
    await reject(f.controller.invoke('setSecret', { revision, ref: 'fresh', value: fresh, extra: true }, owner), 'invalid-input');
    await reject(f.controller.invoke('setSecret', { revision: revision - 1, ref: 'fresh', value: fresh }, owner), 'revision-conflict');
    await reject(f.invoke('saveAndActivate', { server: { ...base, id: before.servers[0].id }, confirmation: 'SAVE AND ACTIVATE THIS SERVER' }), 'stop-before-edit');
    await reject(f.invoke('start', { id: 'a'.repeat(24), confirmation: 'START THIS SERVER' }), 'not-owned');
    assert.equal(f.keyCalls.length, calls); assert.equal(f.store.writes, writes); assert.deepEqual(f.store.data, before); checkRetained(f, held);
    // Append always authenticates stored old values, not stale/mutated cache.
    f.controller.secrets.n8n = 'SYNTHETIC-UNAUTHENTICATED-CACHE';
    await f.invoke('setSecret', { ref: 'fresh', value: fresh });
    assert.deepEqual(unseal(f.store.data.vault, f.key), { n8n: token, unused, fresh }); checkRetained(f, held);
  } finally { await f.controller.dispose(); }
});

test('manual/passphrase vault still blocks fresh refs while mounted and never advertises append capability', async () => {
  const f = fixture({ secrets: null, automatic: false }); const passphrase = 'SYNTHETIC-MANUAL-PASSPHRASE';
  try {
    await f.invoke('initializeVault', { passphrase }); await f.invoke('unlock', { passphrase, ttlSeconds: 300 });
    await f.invoke('setSecret', { ref: 'n8n', value: token }); await f.invoke('setSecret', { ref: 'unused', value: unused }); await f.mount();
    const before = structuredClone(f.store.data); const held = evidence(f);
    assert.deepEqual((await f.invoke('snapshot')).capabilities, { saveAndActivate: true, persistentActivation: true, toolPolicy: true, configurableTimeout: true });
    for (const ref of ['newToken', 'n8n', 'unused']) await reject(f.invoke('setSecret', { ref, value: fresh }), 'stop-before-secret-change');
    for (const ref of ['n8n', 'unused']) await reject(f.invoke('deleteSecret', { ref }), 'stop-before-secret-change');
    assert.deepEqual(f.store.data, before); checkRetained(f, held); assert.equal(f.keyCalls.length, 0);
  } finally { await f.controller.dispose(); }
});

test('credential-free live server safely creates the first automatic key/vault without changing its mount', async () => {
  const f = fixture({ secrets: null });
  try {
    const id = await f.mount(false); const handle = f.controller.live.get(id); const time = f.controller.lastVerifiedAt.get(id); const revision = f.store.data.revision;
    assert.equal(f.keyCalls.length, 0); assert.equal(f.store.data.vault, null);
    const result = await f.invoke('setSecret', { ref: 'firstHeader', value: fresh });
    assert.deepEqual(f.keyCalls, [{ create: true }]); assert.equal(result.revision, revision + 1); assert.deepEqual(result.vault.refs, ['firstHeader']);
    assert.equal(f.controller.live.get(id), handle); assert.equal(f.controller.lastVerifiedAt.get(id), time); assert.equal(f.mounts[0].tool.call(), 'credential-free'); assert.equal(f.mounts[0].stops, 0);
    assert.deepEqual(unseal(f.store.data.vault, f.key), { firstHeader: fresh });
  } finally { await f.controller.dispose(); }
});

test('authenticated 128-ref limit rejects fresh append before key IO while mounts remain live', async () => {
  const secrets = { n8n: token, ...Object.fromEntries(Array.from({ length: 127 }, (_, i) => ['ref' + i, 'SYNTHETIC-' + i])) };
  const f = await credentialed(1, { secrets }); const calls = f.keyCalls.length; const before = structuredClone(f.store.data); const held = evidence(f);
  try { await reject(f.invoke('setSecret', { ref: 'overflow', value: fresh }), 'secret-limit'); assert.equal(f.keyCalls.length, calls); assert.deepEqual(f.store.data, before); checkRetained(f, held); }
  finally { await f.controller.dispose(); }
});

for (const fault of ['missing', 'tampered']) test('mounted append key ' + fault + ' fails closed, retains ref/drift evidence, and never creates/replaces a key', async () => {
  const f = await credentialed(); const held = evidence(f); const before = structuredClone(f.store.data); const cachedKey = f.controller.key;
  try {
    f.faultKey(fault); await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), fault === 'missing' ? 'vault-key-unavailable' : 'vault-unlock-failed');
    assert.equal(f.controller.key, null); assert.equal(f.controller.secrets, null); assert.ok(cachedKey.every(byte => byte === 0));
    assert.deepEqual(f.store.data, before); assert.equal(f.keyCalls.at(-1).create, false); checkRetained(f, held);
    const calls = f.keyCalls.length;
    for (const ref of ['n8n', 'unused']) await reject(f.invoke('setSecret', { ref, value: fresh }), 'stop-before-secret-change');
    await reject(f.invoke('deleteSecret', { ref: 'unused' }), 'stop-before-secret-change'); assert.equal(f.keyCalls.length, calls);
    f.store.data.vault = seal({ n8n: token, unused }, f.key, Buffer.alloc(16, 0x22), AUTOMATIC_KDF);
    await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), 'vault-drift'); await reject(f.invoke('snapshot'), 'vault-drift'); assert.equal(f.keyCalls.length, calls); checkRetained(f, held);
    f.store.data = before; f.faultKey(null); await f.invoke('setSecret', { ref: 'newHeader', value: fresh }); assert.equal(f.controller.secrets.n8n, token); checkRetained(f, held);
  } finally { await f.controller.dispose(); }
});

for (const fault of ['nonce', 'invalid-tag', 'null', 'manual-mode']) test('mounted automatic ' + fault + ' substitution is rejected before key IO/teardown, even after cache wipe', async () => {
  const f = await credentialed(); const held = evidence(f); const calls = f.keyCalls.length;
  try {
    f.controller.clearCredentials();
    if (fault === 'nonce') f.store.data.vault.nonce = Buffer.alloc(12, 0x2f).toString('base64');
    if (fault === 'invalid-tag') f.store.data.vault.tag = 'invalid';
    if (fault === 'null') f.store.data.vault = null;
    if (fault === 'manual-mode') f.store.data.vault.kdf = 'scrypt-N32768-r8-p1';
    const code = fault === 'invalid-tag' ? 'vault-invalid' : 'vault-drift';
    await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), code); await reject(f.invoke('snapshot'), code);
    assert.equal(f.keyCalls.length, calls); assert.equal(f.controller.key, null); checkRetained(f, held);
  } finally { await f.controller.dispose(); }
});

for (const fault of ['null', 'manual-mode', 'ciphertext']) test('explicit target Stop under automatic ' + fault + ' drift never disposes unrelated live siblings or adopts corrupt mode', async () => {
  const f = await credentialed(2); const [first, second] = f.store.data.servers.map(server => server.id); const handle = f.controller.live.get(second); const time = f.controller.lastVerifiedAt.get(second); const calls = f.keyCalls.length; const writes = f.store.writes;
  try {
    if (fault === 'null') f.store.data.vault = null;
    if (fault === 'manual-mode') f.store.data.vault.kdf = 'scrypt-N32768-r8-p1';
    if (fault === 'ciphertext') f.store.data.vault.nonce = Buffer.alloc(12, 0x2f).toString('base64');
    await reject(f.invoke('stop', { id: first }), 'vault-drift');
    assert.equal(f.controller.live.has(first), false); assert.equal(f.controller.live.get(second), handle); assert.equal(f.controller.lastVerifiedAt.get(second), time);
    assert.equal(f.mounts[0].stops, 1); assert.equal(f.mounts[1].stops, 0); assert.equal(handle.tool.call(), token); assert.equal(f.keyCalls.length, calls); assert.equal(f.store.writes, writes + 1); assert.deepEqual(f.store.data.enabledIds, [second]);
    assert.equal(f.controller.key, null); assert.equal(f.controller.secrets, null); assert.equal(f.controller.mode, 'automatic'); await reject(f.invoke('snapshot'), 'vault-drift');
  } finally { await f.controller.dispose(); }
});

test('unknown mounted authentication/membership fails closed, including null vault with mutated saved bindings', async () => {
  const f = await credentialed(); const calls = f.keyCalls.length; const held = evidence(f); const originalVault = structuredClone(f.store.data.vault);
  try {
    f.controller.clearCredentials(); f.controller.authenticatedEnvelope = null; f.controller.authenticatedRefs = null;
    await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), 'vault-locked'); await reject(f.invoke('snapshot'), 'vault-locked');
    assert.equal(f.controller.snapshot(f.store.data).capabilities.appendSecretsWhileMounted, undefined);
    f.store.data.vault = null; f.store.data.servers[0].headerRefs = {};
    await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), 'vault-locked'); await reject(f.invoke('snapshot'), 'vault-locked');
    assert.equal(f.controller.snapshot(f.store.data).capabilities.appendSecretsWhileMounted, undefined);
    f.store.data.vault = { ...originalVault, kdf: 'scrypt-N32768-r8-p1' };
    await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), 'vault-locked'); await reject(f.invoke('snapshot'), 'vault-locked');
    assert.equal(f.controller.mode, 'automatic'); assert.equal(f.keyCalls.length, calls); checkRetained(f, held);
  } finally { await f.controller.dispose(); }
});

test('failed stop retains owned credentialed handle; only fresh automatic refs may still append', async () => {
  const f = await credentialed(); const id = f.store.data.servers[0].id; const handle = f.controller.live.get(id); const time = f.controller.lastVerifiedAt.get(id);
  try {
    f.faultStop(true); await reject(f.invoke('stop', { id }), 'stop-failed');
    for (const ref of ['n8n', 'unused']) { await reject(f.invoke('setSecret', { ref, value: fresh }), 'stop-before-secret-change'); await reject(f.invoke('deleteSecret', { ref }), 'stop-before-secret-change'); }
    const result = await f.invoke('setSecret', { ref: 'newHeader', value: fresh });
    assert.equal(result.servers[0].state, 'stop-failed'); assert.equal(result.servers[0].lastVerifiedAt, time); assert.equal(f.controller.live.get(id), handle); assert.equal(handle.tool.call(), token); assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].stops, 1);
  } finally { f.faultStop(false); await f.controller.dispose(); }
});

test('reply validation and proven pre-publication failure do not persist or install new secrets', async () => {
  const f = await credentialed(); const before = structuredClone(f.store.data); const held = evidence(f); const writes = f.store.writes;
  try {
    f.controller.inventory = () => ({ available: true, servers: ['x'.repeat(33)] });
    await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), 'snapshot-contract-failed');
    assert.equal(f.store.writes, writes); assert.deepEqual(f.store.data, before); assert.deepEqual(f.controller.secrets, { n8n: token, unused }); checkRetained(f, held);
    f.controller.inventory = () => ({ available: false, servers: [] }); const write = f.store.write.bind(f.store);
    f.store.write = async () => { throw new ConsoleError('store-write-failed'); };
    await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), 'store-write-failed');
    assert.deepEqual(f.store.data, before); assert.deepEqual(f.controller.secrets, { n8n: token, unused }); assert.equal(f.controller.secretStateAmbiguous, false); checkRetained(f, held);
    f.store.write = write; await f.invoke('setSecret', { ref: 'newHeader', value: fresh }); checkRetained(f, held);
  } finally { await f.controller.dispose(); }
});

for (const fault of ['after-publication', 'readback', 'unrelated', 'release']) test('mounted append ' + fault + ' ambiguity is quarantined without rollback, stale memory or mount disposal', async () => {
  const f = await credentialed(2); const held = evidence(f); const before = structuredClone(f.store.data); const cachedKey = f.controller.key; const keys = f.returnedKeys;
  const write = f.store.write.bind(f.store); const read = f.store.read.bind(f.store); const transaction = f.store.transaction.bind(f.store); let writes = 0; let unreadable = false;
  try {
    f.store.read = async () => { if (unreadable) throw new Error('SYNTHETIC-READBACK-FAULT'); return read(); };
    f.store.write = async value => {
      writes++; await write(value);
      if (fault === 'readback') unreadable = true;
      if (fault === 'unrelated') { f.store.data.revision++; f.store.data.vault = seal({ n8n: 'SYNTHETIC-UNRELATED-WRITER', unused }, f.key, Buffer.alloc(16, 0x28), AUTOMATIC_KDF); }
      if (fault !== 'release') throw new ConsoleError('store-write-failed');
    };
    if (fault === 'release') f.store.transaction = async fn => { await transaction(fn); throw new Error('SYNTHETIC-RELEASE-FAULT'); };
    await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), 'secret-state-ambiguous');
    assert.equal(writes, 1); assert.equal(f.controller.secretStateAmbiguous, true); assert.equal(f.controller.key, null); assert.equal(f.controller.secrets, null); assert.ok(cachedKey.every(byte => byte === 0)); assert.ok(keys.every(key => key.every(byte => byte === 0))); checkRetained(f, held);
    assert.equal(f.controller.snapshot(f.store.data).capabilities.appendSecretsWhileMounted, undefined);
    f.store.read = read; f.store.write = write; f.store.transaction = transaction; const calls = f.keyCalls.length;
    if (fault === 'after-publication' || fault === 'release') {
      const result = await f.invoke('snapshot'); assert.deepEqual(result.vault.refs, ['n8n', 'newHeader', 'unused']); assert.equal(result.capabilities.appendSecretsWhileMounted, undefined); assert.equal(f.controller.secrets.n8n, token);
      for (const [method, fields] of [['setSecret', { ref: 'retry', value: fresh }], ['deleteSecret', { ref: 'unused' }], ['reconnect', { id: before.servers[0].id, confirmation: 'RECONNECT THIS SERVER' }], ['saveAndActivate', { server: { ...base, headerRefs: { Authorization: 'n8n' } }, confirmation: 'SAVE AND ACTIVATE THIS SERVER' }]]) await reject(f.invoke(method, fields), 'secret-state-ambiguous');
      assert.equal(f.keyCalls.length, calls + 1);
    } else {
      await reject(f.invoke('snapshot'), 'vault-drift'); await reject(f.invoke('setSecret', { ref: 'retry', value: fresh }), 'vault-drift'); assert.equal(f.keyCalls.length, calls);
    }
    assert.equal(writes, 1); checkRetained(f, held);
  } finally { f.store.read = read; f.store.write = write; f.store.transaction = transaction; await f.controller.dispose(); }
});

for (const published of [false, true]) test('first mounted credential publication ' + (published ? 'after' : 'before') + ' publication failure wipes the pending key and preserves credential-free handle', async () => {
  const f = fixture({ secrets: null }); const id = await f.mount(false); const held = f.controller.live.get(id); const before = structuredClone(f.store.data); const write = f.store.write.bind(f.store);
  try {
    f.store.write = async value => { if (published) await write(value); throw new ConsoleError('store-write-failed'); };
    await reject(f.invoke('setSecret', { ref: 'firstHeader', value: fresh }), published ? 'secret-state-ambiguous' : 'store-write-failed');
    assert.equal(f.controller.key, null); assert.equal(f.controller.secrets, null); assert.ok(f.returnedKeys.every(key => key.every(byte => byte === 0)));
    assert.equal(f.controller.live.get(id), held); assert.equal(f.mounts[0].stops, 0); assert.equal(held.tool.call(), 'credential-free'); assert.deepEqual(f.keyCalls, [{ create: true }]);
    if (published) { const result = await f.invoke('snapshot'); assert.deepEqual(result.vault.refs, ['firstHeader']); assert.equal(result.capabilities.appendSecretsWhileMounted, undefined); }
    else { assert.deepEqual(f.store.data, before); assert.equal(f.controller.secretStateAmbiguous, false); }
  } finally { f.store.write = write; await f.controller.dispose(); }
});

test('maximum valid store revision rejects mounted append reply before publishing an invalid next revision', async () => {
  const f = await credentialed(); const held = evidence(f); f.store.data.revision = Number.MAX_SAFE_INTEGER - 1; const before = structuredClone(f.store.data); const writes = f.store.writes;
  try { await reject(f.invoke('setSecret', { ref: 'newHeader', value: fresh }), 'snapshot-contract-failed'); assert.deepEqual(f.store.data, before); assert.equal(f.store.writes, writes); checkRetained(f, held); }
  finally { await f.controller.dispose(); }
});

test('same-controller racing mounted appends serialize one revision and reject stale loser before key IO', async () => {
  const f = await credentialed(); const revision = f.store.data.revision; const calls = f.keyCalls.length; const held = evidence(f);
  try {
    const results = await Promise.allSettled(['first', 'second'].map(ref => f.controller.invoke('setSecret', { revision, ref, value: fresh }, owner)));
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'revision-conflict'); assert.equal(f.keyCalls.length, calls + 1);
    assert.deepEqual(unseal(f.store.data.vault, f.key), { n8n: token, unused, first: fresh }); checkRetained(f, held);
  } finally { await f.controller.dispose(); }
});

test('mounted FileStore append obeys concurrent writer lock/stale revision and never rotates its synthetic private key', async () => {
  const fixtures = fileURLToPath(new URL('./.fixtures/', import.meta.url)); await mkdir(fixtures, { recursive: true, mode: 0o700 });
  const directory = join(fixtures, 'mounted-append-' + randomBytes(12).toString('hex')); assert.equal(dirname(directory) + '/', fixtures);
  const store = new FileStore(directory); const f = fixture({ secrets: null, store }); const otherStore = new FileStore(directory); let otherCalls = 0;
  f.controller.automaticKey = options => { f.keyCalls.push(options); return store.privateKey(options); };
  const other = new ConsoleController({ store: otherStore, automaticKey: options => { otherCalls++; return otherStore.privateKey(options); }, mount: () => assert.fail('never mounts') });
  const invoke = async (method, fields = {}) => f.controller.invoke(method, { revision: (await store.read())?.revision ?? 0, ...fields }, owner);
  let release;
  try {
    await invoke('setSecret', { ref: 'n8n', value: token }); await invoke('setSecret', { ref: 'unused', value: unused });
    const saved = await invoke('saveAndActivate', { server: { ...base, headerRefs: { Authorization: 'n8n' } }, confirmation: 'SAVE AND ACTIVATE THIS SERVER' });
    const held = evidence(f); const revision = saved.revision; const keyBefore = await readFile(store.keyFile); let entered;
    const inside = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; }); const privateKey = store.privateKey.bind(store);
    store.privateKey = async options => { entered(); await gate; return privateKey(options); };
    const running = f.controller.invoke('setSecret', { revision, ref: 'newHeader', value: fresh }, owner); await inside;
    try {
      await reject(other.invoke('setSecret', { revision, ref: 'race', value: fresh }, owner), 'store-busy'); assert.equal(otherCalls, 0);
      release(); await running; await reject(other.invoke('setSecret', { revision, ref: 'race', value: fresh }, owner), 'revision-conflict'); assert.equal(otherCalls, 0);
      assert.deepEqual(await readFile(store.keyFile), keyBefore); assert.deepEqual(unseal((await store.read()).vault, keyBefore), { n8n: token, unused, newHeader: fresh }); checkRetained(f, held);
      const external = await other.invoke('setSecret', { revision: revision + 1, ref: 'external', value: 'SYNTHETIC-EXTERNAL-WRITER' }, owner); const calls = f.keyCalls.length;
      await reject(f.controller.invoke('setSecret', { revision: external.revision, ref: 'afterExternal', value: fresh }, owner), 'vault-drift');
      assert.equal(f.keyCalls.length, calls); assert.deepEqual(await readFile(store.keyFile), keyBefore); checkRetained(f, held);
    } finally { release(); await running.catch(() => {}); }
  } finally { release?.(); await f.controller.dispose(); await other.dispose(); assert.equal(dirname(directory) + '/', fixtures); await rm(directory, { recursive: true, force: true }); }
});

test('append capability is optional literal true in strict output only; 12 original RPC shapes remain unchanged and policy input is strict', async () => {
  const { schemas, result } = makeSchemas(z); assert.equal(METHODS.length, 13); assert.deepEqual(Object.keys(schemas), METHODS);
  const f = fixture({ secrets: null });
  try {
    const snapshot = await f.invoke('snapshot'); assert.deepEqual(snapshot.capabilities, { saveAndActivate: true, appendSecretsWhileMounted: true, persistentActivation: true, toolPolicy: true, configurableTimeout: true }); assert.equal(result.safeParse(snapshot).success, true);
    for (const capabilities of [undefined, { saveAndActivate: true }, { saveAndActivate: true, appendSecretsWhileMounted: true }]) assert.equal(result.safeParse({ ...snapshot, capabilities }).success, true);
    for (const value of [false, 'true', 1, null]) assert.equal(result.safeParse({ ...snapshot, capabilities: { saveAndActivate: true, appendSecretsWhileMounted: value } }).success, false);
    assert.equal(result.safeParse({ ...snapshot, capabilities: { saveAndActivate: true, appendSecretsWhileMounted: true, unknown: true } }).success, false);
    const id = 'a'.repeat(24); const target = { revision: 0, id };
    const inputs = { snapshot: {}, save: { revision: 0, server: base }, saveAndActivate: { revision: 0, server: base, confirmation: 'SAVE AND ACTIVATE THIS SERVER' }, deleteServer: target, start: { ...target, confirmation: 'START THIS SERVER' }, reconnect: { ...target, confirmation: 'RECONNECT THIS SERVER' }, stop: target, initializeVault: { revision: 0, passphrase: 'SYNTHETIC-ONLY-PASSPHRASE' }, unlock: { revision: 0, passphrase: 'SYNTHETIC-ONLY-PASSPHRASE', ttlSeconds: 30 }, lock: { revision: 0 }, setSecret: { revision: 0, ref: 'fresh', value: fresh }, deleteSecret: { revision: 0, ref: 'fresh' }, setToolPolicy: { ...target, toolPolicy: { mode: 'all', names: [] } } };
    for (const method of METHODS) { assert.equal(schemas[method].safeParse(inputs[method]).success, true, method); assert.equal(schemas[method].safeParse({ ...inputs[method], appendSecretsWhileMounted: true }).success, false, method); }
  } finally { await f.controller.dispose(); }
});
