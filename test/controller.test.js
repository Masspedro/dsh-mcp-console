import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleController, validateServer } from '../src/controller.js';
import { ConsoleError } from '../src/storage.js';
const owner = { kind: 'owner' };
const passphrase = 'synthetic-test-passphrase-only';
const secret = 'SYNTHETIC-SECRET-DO-NOT-USE';
const base = { label: 'Synthetic', transport: 'stdio', command: '/synthetic/no-execution', args: [], cwd: '', envRefs: {} };
class MemoryStore {
  data = null; writes = 0; failWrite = false;
  async read() { return structuredClone(this.data); }
  async transaction(fn) { return fn(); }
  async write(value) { if (this.failWrite) throw new ConsoleError('store-write-failed'); this.data = structuredClone(value); this.writes++; }
}
function fixture(options = {}) {
  const store = new MemoryStore(); const mounts = [];
  const controller = new ConsoleController({ store, mount: async (config) => { const call = { config, stopped: false }; mounts.push(call); return { dispose: async () => { call.stopped = true; } }; }, ...options });
  const invoke = (method, fields = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: store.data?.revision ?? 0, ...fields }, owner);
  return { store, mounts, controller, invoke };
}
const rejectsCode = (promise, code) => assert.rejects(promise, (e) => e.code === code);

