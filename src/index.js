import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import { TypertRemoteService, Remote, RemoteError, createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol';
import { FileStore, ConsoleError } from './storage.js';
import { ConsoleController } from './controller.js';
import { METHODS, SERVICE, NAMESPACE, makeRemoteSpec } from './contract.js';
import { createCredentialBroker } from './http-broker.js';
import { createToolPolicyScope } from './tool-policy.js';
import { safeConnectionCode, startupFailureReason } from './diagnostics.js';

export const name = 'personal-mcp-console';
export const inject = ['typert', 'tools', 'profileContext'];
export const REMOTE = createTypertRemoteInfo(makeRemoteSpec(z), z);
const initializers = [];

export class McpConsoleService extends TypertRemoteService {
  constructor(ctx, controller) {
    super(ctx, SERVICE, { namespace: NAMESPACE });
    this.controller = controller;
    for (const initialize of initializers) initialize.call(this);
  }
}
for (const method of METHODS) {
  Object.defineProperty(McpConsoleService.prototype, method, { configurable: true, value: async function(request) {
    const principal = this.ctx.invocation?.peer?.principal;
    try { return await this.controller.invoke(method, request, principal); }
    catch (error) {
      const code = error instanceof ConsoleError ? error.code : 'operation-failed';
      if (code === 'owner-required') throw new RemoteError('remote-access/denied', 'MCP console: owner required', { action: NAMESPACE + '/' + method, reason: 'resource-invalid' });
      throw new RemoteError('gateway/bad-request', 'MCP console: ' + code, { issues: [] });
    }
  } });
  // Apply the official stage-3 Remote decorator without requiring a TS compiler.
  Remote(McpConsoleService.prototype[method], { kind: 'method', name: method, private: false, static: false, addInitializer: (fn) => initializers.push(fn) });
}

export function scopedChildContext(ctx) {
  // A local metadata shadow, not a global logger/core change. SDK/Cordis
  // diagnostics can include upstream messages; never forward their arguments.
  const safeLogger = () => safeLogger;
  for (const level of ['error', 'warn', 'info', 'debug']) safeLogger[level] = () => ctx.logger[level]('personal-mcp-console: upstream diagnostic suppressed');
  return ctx.extend({ logger: safeLogger });
}
export function bridgeStdioConfig(config) {
  const env = Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => ['DSH_MCP_CONSOLE_ENV_' + Buffer.from(key, 'ascii').toString('hex'), value]));
  return { ...config, command: process.execPath, args: [fileURLToPath(new URL('./stdio-bridge.js', import.meta.url)), config.command, ...(config.args ?? [])], env, cwd: config.cwd || process.cwd() };
}
export function officialMount(ctx, startBroker = createCredentialBroker, createScope = createToolPolicyScope) {
  return async (config) => {
    let fiber; let broker; let scope;
    try {
      const { toolPolicy, ...native } = config;
      scope = createScope(scopedChildContext(ctx), config.serverName, toolPolicy);
      // Verified activation and no supervisor retry are mandatory even for a
      // permissive direct caller. Timeout affects tools, not a new startup timer.
      let resolved = { ...native, failOnStartupError: true,
        reconnect: { enabled: false, initialDelayMs: 1000, maxDelayMs: 1000, maxAttempts: 1 } };
      if (config.transport === 'stdio') resolved = bridgeStdioConfig(resolved);
      if (config.transport === 'streamable-http') {
        // Only the broker receives real credentials. The SDK receives a private
        // ephemeral loopback capability; neither headers nor upstream prose.
        broker = await startBroker(config);
        resolved = { ...resolved, url: broker.url, headers: {} };
      }
      fiber = scope.context.plugin(mcpClient, resolved);
      await fiber;
      if (fiber.state !== 2 || scope.isBlocked()) throw new ConsoleError('mount-failed');
      return { initialVerified: true, verifiedAt: Date.now(),
        getToolNames: () => scope.getToolNames(), pauseTools: () => scope.pause(),
        applyToolPolicy: (policy) => scope.setPolicy(policy), resumeTools: () => scope.resume(),
        toolsBlocked: () => scope.isBlocked(), dispose: async () => {
          // Dispatch closes FIRST, independently of SDK/broker teardown success.
          try { scope.close(); } finally { try { await broker?.close(); } finally { await fiber.dispose(); } }
        } };
    } catch (error) {
      // Error provenance is a reviewed literal, never logger/message parsing.
      const code = safeConnectionCode(error, startupFailureReason(error) ?? broker?.getFailureReason?.() ?? 'mount-failed');
      try { scope?.close(); } catch {}
      try { await broker?.close(); } catch {}
      await fiber?.dispose().catch(() => {});
      throw new ConsoleError(code);
    }
  };
}
export function externalInventory(ctx, owned) {
  const runtime = ctx.registry.get(mcpClient);
  const names = new Set();
  if (runtime) for (const fiber of runtime.fibers) {
    const value = fiber.config?.serverName;
    if (fiber.uid !== null && fiber.state === 2 && typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value) && !owned.has(value)) names.add(value);
  }
  return { servers: [...names].sort(), available: true };
}
export function pluginStoreDirectory(profile) {
  if (!profile || typeof profile.home !== 'string' || typeof profile.dir !== 'string' || profile.home.length > 4096 || profile.dir.length > 4096 || !isAbsolute(profile.home) || !isAbsolute(profile.dir) || /[\x00-\x1f]/.test(profile.home + profile.dir)) throw new ConsoleError('profile-metadata-unavailable');
  const profileKey = createHash('sha256').update(resolve(profile.dir)).digest('hex').slice(0, 32);
  return join(resolve(profile.home), 'storages', 'personal-mcp-console', profileKey);
}
export async function apply(ctx) {
  // Data is plugin-owned; no engine, credentials, profile, or shared config path is read.
  const store = new FileStore(pluginStoreDirectory(ctx.profileContext));
  const controller = new ConsoleController({ store, automaticKey: (options) => store.privateKey(options), mount: officialMount(ctx), inventory: () => externalInventory(ctx, new Set([...controller.live.keys()].map((id) => 'pc_' + id))) });
  ctx.effect(() => () => controller.dispose(), 'personal-mcp-console: child/vault cleanup');
  registerHost(ctx, controller);
  // Restoration is authorized only by explicit persisted Switch intent. It is
  // separate from RPC principals and does not delay console/service readiness.
  // Missing/legacy/disabled stores create no files, key or MCP child.
  // Mixed cached modules during a non-atomic package reload must not bypass the
  // startup writer-lock gate. A fresh complete host load resolves this safely.
  if (typeof controller.startup === 'function' && typeof store.readForStartup === 'function') {
    void controller.startup().catch(() => {
      if (!controller.closed) ctx.logger.warn('personal-mcp-console: startup unavailable');
    });
  } else ctx.logger.warn('personal-mcp-console: startup unavailable');
}

export function registerHost(ctx, controller) {
  new McpConsoleService(ctx, controller);
  return ctx.typert.register({ package: REMOTE.package, face: 'host', schemas: [], model: { services: [{ key: SERVICE, exportName: 'McpConsoleService', tags: [], members: METHODS.map((name) => ({ name, kind: 'method', signature: '(request: McpConsoleRequest): Promise<McpConsoleSnapshot>', tags: [] })), types: [] }], events: [], objects: [] }, invocations: REMOTE.descriptors });
}
