import { Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ConsoleError } from './storage.js';

const MAX_NAMES = 512;
const SERVER_NAME = /^pc_[a-f0-9]{24}$/;
const PUBLIC_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const fail = code => { throw new ConsoleError(code); };

// Independent of the wire contract: this is also an execution-boundary check.
// Never infer identities from descriptions, schemas or raw MCP tool names.
function compilePolicy(value, prefix) {
  if (value === undefined) value = { mode: 'all', names: [] };
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-tool-policy');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('invalid-tool-policy');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || !keys.includes('mode') || !keys.includes('names')) fail('invalid-tool-policy');
    const mode = Object.getOwnPropertyDescriptor(value, 'mode');
    const names = Object.getOwnPropertyDescriptor(value, 'names');
    if (!mode?.enumerable || !names?.enumerable || !('value' in mode) || !('value' in names)) fail('invalid-tool-policy');
    if (!['all', 'include', 'exclude'].includes(mode.value) || !Array.isArray(names.value) || names.value.length > MAX_NAMES) fail('invalid-tool-policy');
    if (Object.getPrototypeOf(names.value) !== Array.prototype || Reflect.ownKeys(names.value).length !== names.value.length + 1) fail('invalid-tool-policy');
    const selected = new Set();
    for (let index = 0; index < names.value.length; index++) {
      const item = Object.getOwnPropertyDescriptor(names.value, String(index));
      if (!item?.enumerable || !('value' in item) || !validName(item.value, prefix) || selected.has(item.value)) fail('invalid-tool-policy');
      selected.add(item.value);
    }
    if (mode.value === 'all' && selected.size) fail('invalid-tool-policy');
    return { mode: mode.value, names: selected };
  } catch { fail('invalid-tool-policy'); }
}
function validName(name, prefix) {
  return typeof name === 'string' && PUBLIC_NAME.test(name) && name.startsWith(prefix) && name.length > prefix.length;
}

/**
 * Shadow registration for exactly one console-owned MCP namespace. The root
 * ToolRuntime is never replaced, restricted or enumerated for cleanup. Only
 * exact native disposers owned by this adapter are invoked.
 *
 * pause closes dispatch BEFORE removing presentation. After persisted read-back,
 * setPolicy prepares the new presentation; resume opens dispatch only on success.
 * All methods are synchronous (the installed native registry is synchronous).
 */
