import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, readFile, writeFile, lstat, chmod, unlink, symlink, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { ConsoleController } from '../src/controller.js';
import { FileStore, ConsoleError } from '../src/storage.js';
import { AUTOMATIC_KDF, seal, unseal, validateEnvelope } from '../src/vault.js';
import { makeSchemas, METHODS } from '../src/contract.js';
const owner = { kind: 'owner' };
const token = 'SYNTHETIC-AUTOMATIC-TOKEN-NOT-A-REAL-CREDENTIAL';
const passphrase = 'synthetic-manual-passphrase';
const base = { label: 'Synthetic only', transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: {} };
const fixtures = fileURLToPath(new URL('./.fixtures/', import.meta.url));
const reject = (promise, code) => assert.rejects(promise, e => e.code === code && e.message === code);
class MemoryStore {
  data = null;
  async read() { return structuredClone(this.data); }
  async transaction(fn) { return fn(); }
  async write(value) { this.data = structuredClone(value); }
}
function controllerFor(store, extra = {}) {
  const mounts = []; const keys = []; const keyCalls = [];
  const controller = new ConsoleController({ store,
    automaticKey: async options => { keyCalls.push(options); const key = await store.privateKey(options); keys.push(key); return key; },
    mount: async config => { const entry = { config, stopped: false }; mounts.push(entry); return { dispose: async () => { entry.stopped = true; } }; }, ...extra });
  const invoke = async (method, fields = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: (await store.read())?.revision ?? 0, ...fields }, owner);
  return { controller, mounts, keys, keyCalls, invoke };
}
async function fixture(fn) {
  await mkdir(fixtures, { recursive: true, mode: 0o700 });
  const directory = join(fixtures, 'automatic-' + randomBytes(12).toString('hex'));
  assert.equal(dirname(directory) + '/', fixtures, 'cleanup is limited to this generated synthetic fixture');
  const store = new FileStore(directory); const f = controllerFor(store);
  try { return await fn({ ...f, store, directory }); }
  finally { await f.controller.dispose().catch(() => {}); await rm(directory, { recursive: true, force: true }); }
}

test('automatic startup/snapshot/blank metadata save create no key or vault; empty credential RPC remains invalid', async () => fixture(async f => {
  await assert.rejects(lstat(f.directory), { code: 'ENOENT' });
  const initial = await f.invoke('snapshot');
  assert.deepEqual(initial.vault, { mode: 'automatic', initialized: false, locked: false, expiresAt: 0, refs: [] });
  assert.equal(f.mounts.length, 0); assert.equal(f.keyCalls.length, 0);
  await assert.rejects(lstat(f.directory), { code: 'ENOENT' });
  const saved = await f.invoke('save', { server: base });
  assert.equal(saved.revision, 1); assert.equal((await f.store.read()).vault, null);
  assert.deepEqual((await readdir(f.directory)).sort(), ['store.json']);
  await reject(f.invoke('setSecret', { ref: 'token', value: '' }), 'invalid-input');
  assert.equal(f.keyCalls.length, 0); assert.equal((await f.store.read()).revision, 1);
}));

test('first automatic secret is one revision transaction with private random key, ciphertext only and explicit mount', async () => fixture(async f => {
  const result = await f.invoke('setSecret', { ref: 'token', value: token });
  assert.equal(result.revision, 1); assert.deepEqual(result.vault, { mode: 'automatic', initialized: true, locked: false, expiresAt: 0, refs: ['token'] });
  const disk = await readFile(f.store.file, 'utf8'); const key = await readFile(f.store.keyFile);
  assert.equal(key.length, 32); assert.ok(!disk.includes(token)); assert.ok(!disk.includes(passphrase)); assert.ok(!key.includes(Buffer.from(token)));
  assert.equal((await lstat(f.directory)).mode & 0o777, 0o700); assert.equal((await lstat(f.store.keyFile)).mode & 0o777, 0o600);
  const persisted = await f.store.read(); assert.equal(persisted.vault.kdf, AUTOMATIC_KDF);
  assert.deepEqual(Object.keys(persisted.vault).sort(), ['ciphertext', 'kdf', 'nonce', 'salt', 'tag', 'version']);
  assert.equal(f.mounts.length, 0); assert.ok(!JSON.stringify(result).includes(token));
  const id = (await f.invoke('save', { server: { ...base, headerRefs: { Authorization: 'token' } } })).servers[0].config.id;
  await f.invoke('save', { server: { ...base, id, label: 'Metadata edit keeps reference', headerRefs: { Authorization: 'token' } } });
  assert.deepEqual((await f.store.read()).servers[0].headerRefs, { Authorization: 'token' });
  const mounted = await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
  assert.equal(f.mounts[0].config.headers.Authorization, token); assert.ok(!JSON.stringify(mounted).includes(token));
  const held = f.controller.key; await f.controller.dispose();
  assert.ok(held.every(byte => byte === 0)); assert.equal(f.controller.key, null); assert.equal(f.controller.secrets, null); assert.equal(f.mounts[0].stopped, true);
}));

