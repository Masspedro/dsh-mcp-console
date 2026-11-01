// Only ephemeral literal-loopback listeners and synthetic credentials are used.
// No third-party/MCP server, user token, GUI port or engine process is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createCredentialBroker } from '../src/http-broker.js';
const marker = 'SYNTHETIC-ONLY-CREDENTIAL';
const config = { url: 'https://example.invalid/mcp', headers: { 'X-API-Key': marker } };
const response = () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'set-cookie': 'ignored', location: 'https://example.invalid/never-follow' } });
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return 'http://127.0.0.1:' + server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
function raw(url, { path, headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ hostname: u.hostname, port: u.port, path: path ?? u.pathname, method, headers }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body })); });
    req.on('error', reject); req.end();
  });
}

test('broker uses a fixed destination, upstream-only credentials and redirect:error for every MCP method', async () => {
  const calls = [];
  const broker = await createCredentialBroker(config, { fetchImpl: async (url, init) => { calls.push({ url, init }); return response(); } });
  try {
    assert.match(new URL(broker.url).pathname, /^\/mcp\/[a-f0-9]{48}$/);
    for (const method of ['GET', 'POST', 'DELETE']) {
      const result = await fetch(broker.url, { method, headers: { Authorization: 'NOT-FORWARDED', 'X-Untrusted': 'NOT-FORWARDED', 'Mcp-Session-Id': 'synthetic-session' }, ...(method === 'POST' ? { body: '{"jsonrpc":"2.0"}' } : {}) });
      assert.equal(result.status, 200); await result.text();
      assert.equal(result.headers.get('set-cookie'), null); assert.equal(result.headers.get('location'), null);
      assert.equal(result.headers.get('cache-control'), 'no-store');
    }
    assert.equal(calls.length, 3);
    for (const { url, init } of calls) {
      assert.equal(url, config.url); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.get('x-api-key'), marker); assert.equal(init.headers.get('authorization'), null);
      assert.equal(init.headers.get('x-untrusted'), null); assert.equal(init.headers.get('mcp-session-id'), 'synthetic-session');
    }
  } finally { await broker.close(); }
});

test('wrong capability, query, Host, browser Origin/Fetch markers and unsupported methods never reach upstream', async () => {
  let calls = 0;
  const broker = await createCredentialBroker(config, { fetchImpl: async () => { calls++; return response(); } });
  try {
    const cases = [
      { path: '/mcp/wrong' }, { path: new URL(broker.url).pathname + '?url=https://example.invalid' },
      { path: broker.url }, { headers: { Host: 'example.invalid' } },
      { headers: { Origin: 'http://127.0.0.1:3080' } }, { headers: { Cookie: 'synthetic' } },
      { headers: { 'Sec-Fetch-Site': 'none' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } },
      { headers: { 'Sec-Fetch-Dest': 'document' } }, { headers: { 'Sec-Fetch-User': '?1' } }, { method: 'PUT' },
    ];
    for (const options of cases) assert.equal((await raw(broker.url, options)).status, 403);
    assert.equal(calls, 0);
  } finally { await broker.close(); }
});

test('oversized bodies and excessive concurrent requests are bounded before upstream work', async () => {
  const controllers = [];
  const broker = await createCredentialBroker(config, { fetchImpl: (_url, init) => new Promise((_resolve, reject) => { controllers.push(init.signal); init.signal.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true }); }) });
  const pending = [];
  try {
    const oversized = await fetch(broker.url, { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024 + 1) });
    assert.equal(oversized.status, 413); await oversized.text();
    for (let index = 0; index < 8; index++) pending.push(fetch(broker.url).catch(() => null));
    // Event-driven barrier, not a sleep/poll: the injected upstream observes admission.
    await new Promise(resolve => {
      const original = controllers.push.bind(controllers);
      controllers.push = (...values) => { const n = original(...values); if (n === 8) resolve(); return n; };
      if (controllers.length === 8) resolve();
    });
    const busy = await fetch(broker.url); assert.equal(busy.status, 429); await busy.text();
    assert.equal(controllers.length, 8);
  } finally { await broker.close(); await Promise.all(pending); }
  assert.ok(controllers.every(signal => signal.aborted));
});

test('upstream errors are sanitized and broker teardown cancels in-flight work and closes its own port', async () => {
  const broker = await createCredentialBroker(config, { fetchImpl: async () => { throw new Error(marker); } });
  const result = await fetch(broker.url); assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes(marker));
  await broker.close(); await broker.close();
  await assert.rejects(fetch(broker.url));
});

test('native fetch rejects redirects before a custom credential can reach a second loopback origin', async () => {
  let forwarded = 0; let firstHeader;
  const second = createServer((_req, res) => { forwarded++; res.end('must not be reached'); });
  const secondUrl = await listen(second);
  const first = createServer((req, res) => { firstHeader = req.headers['x-api-key']; res.writeHead(307, { Location: secondUrl + '/wrong' }); res.end(); });
  const firstUrl = await listen(first);
  const broker = await createCredentialBroker({ url: firstUrl + '/mcp', headers: config.headers });
  try {
    const result = await fetch(broker.url, { method: 'POST', body: '{}' });
    assert.equal(result.status, 502); assert.ok(!(await result.text()).includes(marker));
    assert.equal(firstHeader, marker); assert.equal(forwarded, 0);
  } finally { await broker.close(); await close(first); await close(second); }
});

test('non-success upstream status preserves the challenge but never forwards credential-shaped failure text', async () => {
  const broker = await createCredentialBroker(config, { fetchImpl: async () => new Response(marker, { status: 401, headers: { 'www-authenticate': 'Bearer', 'set-cookie': marker } }) });
  try {
    const result = await fetch(broker.url); assert.equal(result.status, 401);
    assert.equal(result.headers.get('www-authenticate'), 'Bearer'); assert.equal(result.headers.get('set-cookie'), null);
    assert.ok(!(await result.text()).includes(marker));
  } finally { await broker.close(); }
});

test('broker closure cancels a successful long-lived event stream and refuses further access', async () => {
  let cancelled = false; let observedSignal;
  const broker = await createCredentialBroker(config, { fetchImpl: async (_url, init) => {
    observedSignal = init.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: message\ndata: {"synthetic":true}\n\n')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await fetch(broker.url); const reader = result.body.getReader();
  assert.ok((await reader.read()).value.length > 0);
  await broker.close();
  await reader.read().catch(() => {});
  assert.equal(observedSignal.aborted, true); assert.equal(cancelled, true);
  await assert.rejects(fetch(broker.url));
});

test('invalid upstream URLs are refused without opening a listener or fetching', async () => {
  for (const url of ['http://example.invalid/mcp', 'https://u:p@example.invalid/mcp', 'https://example.invalid/mcp?token=x', 'https://example.invalid/mcp#x']) {
    await assert.rejects(createCredentialBroker({ url, headers: {} }), error => error.code === 'unsafe-url');
  }
});
