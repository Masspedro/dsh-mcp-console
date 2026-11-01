// Focused REAL native MCP regression; no user/SAP server, network or secrets.
// Actual Cordis + official MCP SDK + actual exported ToolRuntime are used.
// Only systemPrompt's declarative hooks are non-IO stand-ins. No MCP/client,
// transport, ToolRuntime registration, or protocol request is mocked.
// Run: node --import ./test/register.js --test test/native-activation.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ConsoleController } from '../src/controller.js';
import { officialMount, externalInventory } from '../src/index.js';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
const fixturePath = fileURLToPath(new URL('./fixtures/syntheticchild.js', import.meta.url));
const owner = { kind: 'owner' };

// This is an isolated node:test process; its only spawned subprocesses come
// from the explicitly configured owned fixture. Read only our kernel children
// list, never another process's arguments/environment or the engine's identity.
function directOwnedChildren() {
  try { return readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8').trim().split(/\s+/).map(Number).filter(pid => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function terminateDirectOwnedChildren(signal) {
  for (const pid of directOwnedChildren()) { try { process.kill(pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
}
async function bounded(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
class MemoryStore {
  data = null;
  async read() { return structuredClone(this.data); }
  async transaction(fn) { return fn(); }
  async write(value) { this.data = structuredClone(value); }
}

// Native initial connect/list and both controlled fixture generations must
// finish by 15s; 20s test bound leaves cleanup room. No 60s SDK stall escapes.
test('real native SDK verifies initial handshake/tools sync, explicitly reconnects owned stdio, and unregisters on stop', { timeout: 20000 }, async t => {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'dsh-mcp-native-test-'));
  const eventsPath = join(directory, 'events.jsonl');
  await writeFile(eventsPath, '', { mode: 0o600 });
  const ctx = new Context();
  // Real ToolRuntime needs only these declarative systemPrompt hooks in native
  // mode; there is no model, rendering, API carrier or prompt assembly here.
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 });
  new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 1 });
  const store = new MemoryStore();
  const controller = new ConsoleController({ store, mount: officialMount(ctx) });
  const invoke = (method, extra = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: store.data?.revision ?? 0, ...extra }, owner);
  const records = async () => (await readFile(eventsPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const names = serverName => [...ctx.tools.view().visible.keys()].filter(name => name.startsWith('mcp__' + serverName + '__'));
  let watchdogFired = false;
  const watchdog = setTimeout(() => { watchdogFired = true; terminateDirectOwnedChildren('SIGKILL'); }, 15000);
  watchdog.unref();
  const abort = () => terminateDirectOwnedChildren('SIGKILL');
  t.signal.addEventListener('abort', abort, { once: true });
  try {
    const saved = await invoke('save', { server: { label: 'Owned synthetic regression only', transport: 'stdio', command: process.execPath, args: [fixturePath, eventsPath], cwd: '', envRefs: {} } });
    const id = saved.servers[0].config.id; const serverName = saved.servers[0].serverName;
    assert.equal(saved.servers[0].state, 'disabled'); assert.equal(directOwnedChildren().length, 0);
    const started = await invoke('start', { id, confirmation: 'START THIS SERVER' });
    assert.equal(started.servers[0].state, 'activation-verified'); assert.ok(Number.isSafeInteger(started.servers[0].lastVerifiedAt));
    assert.deepEqual(names(serverName), ['mcp__' + serverName + '__synthetic_readonly']);
    const firstFiber = [...ctx.registry.get(mcpClient).fibers].find(fiber => fiber.config?.serverName === serverName);
    assert.ok(firstFiber && firstFiber.uid !== null); assert.equal(firstFiber.state, 2, 'Genuine readiness awaited before verification');
    assert.deepEqual(externalInventory(ctx, new Set()), { servers: [serverName], available: true }, 'Genuine public runtime inventory exposes only mounted names');
    assert.deepEqual(externalInventory(ctx, new Set([serverName])), { servers: [], available: true }, 'Owned native fiber is excluded from unmanaged inventory');
    const initial = await records(); const first = initial.find(item => item.event === 'initialize');
    assert.ok(first); assert.ok(initial.some(item => item.pid === first.pid && item.event === 'initialized')); assert.ok(initial.some(item => item.pid === first.pid && item.event === 'tools/list'));
    await invoke('snapshot'); assert.equal((await records()).filter(item => item.event === 'initialize').length, 1);
    const reconnected = await invoke('reconnect', { id, confirmation: 'RECONNECT THIS SERVER' });
    assert.equal(reconnected.servers[0].state, 'activation-verified'); assert.ok(reconnected.servers[0].lastVerifiedAt >= started.servers[0].lastVerifiedAt);
    assert.deepEqual(names(serverName), ['mcp__' + serverName + '__synthetic_readonly']);
    const afterReconnect = await records(); const handshakes = afterReconnect.filter(item => item.event === 'initialize');
    assert.equal(handshakes.length, 2); const second = handshakes[1]; assert.notEqual(second.pid, first.pid);
    const oldExitIndex = afterReconnect.findIndex(item => item.pid === first.pid && item.event === 'exit');
    const newHandshakeIndex = afterReconnect.findIndex(item => item.pid === second.pid && item.event === 'initialize');
    assert.ok(oldExitIndex >= 0 && oldExitIndex < newHandshakeIndex, 'owned old process exits before the new native handshake');
    assert.ok(afterReconnect.some(item => item.pid === second.pid && item.event === 'tools/list'));
    const stopped = await invoke('stop', { id });
    assert.equal(stopped.servers[0].state, 'unmounted-shutdown-unverified'); assert.equal(Object.hasOwn(stopped.servers[0], 'lastVerifiedAt'), false);
    assert.ok(firstFiber.uid === null || firstFiber.state !== 2, 'Old genuine fiber is not active after replacement');
    assert.deepEqual(externalInventory(ctx, new Set()), { servers: [], available: true }, 'Stopped native fibers are omitted from actual runtime inventory');
    assert.deepEqual(names(serverName), []); assert.equal(controller.live.size, 0);
    const finalRecords = await records(); assert.ok(finalRecords.some(item => item.pid === second.pid && item.event === 'exit'));
    assert.equal(directOwnedChildren().length, 0); assert.equal(watchdogFired, false);
    t.diagnostic('REAL installed Cordis/MCP SDK/ToolRuntime passed: two owned-node handshakes + tools/list generations; native tool registered, old process exited before remount, tools unregistered and no child remained. Only declarative systemPrompt hooks were stand-ins.');
  } finally {
    clearTimeout(watchdog); t.signal.removeEventListener('abort', abort);
    const forceKill = setTimeout(() => terminateDirectOwnedChildren('SIGKILL'), 750);
    try { await bounded(controller.dispose(), 2500, 'Owned native controller cleanup exceeded bound'); }
    finally {
      clearTimeout(forceKill); terminateDirectOwnedChildren('SIGKILL');
      await bounded(ctx.fiber.dispose(), 2500, 'Isolated Cordis cleanup exceeded bound');
      // Verify the resolved absolute disposable target before deleting it.
      const absolute = await realpath(directory);
      assert.equal(dirname(absolute), temporaryRoot); assert.ok(basename(absolute).startsWith('dsh-mcp-native-test-')); assert.equal(absolute, resolve(directory));
      await rm(absolute, { recursive: true, force: true });
    }
  }
});

