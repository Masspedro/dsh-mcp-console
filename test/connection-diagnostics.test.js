// Synthetic credentials/errors and owned ephemeral loopback broker only.
// Every upstream fetch is injected: no external endpoint, tool or user state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { ConsoleError } from '../src/storage.js';
import { createCredentialBroker } from '../src/http-broker.js';
import { CONNECTION_REASON_CODES, safeConnectionCode, startupFailureReason, httpStatusFailureReason, networkFailureReason } from '../src/diagnostics.js';

const taint = 'SYNTHETIC-DIAGNOSTIC-PRIVATE-ONLY';
const config = { url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer ' + taint, 'X-API-Key': taint } };
const ownError = (code) => Object.assign(new Error(taint + ' https://example.invalid/private'), { code });
const success = () => new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { headers: { 'content-type': 'application/json' } });
const post = async (broker) => {
  const response = await fetch(broker.url, { method: 'POST', body: '{}' });
  return { status: response.status, body: await response.text() };
};
const clean = (value) => assert.ok(!(JSON.stringify(value) ?? '').includes(taint));

// Importantly, only an owned ConsoleError with an exact own-data literal can
// traverse the controller boundary. Upstream errors may NOT impersonate one by
// writing the same string into message, name, code or a cause.
test('safe local connection codes have an exact allowlist and fail-closed fallback', () => {
  assert.equal(CONNECTION_REASON_CODES.length, 9);
  for (const code of [...CONNECTION_REASON_CODES, 'mount-failed']) {
    const error = new ConsoleError(code); error.message = taint;
    assert.equal(safeConnectionCode(error), code);
    assert.equal(safeConnectionCode(ownError(code)), 'mount-failed');
  }
  for (const value of [null, undefined, false, taint, new Error('connection-auth-denied'), new ConsoleError(taint), { code: 'connection-auth-denied' }]) {
    assert.equal(safeConnectionCode(value), 'mount-failed');
    assert.equal(safeConnectionCode(value, taint), 'mount-failed');
  }
  assert.equal(safeConnectionCode(new Error(taint), 'connection-invalid-response'), 'connection-invalid-response');
});

test('malicious local error getters, coercion and proxy reflection never expose provider text', () => {
  let getters = 0;
  const poison = () => { getters++; throw new Error(taint); };
  const error = new ConsoleError('connection-auth-denied');
  for (const name of ['message', 'stack', 'cause', 'toString']) Object.defineProperty(error, name, { configurable: true, get: poison });
  assert.equal(safeConnectionCode(error), 'connection-auth-denied');
  Object.defineProperty(error, 'code', { configurable: true, get: poison });
  assert.equal(safeConnectionCode(error), 'mount-failed');
  const proxy = new Proxy(error, { getPrototypeOf: poison, getOwnPropertyDescriptor: poison, get: poison });
  assert.equal(safeConnectionCode(proxy), 'mount-failed');
  const revoked = Proxy.revocable(error, {}); revoked.revoke();
  assert.equal(safeConnectionCode(revoked.proxy), 'mount-failed');
  // Proxy traps may reject instanceof/reflection; no arbitrary property getter
  // is read, and such rejection remains a generic literal.
  assert.equal(getters, 1);
});

