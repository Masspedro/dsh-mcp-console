// Personal-plugin credential boundary. The official MCP client/tool bridge stays
// unchanged; only its HTTP destination is an owned ephemeral loopback listener.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConsoleError } from './storage.js';
import { httpStatusFailureReason, networkFailureReason } from './diagnostics.js';

// Read native Response fields through their original accessors, not arbitrary
// provider-defined own getters. Invalid fetch results produce only a literal.
const responseStatus = Object.getOwnPropertyDescriptor(Response.prototype, 'status').get;
const responseHeaders = Object.getOwnPropertyDescriptor(Response.prototype, 'headers').get;
const responseBody = Object.getOwnPropertyDescriptor(Response.prototype, 'body').get;
const headerGet = Headers.prototype.get;

const MAX_BODY = 2 * 1024 * 1024;
const MAX_ACTIVE = 8;
const REQUEST_HEADERS = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
const RESPONSE_HEADERS = ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'www-authenticate', 'retry-after'];

export async function createCredentialBroker(config, { fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  const destination = new URL(config.url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname);
  if (destination.username || destination.password || destination.search || destination.hash ||
      (destination.protocol !== 'https:' && !(destination.protocol === 'http:' && loopback))) throw new ConsoleError('unsafe-url');
  let credentials = new Headers(config.headers ?? {});
  const capability = '/mcp/' + randomBytes(24).toString('hex');
  const requests = new Set();
  const sockets = new Set();
  let closed = false;
  let expectedHost;
  let failureReason;
  // One broker belongs to one activation attempt. Keep only the first proved
  // POST failure, never an Error object. GET 405 is valid optional-SSE behavior;
  // GET/DELETE failures and local admission refusals cannot poison startup.
  const captureFailure = (req, reason) => {
    if (!closed && req.method === 'POST' && failureReason === undefined && reason !== undefined) failureReason = reason;
  };
  const reject = (res, status) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
    res.end('{"error":"MCP request refused"}');
  };
  const server = createServer({ maxHeaderSize: 16384 }, (req, res) => {
    void forward(req, res).catch(() => {
      // Never send/log upstream error messages, request headers or credentials.
      if (!res.headersSent) reject(res, 502); else res.destroy();
    });
  });
  server.maxConnections = 32;
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 1000;
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connect', (_req, socket) => socket.destroy());
  server.on('upgrade', (_req, socket) => socket.destroy());

  async function forward(req, res) {
    if (closed || req.url !== capability || req.headers.host !== expectedHost ||
        req.headers.origin !== undefined || req.headers.cookie !== undefined ||
        !['GET', 'POST', 'DELETE'].includes(req.method) ||
        req.headers['sec-fetch-site'] !== undefined || req.headers['sec-fetch-dest'] !== undefined ||
        req.headers['sec-fetch-user'] !== undefined) return reject(res, 403);
    req.setTimeout(15000, () => req.destroy());
    if (requests.size >= MAX_ACTIVE) return reject(res, 429);
    const declared = req.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) return reject(res, 413);
    const controller = new AbortController();
    requests.add(controller);
    let timer;
    let timedOut = false;
    const abort = () => controller.abort();
    req.on('aborted', abort);
    res.on('close', abort);
    let body;
    try {
      const chunks = [];
      let count = 0;
      for await (const chunk of req) {
        count += chunk.length;
        if (count > MAX_BODY) { reject(res, 413); req.destroy(); return; }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      req.setTimeout(0); // Do not apply the upload idle timeout to a live SSE stream.
      if ((req.method === 'GET' || req.method === 'DELETE') && body.length) return reject(res, 400);
      const headers = new Headers();
      for (const name of REQUEST_HEADERS) {
        const value = req.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      for (const [name, value] of credentials) headers.set(name, value);
      timer = setTimeout(() => {
        if (closed || controller.signal.aborted) return;
        timedOut = true;
        captureFailure(req, 'connection-timeout');
        abort();
      }, timeoutMs); timer.unref?.();
      let response;
      try {
        response = await fetchImpl(destination.href, {
          method: req.method, headers, redirect: 'error', signal: controller.signal,
          ...(req.method === 'POST' ? { body } : {}),
        });
      } catch (error) {
        // This stage, not a logger string, proves an upstream fetch failure.
        // An intentional close/client abort must not become a timeout/network
        // diagnosis. No error getter, message, stack or arbitrary text is read.
        if (!closed && (!controller.signal.aborted || timedOut)) captureFailure(req, timedOut ? 'connection-timeout' : networkFailureReason(error));
        throw new ConsoleError('mount-failed');
      }
      clearTimeout(timer); timer = undefined;
      if (closed || controller.signal.aborted) throw new ConsoleError('connection-closed');
      let status, upstreamHeaders, upstreamBody;
      try {
        status = responseStatus.call(response);
        if (!Number.isInteger(status) || status < 100 || status > 599) throw new ConsoleError('connection-invalid-response');
        upstreamHeaders = responseHeaders.call(response);
        upstreamBody = responseBody.call(response);
      } catch {
        captureFailure(req, 'connection-invalid-response');
        throw new ConsoleError('connection-invalid-response');
      }
      captureFailure(req, httpStatusFailureReason(status));
      const returned = { 'cache-control': 'no-store' };
      for (const name of RESPONSE_HEADERS) {
        const value = headerGet.call(upstreamHeaders, name);
        if (value !== null) returned[name] = value;
      }
      if (status < 200 || status >= 300) {
        // Status/authentication challenge remain useful; untrusted failure text
        // can echo credentials, so do not let it enter SDK error diagnostics.
        await upstreamBody?.cancel().catch(() => {});
        returned['content-type'] = 'application/json';
        res.writeHead(status, returned);
        res.end('{"error":"MCP upstream request failed"}');
        return;
      }
      res.writeHead(status, returned);
      if (!upstreamBody) { res.end(); return; }
      // Streaming keeps MCP SSE and backpressure intact. Lock/dispose aborts it.
      const stream = Readable.fromWeb(upstreamBody);
      stream.on('error', () => res.destroy());
      const cancelStream = () => stream.destroy();
      controller.signal.addEventListener('abort', cancelStream, { once: true });
      try {
        stream.pipe(res);
        await new Promise(resolve => { res.once('finish', resolve); res.once('close', resolve); });
      } finally {
        controller.signal.removeEventListener('abort', cancelStream);
        stream.destroy();
      }
    } finally {
      clearTimeout(timer);
      body?.fill(0);
      requests.delete(controller);
      req.off('aborted', abort);
      res.off('close', abort);
    }
  }

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch {
    closed = true; credentials = new Headers();
    for (const socket of sockets) socket.destroy();
    server.close();
    throw new ConsoleError('broker-unavailable');
  }
  // Own listener only. Never occupies the GUI/app bridge's reserved ports.
  const port = server.address().port;
  expectedHost = '127.0.0.1:' + port;
  const close = async () => {
    if (closed) return;
    closed = true;
    credentials = new Headers();
    for (const request of requests) request.abort();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(() => resolve()));
  };
  return { url: 'http://' + expectedHost + capability, close, getFailureReason: () => failureReason };
}
