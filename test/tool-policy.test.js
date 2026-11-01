// Only owned synthetic stdio is spawned. No user MCP server/network/credentials.
// Real installed Cordis, ToolRuntime, official MCP client and transport are used.
// Run without building: node --import ./test/register.js --test test/tool-policy.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import { ConsoleError } from '../src/storage.js';
import { createToolPolicyScope } from '../src/tool-policy.js';

const serverName = 'pc_' + 'a'.repeat(24);
const publicName = name => 'mcp__' + serverName + '__' + name;
const siblingName = 'mcp__pc_' + 'b'.repeat(24) + '__sibling';
const fixturePath = fileURLToPath(new URL('./fixtures/tool-policy-child.js', import.meta.url));
const execution = () => ({ signal: new AbortController().signal });
const errorCode = code => error => error instanceof ConsoleError && error.code === code && error.message === code && !Object.hasOwn(error, 'cause');
const names = ctx => [...ctx.tools.view().visible.keys()].sort();
const makeContext = () => {
  const ctx = new Context();
  // Declarative, non-IO systemPrompt hooks only; ToolRuntime itself is real.
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 });
  new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 1 });
  return ctx;
};
const definition = (name, execute = () => 'fixture value', extra = {}) => ({
  name, description: 'Owned policy test', parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute, ...extra
});
const invoke = (ctx, name, callId = 'owned-policy-call') => ctx.tools.execute({ callId, name, arguments: {}, ...execution() });
const disposeContext = ctx => bounded(ctx.fiber.dispose(), 2500, 'Owned context cleanup exceeded bound');

