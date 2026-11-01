// An owned test fixture, not a production MCP server. Only JSON-RPC on stdio.
// Event records contain fixed fixture labels, method names and our own PID;
// no environment, argument values, request payloads or credentials are logged.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const eventPath = process.argv[2];
const record = event => appendFileSync(eventPath, JSON.stringify({ fixture: 'owned-synthetic-mcp', event, pid: process.pid }) + '\n');
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
record('boot');
process.on('exit', () => record('exit'));
process.on('SIGTERM', () => process.exit(0));
const input = createInterface({ input: process.stdin, terminal: false });
input.on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'notifications/initialized') { record('initialized'); return; }
  if (!Object.hasOwn(request, 'id')) return;
  switch (request.method) {
    case 'initialize':
      record('initialize');
      return reply(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'owned-synthetic-mcp', version: '0.0.0-test' } });
    case 'tools/list':
      record('tools/list');
      if (process.argv[3] === 'fail-list') return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Synthetic fixture tool synchronization failed' } }) + '\n');
      return reply(request.id, { tools: [{ name: 'synthetic_readonly', description: 'Owned regression fixture; returns only a fixed test value.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
    case 'ping': return reply(request.id, {});
    case 'tools/call': record('tools/call'); return reply(request.id, { content: [{ type: 'text', text: 'synthetic fixture only' }], isError: false });
    default: return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Synthetic method unsupported' } }) + '\n');
  }
});
input.on('close', () => process.exit(0));
