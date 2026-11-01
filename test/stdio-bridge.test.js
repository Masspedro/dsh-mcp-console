// Isolated owned real subprocesses only. No user profiles/env, external MCP,
// engine process, network, install, file receipt or business tool is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeStdioConfig } from '../src/index.js';

const fixture = fileURLToPath(new URL('./fixtures/stdio-bridge-child.js', import.meta.url));
const bridge = fileURLToPath(new URL('../src/stdio-bridge.js', import.meta.url));
const taint = 'SYNTHETIC-STDIO-BRIDGE-PRIVATE-ONLY';
// Android's bundled bionic Node needs its platform shared-library path and an
// accessible OpenSSL config. Do not inherit NODE_OPTIONS, LD_PRELOAD, credentials
// or the rest of process.env. This fixed config has no user-controlled content.
const runtimeEnv = { OPENSSL_CONF: '/dev/null' };
if (typeof process.env.LD_LIBRARY_PATH === 'string') runtimeEnv.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
async function bounded(promise, ms = 4000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Owned bridge test exceeded its bound')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function runningOwnedPid(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);
  try {
    // This pid was emitted by OUR fixture; never enumerate other processes or
    // read another process's arguments/environment. A zombie is not running,
    // but is deliberately not represented as proof of process-group/reap state.
    const state = (await readFile('/proc/' + pid + '/stat', 'utf8')).split(') ')[1]?.split(' ')[0];
    return state !== 'Z' && state !== 'X';
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return false; throw error; }
}
async function awaitOwnedExit(pid) {
  const deadline = Date.now() + 1500;
  while (await runningOwnedPid(pid)) {
    if (Date.now() >= deadline) throw new Error('Owned intended child remained running after bridge closure');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function start(t, mode, { env = {}, args = [], command = process.execPath, rawEnv, rawArgs } = {}) {
  const root = await realpath(tmpdir());
  const directory = await mkdtemp(join(root, 'dsh-stdio-bridge-test-'));
  const native = { transport: 'stdio', serverName: 'pc_synthetic', command, args: [fixture, mode, ...args], cwd: directory, env };
  const wrapped = bridgeStdioConfig(native);
  assert.equal(wrapped.command, process.execPath); assert.equal(wrapped.args[0], bridge);
  assert.equal(wrapped.cwd, directory);
  assert.equal(wrapped.env.NODE_OPTIONS, undefined, 'intended user Node options must not configure the wrapper runtime');
  // Minimal synthetic environment plus runtime-only Android prerequisites;
  // not a copy of the test/engine process env or inherited user Node options.
  const child = spawn(wrapped.command, rawArgs ?? wrapped.args, { cwd: wrapped.cwd, env: { ...runtimeEnv, ...(rawEnv ?? wrapped.env) }, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout = [], stderr = [];
  let stdoutBytes = 0, stderrBytes = 0, firstLine = '', readyPid;
  let resolveLine, rejectLine;
  const line = new Promise((resolve, reject) => { resolveLine = resolve; rejectLine = reject; }); line.catch(() => {});
  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length; if (stdoutBytes <= 4 * 1024 * 1024) stdout.push(chunk);
    if (firstLine.length < 8192 && !firstLine.includes('\n')) {
      firstLine += chunk.toString('utf8');
      if (firstLine.includes('\n')) {
        const head = firstLine.slice(0, firstLine.indexOf('\n'));
        try { const value = JSON.parse(head); if (value.ready === true && Number.isSafeInteger(value.pid) && value.pid > 0) readyPid = value.pid; } catch {}
        resolveLine(head);
      }
    }
  });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes <= 16384) stderr.push(chunk); });
  const closed = new Promise((resolve, reject) => {
    child.once('error', () => { const error = new Error('Owned bridge spawn failed'); rejectLine(error); reject(error); });
    child.once('close', (code, signal) => { rejectLine(new Error('Owned bridge closed before first line')); resolve({ code, signal }); });
  }); closed.catch(() => {});
  t.after(async () => {
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    try { await bounded(closed, 1500); }
    catch { child.kill('SIGKILL'); await bounded(closed, 1500); }
    if (readyPid && await runningOwnedPid(readyPid)) { try { process.kill(readyPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } await awaitOwnedExit(readyPid); }
    const absolute = await realpath(directory);
    assert.equal(absolute, resolve(directory)); assert.equal(dirname(absolute), root); assert.ok(basename(absolute).startsWith('dsh-stdio-bridge-test-'));
    await rm(absolute, { recursive: true, force: true });
  });
  return { child, directory, wrapped, line, closed,
    get pid() { return readyPid; }, get stdout() { return Buffer.concat(stdout).toString('utf8'); },
    get stdoutBytes() { return stdoutBytes; }, get stderr() { return Buffer.concat(stderr).toString('utf8'); }, get stderrBytes() { return stderrBytes; } };
}
function assertSilent(result) { assert.equal(result.stderrBytes, 0, 'upstream stderr must not reach wrapper stderr'); assert.equal(result.stderr, ''); }