// Save now authorizes an actual connection, not a harmless reachability probe.
// Execute the registered tool through the REAL ToolRuntime before/after OFF/ON.
test('verified Save registers a callable native MCP tool, OFF removes it, and ON restores a fresh verified generation', { timeout: 20000 }, async t => {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'dsh-mcp-verified-save-test-'));
  const eventsPath = join(directory, 'events.jsonl');
  await writeFile(eventsPath, '', { mode: 0o600 });
  const ctx = new Context();
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 });
  new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 1 });
  const store = new MemoryStore();
  const controller = new ConsoleController({ store, mount: officialMount(ctx) });
  const invoke = (method, extra = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: store.data?.revision ?? 0, ...extra }, owner);
  const records = async () => (await readFile(eventsPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  let watchdogFired = false;
  const watchdog = setTimeout(() => { watchdogFired = true; terminateDirectOwnedChildren('SIGKILL'); }, 15000);
  watchdog.unref();
  const abort = () => terminateDirectOwnedChildren('SIGKILL');
  t.signal.addEventListener('abort', abort, { once: true });
  try {
    assert.equal((await invoke('snapshot')).capabilities.saveAndActivate, true);
    assert.equal(store.data, null); assert.equal(directOwnedChildren().length, 0);
    const saved = await invoke('saveAndActivate', { confirmation: 'SAVE AND ACTIVATE THIS SERVER', server: { label: 'Verified owned fixture', transport: 'stdio', command: process.execPath, args: [fixturePath, eventsPath], cwd: '', envRefs: {} } });
    assert.equal(saved.servers.length, 1); assert.equal(saved.revision, 1);
    const row = saved.servers[0], id = row.config.id, toolName = 'mcp__' + row.serverName + '__synthetic_readonly';
    assert.equal(row.state, 'activation-verified'); assert.ok(Number.isSafeInteger(row.lastVerifiedAt));
    assert.ok(ctx.tools.view().visible.has(toolName)); assert.equal(controller.live.size, 1);
    const call = callId => ctx.tools.execute({ callId, name: toolName, arguments: {}, signal: new AbortController().signal });
    const firstResult = await call('synthetic-save-call-1');
    assert.notEqual(firstResult.isError, true); assert.ok(firstResult.content.some(item => item.type === 'text' && item.text === 'synthetic fixture only'));
    const firstRecords = await records(); assert.equal(firstRecords.filter(item => item.event === 'initialize').length, 1); assert.equal(firstRecords.filter(item => item.event === 'tools/list').length, 1); assert.equal(firstRecords.filter(item => item.event === 'tools/call').length, 1);
    await invoke('snapshot'); assert.equal((await records()).filter(item => item.event === 'initialize').length, 1);
    const stopped = await invoke('stop', { id });
    assert.equal(stopped.servers.length, 1); assert.equal(stopped.servers[0].state, 'unmounted-shutdown-unverified');
    assert.equal(ctx.tools.view().visible.has(toolName), false); assert.equal(controller.live.size, 0); assert.equal(directOwnedChildren().length, 0);
    const offResult = await call('synthetic-save-call-off'); assert.equal(offResult.isError, true);
    assert.equal((await records()).filter(item => item.event === 'tools/call').length, 1);
    const restarted = await invoke('start', { id, confirmation: 'START THIS SERVER' });
    assert.equal(restarted.servers[0].state, 'activation-verified'); assert.ok(ctx.tools.view().visible.has(toolName));
    const secondResult = await call('synthetic-save-call-2'); assert.notEqual(secondResult.isError, true); assert.ok(secondResult.content.some(item => item.type === 'text' && item.text === 'synthetic fixture only'));
    const secondRecords = await records(); assert.equal(secondRecords.filter(item => item.event === 'initialize').length, 2); assert.equal(secondRecords.filter(item => item.event === 'tools/list').length, 2); assert.equal(secondRecords.filter(item => item.event === 'tools/call').length, 2);
    await invoke('stop', { id }); assert.equal(ctx.tools.view().visible.has(toolName), false);
    await invoke('deleteServer', { id }); assert.equal((await invoke('snapshot')).servers.length, 0);
    const revisionBeforeFailedSync = store.data.revision;
    await assert.rejects(invoke('saveAndActivate', { confirmation: 'SAVE AND ACTIVATE THIS SERVER', server: { label: 'Rejected tool sync fixture', transport: 'stdio', command: process.execPath, args: [fixturePath, eventsPath, 'fail-list'], cwd: '', envRefs: {} } }), error => error.code === 'mount-failed');
    assert.equal(store.data.revision, revisionBeforeFailedSync); assert.equal(store.data.servers.length, 0); assert.equal(controller.live.size, 0);
    assert.equal(ctx.tools.view().visible.has(toolName), false);
    const failedRecords = await records(); assert.equal(failedRecords.filter(item => item.event === 'initialize').length, 3); assert.equal(failedRecords.filter(item => item.event === 'tools/list').length, 3); assert.equal(failedRecords.filter(item => item.event === 'tools/call').length, 2);
    assert.equal(directOwnedChildren().length, 0); assert.equal(watchdogFired, false);
    t.diagnostic('REAL official SDK + ToolRuntime: Save connected/synced and committed one active server; native tool invocation returned fixture data, OFF made it unavailable with no upstream call, ON reconnected and made it callable again. A genuine tools/list failure after initialize produced no saved record, live child or callable tool. No user MCP or real credential was used.');
  } finally {
    clearTimeout(watchdog); t.signal.removeEventListener('abort', abort);
    const forceKill = setTimeout(() => terminateDirectOwnedChildren('SIGKILL'), 750);
    try { await bounded(controller.dispose(), 2500, 'Owned verified-save cleanup exceeded bound'); }
    finally {
      clearTimeout(forceKill); terminateDirectOwnedChildren('SIGKILL');
      await bounded(ctx.fiber.dispose(), 2500, 'Isolated verified-save Cordis cleanup exceeded bound');
      const absolute = await realpath(directory);
      assert.equal(dirname(absolute), temporaryRoot); assert.ok(basename(absolute).startsWith('dsh-mcp-verified-save-test-')); assert.equal(absolute, resolve(directory));
      await rm(absolute, { recursive: true, force: true });
    }
  }
});