test('startup diagnosis follows actual Error causes and exact SDK/network own-data codes only', () => {
  for (const [code, expected] of [
    ['REQUEST_TIMEOUT', 'connection-timeout'], ['INVALID_RESULT', 'connection-invalid-response'],
    ['CLIENT_HTTP_UNEXPECTED_CONTENT', 'connection-invalid-response'],
    ['CLIENT_HTTP_AUTHENTICATION', 'connection-auth-denied'], ['CLIENT_HTTP_FORBIDDEN', 'connection-auth-denied'],
    ['ECONNREFUSED', 'connection-refused'], ['ENOTFOUND', 'connection-unreachable'], ['CERT_HAS_EXPIRED', 'connection-tls-failed'],
  ]) {
    const shapedSdkError = ownError(code);
    shapedSdkError.data = { message: taint, statusText: taint, contentType: taint };
    const outer = new Error(taint, { cause: shapedSdkError });
    assert.equal(startupFailureReason(outer), expected);
    assert.equal(safeConnectionCode(outer), 'mount-failed', 'upstream is not a local ConsoleError');
    assert.equal(safeConnectionCode(outer, startupFailureReason(outer)), expected);
    assert.equal(startupFailureReason({ cause: shapedSdkError }), undefined);
    assert.equal(startupFailureReason(new Error(taint, { cause: { code } })), undefined);
  }
  for (const code of ['ERA_NEGOTIATION_FAILED', 'CONNECTION_CLOSED', 'UNKNOWN', 'REQUEST_TIMEOUT ' + taint]) assert.equal(startupFailureReason(ownError(code)), undefined);
  for (const value of [null, undefined, taint, new Error('REQUEST_TIMEOUT'), new SyntaxError(taint), { code: 'INVALID_RESULT' }]) assert.equal(startupFailureReason(value), undefined);
  assert.equal(startupFailureReason(new Error(taint, { cause: new AggregateError([ownError('ECONNREFUSED'), ownError('ECONNREFUSED')], taint) })), 'connection-refused');
  assert.equal(startupFailureReason(new AggregateError([ownError('ECONNREFUSED'), ownError('ETIMEDOUT')], taint)), undefined);
  const cycle = new Error(taint); cycle.cause = cycle; assert.equal(startupFailureReason(cycle), undefined);
  let deep = ownError('REQUEST_TIMEOUT'); for (let index = 0; index < 5; index++) deep = new Error(taint, { cause: deep });
  assert.equal(startupFailureReason(deep), undefined);
});

test('startup diagnosis avoids SDK custom instanceof, error getters, coercion and proxy traps', () => {
  let getters = 0;
  const poison = () => { getters++; throw new Error(taint); };
  class ShapedSdkError extends Error { static [Symbol.hasInstance]() { throw new Error(taint); } }
  const value = Object.assign(new ShapedSdkError(taint), { code: 'INVALID_RESULT' });
  for (const key of ['message', 'stack', 'name', 'data', 'status', 'cause', 'errors', 'constructor', 'toString']) Object.defineProperty(value, key, { configurable: true, get: poison });
  Object.defineProperty(value, Symbol.toPrimitive, { get: poison });
  assert.equal(startupFailureReason(value), 'connection-invalid-response'); assert.equal(getters, 0);
  Object.defineProperty(value, 'code', { configurable: true, get: poison });
  assert.equal(startupFailureReason(value), undefined); assert.equal(getters, 0);
  const proxy = new Proxy(value, { getPrototypeOf: poison, getOwnPropertyDescriptor: poison, get: poison });
  assert.equal(startupFailureReason(proxy), undefined); assert.equal(getters, 1);
  const revoked = Proxy.revocable(value, {}); revoked.revoke(); assert.equal(startupFailureReason(revoked.proxy), undefined);
});

test('HTTP status diagnosis uses only exact numeric status and no provider prose', () => {
  for (const [statuses, expected] of [
    [[401, 403], 'connection-auth-denied'], [[404, 405], 'connection-endpoint-unavailable'],
    [[429], 'connection-rate-limited'], [[500, 502, 503, 504, 599], 'connection-service-unavailable'],
  ]) for (const status of statuses) assert.equal(httpStatusFailureReason(status), expected);
  for (const status of [200, 202, 400, 408, 422, 499, 600, '401', NaN, 401.5, taint, {}]) assert.equal(httpStatusFailureReason(status), undefined);
});

