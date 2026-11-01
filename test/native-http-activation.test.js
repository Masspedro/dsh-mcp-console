// Owned loopback MCP fixture only: no user endpoint, token, profile or process.
// Genuine official Streamable HTTP SDK, credential broker and ToolRuntime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ConsoleController } from '../src/controller.js';
import { officialMount } from '../src/index.js';

class MemoryStore {
  data = null;
  async read() { return structuredClone(this.data); }
  async transaction(fn) { return fn(); }
  async write(data) { this.data = structuredClone(data); }
}
async function bounded(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

test('genuine HTTP MCP Save rejects bad authentication then verifies, calls, disables and reloads an encrypted-header tool', { timeout: 25000 }, async () => {
  const synthetic = 'SYNTHETIC-ONLY-NATIVE-HTTP-VALUE';
  const events = [];
  const upstream = createServer(async (request, response) => {
    // Never store/log incoming credentials or request arguments, even fixtures.
    if (request.headers.authorization !== 'Bearer ' + synthetic) {
      events.push('unauthorized'); response.writeHead(401, { 'content-type': 'text/plain' }); response.end('Synthetic denied'); return;
    }
    if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    let rpc; try { rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { response.writeHead(400); response.end(); return; }
    events.push(rpc.method);
    if (!Object.hasOwn(rpc, 'id')) { response.writeHead(202); response.end(); return; }
    let result;
    if (rpc.method === 'initialize') result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'owned-http-mcp-fixture', version: '0.0.0-test' } };
    else if (rpc.method === 'tools/list') result = { tools: [{ name: 'synthetic_http_readonly', description: 'Fixed owned test data only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] };
    else if (rpc.method === 'tools/call') result = { content: [{ type: 'text', text: 'native HTTP fixture only' }], isError: false };
    else if (rpc.method === 'ping') result = {};
    else { response.writeHead(400); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', resolve); });
  const url = 'http://127.0.0.1:' + upstream.address().port + '/mcp';
  const ctx = new Context();
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 });
  new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 1 });
  const store = new MemoryStore(); const keyCalls = [];
  const controller = new ConsoleController({ store, automaticKey: async options => { keyCalls.push(options); return Buffer.alloc(32, 0x3d); }, mount: officialMount(ctx) });
  const invoke = (method, extra = {}) => controller.invoke(method, method === 'snapshot' ? {} : { revision: store.data?.revision ?? 0, ...extra }, { kind: 'owner' });
  try {
    await assert.rejects(bounded(invoke('saveAndActivate', { confirmation: 'SAVE AND ACTIVATE THIS SERVER', server: { label: 'Denied owned HTTP fixture', transport: 'streamable-http', url, headerRefs: {} } }), 8000, 'Owned HTTP denied verification exceeded bound'), error => error.code === 'connection-auth-denied');
    assert.equal(store.data, null); assert.equal(controller.live.size, 0); assert.ok(events.includes('unauthorized'));
    await invoke('setSecret', { ref: 'syntheticHttp', value: 'Bearer ' + synthetic });
    await invoke('setSecret', { ref: 'syntheticUnused', value: 'SYNTHETIC-UNUSED-HTTP-HEADER' });
    assert.equal(JSON.stringify(store.data).includes(synthetic), false);
    const saved = await bounded(invoke('saveAndActivate', { confirmation: 'SAVE AND ACTIVATE THIS SERVER', server: { label: 'Verified owned HTTP fixture', transport: 'streamable-http', url, headerRefs: { Authorization: 'syntheticHttp' } } }), 8000, 'Owned HTTP verification exceeded bound');
    assert.equal(saved.servers.length, 1); const row = saved.servers[0], id = row.config.id;
    assert.equal(row.state, 'activation-verified'); assert.ok(Number.isSafeInteger(row.lastVerifiedAt));
    assert.equal(JSON.stringify(saved).includes(synthetic), false);
    const toolName = 'mcp__' + row.serverName + '__synthetic_http_readonly';
    assert.ok(ctx.tools.view().visible.has(toolName));
    const call = callId => ctx.tools.execute({ callId, name: toolName, arguments: {}, signal: new AbortController().signal });
    const first = await bounded(call('synthetic-native-http-1'), 4000, 'Owned HTTP tool call exceeded bound');
    assert.notEqual(first.isError, true); assert.ok(first.content.some(item => item.type === 'text' && item.text === 'native HTTP fixture only'));
    assert.equal(events.filter(method => method === 'initialize').length, 1); assert.equal(events.filter(method => method === 'tools/list').length, 1); assert.equal(events.filter(method => method === 'tools/call').length, 1);
    // Appending unrelated credentials must not reconnect, rotate the key, rebuild
    // tools or change the broker's live synthetic Authorization binding.
    const heldHandle = controller.live.get(id); const heldTools = [...ctx.tools.view().visible]; const heldKey = Buffer.from(controller.key); const oldVault = structuredClone(store.data.vault); const unauthorized = events.filter(method => method === 'unauthorized').length;
    const appended = await invoke('setSecret', { ref: 'syntheticNewToken', value: 'SYNTHETIC-NEW-TOKEN-ONLY' });
    await invoke('setSecret', { ref: 'syntheticDirectHeader', value: 'SYNTHETIC-NEW-DIRECT-HEADER-ONLY' });
    assert.equal(appended.capabilities.appendSecretsWhileMounted, true); assert.equal(appended.servers[0].lastVerifiedAt, row.lastVerifiedAt);
    assert.equal(controller.live.get(id), heldHandle); assert.deepEqual([...ctx.tools.view().visible], heldTools); assert.deepEqual(controller.key, heldKey);
    assert.equal(store.data.vault.salt, oldVault.salt); assert.equal(store.data.vault.kdf, oldVault.kdf); assert.notEqual(store.data.vault.nonce, oldVault.nonce);
    const guardedCalls = keyCalls.length; const beforeGuards = structuredClone(store.data);
    for (const ref of ['syntheticHttp', 'syntheticUnused']) {
      await assert.rejects(invoke('setSecret', { ref, value: 'SYNTHETIC-DENIED-REPLACEMENT' }), error => error.code === 'stop-before-secret-change');
      await assert.rejects(invoke('deleteSecret', { ref }), error => error.code === 'stop-before-secret-change');
    }
    assert.equal(keyCalls.length, guardedCalls); assert.deepEqual(store.data, beforeGuards); assert.equal(controller.live.get(id), heldHandle); assert.deepEqual([...ctx.tools.view().visible], heldTools);
    const afterAppend = await bounded(call('synthetic-native-http-after-append'), 4000, 'Owned HTTP post-append call exceeded bound');
    assert.notEqual(afterAppend.isError, true); assert.ok(afterAppend.content.some(item => item.type === 'text' && item.text === 'native HTTP fixture only'));
    assert.equal(events.filter(method => method === 'unauthorized').length, unauthorized); assert.equal(events.filter(method => method === 'initialize').length, 1); assert.equal(events.filter(method => method === 'tools/list').length, 1); assert.equal(events.filter(method => method === 'tools/call').length, 2); heldKey.fill(0);
    await invoke('stop', { id }); assert.equal(ctx.tools.view().visible.has(toolName), false); assert.equal(controller.live.size, 0);
    const off = await call('synthetic-native-http-off'); assert.equal(off.isError, true); assert.equal(events.filter(method => method === 'tools/call').length, 2);
    const on = await bounded(invoke('start', { id, confirmation: 'START THIS SERVER' }), 8000, 'Owned HTTP ON exceeded bound');
    assert.equal(on.servers[0].state, 'activation-verified'); assert.ok(ctx.tools.view().visible.has(toolName));
    const second = await bounded(call('synthetic-native-http-2'), 4000, 'Owned HTTP second call exceeded bound');
    assert.notEqual(second.isError, true); assert.ok(second.content.some(item => item.type === 'text' && item.text === 'native HTTP fixture only'));
    assert.equal(events.filter(method => method === 'initialize').length, 2); assert.equal(events.filter(method => method === 'tools/list').length, 2); assert.equal(events.filter(method => method === 'tools/call').length, 3);
    await invoke('stop', { id }); await invoke('deleteServer', { id }); assert.equal((await invoke('snapshot')).servers.length, 0);
  } finally {
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    try { await bounded(controller.dispose(), 2500, 'Owned HTTP controller cleanup exceeded bound'); }
    finally { await bounded(ctx.fiber.dispose(), 2500, 'Owned HTTP context cleanup exceeded bound'); }
  }
});