test('startup and metadata operations never connect; only owned configs editable', async () => {
  const f = fixture();
  assert.equal((await f.invoke('snapshot')).revision, 0); assert.equal(f.mounts.length, 0); assert.equal(f.store.writes, 0);
  const saved = await f.invoke('save', { server: base }); const id = saved.servers[0].config.id;
  assert.match(saved.servers[0].serverName, /^pc_[a-f0-9]{24}$/); assert.equal(saved.servers[0].state, 'disabled');
  assert.equal(f.mounts.length, 0);
  await rejectsCode(f.invoke('deleteServer', { id: 'a'.repeat(24) }), 'not-owned');
  await f.invoke('deleteServer', { id }); assert.equal(f.store.data.servers.length, 0); await f.controller.dispose();
});
test('owner checks happen before IO and exact schemas reject extras and missing confirmation', async () => {
  const f = fixture();
  for (const principal of [undefined, { kind: 'remote' }, { kind: 'worker' }]) await rejectsCode(f.controller.invoke('snapshot', {}, principal), 'owner-required');
  assert.equal(f.store.writes, 0);
  await rejectsCode(f.invoke('save', { server: { ...base, env: { TOKEN: secret } } }), 'invalid-input');
  await rejectsCode(f.controller.invoke('snapshot', { unexpected: secret }, owner), 'invalid-input');
  await rejectsCode(f.invoke('start', { id: 'a'.repeat(24) }), 'invalid-input');
  await rejectsCode(f.invoke('setSecret', { ref: 'token', value: 'header\r\ninjection' }), 'invalid-input');
});
test('HTTP policy rejects unsafe input without probing; no literal headers supported', () => {
  const server = (url) => ({ label: 'HTTP synthetic', transport: 'streamable-http', url, headerRefs: {} });
  for (const url of ['http://example.com/mcp', 'https://user:pass@example.com/mcp', 'https://example.com/mcp?token=a', 'https://example.com/mcp#token', 'file:///x', 'https://example.com\\evil']) assert.throws(() => validateServer(server(url)));
  for (const url of ['https://example.invalid/mcp', 'http://127.0.0.1:1234/mcp', 'http://localhost:1234', 'http://[::1]:1234']) assert.equal(validateServer(server(url)).transport, 'streamable-http');
  assert.throws(() => validateServer({ ...server('https://example.invalid/mcp'), headers: { Authorization: secret } }));
  assert.throws(() => validateServer({ ...server('https://example.invalid/mcp'), headerRefs: { Host: 'token' } }));
  assert.throws(() => validateServer({ ...server('https://example.invalid/mcp'), headerRefs: { Authorization: 'token', authorization: 'other' } }));
});
test('credential-shaped arguments are rejected, without claiming arbitrary metadata is secret-free', () => {
  for (const args of [['--token', 'synthetic'], ['--api-key=synthetic'], ['--password=synthetic'], ['Authorization: synthetic'], ['Bearer synthetic']]) assert.throws(() => validateServer({ ...base, args }), (error) => error.code === 'credential-argument');
  assert.equal(validateServer({ ...base, args: ['--config', '/synthetic/public-config'] }).args.length, 2);
});
test('owner lock wipes key and stops children before stale revision or unreadable-store failure', async () => {
  for (const corrupt of [false, true]) {
    const f = fixture(); await f.invoke('initializeVault', { passphrase }); await f.invoke('unlock', { passphrase, ttlSeconds: 30 });
    const id = (await f.invoke('save', { server: base })).servers[0].config.id; await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
    const key = f.controller.key;
    if (corrupt) f.store.read = async () => { throw new ConsoleError('store-invalid'); };
    await rejectsCode(f.controller.invoke('lock', { revision: 0 }, owner), corrupt ? 'store-invalid' : 'revision-conflict');
    assert.equal(f.controller.key, null); assert.equal(f.controller.secrets, null); assert.ok(key.every((byte) => byte === 0)); assert.equal(f.mounts[0].stopped, true);
  }
});
test('revisions serialize racing writes and a failed edit preserves saved metadata', async () => {
  const f = fixture();
  const races = await Promise.allSettled([f.controller.invoke('save', { revision: 0, server: base }, owner), f.controller.invoke('save', { revision: 0, server: base }, owner)]);
  assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1); assert.equal(races[1].reason.code, 'revision-conflict');
  const original = JSON.stringify(f.store.data); const id = f.store.data.servers[0].id; f.store.failWrite = true;
  await rejectsCode(f.invoke('save', { server: { ...base, id, label: 'Changed' } }), 'store-write-failed'); assert.equal(JSON.stringify(f.store.data), original);
});
test('explicit starts use only secret refs, claim mounted not connected, and do not silently edit active state', async () => {
  const f = fixture(); await f.invoke('initializeVault', { passphrase });
  assert.equal((await f.invoke('snapshot')).vault.locked, true);
  await f.invoke('unlock', { passphrase, ttlSeconds: 300 }); await f.invoke('setSecret', { ref: 'token', value: secret });
  const state = await f.invoke('save', { server: { ...base, envRefs: { API_TOKEN: 'token' } } }); const id = state.servers[0].config.id;
  const mounted = await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
  assert.equal(mounted.servers[0].state, 'mounted-status-unavailable'); assert.equal(f.mounts[0].config.env.API_TOKEN, secret); assert.equal(f.mounts[0].config.reconnect.enabled, false);
  assert.ok(!JSON.stringify(mounted).includes(secret)); assert.ok(!JSON.stringify(f.store.data).includes(secret));
  await rejectsCode(f.invoke('save', { server: { ...base, id } }), 'stop-before-edit');
  await rejectsCode(f.invoke('deleteServer', { id }), 'stop-before-delete');
  await rejectsCode(f.invoke('setSecret', { ref: 'token', value: 'changed' }), 'stop-before-secret-change');
  await f.invoke('lock'); assert.equal(f.mounts[0].stopped, true); assert.equal(f.controller.key, null); assert.equal(f.controller.secrets, null);
  await rejectsCode(f.invoke('start', { id, confirmation: 'START THIS SERVER' }), 'vault-locked');
  const restart = new ConsoleController({ store: f.store, mount: () => assert.fail('must not mount') });
  assert.equal((await restart.invoke('snapshot', {}, owner)).vault.locked, true); await restart.dispose();
});
test('vault at rest, wrong passphrase, tamper, random nonces, lock and TTL fail closed', async () => {
  let now = 1000; const f = fixture({ now: () => now });
  await f.invoke('initializeVault', { passphrase });
  const disk = JSON.stringify(f.store.data); assert.ok(!disk.includes(passphrase)); assert.equal(f.store.data.vault.kdf, 'scrypt-N32768-r8-p1');
  await rejectsCode(f.invoke('unlock', { passphrase: 'wrong-synthetic-passphrase', ttlSeconds: 30 }), 'vault-unlock-failed');
  await f.invoke('unlock', { passphrase, ttlSeconds: 30 });
  await f.invoke('setSecret', { ref: 'token', value: secret }); const nonce = f.store.data.vault.nonce;
  await f.invoke('setSecret', { ref: 'token', value: secret }); assert.notEqual(f.store.data.vault.nonce, nonce);
  assert.ok(!JSON.stringify(f.store.data).includes(secret)); assert.ok(!JSON.stringify(await f.invoke('snapshot')).includes(secret));
  now = 32000; assert.equal((await f.invoke('snapshot')).vault.locked, true); assert.equal(f.controller.key, null);
  f.store.data.vault.tag = Buffer.alloc(16).toString('base64');
  await rejectsCode(f.invoke('unlock', { passphrase, ttlSeconds: 30 }), 'vault-unlock-failed');
});
test('secret publication failure keeps old encrypted store and decrypted value', async () => {
  const f = fixture(); await f.invoke('initializeVault', { passphrase }); await f.invoke('unlock', { passphrase, ttlSeconds: 30 }); await f.invoke('setSecret', { ref: 'token', value: secret });
  const old = JSON.stringify(f.store.data); f.store.failWrite = true;
  await rejectsCode(f.invoke('setSecret', { ref: 'token', value: 'synthetic-change' }), 'store-write-failed'); assert.equal(f.controller.secrets.token, secret); assert.equal(JSON.stringify(f.store.data), old); await f.controller.dispose();
});
test('mount errors never echo raw secrets and preference publication failure prevents mount', async () => {
  const f = fixture({ mount: async () => { throw new Error(secret); } });
  const id = (await f.invoke('save', { server: base })).servers[0].config.id;
  await assert.rejects(f.invoke('start', { id, confirmation: 'START THIS SERVER' }), (e) => e.code === 'mount-failed' && !e.message.includes(secret));
  assert.equal((await f.invoke('snapshot')).servers[0].state, 'mount-failed');
  const g = fixture(); const gid = (await g.invoke('save', { server: base })).servers[0].config.id; g.store.failWrite = true;
  await rejectsCode(g.invoke('start', { id: gid, confirmation: 'START THIS SERVER' }), 'store-write-failed'); assert.equal(g.mounts.length, 0); assert.deepEqual(g.store.data.enabledIds, []);
});
test('blank saved stdio cwd is omitted at the mount seam and explicit absolute cwd is preserved', async () => {
  const f = fixture();
  const id = (await f.invoke('save', { server: base })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' }); assert.equal(Object.hasOwn(f.mounts[0].config, 'cwd'), false);
  assert.equal(f.store.data.servers[0].cwd, ''); await f.invoke('stop', { id });
  await f.invoke('save', { server: { ...base, id, cwd: '/synthetic/absolute-directory' } });
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' }); assert.equal(f.mounts[1].config.cwd, '/synthetic/absolute-directory');
  await f.controller.dispose();
});
test('TTL callback stops secret-backed synthetic children and clears the key', async () => {
  let timeout;
  const f = fixture({ setTimer: (callback) => { timeout = callback; return { unref() {} }; }, clearTimer: () => {} });
  await f.invoke('initializeVault', { passphrase }); await f.invoke('unlock', { passphrase, ttlSeconds: 30 }); await f.invoke('setSecret', { ref: 'token', value: secret });
  const id = (await f.invoke('save', { server: { ...base, envRefs: { TOKEN: 'token' } } })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
  const heldKey = f.controller.key; timeout(); await f.controller.queue;
  assert.equal(f.mounts[0].stopped, true); assert.ok(heldKey.every((byte) => byte === 0)); assert.equal(f.controller.key, null); assert.equal((await f.invoke('snapshot')).vault.locked, true);
});
test('stop failure retains child ownership and reports honestly while wiping the vault key', async () => {
  const f = fixture({ mount: async () => ({ dispose: async () => { throw new Error(secret); } }) });
  const id = (await f.invoke('save', { server: base })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
  await rejectsCode(f.invoke('stop', { id }), 'stop-failed');
  const status = await f.invoke('snapshot'); assert.equal(status.servers[0].state, 'stop-failed'); assert.equal(f.controller.live.size, 1); assert.ok(!JSON.stringify(status).includes(secret));
  await rejectsCode(f.invoke('start', { id, confirmation: 'START THIS SERVER' }), 'already-mounted');
  await rejectsCode(f.controller.dispose(), 'stop-failed'); assert.equal(f.controller.key, null);
});
test('fulfilled teardown is only an unmount and never claims confirmed server shutdown', async () => {
  const f = fixture();
  const id = (await f.invoke('save', { server: base })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
  const stopped = await f.invoke('stop', { id });
  assert.equal(stopped.servers[0].state, 'unmounted-shutdown-unverified');
  assert.equal(f.controller.live.size, 0);
  assert.equal((await f.invoke('stop', { id })).servers[0].state, 'unmounted-shutdown-unverified');
  assert.equal((await f.invoke('lock')).servers[0].state, 'unmounted-shutdown-unverified');
  await f.controller.dispose();
});
test('missing secrets, limits, delete-in-use and disposal are enforced', async () => {
  const f = fixture(); await f.invoke('initializeVault', { passphrase }); await f.invoke('unlock', { passphrase, ttlSeconds: 30 });
  const id = (await f.invoke('save', { server: { ...base, envRefs: { TOKEN: 'absent' } } })).servers[0].config.id;
  await rejectsCode(f.invoke('start', { id, confirmation: 'START THIS SERVER' }), 'secret-missing');
  await rejectsCode(f.invoke('deleteSecret', { ref: 'absent' }), 'secret-in-use');
  await rejectsCode(f.invoke('setSecret', { ref: '__proto__', value: secret }), 'invalid-input');
  await f.controller.dispose(); await rejectsCode(f.invoke('snapshot'), 'disposed');
});

test('stdio accepts safe executable basenames or absolute paths, never relative paths or shell command strings', () => {
  for (const command of ['node', 'npx', 'python', 'python3.12', '_custom', 'my-tool', '/synthetic/bin/node', '/synthetic/@scope/server']) assert.equal(validateServer({ ...base, command }).command, command);
  for (const command of ['./node', '../bin/node', 'bin/node', 'node --version', 'npx server', 'node;echo', 'node|echo', '$(node)', 'node &', 'C:\\bin\\node', '/usr/bin/node --version', '/usr/bin/node;echo', '/tmp/$(node)', '/tmp/node&other']) assert.throws(() => validateServer({ ...base, command }), error => error.code === 'invalid-input');
});

test('explicit reconnect disposes the old owned child before one native remount and publishes transient initial verification', async () => {
  const events = []; let count = 0;
  const f = fixture({ mount: async config => {
    const generation = ++count; events.push('mount:' + generation);
    assert.equal(config.failOnStartupError, true); assert.equal(config.reconnect.enabled, false);
    return { initialVerified: true, verifiedAt: 1000 + generation, dispose: async () => { events.push('stop:' + generation + ':begin'); await Promise.resolve(); events.push('stop:' + generation + ':end'); } };
  } });
  const id = (await f.invoke('save', { server: { ...base, command: 'node' } })).servers[0].config.id;
  const first = await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
  assert.equal(first.servers[0].state, 'activation-verified'); assert.equal(first.servers[0].lastVerifiedAt, 1001);
  await f.invoke('snapshot'); await f.invoke('snapshot');
  await f.invoke('save', { server: { ...base, label: 'Other saved only', command: 'python' } });
  assert.deepEqual(events, ['mount:1']);
  const reconnected = await f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' });
  assert.deepEqual(events, ['mount:1','stop:1:begin','stop:1:end','mount:2']);
  assert.equal(reconnected.servers[0].state, 'activation-verified'); assert.equal(reconnected.servers[0].lastVerifiedAt, 1002);
  assert.equal(reconnected.servers[1].state, 'disabled'); assert.equal(f.controller.live.size, 1);
  assert.ok(!JSON.stringify(f.store.data).includes('lastVerifiedAt')); assert.ok(!JSON.stringify(f.store.data).includes('activation-verified'));
  const restarted = new ConsoleController({ store: f.store, mount: () => assert.fail('restart/snapshot must not connect') });
  const afterRestart = await restarted.invoke('snapshot', {}, owner);
  assert.ok(afterRestart.servers.every(server => server.state === 'disabled' && !Object.hasOwn(server, 'lastVerifiedAt')));
  await restarted.dispose();
  const stopped = await f.invoke('stop', { id }); assert.equal(Object.hasOwn(stopped.servers[0], 'lastVerifiedAt'), false);
  await f.controller.dispose();
});

test('reconnect authorization, exact confirmation, ownership and stale revision cause no child teardown or remount', async () => {
  let mounts = 0; let stops = 0;
  const f = fixture({ mount: async () => { mounts++; return { dispose: async () => { stops++; } }; } });
  const id = (await f.invoke('save', { server: base })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' }); const revision = f.store.data.revision;
  const request = { revision, id, confirmation: 'RECONNECT THIS SERVER' };
  for (const principal of [undefined, { kind: 'worker' }, { kind: 'remote' }]) await rejectsCode(f.controller.invoke('reconnect', request, principal), 'owner-required');
  await rejectsCode(f.controller.invoke('reconnect', { revision, id }, owner), 'invalid-input');
  await rejectsCode(f.controller.invoke('reconnect', { ...request, confirmation: 'START THIS SERVER' }, owner), 'invalid-input');
  await rejectsCode(f.controller.invoke('reconnect', { ...request, unexpected: secret }, owner), 'invalid-input');
  await rejectsCode(f.controller.invoke('reconnect', { ...request, id: 'a'.repeat(24) }, owner), 'not-owned');
  // Even an expired synthetic key cannot make a stale reconnect trigger cleanup.
  f.controller.key = Buffer.alloc(32, 7); f.controller.secrets = {}; f.controller.envelope = 'null'; f.controller.expiresAt = 1;
  await rejectsCode(f.controller.invoke('reconnect', { ...request, revision: revision - 1 }, owner), 'revision-conflict');
  assert.equal(stops, 0); assert.equal(mounts, 1); assert.equal(f.controller.live.size, 1); assert.ok(f.controller.key.every(byte => byte === 7));
  await f.controller.dispose();
});

test('unverified arbitrary handles never invent successful activation or timestamps', async () => {
  for (const metadata of [{}, { initialVerified: false, verifiedAt: 123 }, { initialVerified: 'true', verifiedAt: 123 }]) {
    const f = fixture({ mount: async () => ({ ...metadata, dispose: async () => {} }) });
    const id = (await f.invoke('save', { server: base })).servers[0].config.id;
    const result = await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
    assert.equal(result.servers[0].state, 'mounted-status-unavailable'); assert.equal(Object.hasOwn(result.servers[0], 'lastVerifiedAt'), false);
    const reconnected = await f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' });
    assert.equal(reconnected.servers[0].state, 'mounted-status-unavailable'); assert.equal(Object.hasOwn(reconnected.servers[0], 'lastVerifiedAt'), false);
    await f.controller.dispose();
  }
  for (const verifiedAt of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, secret]) {
    const f = fixture({ mount: async () => ({ initialVerified: true, verifiedAt, dispose: async () => {} }) });
    const id = (await f.invoke('save', { server: base })).servers[0].config.id;
    const result = await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
    assert.equal(result.servers[0].state, 'activation-verified'); assert.equal(Object.hasOwn(result.servers[0], 'lastVerifiedAt'), false); assert.ok(!JSON.stringify(result).includes(secret));
    await f.controller.dispose();
  }
  const zero = fixture({ mount: async () => ({ initialVerified: true, verifiedAt: 0, dispose: async () => {} }) });
  const id = (await zero.invoke('save', { server: base })).servers[0].config.id;
  assert.equal((await zero.invoke('start', { id, confirmation: 'START THIS SERVER' })).servers[0].lastVerifiedAt, 0); await zero.controller.dispose();
});

test('reconnect stop failure retains the owned old handle and prevents native remount', async () => {
  let mounts = 0;
  const held = { initialVerified: true, verifiedAt: 123, dispose: async () => { throw new Error(secret); } };
  const f = fixture({ mount: async () => { mounts++; return held; } });
  const id = (await f.invoke('save', { server: base })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
  await rejectsCode(f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), 'stop-failed');
  assert.equal(mounts, 1); assert.equal(f.controller.live.get(id), held);
  const result = await f.invoke('snapshot'); assert.equal(result.servers[0].state, 'stop-failed'); assert.equal(result.servers[0].lastVerifiedAt, 123); assert.ok(!JSON.stringify(result).includes(secret));
  await rejectsCode(f.controller.dispose(), 'stop-failed');
});

test('reconnect validates locked, expired, mismatched and missing vault refs before stopping its old child', async () => {
  let now = 1000; let stops = 0; let mounts = 0;
  const f = fixture({ now: () => now, setTimer: () => ({ unref() {} }), clearTimer: () => {}, mount: async config => { mounts++; assert.equal(config.env.API_TOKEN, secret); return { dispose: async () => { stops++; } }; } });
  await f.invoke('initializeVault', { passphrase }); await f.invoke('unlock', { passphrase, ttlSeconds: 30 }); await f.invoke('setSecret', { ref: 'token', value: secret });
  const id = (await f.invoke('save', { server: { ...base, command: 'npx', envRefs: { API_TOKEN: 'token' } } })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
  delete f.controller.secrets.token;
  await rejectsCode(f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), 'secret-missing'); assert.equal(stops, 0);
  f.controller.secrets.token = secret; now = 32000;
  await rejectsCode(f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), 'vault-locked'); assert.equal(stops, 0);
  now = 1000; const oldEnvelope = f.controller.envelope; f.controller.envelope = 'synthetic mismatch';
  await rejectsCode(f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), 'vault-locked'); assert.equal(stops, 0); f.controller.envelope = oldEnvelope;
  f.controller.key.fill(0); f.controller.key = null;
  await rejectsCode(f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), 'vault-locked'); assert.equal(stops, 0);
  assert.equal(mounts, 1); assert.equal(f.controller.live.size, 1); await f.controller.dispose();
});

test('failed initial/remount activation is mount-failed without raw error text or stale verification', async () => {
  for (const remount of [false, true]) {
    let calls = 0; let stops = 0;
    const f = fixture({ mount: async () => { calls++; if (!remount || calls > 1) throw new Error(secret); return { initialVerified: true, verifiedAt: 100, dispose: async () => { stops++; } }; } });
    const id = (await f.invoke('save', { server: base })).servers[0].config.id;
    if (remount) await f.invoke('start', { id, confirmation: 'START THIS SERVER' });
    await assert.rejects(f.invoke(remount ? 'reconnect' : 'start', { id, confirmation: remount ? 'RECONNECT THIS SERVER' : 'START THIS SERVER' }), error => error.code === 'mount-failed' && !error.message.includes(secret));
    const result = await f.invoke('snapshot'); assert.equal(result.servers[0].state, 'mount-failed'); assert.equal(Object.hasOwn(result.servers[0], 'lastVerifiedAt'), false); assert.equal(f.controller.live.size, 0); assert.equal(stops, remount ? 1 : 0); await f.controller.dispose();
  }
  const handle = { initialVerified: true, verifiedAt: 123 };
  const invalid = fixture({ mount: async () => handle });
  const id = (await invalid.invoke('save', { server: base })).servers[0].config.id;
  await rejectsCode(invalid.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), 'stop-failed');
  assert.equal((await invalid.invoke('snapshot')).servers[0].state, 'stop-failed'); assert.equal(invalid.controller.live.get(id), handle);
  await rejectsCode(invalid.controller.dispose(), 'stop-failed'); handle.dispose = async () => {}; await invalid.controller.dispose();
});

test('preference write failure before explicit reconnect preserves the old owned child without remount', async () => {
  const events = []; let count = 0;
  const f = fixture({ mount: async () => { const n = ++count; events.push('mount:' + n); return { initialVerified: true, verifiedAt: 100 + n, dispose: async () => { events.push('stop:' + n); } }; } });
  const id = (await f.invoke('save', { server: base })).servers[0].config.id;
  await f.invoke('start', { id, confirmation: 'START THIS SERVER' }); const before = JSON.stringify(f.store.data);
  f.store.failWrite = true;
  await rejectsCode(f.invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' }), 'store-write-failed');
  assert.deepEqual(events, ['mount:1']); assert.equal(f.controller.live.size, 1); assert.equal(JSON.stringify(f.store.data), before);
  const result = await f.invoke('snapshot'); assert.equal(result.servers[0].lastVerifiedAt, 101); assert.equal(result.servers[0].state, 'activation-verified'); assert.equal(result.servers[0].enabled, true); await f.controller.dispose();
});