test('network diagnosis accepts only bounded standard own-data codes including fetch causes', () => {
  for (const [codes, expected] of [
    [['ECONNREFUSED'], 'connection-refused'],
    [['ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'], 'connection-unreachable'],
    [['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'], 'connection-timeout'],
    [['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID'], 'connection-tls-failed'],
  ]) for (const code of codes) {
    assert.equal(networkFailureReason(ownError(code)), expected);
    assert.equal(networkFailureReason(new TypeError(taint, { cause: ownError(code) })), expected);
  }
  for (const value of [null, undefined, taint, new Error('ECONNREFUSED ' + taint), ownError('ERR_TLS_' + taint), ownError(401), { status: 401 }, new ConsoleError('connection-auth-denied')]) assert.equal(networkFailureReason(value), undefined);
  assert.equal(networkFailureReason(new AggregateError([ownError('ECONNREFUSED'), ownError('ECONNREFUSED')], taint)), 'connection-refused');
  assert.equal(networkFailureReason(new AggregateError([ownError('ECONNREFUSED'), ownError('ETIMEDOUT')], taint)), undefined);
  assert.equal(networkFailureReason(new AggregateError([ownError('ECONNREFUSED'), new Error(taint)], taint)), undefined);
  assert.equal(networkFailureReason(new AggregateError(Array.from({ length: 5 }, () => ownError('ECONNREFUSED')), taint)), undefined);
  const cycle = {}; cycle.cause = cycle; assert.equal(networkFailureReason(cycle), undefined);
  let deep = ownError('ECONNREFUSED'); for (let i = 0; i < 5; i++) deep = { cause: deep };
  assert.equal(networkFailureReason(deep), undefined);
});

test('network diagnosis does not invoke malicious getters, inherited properties or coercion', () => {
  let accessed = 0;
  const poison = () => { accessed++; throw new Error(taint); };
  const value = {};
  for (const key of ['code', 'cause', 'errors', 'message', 'stack', 'name', 'toString']) Object.defineProperty(value, key, { get: poison });
  Object.defineProperty(value, Symbol.toPrimitive, { get: poison });
  assert.equal(networkFailureReason(value), undefined); assert.equal(accessed, 0);
  const inherited = Object.create(Object.defineProperty({}, 'code', { get: poison }));
  assert.equal(networkFailureReason(inherited), undefined); assert.equal(accessed, 0);
  assert.equal(networkFailureReason(new Proxy({}, { getOwnPropertyDescriptor: poison, get: poison })), undefined);
  assert.equal(accessed, 3, 'only bounded own-descriptor traps are attempted');
});

for (const [status, reason] of [[401, 'connection-auth-denied'], [403, 'connection-auth-denied'], [404, 'connection-endpoint-unavailable'], [405, 'connection-endpoint-unavailable'], [429, 'connection-rate-limited'], [500, 'connection-service-unavailable'], [503, 'connection-service-unavailable'], [400, undefined]]) {
  test('broker captures POST status ' + status + ' without reading or exposing upstream failure text', async () => {
    let calls = 0, cancelled = 0;
    const broker = await createCredentialBroker(config, { fetchImpl: async (_url, init) => {
      calls++; assert.equal(init.headers.get('authorization'), 'Bearer ' + taint);
      const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(taint)); }, pull() { throw new Error('body was read: ' + taint); }, cancel() { cancelled++; } });
      return new Response(body, { status, headers: { 'content-type': 'text/plain', 'www-authenticate': 'Bearer', 'set-cookie': taint } });
    } });
    try {
      assert.equal(broker.getFailureReason(), undefined);
      const result = await post(broker);
      assert.equal(result.status, status); assert.equal(broker.getFailureReason(), reason);
      assert.equal(calls, 1, 'diagnostics must not retry'); assert.equal(cancelled, 1);
      clean(result); clean(broker.getFailureReason());
    } finally { await broker.close(); }
    assert.equal(broker.getFailureReason(), reason, 'cleanup cannot replace the captured attempt evidence');
  });
}

for (const [code, reason] of [['ECONNREFUSED', 'connection-refused'], ['ENOTFOUND', 'connection-unreachable'], ['ETIMEDOUT', 'connection-timeout'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'connection-tls-failed'], ['UNKNOWN-' + taint, undefined]]) {
  test('broker captures fetch-stage code ' + code.replace(taint, 'synthetic') + ' while keeping fixed 502 output', async () => {
    let calls = 0;
    const broker = await createCredentialBroker(config, { fetchImpl: async () => { calls++; throw new TypeError(taint, { cause: ownError(code) }); } });
    try {
      const result = await post(broker); assert.equal(result.status, 502);
      assert.equal(broker.getFailureReason(), reason); assert.equal(calls, 1); clean(result); clean(broker.getFailureReason());
    } finally { await broker.close(); }
  });
}