async function bounded(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
// Isolated test process: these are only its explicitly owned fixture children.
function ownedChildren() {
  try { return readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8').trim().split(/\s+/).map(Number).filter(pid => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function terminateOwnedChildren() {
  for (const pid of ownedChildren()) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
}
// Event-driven wait, no busy polling or unbounded SDK notification wait.
function registryWhen(ctx, predicate) {
  let dispose;
  let timer;
  const promise = new Promise((resolve, reject) => {
    const check = () => { if (predicate()) { clearTimeout(timer); dispose?.(); resolve(); } };
    dispose = ctx.on('tools/change', check);
    timer = setTimeout(() => { dispose(); reject(new Error('Owned fixture registry transition exceeded bound')); }, 2500);
    check();
  });
  return { promise, cancel: () => { clearTimeout(timer); dispose?.(); } };
}

// Policy semantics are exercised against the real native registry, not a fake.
test('default all, include-empty, exact future include and exclude policies expose only admitted public names', async () => {
  const ctx = makeContext();
  const scope = createToolPolicyScope(ctx, serverName);
  let upstream = 0;
  const a = publicName('alpha'), b = publicName('blocked'), future = publicName('future');
  try {
    ctx.tools.register(definition(siblingName));
    scope.context.tools.register(definition(b, () => { upstream++; return 'b'; }));
    scope.context.tools.register(definition(a, () => { upstream++; return 'a'; }));
    assert.deepEqual(scope.getToolNames(), [a, b].sort());
    assert.deepEqual(names(ctx), [a, b, siblingName].sort());
    assert.equal(scope.isBlocked(), false);
    assert.equal((await invoke(ctx, a)).isError, false);
    const retained = ctx.tools.get(a);
    scope.setPolicy({ mode: 'include', names: [] });
    assert.deepEqual(names(ctx), [siblingName]);
    assert.equal(ctx.tools.view().knownNames.has(a), false);
    assert.equal(ctx.tools.view().knownNames.has(b), false);
    assert.deepEqual(scope.getToolNames(), [a, b].sort());
    assert.equal(scope.isBlocked(), false, 'include-empty is valid, not an adapter failure');
    assert.equal((await invoke(ctx, b)).isError, true);
    await assert.rejects(retained.execute({}, execution()), errorCode('invalid-tool-policy'));
    assert.equal(upstream, 1);
    scope.setPolicy({ mode: 'include', names: [future] });
    assert.deepEqual(names(ctx), [siblingName]);
    scope.context.tools.register(definition(future, () => { upstream++; return 'future'; }));
    assert.deepEqual(names(ctx), [future, siblingName].sort());
    assert.equal((await invoke(ctx, future)).isError, false);
    scope.setPolicy({ mode: 'exclude', names: [b] });
    assert.deepEqual(names(ctx), [a, future, siblingName].sort());
    scope.context.tools.register(definition(publicName('unlisted_new')));
    assert.equal(ctx.tools.get(publicName('unlisted_new')) !== undefined, true, 'exclude allows new unlisted tools');
    scope.setPolicy();
    assert.deepEqual(names(ctx), [a, b, future, publicName('unlisted_new'), siblingName].sort());
    const inventory = scope.getToolNames(); inventory.length = 0;
    assert.equal(scope.getToolNames().length, 4, 'inventory is a names-only copy');
  } finally { scope.close(); await disposeContext(ctx); }
});

test('pause hides presentation, inventories new registrations, and resumes only with a fresh current-policy generation', async () => {
  const ctx = makeContext(), scope = createToolPolicyScope(ctx, serverName);
  const a = publicName('alpha'), b = publicName('blocked');
  let upstream = 0;
  try {
    ctx.tools.register(definition(siblingName));
    scope.context.tools.register(definition(a, () => { upstream++; return 'a'; }));
    const old = ctx.tools.get(a);
    scope.pause(); scope.pause();
    assert.equal(scope.isBlocked(), true); assert.deepEqual(names(ctx), [siblingName]);
    assert.deepEqual(scope.getToolNames(), [a]);
    await assert.rejects(old.execute({}, execution()), errorCode('invalid-tool-policy'));
    scope.context.tools.register(definition(b, () => { upstream++; return 'b'; }));
    assert.deepEqual(names(ctx), [siblingName], 'registration during persistence is inventory-only');
    scope.setPolicy({ mode: 'include', names: [b] });
    assert.equal(scope.isBlocked(), true);
    assert.deepEqual(names(ctx), [b, siblingName].sort());
    const prepared = ctx.tools.get(b);
    await assert.rejects(prepared.execute({}, execution()), errorCode('invalid-tool-policy'));
    assert.equal(upstream, 0);
    scope.resume(); assert.equal(scope.isBlocked(), false);
    assert.equal((await invoke(ctx, b)).isError, false); assert.equal(upstream, 1);
    await assert.rejects(old.execute({}, execution()), errorCode('invalid-tool-policy'));
    scope.pause();
    scope.context.tools.register(definition(publicName('after_readback')));
    scope.resume();
    assert.equal(ctx.tools.get(publicName('after_readback')), undefined, 'include does not expand on resume');
  } finally { scope.close(); await disposeContext(ctx); }
});

test('returned SDK disposers retire the exact inventory generation; old bodies never revive', async () => {
  const ctx = makeContext(), scope = createToolPolicyScope(ctx, serverName, { mode: 'exclude', names: [publicName('blocked')] });
  const a = publicName('alpha'), b = publicName('blocked');
  let upstream = 0;
  try {
    const first = scope.context.tools.register(definition(a, () => { upstream++; return 'first'; }));
    const denied = scope.context.tools.register(definition(b, () => { upstream++; return 'denied'; }));
    const old = ctx.tools.get(a);
    first(); denied();
    assert.deepEqual(scope.getToolNames(), []); assert.deepEqual(names(ctx), []);
    scope.context.tools.register(definition(a, () => { upstream++; return 'second'; }));
    scope.context.tools.register(definition(b, () => { upstream++; return 'denied second'; }));
    const fresh = ctx.tools.get(a);
    first(); denied();
    assert.deepEqual(scope.getToolNames(), [a, b].sort());
    assert.equal(ctx.tools.get(a), fresh); assert.equal(ctx.tools.get(b), undefined);
    await assert.rejects(old.execute({}, execution()), errorCode('invalid-tool-policy'));
    assert.equal((await invoke(ctx, a)).isError, false); assert.equal(upstream, 1);
    scope.close(); scope.close();
    assert.deepEqual(scope.getToolNames(), []); assert.deepEqual(names(ctx), []); assert.equal(scope.isBlocked(), true);
    await assert.rejects(fresh.execute({}, execution()), errorCode('invalid-tool-policy'));
    assert.throws(() => scope.context.tools.register(definition(a)), errorCode('invalid-tool-policy'));
    assert.throws(() => scope.resume(), errorCode('invalid-tool-policy'));
  } finally { scope.close(); await disposeContext(ctx); }
});

test('getter shadow preserves child effect ownership for admitted and denied tools without changing native siblings', async () => {
  const ctx = makeContext(), scope = createToolPolicyScope(ctx, serverName, { mode: 'include', names: [publicName('alpha')] });
  let childCtx;
  try {
    ctx.tools.register(definition(siblingName));
    const fiber = scope.context.plugin(async child => {
      childCtx = child;
      child.tools.register(definition(publicName('alpha')));
      child.tools.register(definition(publicName('blocked')));
    });
    await fiber; assert.equal(fiber.state, 2);
    assert.notEqual(childCtx.fiber, ctx.fiber);
    assert.deepEqual(names(ctx), [publicName('alpha'), siblingName].sort());
    assert.deepEqual(scope.getToolNames(), [publicName('alpha'), publicName('blocked')].sort());
    const retained = ctx.tools.get(publicName('alpha'));
    scope.pause(); scope.setPolicy({ mode: 'all', names: [] }); scope.resume();
    assert.ok(ctx.tools.get(publicName('blocked')));
    await fiber.dispose();
    assert.deepEqual(scope.getToolNames(), []);
    assert.deepEqual(names(ctx), [siblingName], 're-applied definitions still belong to child, not root');
    await assert.rejects(retained.execute({}, execution()), errorCode('invalid-tool-policy'));
    assert.equal((await invoke(ctx, siblingName)).isError, false);
    scope.close(); assert.deepEqual(names(ctx), [siblingName]);
  } finally { scope.close(); await disposeContext(ctx); }
});

test('explicit close releases every owned native/inventory effect even without SDK teardown; projectContent is unchanged', async () => {
  const ctx = makeContext(), scope = createToolPolicyScope(ctx, serverName, { mode: 'include', names: [publicName('alpha')] });
  const a = publicName('alpha');
  const projectContent = () => [{ type: 'text', text: 'owned projected value' }];
  const source = definition(a, () => 'owned result', { projectContent });
  const ownInventoryEffects = () => ctx.fiber.getEffects().filter(effect => effect.label === 'personal-mcp-console: tool inventory').length;
  try {
    ctx.tools.register(definition(siblingName));
    scope.context.tools.register(source);
    scope.context.tools.register(definition(publicName('blocked')));
    assert.equal(ownInventoryEffects(), 2);
    const wrapped = ctx.tools.get(a);
    assert.equal(wrapped.projectContent, projectContent);
    assert.equal(wrapped.output, source.output);
    assert.equal(await wrapped.execute({}, execution()), 'owned result');
    scope.pause(); scope.setPolicy({ mode: 'all', names: [] }); scope.resume();
    assert.equal(ctx.tools.get(a).projectContent, projectContent);
    const result = await invoke(ctx, a);
    assert.equal(result.isError, false);
    assert.deepEqual(result.content, [{ type: 'text', text: 'owned projected value' }]);
    scope.close(); scope.close();
    assert.equal(ownInventoryEffects(), 0);
    assert.deepEqual(scope.getToolNames(), []); assert.deepEqual(names(ctx), [siblingName]);
    await assert.rejects(wrapped.execute({}, execution()), errorCode('invalid-tool-policy'));
  } finally { scope.close(); await disposeContext(ctx); }
});

test('native deregistration observer exceptions cannot leak text or leave the dispatch gate open', async () => {
  const ctx = makeContext(), scope = createToolPolicyScope(ctx, serverName);
  const a = publicName('alpha');
  let upstream = 0;
  try {
    ctx.tools.register(definition(siblingName));
    scope.context.tools.register(definition(a, () => { upstream++; return 'a'; }));
    const retained = ctx.tools.get(a);
    let armed = true;
    const stop = ctx.on('tools/change', () => { if (armed && !ctx.tools.get(a)) { armed = false; throw new Error('synthetic observer details'); } });
    assert.throws(() => scope.pause(), errorCode('tool-policy-apply-failed'));
    stop();
    assert.equal(scope.isBlocked(), true); assert.deepEqual(names(ctx), [siblingName]);
    await assert.rejects(retained.execute({}, execution()), errorCode('invalid-tool-policy'));
    assert.equal(upstream, 0);
    scope.setPolicy(); scope.resume();
    assert.equal((await invoke(ctx, a)).isError, false); assert.equal(upstream, 1);
    scope.close(); assert.deepEqual(names(ctx), [siblingName]);
  } finally { scope.close(); await disposeContext(ctx); }
});

test('failed setPolicy rolls back every own registration, remains closed, and preserves foreign collisions', async () => {
  const ctx = makeContext(), scope = createToolPolicyScope(ctx, serverName, { mode: 'include', names: [publicName('alpha')] });
  const a = publicName('alpha'), collision = publicName('foreign_collision');
  let upstream = 0;
  try {
    const foreign = definition(collision);
    ctx.tools.register(foreign); ctx.tools.register(definition(siblingName));
    scope.context.tools.register(definition(a, () => { upstream++; return 'a'; }));
    scope.context.tools.register(definition(collision, () => { upstream++; return 'collision'; }));
    const retained = ctx.tools.get(a);
    scope.pause();
    assert.throws(() => scope.setPolicy({ mode: 'all', names: [] }), errorCode('tool-policy-apply-failed'));
    assert.deepEqual(names(ctx), [collision, siblingName].sort());
    assert.equal(ctx.tools.get(collision), foreign);
    assert.equal(scope.isBlocked(), true);
    assert.deepEqual(scope.getToolNames(), [a, collision].sort());
    await assert.rejects(retained.execute({}, execution()), errorCode('invalid-tool-policy'));
    assert.throws(() => scope.resume(), errorCode('tool-policy-apply-failed')); assert.equal(upstream, 0);
    scope.setPolicy({ mode: 'include', names: [a] });
    assert.equal(scope.isBlocked(), true); scope.resume();
    assert.equal((await invoke(ctx, a)).isError, false); assert.equal(upstream, 1);
    scope.close(); assert.equal(ctx.tools.get(collision), foreign); assert.deepEqual(names(ctx), [collision, siblingName].sort());
  } finally { scope.close(); await disposeContext(ctx); }
});

test('native failure diagnostics and genuine execute failures are reduced to own literal ConsoleErrors', async () => {
  const ctx = makeContext(), scope = createToolPolicyScope(ctx, serverName, { mode: 'include', names: [] });
  const a = publicName('alpha'), b = publicName('bad_native');
  const sensitive = 'synthetic upstream details must not escape';
  try {
    scope.context.tools.register(definition(a, () => { throw new Error(sensitive); }));
    const bad = definition(b, () => 'bad');
    Object.defineProperty(bad.output, 'render', { get() { throw new Error(sensitive); } });
    const badDispose = scope.context.tools.register(bad);
    assert.throws(() => scope.setPolicy({ mode: 'all', names: [] }), errorCode('tool-policy-apply-failed'));
    assert.deepEqual(names(ctx), []); assert.equal(scope.isBlocked(), true);
    badDispose();
    scope.setPolicy({ mode: 'all', names: [] }); scope.resume();
    await assert.rejects(ctx.tools.get(a).execute({}, execution()), errorCode('operation-failed'));
    const result = await invoke(ctx, a);
    assert.equal(result.isError, true);
    assert.equal(JSON.stringify(result).includes(sensitive), false);
  } finally { scope.close(); await disposeContext(ctx); }
});

test('malformed, oversized, duplicate and foreign policies fail closed without mutating the native sibling', async () => {
  const ctx = makeContext(), scope = createToolPolicyScope(ctx, serverName);
  const a = publicName('alpha');
  const accessor = { mode: 'all' };
  Object.defineProperty(accessor, 'names', { enumerable: true, get() { throw new Error('synthetic secret'); } });
  const sparse = []; sparse.length = 1;
  const invalid = [null, [], {}, { mode: 'unknown', names: [] }, { mode: 'all', names: [a] }, { mode: 'include', names: [a, a] },
    { mode: 'exclude', names: [siblingName] }, { mode: 'include', names: [a + ' '.repeat(1)] }, { mode: 'include', names: [publicName('x'.repeat(65))] },
    { mode: 'include', names: ['mcp__' + serverName + '__'] }, { mode: 'include', names: [publicName('ümlaut')] }, { mode: 'include', names: ['alpha'] },
    { mode: 'include', names: sparse }, { mode: 'include', names: Array.from({ length: 513 }, (_v, i) => publicName('t' + i)) }, { mode: 'all', names: [], surprise: true }, accessor];
  try {
    ctx.tools.register(definition(siblingName)); scope.context.tools.register(definition(a));
    for (const value of invalid) {
      assert.throws(() => scope.setPolicy(value), errorCode('invalid-tool-policy'));
      assert.deepEqual(names(ctx), [siblingName]); assert.equal(scope.isBlocked(), true);
      assert.throws(() => scope.resume(), errorCode('invalid-tool-policy'));
      assert.throws(() => createToolPolicyScope(ctx, serverName, value), errorCode('invalid-tool-policy'));
    }
    scope.setPolicy({ mode: 'include', names: Array.from({ length: 512 }, (_v, i) => publicName('t' + i)) }); scope.resume();
    assert.equal(scope.isBlocked(), false); assert.deepEqual(names(ctx), [siblingName]);
    scope.setPolicy(); assert.ok(ctx.tools.get(a));
    assert.throws(() => createToolPolicyScope(ctx, 'foreign'), errorCode('invalid-tool-policy'));
  } finally { scope.close(); await disposeContext(ctx); }
});

test('namespace, duplicate and oversized advertised inventories clear incomplete inventory and irreversibly block that scope', async () => {
  const ctx = makeContext();
  try {
    ctx.tools.register(definition(siblingName));
    for (const invalidName of [siblingName, publicName(''), publicName('bad name'), publicName('x'.repeat(65)), 123]) {
      const scope = createToolPolicyScope(ctx, serverName);
      scope.context.tools.register(definition(publicName('alpha')));
      const retained = ctx.tools.get(publicName('alpha'));
      assert.throws(() => scope.context.tools.register(definition(invalidName)), errorCode('invalid-tool-policy'));
      assert.deepEqual(scope.getToolNames(), []); assert.deepEqual(names(ctx), [siblingName]); assert.equal(scope.isBlocked(), true);
      await assert.rejects(retained.execute({}, execution()), errorCode('invalid-tool-policy'));
      assert.throws(() => scope.setPolicy(), errorCode('invalid-tool-policy')); scope.close();
    }
    const duplicate = createToolPolicyScope(ctx, serverName, { mode: 'include', names: [] });
    duplicate.context.tools.register(definition(publicName('alpha')));
    assert.throws(() => duplicate.context.tools.register(definition(publicName('alpha'))), errorCode('invalid-tool-policy'));
    assert.deepEqual(duplicate.getToolNames(), []); duplicate.close();
    const many = createToolPolicyScope(ctx, serverName, { mode: 'include', names: [] });
    for (let i = 0; i < 512; i++) many.context.tools.register(definition(publicName('t' + i)));
    assert.equal(many.getToolNames().length, 512); assert.deepEqual(names(ctx), [siblingName]);
    assert.throws(() => many.context.tools.register(definition(publicName('t512'))), errorCode('tool-inventory-limit'));
    assert.equal(many.isBlocked(), true); assert.deepEqual(many.getToolNames(), []);
    assert.throws(() => many.setPolicy(), errorCode('tool-inventory-limit'));
    assert.throws(() => many.context.tools.register(definition(publicName('new'))), errorCode('tool-inventory-limit'));
    many.close(); assert.deepEqual(names(ctx), [siblingName]);
  } finally { await disposeContext(ctx); }
});

test('reentrant pause during native tools/change cannot accidentally reopen a policy gate', async () => {
  const ctx = makeContext(), scope = createToolPolicyScope(ctx, serverName);
  const a = publicName('alpha');
  try {
    scope.context.tools.register(definition(a)); scope.pause();
    let armed = true;
    const stop = ctx.on('tools/change', () => { if (armed && ctx.tools.get(a)) { armed = false; scope.pause(); } });
    assert.throws(() => scope.resume(), errorCode('tool-policy-apply-failed'));
    stop(); assert.equal(scope.isBlocked(), true); assert.deepEqual(names(ctx), []);
    scope.setPolicy(); scope.resume(); assert.equal(scope.isBlocked(), false); assert.ok(ctx.tools.get(a));
  } finally { scope.close(); await disposeContext(ctx); }
});

async function withRealSdk(t, policy, body) {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'dsh-tool-policy-test-'));
  const eventsPath = join(directory, 'events.jsonl');
  await writeFile(eventsPath, '', { mode: 0o600 });
  const ctx = makeContext();
  const scope = createToolPolicyScope(ctx, serverName, policy);
  // SDK errors may include upstream strings. This is an isolated no-IO logger
  // shadow just like production's scoped logger, not a runtime/transport mock.
  const logger = () => logger;
  for (const level of ['error', 'warn', 'info', 'debug']) logger[level] = () => {};
  ctx.tools.register(definition(siblingName));
  let fiber;
  let watchdogFired = false;
  const watchdog = setTimeout(() => { watchdogFired = true; terminateOwnedChildren(); }, 15000); watchdog.unref();
  const abort = () => terminateOwnedChildren(); t.signal.addEventListener('abort', abort, { once: true });
  const records = async () => (await readFile(eventsPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  try {
    fiber = scope.context.extend({ logger }).plugin(mcpClient, { serverName, transport: 'stdio', command: process.execPath, args: [fixturePath, eventsPath], env: {}, cwd: process.cwd(), failOnStartupError: true, reconnect: { enabled: false }, toolCallTimeoutMs: 2500 });
    await bounded(fiber, 5000, 'Owned official SDK handshake exceeded bound');
    assert.equal(fiber.state, 2);
    const first = await records();
    assert.equal(first.filter(row => row.event === 'initialize').length, 1);
    assert.equal(first.filter(row => row.event === 'tools/list').length, 1);
    assert.ok(first.some(row => row.event === 'initialized'));
    await body({ ctx, scope, records, fiber });
    assert.equal(watchdogFired, false);
  } finally {
    clearTimeout(watchdog); t.signal.removeEventListener('abort', abort);
    scope.close();
    const forceKill = setTimeout(terminateOwnedChildren, 750);
    try { await bounded(fiber?.dispose(), 2500, 'Owned SDK cleanup exceeded bound'); }
    finally {
      clearTimeout(forceKill); terminateOwnedChildren();
      await disposeContext(ctx);
      const absolute = await realpath(directory);
      assert.equal(dirname(absolute), temporaryRoot); assert.ok(basename(absolute).startsWith('dsh-tool-policy-test-')); assert.equal(absolute, resolve(directory));
      await rm(absolute, { recursive: true, force: true });
    }
    assert.equal(ownedChildren().length, 0);
  }
}

// Notifications exercise the installed SDK's actual old-disposer/new-register
// refresh path. No syncTools clone or simulated upstream client is used.
test('REAL official SDK excludes a tool before native exposure/dispatch, blocks its reappearance and stale refresh bodies', { timeout: 20000 }, async t => {
  const a = publicName('alpha'), b = publicName('blocked'), advance = publicName('advance'), future = publicName('future');
  await withRealSdk(t, { mode: 'exclude', names: [b] }, async ({ ctx, scope, records, fiber }) => {
    assert.deepEqual(scope.getToolNames(), [a, b, advance].sort());
    assert.deepEqual(names(ctx), [a, advance, siblingName].sort());
    assert.equal(ctx.tools.view().knownNames.has(b), false);
    assert.equal(ctx.tools.schemas().some(schema => schema.name === b), false);
    assert.equal((await invoke(ctx, b, 'excluded')).isError, true);
    assert.equal((await records()).filter(row => row.event === 'tools/call/blocked').length, 0);
    const old = ctx.tools.get(a);
    const changed = registryWhen(ctx, () => !!ctx.tools.get(future) && !!ctx.tools.get(advance) && !scope.getToolNames().includes(b));
    try { assert.notEqual((await invoke(ctx, advance, 'advance-1')).isError, true); await changed.promise; } finally { changed.cancel(); }
    assert.deepEqual(scope.getToolNames(), [a, future, advance].sort());
    await assert.rejects(old.execute({}, execution()), errorCode('invalid-tool-policy'));
    const changedAgain = registryWhen(ctx, () => scope.getToolNames().includes(b) && !!ctx.tools.get(advance));
    try { assert.notEqual((await invoke(ctx, advance, 'advance-2')).isError, true); await changedAgain.promise; } finally { changedAgain.cancel(); }
    assert.deepEqual(scope.getToolNames(), [a, b, future, advance].sort());
    assert.deepEqual(names(ctx), [a, future, advance, siblingName].sort());
    assert.equal((await invoke(ctx, b, 'excluded-reappearance')).isError, true);
    assert.notEqual((await invoke(ctx, future, 'new-unlisted')).isError, true);
    const after = await records();
    assert.equal(after.filter(row => row.event === 'tools/list').length, 3);
    assert.equal(after.filter(row => row.event === 'tools/call/blocked').length, 0);
    assert.equal(after.filter(row => row.event === 'tools/call/alpha').length, 0, 'retained old execute never reaches upstream');
    assert.equal(after.filter(row => row.event === 'tools/call/future').length, 1);
    const retained = ctx.tools.get(future);
    // Policy close is sufficient even before, or without, SDK teardown success.
    scope.close(); assert.deepEqual(names(ctx), [siblingName]); assert.deepEqual(scope.getToolNames(), []);
    await assert.rejects(retained.execute({}, execution()), errorCode('invalid-tool-policy'));
    assert.equal((await invoke(ctx, future, 'closed-native')).isError, true);
    assert.equal((await records()).filter(row => row.event === 'tools/call/future').length, 1);
    await fiber.dispose(); assert.deepEqual(names(ctx), [siblingName]);
    assert.notEqual((await invoke(ctx, siblingName)).isError, true);
    t.diagnostic('Real installed official SDK + Cordis + native ToolRuntime: full advertised inventory, zero excluded calls, two list_changed refreshes, blacklist reappearance denied, future unlisted admitted, old generation/close denied, sibling preserved.');
  });
});

test('REAL SDK include-empty still verifies connection/list; exact unknown-future selection expands only when that name appears', { timeout: 20000 }, async t => {
  const a = publicName('alpha'), b = publicName('blocked'), advance = publicName('advance'), future = publicName('future');
  await withRealSdk(t, { mode: 'include', names: [] }, async ({ ctx, scope, records, fiber }) => {
    assert.deepEqual(scope.getToolNames(), [a, b, advance].sort());
    assert.deepEqual(names(ctx), [siblingName]); assert.equal(scope.isBlocked(), false);
    for (const name of [a, b, advance]) assert.equal((await invoke(ctx, name, 'include-empty')).isError, true);
    assert.equal((await records()).filter(row => row.event.startsWith('tools/call/')).length, 0);
    scope.pause(); scope.setPolicy({ mode: 'include', names: [advance, future] });
    assert.equal(scope.isBlocked(), true);
    assert.deepEqual(names(ctx), [advance, siblingName].sort());
    const prepared = ctx.tools.get(advance);
    await assert.rejects(prepared.execute({}, execution()), errorCode('invalid-tool-policy'));
    assert.equal((await records()).filter(row => row.event.startsWith('tools/call/')).length, 0);
    scope.resume();
    const changed = registryWhen(ctx, () => !!ctx.tools.get(future) && !!ctx.tools.get(advance));
    try { assert.notEqual((await invoke(ctx, advance, 'future-advance')).isError, true); await changed.promise; } finally { changed.cancel(); }
    assert.deepEqual(scope.getToolNames(), [a, future, advance].sort());
    assert.deepEqual(names(ctx), [future, advance, siblingName].sort());
    assert.equal((await invoke(ctx, a, 'include-denied')).isError, true);
    assert.notEqual((await invoke(ctx, future, 'future-exact')).isError, true);
    const retained = ctx.tools.get(future);
    await fiber.dispose();
    assert.deepEqual(scope.getToolNames(), []); assert.deepEqual(names(ctx), [siblingName]);
    await assert.rejects(retained.execute({}, execution()), errorCode('invalid-tool-policy'));
    const final = await records();
    assert.equal(final.filter(row => row.event === 'tools/call/alpha').length, 0);
    assert.equal(final.filter(row => row.event === 'tools/call/blocked').length, 0);
    assert.equal(final.filter(row => row.event === 'tools/call/advance').length, 1);
    assert.equal(final.filter(row => row.event === 'tools/call/future').length, 1);
    assert.ok(final.some(row => row.event === 'exit'));
    t.diagnostic('Real official SDK initialized/listed include-empty without tool exposure; future exact public name admitted on real notification refresh; nonselected tools made zero upstream calls; SDK child disposal cleared both native registrations and full inventory.');
  });
});