test('restart automatically rehydrates refs and explicit start/reconnect uses configured credentials without password or auto mounts', async () => fixture(async f => {
  await f.invoke('setSecret', { ref: 'token', value: token });
  const id = (await f.invoke('save', { server: { ...base, headerRefs: { Authorization: 'token' } } })).servers[0].config.id;
  await f.controller.dispose();
  const restart = controllerFor(new FileStore(f.directory));
  try {
    assert.equal(restart.controller.key, null); assert.equal(restart.mounts.length, 0);
    const snapshot = await restart.invoke('snapshot'); assert.deepEqual(snapshot.vault.refs, ['token']); assert.equal(snapshot.vault.mode, 'automatic');
    assert.equal(restart.mounts.length, 0); assert.ok(!JSON.stringify(snapshot).includes(token));
    await restart.invoke('start', { id, confirmation: 'START THIS SERVER' });
    const oldKey = restart.controller.key; await restart.invoke('snapshot');
    assert.ok(oldKey.every(byte => byte === 0)); assert.equal(restart.mounts[0].stopped, false, 'rehydration does not lock/dispose children');
    await restart.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' });
    assert.equal(restart.mounts[0].stopped, true); assert.equal(restart.mounts[1].config.headers.Authorization, token);
    const calls = restart.keyCalls.length; await reject(restart.invoke('lock'), 'automatic-mode');
    assert.equal(restart.keyCalls.length, calls); assert.equal(restart.mounts[1].stopped, false);
  } finally { await restart.controller.dispose(); }
}));

test('owner, exact RPC schema, revision, ownership and mounted guards precede automatic key IO and teardown', async () => {
  const store = new MemoryStore(); let keyIO = 0; let stops = 0;
  const f = controllerFor(store, { automaticKey: async () => { keyIO++; return Buffer.alloc(32, 7); }, mount: async () => ({ dispose: async () => { stops++; } }) });
  const request = { revision: 0, ref: 'token', value: token };
  await reject(f.controller.invoke('setSecret', request, { kind: 'worker' }), 'owner-required');
  await reject(f.controller.invoke('setSecret', { ...request, extra: true }, owner), 'invalid-input');
  await reject(f.controller.invoke('setSecret', { ...request, revision: 1 }, owner), 'revision-conflict');
  await reject(f.invoke('start', { id: 'a'.repeat(24), confirmation: 'START THIS SERVER' }), 'not-owned');
  assert.equal(keyIO, 0);
  await f.invoke('setSecret', { ref: 'token', value: token });
  const id = (await f.invoke('save', { server: base })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' }); const calls = keyIO;
  await reject(f.invoke('setSecret', { ref: 'token', value: token }), 'stop-before-secret-change');
  await reject(f.invoke('deleteSecret', { ref: 'token' }), 'stop-before-secret-change');
  await reject(f.invoke('start', { id, confirmation: 'START THIS SERVER' }), 'already-mounted');
  await reject(f.controller.invoke('reconnect', { revision: 0, id, confirmation: 'RECONNECT THIS SERVER' }, owner), 'revision-conflict');
  assert.equal(keyIO, calls); assert.equal(stops, 0); await f.controller.dispose();
});

test('automatic ciphertext drift and missing binding fail before reconnect tears down the old child', async () => fixture(async f => {
  await f.invoke('setSecret', { ref: 'token', value: token });
  const id = (await f.invoke('save', { server: { ...base, headerRefs: { Authorization: 'token' } } })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
  const before = await f.store.read(); const calls = f.keyCalls.length;
  const changed = structuredClone(before); changed.vault = seal({ token }, f.controller.key, randomBytes(16), AUTOMATIC_KDF);
  await f.store.transaction(() => f.store.write(changed));
  await reject(f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), 'vault-drift');
  assert.equal(f.keyCalls.length, calls); assert.equal(f.mounts[0].stopped, false);
  await f.store.transaction(() => f.store.write(before));
  const missing = structuredClone(before); missing.servers[0].headerRefs.Authorization = 'absent';
  await f.store.transaction(() => f.store.write(missing));
  await reject(f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), 'secret-missing');
  assert.equal(f.mounts[0].stopped, false); assert.equal(f.mounts.length, 1);
}));

