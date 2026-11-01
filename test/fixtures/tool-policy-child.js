// Owned isolated policy test fixture: JSON-RPC stdio only, no external IO.
// Log only fixed fixture labels, method labels and our own PID; never payloads.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const eventPath = process.argv[2];
const record = event => appendFileSync(eventPath, JSON.stringify({ fixture: 'owned-tool-policy', event, pid: process.pid }) + '\n');
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const notify = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n');
let generation = 0;
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
      return reply(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'owned-tool-policy', version: '0.0.0-test' } });
    case 'tools/list': {
      record('tools/list');
      const names = generation === 0 ? ['alpha', 'blocked', 'advance'] : generation === 1 ? ['alpha', 'future', 'advance'] : ['alpha', 'blocked', 'future', 'advance'];
      return reply(request.id, { tools: names.map(name => ({ name, description: 'Fixed owned fixture; selection is by exact name only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } })) });
    }
    case 'tools/call': {
      const name = request.params?.name;
      if (!['alpha', 'blocked', 'future', 'advance'].includes(name)) return reply(request.id, { content: [{ type: 'text', text: 'unsupported fixture tool' }], isError: true });
      record('tools/call/' + name);
      reply(request.id, { content: [{ type: 'text', text: 'owned policy fixture: ' + name }], isError: false });
      if (name === 'advance') { generation++; notify(); }
      return;
    }
    case 'ping': return reply(request.id, {});
    default: return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Owned fixture method unsupported' } }) + '\n');
  }
});
input.on('close', () => process.exit(0));