test('bridgeStdioConfig encodes every supplied environment mapping and preserves cwd/argv/native controls', () => {
  const config = { transport: 'stdio', serverName: 'pc_synthetic', command: '/synthetic/executable', args: ['a b', ';literal', '$(literal)', '--non-secret'], cwd: '/synthetic/absolute', env: { NODE_OPTIONS: '--stack-trace-limit=37', SYNTHETIC_API_KEY: taint }, failOnStartupError: true, reconnect: { enabled: false }, toolCallTimeoutMs: 60000 };
  const copy = structuredClone(config); const wrapped = bridgeStdioConfig(config);
  assert.deepEqual(config, copy, 'wrapper mapping must not mutate the caller');
  assert.equal(wrapped.command, process.execPath); assert.deepEqual(wrapped.args, [bridge, config.command, ...config.args]);
  assert.equal(wrapped.cwd, config.cwd); assert.equal(wrapped.failOnStartupError, true); assert.equal(wrapped.reconnect.enabled, false); assert.equal(wrapped.toolCallTimeoutMs, 60000);
  assert.deepEqual(Object.keys(wrapped.env).sort(), Object.keys(config.env).map(key => 'DSH_MCP_CONSOLE_ENV_' + Buffer.from(key, 'ascii').toString('hex')).sort());
  assert.ok(!JSON.stringify(wrapped.args).includes(taint)); assert.equal(wrapped.env.NODE_OPTIONS, undefined);
  assert.equal(bridgeStdioConfig({ ...config, cwd: '' }).cwd, process.cwd());
});

test('real intended child receives exact cwd/non-shell args/env and encoded NODE_OPTIONS only after wrapper starts', { timeout: 10000 }, async t => {
  const args = ['a b', ';literal', '$(literal)', '"quoted"', '--non-secret'];
  const result = await start(t, 'metadata', { args, env: { SYNTHETIC_API_KEY: taint, SYNTHETIC_MAPPING: 'literal value', DSH_MCP_CONSOLE_ENV_TEST: 'reserved value', NODE_OPTIONS: '--stack-trace-limit=37' } });
  assert.deepEqual(await bounded(result.closed), { code: 0, signal: null });
  const metadata = JSON.parse(result.stdout.trim());
  assert.equal(metadata.cwd, result.directory); assert.deepEqual(metadata.args, args);
  assert.equal(metadata.credentialMatched, true); assert.equal(metadata.arbitraryMappingMatched, true); assert.equal(metadata.reservedNameMatched, true);
  assert.equal(metadata.nodeOptionsMatched, true); assert.equal(metadata.stackTraceLimit, 37);
  assert.ok(!result.stdout.includes(taint)); assertSilent(result);
});

for (const options of ['--bad-option-' + taint, '--require=/synthetic/missing-' + taint]) {
  test('invalid intended-child NODE_OPTIONS cannot print credential taint through wrapper stderr', { timeout: 10000 }, async t => {
    const result = await start(t, 'metadata', { env: { NODE_OPTIONS: options } });
    const outcome = await bounded(result.closed); assert.ok(Number.isInteger(outcome.code) && outcome.code !== 0);
    assert.equal(result.stdoutBytes, 0); assertSilent(result); assert.ok(!JSON.stringify(result.wrapped.args).includes(taint));
  });
}