test('broker rejects malicious errors and invalid response shapes without reading arbitrary fields', async () => {
  let getters = 0;
  const poison = () => { getters++; throw new Error(taint); };
  const error = {};
  for (const key of ['code', 'cause', 'errors', 'message', 'stack', 'toString']) Object.defineProperty(error, key, { get: poison });
  const invalid = {};
  for (const key of ['ok', 'status', 'headers', 'body']) Object.defineProperty(invalid, key, { get: poison });
  for (const [fetchImpl, expected] of [[async () => { throw error; }, undefined], [async () => invalid, 'connection-invalid-response']]) {
    const broker = await createCredentialBroker(config, { fetchImpl });
    try { const result = await post(broker); assert.equal(result.status, 502); assert.equal(broker.getFailureReason(), expected); clean(result); }
    finally { await broker.close(); }
  }
  assert.equal(getters, 0);
  const native = success();
  for (const key of ['ok', 'status', 'headers', 'body']) Object.defineProperty(native, key, { get: poison });
  const broker = await createCredentialBroker(config, { fetchImpl: async () => native });
  try { assert.equal((await post(broker)).status, 200); assert.equal(broker.getFailureReason(), undefined); assert.equal(getters, 0); }
  finally { await broker.close(); }
});

test('broker deadline proves timeout without inspecting an abort error or retrying', async () => {
  let calls = 0, observed;
  const broker = await createCredentialBroker(config, { timeoutMs: 15, fetchImpl: (_url, init) => {
    calls++; observed = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => {
      const error = Object.defineProperty({}, 'code', { get() { throw new Error(taint); } }); reject(error);
    }, { once: true }));
  } });
  try {
    const result = await post(broker); assert.equal(result.status, 502); assert.equal(observed.aborted, true);
    assert.equal(broker.getFailureReason(), 'connection-timeout'); assert.equal(calls, 1); clean(result);
  } finally { await broker.close(); }
});

test('intentional broker close/client abort is not reported as timeout or upstream failure', async () => {
  let admit;
  const admitted = new Promise(resolve => { admit = resolve; });
  const broker = await createCredentialBroker(config, { timeoutMs: 1000, fetchImpl: (_url, init) => {
    admit(); return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(ownError('ETIMEDOUT')), { once: true }));
  } });
  const pending = post(broker).catch(() => undefined);
  await admitted; await broker.close(); await pending;
  assert.equal(broker.getFailureReason(), undefined);
});

test('optional GET/DELETE, local admission failures and success do not poison POST startup evidence', async () => {
  let calls = 0;
  const broker = await createCredentialBroker(config, { fetchImpl: async (_url, init) => {
    calls++; return init.method === 'POST' ? success() : new Response(taint, { status: 405 });
  } });
  try {
    for (const method of ['GET', 'DELETE']) { const response = await fetch(broker.url, { method }); assert.equal(response.status, 405); await response.text(); }
    assert.equal(broker.getFailureReason(), undefined);
    const local = await new Promise((resolve, reject) => {
      const url = new URL(broker.url);
      const req = request({ hostname: url.hostname, port: url.port, path: '/wrong', method: 'POST' }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }); req.on('error', reject); req.end();
    });
    assert.equal(local, 403); assert.equal(calls, 2); assert.equal(broker.getFailureReason(), undefined);
    assert.equal((await post(broker)).status, 200); assert.equal(broker.getFailureReason(), undefined);
  } finally { await broker.close(); }
});

test('first proven POST failure is retained, later attempts cannot conflict or clear it', async () => {
  let calls = 0;
  const broker = await createCredentialBroker(config, { fetchImpl: async () => {
    calls++; return calls === 1 ? new Response(taint, { status: 403 }) : calls === 2 ? new Response(taint, { status: 503 }) : success();
  } });
  try {
    assert.equal((await post(broker)).status, 403); assert.equal(broker.getFailureReason(), 'connection-auth-denied');
    assert.equal((await post(broker)).status, 503); assert.equal(broker.getFailureReason(), 'connection-auth-denied');
    assert.equal((await post(broker)).status, 200); assert.equal(broker.getFailureReason(), 'connection-auth-denied');
    assert.equal(calls, 3, 'only the explicitly submitted requests occur');
  } finally { await broker.close(); }
});