for (const fault of ['missing', 'short', 'oversize', 'tampered', 'permissions', 'symlink', 'directory']) {
  test('automatic protected key fails safely without replacement: ' + fault, async () => fixture(async f => {
    await f.invoke('setSecret', { ref: 'token', value: token });
    const id = (await f.invoke('save', { server: { ...base, headerRefs: { Authorization: 'token' } } })).servers[0].config.id;
    await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
    const disk = await readFile(f.store.file, 'utf8'); const keyPath = f.store.keyFile;
    assert.equal(keyPath, join(f.directory, 'private-key.bin'));
    if (fault === 'missing' || fault === 'symlink' || fault === 'directory') await unlink(keyPath);
    if (fault === 'short') await writeFile(keyPath, Buffer.alloc(0));
    if (fault === 'oversize') await writeFile(keyPath, Buffer.alloc(33));
    if (fault === 'tampered') await writeFile(keyPath, randomBytes(32));
    if (fault === 'permissions') await chmod(keyPath, 0o644);
    if (fault === 'symlink') { const target = join(f.directory, 'synthetic-key-target'); await writeFile(target, randomBytes(32), { mode: 0o600 }); await symlink(target, keyPath); }
    if (fault === 'directory') await mkdir(keyPath, { mode: 0o700 });
    const expected = fault === 'tampered' ? 'vault-unlock-failed' : 'vault-key-unavailable';
    await reject(f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), expected);
    assert.equal(f.mounts[0].stopped, false); assert.equal(f.mounts.length, 1); assert.equal(await readFile(f.store.file, 'utf8'), disk);
    assert.equal(f.controller.key, null); assert.equal(f.controller.secrets, null);
    await reject(f.invoke('snapshot'), expected);
    if (fault === 'missing') await assert.rejects(lstat(keyPath), { code: 'ENOENT' });
  }));
}

test('failed first publication wipes pending key; orphan is reusable only with no persisted vault, and later failure preserves old envelope/value', async () => fixture(async f => {
  const originalWrite = f.store.write.bind(f.store); f.store.write = async () => { throw new ConsoleError('store-write-failed'); };
  await reject(f.invoke('setSecret', { ref: 'token', value: token }), 'store-write-failed');
  const orphan = await readFile(f.store.keyFile); assert.equal(await f.store.read(), null); assert.equal(f.controller.key, null); assert.equal(f.controller.secrets, null);
  assert.ok(f.keys[0].every(byte => byte === 0));
  f.store.write = originalWrite; const saved = await f.invoke('setSecret', { ref: 'token', value: token }); assert.equal(saved.revision, 1);
  assert.deepEqual(await readFile(f.store.keyFile), orphan); const old = await readFile(f.store.file, 'utf8');
  f.store.write = async () => { throw new ConsoleError('store-write-failed'); };
  await reject(f.invoke('setSecret', { ref: 'token', value: 'SYNTHETIC-REPLACEMENT' }), 'store-write-failed');
  assert.equal(await readFile(f.store.file, 'utf8'), old); assert.equal(f.controller.secrets.token, token); assert.deepEqual(await readFile(f.store.keyFile), orphan);
}));

test('key creation requires writer lock and failed directory fsync keeps an orphan without publishing credentials', async () => fixture(async f => {
  await f.store.prepare();
  await reject(f.store.privateKey({ create: true }), 'vault-key-unavailable');
  await assert.rejects(lstat(f.store.keyFile), { code: 'ENOENT' });
  const sync = f.store.syncDirectory.bind(f.store); f.store.syncDirectory = async () => { throw new Error('SYNTHETIC-PRIVATE-PATH-MUST-NOT-ESCAPE'); };
  await reject(f.invoke('setSecret', { ref: 'token', value: token }), 'vault-key-unavailable');
  assert.equal(await f.store.read(), null); assert.equal(f.controller.key, null); const orphan = await readFile(f.store.keyFile);
  f.store.syncDirectory = sync; assert.equal((await f.invoke('setSecret', { ref: 'token', value: token })).revision, 1);
  assert.deepEqual(await readFile(f.store.keyFile), orphan);
}));

test('ambiguous post-publication failure retains key and supports authenticated restart recovery', async () => fixture(async f => {
  const publish = f.store.write.bind(f.store); f.store.write = async value => { await publish(value); throw new ConsoleError('store-write-failed'); };
  await reject(f.invoke('setSecret', { ref: 'token', value: token }), 'store-write-failed');
  assert.equal(f.controller.key, null); const key = await readFile(f.store.keyFile); assert.equal(key.length, 32);
  const restart = controllerFor(new FileStore(f.directory));
  try { const result = await restart.invoke('snapshot'); assert.equal(result.revision, 1); assert.deepEqual(result.vault.refs, ['token']); assert.equal(restart.controller.secrets.token, token); }
  finally { await restart.controller.dispose(); }
}));