export function createToolPolicyScope(ctx, serverName, policy) {
  if (typeof serverName !== 'string' || !SERVER_NAME.test(serverName)) fail('invalid-tool-policy');
  const prefix = 'mcp__' + serverName + '__';
  let current = compilePolicy(policy, prefix);
  const inventory = new Map();
  const nativeDisposers = new Set();
  const inventoryDisposers = new Set();
  let paused = false;
  let closed = false;
  let fault;
  let inventoryFault;
  let applying = false;
  let barrier = 0;

  const admits = name => current.mode === 'all' || (current.mode === 'include' ? current.names.has(name) : !current.names.has(name));
  const blocked = () => closed || paused || applying || fault !== undefined;

  function removeNative(entry) {
    // Revoke a retained executor even if deregistration itself throws.
    entry.token = undefined;
    const dispose = entry.nativeDispose;
    entry.nativeDispose = undefined;
    if (!dispose) return;
    try { dispose(); nativeDisposers.delete(dispose); }
    catch { fail('tool-policy-apply-failed'); }
  }
  function stripNative() {
    for (const entry of inventory.values()) entry.token = undefined;
    let failed = false;
    for (const entry of inventory.values()) {
      try { removeNative(entry); } catch { failed = true; }
    }
    // Retain explicit disposers until successful: safety backstop independent of
    // SDK teardown order, including already-retired inventory generations.
    for (const dispose of [...nativeDisposers]) {
      try { dispose(); nativeDisposers.delete(dispose); } catch { failed = true; }
    }
    if (failed) fail('tool-policy-apply-failed');
  }
  function releaseInventoryEffects() {
    for (const dispose of [...inventoryDisposers]) {
      try { dispose(); inventoryDisposers.delete(dispose); }
      catch { /* Dispatch is already closed; retain the disposer for close. */ }
    }
  }
  function blockWith(code, fatal = false) {
    fault = code;
    paused = true;
    if (fatal) inventoryFault = code;
    try { stripNative(); } catch { /* Keep the gate closed; never forward native diagnostics. */ }
    if (fatal) {
      for (const entry of inventory.values()) entry.alive = false;
      releaseInventoryEffects();
      inventory.clear();
    }
    fail(code);
  }
  function registerNative(entry) {
    const token = {};
    entry.token = token;
    const original = entry.definition.execute;
    const wrapped = { ...entry.definition, async execute(...args) {
      // No await or other callback between the current-policy/generation check
      // and invocation. Already-dispatched business calls cannot be retracted.
      if (blocked() || !entry.alive || !entry.nativeDispose || inventory.get(entry.name) !== entry || entry.token !== token || !admits(entry.name)) fail('invalid-tool-policy');
      try { return await Reflect.apply(original, this, args); }
      catch { fail('operation-failed'); }
    } };
    // IMPORTANT: captured traced receiver retains the SDK registration CALLER's
    // this.ctx, rather than registering re-applied definitions on the root fiber.
    const dispose = ToolRuntime.prototype.register.call(entry.runtime, wrapped);
    if (typeof dispose !== 'function') fail('tool-policy-apply-failed');
    nativeDisposers.add(dispose);
    entry.nativeDispose = dispose;
    // A synchronous tools/change listener can pause/close during registration.
    if (closed || fault !== undefined || !entry.alive || inventory.get(entry.name) !== entry || entry.token !== token) removeNative(entry);
  }
  function reconcile() {
    if (applying) blockWith('tool-policy-apply-failed');
    applying = true;
    const startedAt = barrier;
    try {
      for (const entry of inventory.values()) {
        if (!admits(entry.name)) removeNative(entry);
        else if (!entry.nativeDispose) registerNative(entry);
      }
      if (closed || fault !== undefined || startedAt !== barrier) fail('tool-policy-apply-failed');
    } catch { blockWith('tool-policy-apply-failed'); }
    finally { applying = false; }
  }
  function retire(entry) {
    if (entry.inventoryDispose) inventoryDisposers.delete(entry.inventoryDispose);
    entry.inventoryDispose = undefined;
    if (!entry.alive) return;
    entry.alive = false;
    if (inventory.get(entry.name) === entry) inventory.delete(entry.name);
    try { removeNative(entry); }
    catch { blockWith('tool-policy-apply-failed'); }
  }

  let context;
  try {
    const shadow = ctx.tools[Service.extend]({ register(definition) {
      if (closed || inventoryFault !== undefined) fail(inventoryFault ?? 'invalid-tool-policy');
      let name;
      let snapshot;
      try {
        name = definition?.name;
        if (!validName(name, prefix) || typeof definition.execute !== 'function' || inventory.has(name)) blockWith('invalid-tool-policy', true);
        if (inventory.size >= MAX_NAMES) blockWith('tool-inventory-limit', true);
        snapshot = { ...definition };
        if (snapshot.name !== name || typeof snapshot.execute !== 'function') blockWith('invalid-tool-policy', true);
      } catch (error) {
        if (inventoryFault !== undefined) fail(inventoryFault);
        blockWith('invalid-tool-policy', true);
      }
      const entry = { name, definition: snapshot, runtime: this, alive: true, token: undefined, nativeDispose: undefined };
      inventory.set(name, entry);
      let dispose;
      try {
        // Denied definitions are inventory-only and NEVER enter ToolRuntime.
        // The inventory removal is itself owned by the registering child fiber.
        dispose = this.ctx.effect(() => () => retire(entry), 'personal-mcp-console: tool inventory');
        entry.inventoryDispose = dispose;
        inventoryDisposers.add(dispose);
        if (!blocked() && admits(name)) registerNative(entry);
      } catch { blockWith('tool-policy-apply-failed'); }
      return dispose;
    } });
    // A getter is critical: a plain { tools: shadow } is traced to the parent
    // and can leak native registrations when the SDK child fiber is disposed.
    context = ctx.extend({ get tools() { return this.reflect.trace(shadow); } });
  } catch { fail('tool-policy-apply-failed'); }

  return {
    context,
    getToolNames: () => [...inventory.keys()].sort(),
    isBlocked: blocked,
    pause() {
      barrier++;
      paused = true;
      try { stripNative(); } catch { blockWith('tool-policy-apply-failed'); }
    },
    setPolicy(value) {
      if (applying) blockWith('tool-policy-apply-failed');
      barrier++;
      // Even invalid publication input revokes every previously retained body.
      try { stripNative(); } catch { blockWith('tool-policy-apply-failed'); }
      if (closed) fail('invalid-tool-policy');
      if (inventoryFault !== undefined) fail(inventoryFault);
      let next;
      try { next = compilePolicy(value, prefix); } catch { blockWith('invalid-tool-policy'); }
      current = next;
      fault = undefined;
      reconcile();
    },
    resume() {
      if (closed || fault !== undefined) fail(fault ?? 'invalid-tool-policy');
      reconcile();
      paused = false;
    },
    close() {
      // Explicit close precedes SDK teardown and is safe to repeat. Old bodies
      // remain blocked even if transport/fiber cleanup never finishes.
      barrier++;
      closed = true;
      paused = true;
      for (const entry of inventory.values()) { entry.alive = false; entry.token = undefined; }
      try { stripNative(); } catch { fault = 'tool-policy-apply-failed'; }
      releaseInventoryEffects();
      inventory.clear();
    }
  };
}
