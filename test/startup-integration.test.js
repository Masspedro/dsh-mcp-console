// Genuine private FileStore + console apply lifecycle + official SDK/ToolRuntime.
// Owned loopback endpoint and synthetic credentials only; no user profile/data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ConsoleController } from '../src/controller.js';
import { FileStore } from '../src/storage.js';
import { apply, inject, officialMount, pluginStoreDirectory } from '../src/index.js';
import { SERVICE } from '../src/contract.js';

async function bounded(promise, milliseconds = 8000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Owned startup fixture exceeded bound')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function nativeContext(profile) {
  const ctx = new Context(); new TypertRegistry(ctx);
  ctx.provide('profileContext', profile);
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 });
  new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 1 });
  return ctx;
}

// Failed boot before a healthy sibling, then OFF persistence in a third context.
test('real console startup restores only persisted ON, isolates auth failure, registers tools without executing them and preserves vault/key', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-console-startup-integration-'));
  const profile = { home: root, dir: join(root, 'profiles', 'owned') };
  const store = new FileStore(pluginStoreDirectory(profile));
  const events = []; const synthetic = 'Bearer SYNTHETIC_STARTUP_VALUE';
  const upstream = createServer(async (request, response) => {
    const path = request.url;
    if (path !== '/mcp' || request.headers.authorization !== synthetic) {
      events.push({ path, method: 'denied' }); response.writeHead(401); response.end('Owned denied'); return;
    }
    if (request.method === 'DELETE') { events.push({ path, method: 'delete' }); response.writeHead(204); response.end(); return; }
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    let rpc; try { rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { response.writeHead(400); response.end(); return; }
    events.push({ path, method: rpc.method });
    if (!Object.hasOwn(rpc, 'id')) { response.writeHead(202); response.end(); return; }
    let result;
    if (rpc.method === 'initialize') result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'owned-startup-fixture', version: '0.0.0-test' } };
    else if (rpc.method === 'tools/list') result = { tools: [{ name: 'startup_fixture_tool', description: 'Owned test tool, never called automatically.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] };
    else if (rpc.method === 'tools/call') result = { content: [{ type: 'text', text: 'unexpected automatic call' }], isError: true };
    else if (rpc.method === 'ping') result = {};
    else { response.writeHead(400); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise((done, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', done); });
  const origin = 'http://127.0.0.1:' + upstream.address().port;
  const contexts = []; let seed; let restored;
  try {
    const seedCtx = nativeContext(profile); contexts.push(seedCtx);
    seed = new ConsoleController({ store, automaticKey: options => store.privateKey(options), mount: officialMount(seedCtx) });
    const invoke = (controller, method, extra = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: storeRevision(), ...extra }, { kind: 'owner' });
    let revision = 0; const storeRevision = () => revision;
    const seedCall = async (method, extra = {}) => { const snapshot = await invoke(seed, method, extra); revision = snapshot.revision; return snapshot; };
    const bad = await seedCall('save', { server: { label: 'Owned rejected sibling', transport: 'streamable-http', url: origin + '/denied', headerRefs: {} } });
    const badId = bad.servers[0].config.id;
    await assert.rejects(bounded(seedCall('start', { id: badId, confirmation: 'START THIS SERVER' })), error => error.code === 'connection-auth-denied');
    const afterFailure = await seedCall('snapshot'); assert.equal(afterFailure.servers[0].enabled, true); assert.equal(afterFailure.servers[0].state, 'mount-failed');
    await seedCall('setSecret', { ref: 'ownedStartupToken', value: synthetic });
    const saved = await bounded(seedCall('saveAndActivate', { confirmation: 'SAVE AND ACTIVATE THIS SERVER', server: { label: 'Owned automatic sibling', transport: 'streamable-http', url: origin + '/mcp', headerRefs: { Authorization: 'ownedStartupToken' } } }));
    const good = saved.servers.find(row => row.config.id !== badId); assert.equal(good.enabled, true); assert.equal(good.state, 'activation-verified');
    const tool = 'mcp__' + good.serverName + '__startup_fixture_tool';
    assert.equal(seedCtx.tools.view().visible.has(tool), true);
    await bounded(seed.dispose()); await bounded(seedCtx.fiber.dispose());
    const storedBefore = await readFile(store.file); const keyBefore = await readFile(store.keyFile);
    assert.equal(storedBefore.toString().includes(synthetic), false);
    const before = events.length;
    const bootCtx = nativeContext(profile); contexts.push(bootCtx);
    const bootFiber = bootCtx.plugin({ name: 'owned-console-boot', inject, apply }); await bounded(bootFiber);
    restored = bootCtx.get(SERVICE).controller;
    await bounded(restored.startup()); // Same promise/run already scheduled by apply.
    const snapshot = await restored.invoke('snapshot', {}, { kind: 'owner' });
    const badBoot = snapshot.servers.find(row => row.config.id === badId), goodBoot = snapshot.servers.find(row => row.config.id === good.config.id);
    assert.equal(snapshot.capabilities.persistentActivation, true);
    assert.equal(badBoot.enabled, true); assert.equal(badBoot.state, 'mount-failed');
    assert.equal(goodBoot.enabled, true); assert.equal(goodBoot.state, 'activation-verified'); assert.ok(Number.isSafeInteger(goodBoot.lastVerifiedAt));
    assert.equal(bootCtx.tools.view().visible.has(tool), true); assert.equal(restored.live.size, 1);
    assert.ok(events.slice(before).some(event => event.method === 'denied'));
    assert.equal(events.slice(before).filter(event => event.method === 'initialize').length, 1);
    assert.equal(events.slice(before).filter(event => event.method === 'tools/list').length, 1);
    assert.equal(events.filter(event => event.method === 'tools/call').length, 0);
    assert.deepEqual(await readFile(store.file), storedBefore, 'Startup performs no store/preference/vault write');
    assert.deepEqual(await readFile(store.keyFile), keyBefore, 'Startup never rotates/regenerates key');
    assert.equal(JSON.stringify(snapshot).includes(synthetic), false);
    const stable = events.length; await bounded(restored.startup()); assert.equal(events.length, stable, 'Repeated startup does not reconnect');
    let off = await restored.invoke('stop', { revision: snapshot.revision, id: good.config.id }, { kind: 'owner' });
    off = await restored.invoke('stop', { revision: off.revision, id: badId }, { kind: 'owner' });
    assert.ok(off.servers.every(row => row.enabled === false)); assert.equal(bootCtx.tools.view().visible.has(tool), false);
    await bounded(bootFiber.dispose()); await bounded(bootCtx.fiber.dispose());
    const noStarts = events.length;
    const thirdCtx = nativeContext(profile); contexts.push(thirdCtx);
    const thirdFiber = thirdCtx.plugin({ name: 'owned-console-disabled-boot', inject, apply }); await bounded(thirdFiber);
    const disabled = thirdCtx.get(SERVICE).controller; await bounded(disabled.startup());
    assert.equal(disabled.live.size, 0); assert.equal(disabled.key, null); assert.equal(events.length, noStarts);
    assert.ok((await disabled.invoke('snapshot', {}, { kind: 'owner' })).servers.every(row => !row.enabled));
    await bounded(thirdFiber.dispose()); await bounded(thirdCtx.fiber.dispose());
    keyBefore.fill(0);
  } finally {
    await seed?.dispose().catch(() => {}); await restored?.dispose().catch(() => {});
    for (const ctx of contexts) await bounded(ctx.fiber.dispose(), 2500).catch(() => {});
    upstream.closeAllConnections(); await new Promise(done => upstream.close(done));
    assert.equal(await import('node:fs/promises').then(fs => fs.realpath(root)), resolve(root));
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.match(basename(root), /^mcp-console-startup-integration-[A-Za-z0-9]+$/);
    await rm(root, { recursive: true, force: true });
  }
});

test('mixed cached storage without the startup writer-lock gate cannot start restoration', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-console-startup-integration-'));
  const profile = { home: root, dir: join(root, 'profiles', 'mixed') }, ctx = nativeContext(profile);
  const descriptor = Object.getOwnPropertyDescriptor(FileStore.prototype, 'readForStartup');
  try {
    Object.defineProperty(FileStore.prototype, 'readForStartup', { ...descriptor, value: undefined });
    const fiber = ctx.plugin({ name: 'owned-mixed-boot', inject, apply }); await bounded(fiber);
    const controller = ctx.get(SERVICE).controller;
    assert.equal(controller.startupPromise, null); assert.equal(controller.live.size, 0);
    await assert.rejects(access(pluginStoreDirectory(profile)), error => error.code === 'ENOENT');
    await bounded(fiber.dispose());
  } finally {
    Object.defineProperty(FileStore.prototype, 'readForStartup', descriptor);
    await bounded(ctx.fiber.dispose(), 2500);
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.match(basename(root), /^mcp-console-startup-integration-[A-Za-z0-9]+$/);
    await rm(root, { recursive: true, force: true });
  }
});

test('console lifecycle startup on an empty profile reads metadata only without creating directories or keys', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-console-startup-integration-'));
  const profile = { home: root, dir: join(root, 'profiles', 'empty') }; const ctx = nativeContext(profile);
  try {
    const fiber = ctx.plugin({ name: 'owned-empty-boot', inject, apply }); await bounded(fiber);
    const controller = ctx.get(SERVICE).controller; await bounded(controller.startup());
    assert.equal(controller.live.size, 0); assert.equal(controller.key, null);
    await assert.rejects(access(pluginStoreDirectory(profile)), error => error.code === 'ENOENT');
    await bounded(fiber.dispose());
  } finally {
    await bounded(ctx.fiber.dispose(), 2500);
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.match(basename(root), /^mcp-console-startup-integration-[A-Za-z0-9]+$/);
    await rm(root, { recursive: true, force: true });
  }
});