test('concurrent FileStore writers share exclusive lock and never overwrite/regenerate a published key', async () => fixture(async f => {
  let entered; let release; const inside = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  const privateKey = f.store.privateKey.bind(f.store); f.store.privateKey = async options => { entered(); await gate; return privateKey(options); };
  const other = controllerFor(new FileStore(f.directory));
  const first = f.controller.invoke('setSecret', { revision: 0, ref: 'token', value: token }, owner); await inside;
  try {
    await reject(other.controller.invoke('setSecret', { revision: 0, ref: 'token', value: 'SYNTHETIC-RACE' }, owner), 'store-busy');
    assert.equal(other.keyCalls.length, 0); release(); assert.equal((await first).revision, 1);
    const key = await readFile(f.store.keyFile);
    await reject(other.controller.invoke('setSecret', { revision: 0, ref: 'token', value: 'SYNTHETIC-RACE' }, owner), 'revision-conflict');
    assert.equal(other.keyCalls.length, 0);
    assert.equal((await other.invoke('setSecret', { ref: 'token', value: 'SYNTHETIC-NEXT' })).revision, 2);
    assert.deepEqual(await readFile(f.store.keyFile), key); assert.deepEqual((await readdir(f.directory)).sort(), ['private-key.bin', 'store.json']);
  } finally { release(); await first.catch(() => {}); await other.controller.dispose(); }
}));

test('legacy manual envelope remains manual with an automatic provider and never bypasses its passphrase', async () => {
  const store = new MemoryStore(); const manual = new ConsoleController({ store, mount: async () => assert.fail('no automatic mount') });
  const invokeManual = (method, fields) => manual.invoke(method, { revision: store.data?.revision ?? 0, ...fields }, owner);
  await invokeManual('initializeVault', { passphrase }); await invokeManual('unlock', { passphrase, ttlSeconds: 30 }); await invokeManual('setSecret', { ref: 'token', value: token }); await manual.dispose();
  let keyIO = 0; const f = controllerFor(store, { automaticKey: async () => { keyIO++; assert.fail('legacy must not read automatic key'); } });
  assert.deepEqual((await f.invoke('snapshot')).vault, { mode: 'passphrase', initialized: true, locked: true, expiresAt: 0, refs: [] });
  await reject(f.invoke('setSecret', { ref: 'token', value: 'SYNTHETIC-CHANGE' }), 'vault-locked');
  await reject(f.invoke('unlock', { passphrase: 'synthetic-wrong-passphrase', ttlSeconds: 30 }), 'vault-unlock-failed');
  await f.invoke('unlock', { passphrase, ttlSeconds: 30 }); assert.equal(f.controller.secrets.token, token);
  assert.equal(store.data.vault.kdf, 'scrypt-N32768-r8-p1'); assert.equal(keyIO, 0); await f.controller.dispose();
});

test('dual strict envelopes use distinct authenticated AAD and optional mode preserves legacy results and all 11 legacy RPC inputs', async () => {
  const key = randomBytes(32); const salt = randomBytes(16);
  try {
    const automatic = seal({ token }, key, salt, AUTOMATIC_KDF); const manual = seal({ token }, key, salt);
    validateEnvelope(automatic); validateEnvelope(manual); assert.equal(unseal(automatic, key).token, token); assert.equal(unseal(manual, key).token, token);
    for (const changed of [{ ...automatic, kdf: manual.kdf }, { ...manual, kdf: automatic.kdf }, { ...automatic, salt: randomBytes(16).toString('base64') }]) assert.throws(() => unseal(changed, key), e => e.code === 'vault-unlock-failed');
    for (const changed of [{ ...automatic, extra: true }, { ...automatic, version: 2 }, { ...automatic, kdf: 'unknown' }]) assert.throws(() => validateEnvelope(changed), e => e.code === 'vault-invalid');
    const { schemas, result } = makeSchemas(z); assert.equal(METHODS.length, 13); assert.deepEqual(Object.keys(schemas), METHODS);
    const f = controllerFor(new MemoryStore(), { automaticKey: async () => Buffer.alloc(32, 7) }); const snapshot = await f.invoke('snapshot');
    assert.equal(result.safeParse(snapshot).success, true); delete snapshot.vault.mode; assert.equal(result.safeParse(snapshot).success, true);
    snapshot.vault.mode = 'unknown'; assert.equal(result.safeParse(snapshot).success, false);
    await reject(f.invoke('initializeVault', { passphrase }), 'automatic-mode'); await reject(f.invoke('unlock', { passphrase, ttlSeconds: 30 }), 'automatic-mode'); await f.controller.dispose();
  } finally { key.fill(0); }
});