test('multi-MiB tainted child stderr is discarded without blocking a clean stdout result', { timeout: 10000 }, async t => {
  const result = await start(t, 'stderr-flood');
  assert.deepEqual(await bounded(result.closed), { code: 0, signal: null });
  assert.equal(result.stdout, 'STDERR_DISCARDED\n'); assertSilent(result);
});

test('normal direct-child close drains large stdout completely before bridge exits', { timeout: 10000 }, async t => {
  const result = await start(t, 'stdout-drain');
  assert.deepEqual(await bounded(result.closed), { code: 0, signal: null });
  const expected = 'x'.repeat(3 * 1024 * 1024) + 'STDOUT_DRAINED\n';
  assert.equal(result.stdoutBytes, Buffer.byteLength(expected)); assert.equal(result.stdout, expected); assertSilent(result);
});

for (const action of ['SIGTERM', 'stdin-EOF']) {
  test('bridge ' + action + ' stops its owned SIGTERM-ignoring direct child and closes pipes', { timeout: 10000 }, async t => {
    const result = await start(t, 'hold');
    const ready = JSON.parse(await bounded(result.line)); assert.equal(ready.ready, true); assert.equal(result.pid, ready.pid);
    assert.equal(await runningOwnedPid(result.pid), true);
    if (action === 'SIGTERM') result.child.kill('SIGTERM'); else result.child.stdin.end();
    const outcome = await bounded(result.closed); assert.deepEqual(outcome, { code: 0, signal: null });
    await awaitOwnedExit(result.pid); assert.equal(await runningOwnedPid(result.pid), false); assertSilent(result);
  });
}

test('closing the downstream stdout pipe triggers owned direct-child cleanup without unsafe diagnostics', { timeout: 10000 }, async t => {
  const result = await start(t, 'write-forever');
  await bounded(result.line); assert.ok(result.pid); result.child.stdout.destroy();
  const outcome = await bounded(result.closed); assert.ok(Number.isInteger(outcome.code));
  await awaitOwnedExit(result.pid); assertSilent(result);
});

test('cooperative child cleanup must not turn bridge stdout failure into a success exit', { timeout: 10000 }, async t => {
  const result = await start(t, 'write-cooperative');
  await bounded(result.line); assert.ok(result.pid); result.child.stdout.destroy();
  const outcome = await bounded(result.closed);
  await awaitOwnedExit(result.pid); assertSilent(result);
  assert.deepEqual(outcome, { code: 1, signal: null }, 'finish(1) must retain failure even when SIGTERM closes the child before the escalation timer');
});

for (const mode of ['throw-taint', 'malicious-error', 'unknown-fixture-mode']) {
  test('malicious intended child mode ' + mode + ' leaves no wrapper error text or output', { timeout: 10000 }, async t => {
    const result = await start(t, mode);
    const outcome = await bounded(result.closed); assert.ok(Number.isInteger(outcome.code) && outcome.code !== 0);
    assert.equal(result.stdoutBytes, 0); assertSilent(result);
  });
}

test('missing executable spawn failure is silent and bounded', { timeout: 10000 }, async t => {
  const result = await start(t, 'metadata', { command: '/synthetic/nonexistent-' + taint });
  const outcome = await bounded(result.closed); assert.ok(Number.isInteger(outcome.code) && outcome.code !== 0);
  assert.equal(result.stdoutBytes, 0); assertSilent(result);
});

test('malformed encoded mapping is refused before child start without printing any taint', { timeout: 10000 }, async t => {
  const result = await start(t, 'metadata', { rawEnv: { DSH_MCP_CONSOLE_ENV_nothex: taint } });
  assert.deepEqual(await bounded(result.closed), { code: 1, signal: null }); assert.equal(result.stdoutBytes, 0); assertSilent(result);
});
