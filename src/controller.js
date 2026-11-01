import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { makeSchemas, METHODS, CONNECTION_FAILURE_CODES, TOOL_FAILURE_CODES } from './contract.js';
import { safeConnectionCode } from './diagnostics.js';
import { ConsoleError, fail } from './storage.js';
import { derive, seal, unseal, validateEnvelope, AUTOMATIC_KDF } from './vault.js';
const { schemas, server: serverSchema, result: resultSchema, toolNames: toolNamesSchema } = makeSchemas(z);
const failureCodes = new Set([...CONNECTION_FAILURE_CODES, ...TOOL_FAILURE_CODES]);
const emptyStore = () => ({ version: 1, revision: 0, servers: [], vault: null });
const serverName = (id) => 'pc_' + id;
const refsOf = (server) => Object.values(server.transport === 'stdio' ? server.envRefs : server.headerRefs);

export function validateServer(input) {
  const result = serverSchema.safeParse(input);
  if (!result.success) fail('invalid-input');
  const server = result.data;
  if (server.id && server.toolPolicy?.names.some((name) => !name.startsWith('mcp__' + serverName(server.id) + '__'))) fail('invalid-tool-policy');
  if (server.transport === 'stdio' && server.args.some((value) => /(?:^|[^a-z])(?:access[-_]?token|api[-_]?key|password|passwd|secret|authorization|credential|token)(?:$|[=:"'\s])/i.test(value) || /^Bearer\s/i.test(value))) fail('credential-argument');
  if (server.transport === 'streamable-http') {
    let url; try { url = new URL(server.url); } catch { fail('invalid-url'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) fail('unsafe-url');
    if (/\s|\\/.test(server.url)) fail('unsafe-url');
    server.url = url.href;
    const keys = Object.keys(server.headerRefs).map((v) => v.toLowerCase());
    if (new Set(keys).size !== keys.length || keys.some((v) => ['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-connection'].includes(v))) fail('invalid-headers');
  }
  return server;
}
function validateStore(raw) {
  if (raw === null) return emptyStore();
  if (!raw || Array.isArray(raw) || typeof raw !== 'object' || !['revision,servers,vault,version', 'enabledIds,revision,servers,vault,version'].includes(Object.keys(raw).sort().join(',')) || raw.version !== 1 || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || raw.revision >= Number.MAX_SAFE_INTEGER || !Array.isArray(raw.servers) || raw.servers.length > 32) fail('store-invalid');
  const ids = new Set();
  for (const server of raw.servers) {
    validateServer(server);
    if (!server.id || ids.has(server.id)) fail('store-invalid');
    ids.add(server.id);
  }
  if (Object.hasOwn(raw, 'enabledIds') && (!Array.isArray(raw.enabledIds) || raw.enabledIds.length > 32 || new Set(raw.enabledIds).size !== raw.enabledIds.length || Array.from(raw.enabledIds).some((id) => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id) || !ids.has(id)))) fail('store-invalid');
  if (raw.vault !== null) validateEnvelope(raw.vault);
  return raw;
}
const isEnabled = (store, id) => store.enabledIds?.includes(id) === true;
function setEnabled(store, id, enabled) {
  const ids = new Set(store.enabledIds ?? []);
  if (enabled) ids.add(id); else ids.delete(id);
  // Preference is separate from server configuration; legacy absence means OFF.
  store.enabledIds = store.servers.filter((server) => ids.has(server.id)).map((server) => server.id);
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export class ConsoleController {
  constructor({ store, mount, automaticKey = null, inventory = () => ({ servers: [], available: false }), now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.store = store; this.mount = mount; this.automaticKey = automaticKey; this.mode = automaticKey ? 'automatic' : 'passphrase'; this.inventory = inventory; this.now = now;
    this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.live = new Map(); this.liveCredentialRefs = new Map(); this.states = new Map(); this.lastVerifiedAt = new Map(); this.queue = Promise.resolve(); this.closed = false;
    // Failed provisional saves stay owned even when no server record exists.
    // Never generate a fresh no-ID child while its predecessor cannot be cleaned.
    this.pendingSaves = new Set(); this.saveStateAmbiguous = false;
    this.preferenceStateAmbiguous = new Set(); this.startupPromise = null;
    this.toolPolicyStateAmbiguous = new Set(); this.toolInventories = new Map(); this.lastFailures = new Map();
    this.key = null; this.secrets = null; this.envelope = null; this.expiresAt = 0; this.timer = null;
    // Non-secret authentication evidence survives cache/key failures while owned
    // mounts retain their original credentials. Unknown membership is not fresh.
    this.authenticatedEnvelope = null; this.authenticatedRefs = null;
    this.secretStateAmbiguous = false;
    this.unlockFailures = 0; this.unlockBlockedUntil = 0;
  }
  enqueue(fn) {
    const next = this.queue.then(fn, fn); this.queue = next.catch(() => {}); return next;
  }
  async invoke(method, input, principal) {
    if (principal?.kind !== 'owner') fail('owner-required');
    if (!METHODS.includes(method)) fail('invalid-method');
    const parsed = schemas[method].safeParse(input);
    if (!parsed.success) fail('invalid-input');
    // Authentication precedes queuing/IO; no stored invocation context is reused.
    return this.enqueue(async () => {
      if (this.closed) fail('disposed');
      // A valid owner lock revokes in-memory access even if its revision is stale
      // or the disk store is corrupt/unreadable. Reporting still fails safely.
      if (method === 'lock' && this.mode === 'passphrase') await this.lockMemory();
      if (method === 'snapshot' && this.mode === 'passphrase' && this.key && this.now() >= this.expiresAt) await this.lockMemory();
      let committedActivation; let committedAppend; let committedPreference; let attemptedToolPolicy; let policyHandle;
      const operation = async () => {
        const current = validateStore(await this.store.read());
        const request = parsed.data;
        // Ordinary stale mutations must never tear down children. Emergency Lock
        // intentionally remains the separately documented exception above.
        if (method !== 'snapshot' && request.revision !== current.revision) fail('revision-conflict');
        // Detect even KDF/mode tampering against the retained automatic baseline
        // before switching into manual cleanup that could dispose owned handles.
        if (this.live.size && this.authenticatedEnvelope !== null && JSON.stringify(current.vault) !== this.authenticatedEnvelope) {
          if (method !== 'stop') fail('vault-drift');
          // Emergency target Stop may still clean its owned handle, but corrupt
          // KDF/mode metadata must never turn it into a manual global lock/TTL.
          targetById(current, request.id);
          await this.publishPreference(current, request.id, false); committedPreference = request.id;
          try { await this.stopOne(request.id); } finally { this.clearCredentials(); }
          fail('vault-drift');
        }
        if (this.live.size && this.mode === 'automatic' && this.authenticatedEnvelope === null && current.vault?.kdf !== AUTOMATIC_KDF && [...this.live.keys()].some((id) => !this.liveCredentialRefs.has(id) || this.liveCredentialRefs.get(id).size)) {
          if (method === 'stop') {
            targetById(current, request.id);
            await this.publishPreference(current, request.id, false); committedPreference = request.id;
            try { await this.stopOne(request.id); } finally { this.clearCredentials(); }
          }
          fail('vault-locked');
        }
        this.mode = current.vault ? (current.vault.kdf === AUTOMATIC_KDF ? 'automatic' : 'passphrase') : (this.automaticKey ? 'automatic' : 'passphrase');
        const automatic = this.mode === 'automatic';
        if (!automatic && !this.live.size) { this.authenticatedEnvelope = null; this.authenticatedRefs = null; }
        const mountedAppend = automatic && method === 'setSecret' && this.live.size > 0;
        if (automatic && ['lock', 'initializeVault', 'unlock'].includes(method)) fail('automatic-mode');
        // A cached plaintext view cannot silently follow changed ciphertext during
        // a mutation. Retain the authenticated baseline after key/cache failure;
        // a mounted snapshot must not silently adopt drift and erase that guard.
        const currentEnvelope = JSON.stringify(current.vault);
        if (automatic && method !== 'stop' && ((method !== 'snapshot' && this.key && currentEnvelope !== this.envelope) || (this.live.size && this.authenticatedEnvelope !== null && currentEnvelope !== this.authenticatedEnvelope))) fail('vault-drift');
        const next = structuredClone(current);
        const target = () => { const server = next.servers.find((s) => s.id === request.id); if (!server) fail('not-owned'); return server; };
        const resolveConfig = (server) => this.resolveConfig(server, current, automatic);
        // The new endpoint's metadata/ownership guards precede key IO, child
        // cleanup and mounting. Legacy save remains a metadata-only operation.
        let activationServer;
        if (method === 'saveAndActivate') {
          activationServer = validateServer(request.server);
          if (activationServer.id) {
            targetById(next, activationServer.id);
            if (this.live.has(activationServer.id)) fail('stop-before-edit');
            if (this.preferenceStateAmbiguous.has(activationServer.id)) fail('preference-state-ambiguous');
            if (this.toolPolicyStateAmbiguous.has(activationServer.id)) fail('tool-policy-state-ambiguous');
          } else if (next.servers.length >= 32) fail('server-limit');
          if (this.saveStateAmbiguous) fail('save-state-ambiguous');
          if (this.pendingSaves.size) fail('save-cleanup-required');
          if (!activationServer.id) {
            do { activationServer.id = randomBytes(12).toString('hex'); }
            while (next.servers.some((server) => server.id === activationServer.id) || this.live.has(activationServer.id));
          }
          validateServer(activationServer);
        }
        // Resolve every vault binding BEFORE any reconnect-triggered teardown,
        // including expired/mismatched vault state. The independent TTL callback
        // still performs its own cleanup at the next serialized queue boundary.
        // Ownership/mount-state guards precede all automatic key IO.
        if (method === 'start' || method === 'reconnect') {
          const server = target();
          if (method === 'start' && this.live.has(server.id)) fail('already-mounted');
          if (this.preferenceStateAmbiguous.has(server.id)) fail('preference-state-ambiguous');
          if (this.toolPolicyStateAmbiguous.has(server.id)) fail('tool-policy-state-ambiguous');
        }
        if (automatic && this.secretStateAmbiguous && (['start', 'reconnect', 'setSecret', 'deleteSecret'].includes(method) || (activationServer && refsOf(activationServer).length))) fail('secret-state-ambiguous');
        if (automatic && (method === 'setSecret' || method === 'deleteSecret') && this.live.size) {
          if (!mountedAppend) fail('stop-before-secret-change');
          if (current.vault && (this.authenticatedEnvelope !== currentEnvelope || !this.authenticatedRefs)) fail('vault-locked');
          if (!current.vault && [...this.live.keys()].some((id) => !this.liveCredentialRefs.has(id) || this.liveCredentialRefs.get(id).size)) fail('vault-locked');
          if (this.authenticatedRefs?.has(request.ref)) fail('stop-before-secret-change');
          if (this.authenticatedRefs?.size >= 128) fail('secret-limit');
        }
        if (automatic && current.vault && (['snapshot', 'start', 'reconnect', 'setSecret', 'deleteSecret'].includes(method) || (activationServer && refsOf(activationServer).length))) await this.loadAutomatic(current.vault);
        if (automatic && method === 'snapshot' && !current.vault) {
          if ([...this.live.keys()].some((id) => !this.liveCredentialRefs.has(id) || this.liveCredentialRefs.get(id).size)) fail('vault-locked');
          this.clearCredentials(); this.rememberAuthentication(null, {});
        }
        const reconnectConfig = method === 'reconnect' ? resolveConfig(target()) : null;
        if (!automatic && this.key && this.now() >= this.expiresAt) { if (method === 'stop') this.clearCredentials(); else await this.lockMemory(); }
        if (!automatic && this.key && JSON.stringify(current.vault) !== this.envelope) { if (method === 'stop') this.clearCredentials(); else await this.lockMemory(); }
        // Unlike legacy reconnect, new Save must not capture plaintext bindings
        // before expiry/drift cleanup and then mount with those revoked strings.
        const activationConfig = activationServer ? resolveConfig(activationServer) : null;
        if (method === 'snapshot') return this.snapshot(current);
        let rollback; let pendingKey; let changedServer;
        try {
          switch (method) {
            case 'save': {
              const server = validateServer(request.server);
              if (server.id) { targetById(next, server.id); if (this.live.has(server.id)) fail('stop-before-edit'); if (this.toolPolicyStateAmbiguous.has(server.id)) fail('tool-policy-state-ambiguous'); }
              else { if (next.servers.length >= 32) fail('server-limit'); server.id = randomBytes(12).toString('hex'); }
              validateServer(server);
              const index = next.servers.findIndex((s) => s.id === server.id);
              const changed = index < 0 || !same(validateServer(next.servers[index]), server);
              if (index < 0) next.servers.push(server); else next.servers[index] = server;
              if (changed) { setEnabled(next, server.id, false); changedServer = server.id; }
              break;
            }
            case 'saveAndActivate': {
              let handle;
              this.lastFailures.delete(activationServer.id);
              try { handle = await this.mount(activationConfig); }
              catch (error) { const code = safeConnectionCode(error); this.states.set(activationServer.id, 'mount-failed'); this.lastVerifiedAt.delete(activationServer.id); this.lastFailures.set(activationServer.id, code); fail(code); }
              // Take ownership before checking the adapter's contract, so a
              // malformed/unverified returned handle is never silently orphaned.
              if (this.ownHandle(activationServer, handle, current, automatic)) {
                this.pendingSaves.add(activationServer.id);
                rollback = () => this.stopOne(activationServer.id);
              }
              if (this.closed) fail('disposed');
              if (!handle || typeof handle.dispose !== 'function' || handle.initialVerified !== true || !Number.isSafeInteger(handle.verifiedAt) || handle.verifiedAt < 0) {
                this.states.set(activationServer.id, 'mount-failed'); this.lastVerifiedAt.delete(activationServer.id); fail('mount-failed');
              }
              this.states.set(activationServer.id, 'activation-verified');
              this.lastVerifiedAt.set(activationServer.id, handle.verifiedAt);
              // No persisted or staged server record exists until native initial
              // handshake AND tools sync have explicitly completed successfully.
              const index = next.servers.findIndex((server) => server.id === activationServer.id);
              if (index < 0) next.servers.push(activationServer); else next.servers[index] = activationServer;
              setEnabled(next, activationServer.id, true);
              break;
            }
            case 'deleteServer': target(); if (this.live.has(request.id)) fail('stop-before-delete'); next.servers = next.servers.filter((s) => s.id !== request.id); setEnabled(next, request.id, false); break;
            case 'start': case 'reconnect': {
              const server = target();
              if (!reconnectConfig) resolveConfig(server);
              // ON is explicit persisted intent, not a claim that mounting worked.
              // Complete guarded publication BEFORE reconnect teardown or network.
              const published = await this.publishPreference(current, server.id, true);
              committedPreference = server.id;
              if (this.closed) fail('disposed');
              // Publication can yield past manual expiry. Do not execute with
              // plaintext bindings captured before the durable preference write.
              this.resolveConfig(server, published, automatic);
              if (method === 'reconnect') await this.stopOne(server.id);
              if (this.closed) fail('disposed');
              const liveConfig = this.resolveConfig(server, published, automatic);
              let handle;
              this.lastFailures.delete(server.id);
              try { handle = await this.mount(liveConfig); }
              catch (error) { const code = safeConnectionCode(error); this.states.set(server.id, 'mount-failed'); this.lastVerifiedAt.delete(server.id); this.lastFailures.set(server.id, code); fail(code); }
              if (this.ownHandle(server, handle, current, automatic)) rollback = () => this.stopOne(server.id);
              if (this.closed) fail('disposed');
              if (!handle || typeof handle.dispose !== 'function') {
                this.states.set(server.id, 'mount-failed'); this.lastVerifiedAt.delete(server.id); fail('mount-failed');
              }
              this.recordVerification(server.id, handle);
              return this.snapshot(published);
            }
            case 'setToolPolicy': {
              target();
              return await this.publishToolPolicy(current, request.id, request.toolPolicy, (handle) => { attemptedToolPolicy = request.id; policyHandle = handle; });
            }
            case 'stop': {
              target();
              // OFF is durable before successful teardown; failed publication
              // leaves the old child owned and untouched. Failed disposal leaves
              // the durable OFF preference and stop-failed owned handle visible.
              const published = await this.publishPreference(current, request.id, false);
              committedPreference = request.id;
              await this.stopOne(request.id);
              return this.snapshot(published);
            }
            case 'initializeVault': {
              if (next.vault) fail('vault-exists');
              const salt = randomBytes(16); const key = await derive(request.passphrase, salt);
              try { next.vault = seal({}, key, salt); } finally { key.fill(0); }
              break;
            }
            case 'unlock': {
              if (!next.vault) fail('vault-not-initialized');
              if (this.now() < this.unlockBlockedUntil) fail('unlock-rate-limited');
              const key = await derive(request.passphrase, Buffer.from(next.vault.salt, 'base64'));
              let secrets;
              try { secrets = unseal(next.vault, key); }
              catch (error) { key.fill(0); this.unlockFailures++; if (this.unlockFailures >= 3) { this.unlockBlockedUntil = this.now() + 30000; this.unlockFailures = 0; } throw error; }
              try { await this.lockMemory(); } catch (error) { key.fill(0); throw error; }
              this.key = key; this.secrets = secrets; this.envelope = JSON.stringify(next.vault);
              this.expiresAt = this.now() + request.ttlSeconds * 1000; this.unlockFailures = 0;
              this.timer = this.setTimer(() => { void this.enqueue(() => this.lockMemory()).catch(() => {}); }, request.ttlSeconds * 1000); this.timer?.unref?.();
              rollback = () => this.lockMemory();
              break;
            }
            case 'lock': await this.lockMemory(); break;
            case 'setSecret': case 'deleteSecret': {
              if (!automatic && (!this.key || !this.secrets)) fail('vault-locked');
              if (this.live.size && !mountedAppend) fail('stop-before-secret-change');
              if (automatic && !next.vault && method === 'setSecret') pendingKey = await this.getAutomaticKey(true);
              if (!pendingKey && (!this.key || !this.secrets)) fail('vault-locked');
              // Reauthenticated membership is authoritative, not an optimistic
              // cached absence. Never overwrite even an unused mounted-vault ref.
              if (mountedAppend && Object.hasOwn(this.secrets ?? {}, request.ref)) fail('stop-before-secret-change');
              const secrets = { ...(pendingKey ? {} : this.secrets) };
              if (method === 'setSecret') { if (!Object.hasOwn(secrets, request.ref) && Object.keys(secrets).length >= 128) fail('secret-limit'); secrets[request.ref] = request.value; }
              else { if (next.servers.some((s) => refsOf(s).includes(request.ref))) fail('secret-in-use'); delete secrets[request.ref]; }
              next.vault = seal(secrets, pendingKey ?? this.key, next.vault ? Buffer.from(next.vault.salt, 'base64') : randomBytes(16), automatic ? AUTOMATIC_KDF : 'scrypt-N32768-r8-p1');
              // Install the new plaintext view only after atomic publication succeeds.
              rollback = null; next._secrets = secrets;
              break;
            }
          }
          const newSecrets = next._secrets; delete next._secrets;
          next.revision++;
          if (method === 'saveAndActivate') {
            // Validate the reply before publishing; a snapshot-contract failure
            // must not turn a rejected Save into a persisted new server record.
            const snapshot = this.snapshot(next);
            if (this.closed) fail('disposed');
            try {
              await this.store.write(next);
              if (!same(validateStore(await this.store.read()), next)) fail('save-state-ambiguous');
            }
            catch (error) { await this.restoreFailedSave(current, next); throw error; }
            this.pendingSaves.delete(activationServer.id);
            // Publication may have completed while disposal was requested. Keep
            // that genuine saved intent, but never return/publish a late mount.
            if (this.closed) fail('disposed');
            committedActivation = activationServer.id;
            return snapshot; // The verified owned mount deliberately remains live.
          }
          // Mounted append cannot publish a write whose reply is already known
          // to fail validation. Stage only non-secret output; keep mounts intact.
          const appendSnapshot = mountedAppend ? this.snapshot(next, newSecrets) : null;
          try { await this.store.write(next); }
          catch (error) {
            if (mountedAppend) await this.checkFailedAppend(current, next, newSecrets);
            throw error;
          }
          if (newSecrets) {
            if (pendingKey) { this.clearCredentials(); this.key = pendingKey; pendingKey = null; }
            this.secrets = newSecrets; this.envelope = JSON.stringify(next.vault);
            if (automatic) this.rememberAuthentication(next.vault, newSecrets);
          }
          if (mountedAppend) committedAppend = true;
          if (changedServer) { this.states.set(changedServer, 'disabled'); this.lastVerifiedAt.delete(changedServer); this.lastFailures.delete(changedServer); this.toolInventories.delete(changedServer); }
          if (method === 'deleteServer') { this.states.delete(request.id); this.toolInventories.delete(request.id); this.lastFailures.delete(request.id); this.toolPolicyStateAmbiguous.delete(request.id); }
          return appendSnapshot ?? this.snapshot(next);
        } catch (error) {
          pendingKey?.fill(0);
          if (rollback) {
            try { await rollback(); }
            catch {
              if (method === 'saveAndActivate') { if (!this.saveStateAmbiguous) fail('save-cleanup-required'); }
              else fail('stop-failed');
            }
          }
          if (activationServer && !current.servers.some((server) => server.id === activationServer.id) && !this.live.has(activationServer.id)) {
            this.states.delete(activationServer.id); this.lastVerifiedAt.delete(activationServer.id); this.lastFailures.delete(activationServer.id); this.toolInventories.delete(activationServer.id);
          }
          if (error instanceof ConsoleError) throw error;
          fail('operation-failed');
        }
      };
      if (method === 'snapshot') return operation();
      let operationError;
      try { return await this.store.transaction(async () => { try { return await operation(); } catch (error) { operationError = error; throw error; } }); }
      catch (error) {
        if (attemptedToolPolicy && error !== operationError) {
          // A lock-release failure after opening the gate must close it again;
          // never silently replay a policy or compensate without lock ownership.
          try { policyHandle?.pauseTools(); } catch {}
          this.toolPolicyStateAmbiguous.add(attemptedToolPolicy);
          this.states.set(attemptedToolPolicy, this.live.has(attemptedToolPolicy) ? 'mounted-status-unavailable' : 'disabled');
          this.lastVerifiedAt.delete(attemptedToolPolicy); this.lastFailures.set(attemptedToolPolicy, 'tool-policy-state-ambiguous');
          fail('tool-policy-state-ambiguous');
        }
        if (committedPreference && error !== operationError) {
          // Lock-release failure may override any operation outcome. No lock is
          // proven now: never roll back preference or drop an owned live handle.
          this.preferenceStateAmbiguous.add(committedPreference);
          fail('preference-state-ambiguous');
        }
        if (committedAppend) {
          // Publication may have completed before writer-lock release failed.
          // Never compensate/retry outside proven lock ownership or retain a
          // silently stale credential cache. Existing tool handles remain live.
          this.secretStateAmbiguous = true; this.clearCredentials();
          fail('secret-state-ambiguous');
        }
        if (committedActivation) {
          // Transaction release can fail after publication. Its writer lock is no
          // longer proven: do not compensate outside it or silently retry Save.
          this.saveStateAmbiguous = true; this.pendingSaves.add(committedActivation);
          await this.stopOne(committedActivation).catch(() => {});
          fail('save-state-ambiguous');
        }
        throw error;
      }
    });
  }
  // Trusted lifecycle entry, deliberately absent from METHODS and all RPC
  // descriptors. It never fabricates/reuses an owner principal. One bounded
  // pass yields this queue between IDs so queued owner operations take priority.
  startup() {
    if (this.startupPromise) return this.startupPromise;
    this.startupPromise = (async () => {
      const approved = await this.enqueue(async () => {
        if (this.closed) return [];
        const current = await this.#readStartupStore();
        return current.servers.filter((server) => isEnabled(current, server.id)).map((server) => structuredClone(server));
      });
      for (const server of approved) {
        await this.enqueue(() => this.#restoreEnabled(server)).catch(() => {});
      }
    })().catch((error) => { if (error instanceof ConsoleError) throw error; fail('operation-failed'); });
    return this.startupPromise;
  }
  async #readStartupStore() {
    return validateStore(await (typeof this.store.readForStartup === 'function' ? this.store.readForStartup() : this.store.read()));
  }
  async #restoreEnabled(approved) {
    if (this.closed || this.live.has(approved.id) || this.preferenceStateAmbiguous.has(approved.id) || this.toolPolicyStateAmbiguous.has(approved.id)) return;
    let owned = false; let accepted = false; let attemptedMount = false;
    try {
      const current = await this.#readStartupStore();
      const server = current.servers.find((row) => row.id === approved.id);
      if (!server || !isEnabled(current, server.id) || !same(server, approved)) return;
      // Do not adopt changed ciphertext/mode when sibling mounts retain secrets.
      this.assertMountedVault(current);
      this.mode = current.vault ? (current.vault.kdf === AUTOMATIC_KDF ? 'automatic' : 'passphrase') : (this.automaticKey ? 'automatic' : 'passphrase');
      const automatic = this.mode === 'automatic';
      if (refsOf(server).length) {
        if (!automatic) fail('vault-locked'); // No stored passphrase or migration.
        if (this.secretStateAmbiguous) fail('secret-state-ambiguous');
        if (current.vault) await this.loadAutomatic(current.vault); // create:false only.
      }
      if (this.closed) return;
      // Key IO can yield to another process. Recheck ALL metadata/ciphertext and
      // the writer-lock gate before any process/network side effect.
      if (!same(await this.#readStartupStore(), current)) return;
      const config = this.resolveConfig(server, current, automatic);
      let handle;
      this.lastFailures.delete(server.id); attemptedMount = true;
      try { handle = await this.mount(config); } catch (error) { fail(safeConnectionCode(error)); }
      // Retain even a malformed late handle until cleanup actually succeeds.
      owned = this.ownHandle(server, handle, current, automatic);
      if (this.closed) fail('disposed');
      if (!handle || typeof handle.dispose !== 'function' || handle.initialVerified !== true || !Number.isSafeInteger(handle.verifiedAt) || handle.verifiedAt < 0) fail('mount-failed');
      // No late activation publication after disable/delete/edit/revision or
      // ciphertext change. Only this provisional handle may be disposed here.
      if (!same(await this.#readStartupStore(), current) || this.closed) fail('mount-failed');
      this.recordVerification(server.id, handle); accepted = true;
    } catch (error) {
      if (!this.live.has(approved.id) || owned) {
        this.states.set(approved.id, 'mount-failed'); this.lastVerifiedAt.delete(approved.id);
        if (attemptedMount) this.lastFailures.set(approved.id, safeConnectionCode(error));
      }
    } finally {
      if (owned && !accepted) {
        try { await this.stopOne(approved.id); this.states.set(approved.id, 'mount-failed'); }
        catch {} // stopOne exposes stop-failed and keeps ownership for disposal.
      }
    }
  }
  assertMountedVault(current) {
    if (this.live.size && this.authenticatedEnvelope !== null && JSON.stringify(current.vault) !== this.authenticatedEnvelope) fail('vault-drift');
    if (this.live.size && this.authenticatedEnvelope === null && [...this.live.keys()].some((id) => !this.liveCredentialRefs.has(id) || this.liveCredentialRefs.get(id).size)) fail('vault-locked');
    if (this.key && JSON.stringify(current.vault) !== this.envelope) fail('vault-drift');
  }
  resolveConfig(server, current, automatic) {
    const refs = refsOf(server);
    if (refs.length && (!this.key || !this.secrets || (!automatic && this.now() >= this.expiresAt) || JSON.stringify(current.vault) !== this.envelope)) fail('vault-locked');
    const values = Object.fromEntries(Object.entries(server.transport === 'stdio' ? server.envRefs : server.headerRefs).map(([name, ref]) => {
      if (!Object.hasOwn(this.secrets ?? {}, ref)) fail('secret-missing');
      return [name, this.secrets[ref]];
    }));
    return { transport: server.transport, serverName: serverName(server.id), toolCallTimeoutMs: server.toolCallTimeoutMs ?? 60000, ...(server.toolPolicy ? { toolPolicy: structuredClone(server.toolPolicy) } : {}), maxInstructionBytes: 16384, failOnStartupError: true, reconnect: { enabled: false, initialDelayMs: 1000, maxDelayMs: 1000, maxAttempts: 1 }, ...(server.transport === 'stdio' ? { command: server.command, args: server.args, ...(server.cwd ? { cwd: server.cwd } : {}), env: values } : { url: server.url, headers: values }) };
  }
  ownHandle(server, handle, current, automatic) {
    if (!handle || (typeof handle !== 'object' && typeof handle !== 'function')) return false;
    // A credential-free first handle does not authenticate persisted ciphertext.
    // Discard obsolete no-mount evidence rather than mislabel it authenticated;
    // a later credentialed sibling must authenticate with the existing key.
    if (automatic && current.vault && !this.live.size && !this.key && refsOf(server).length === 0) { this.authenticatedEnvelope = null; this.authenticatedRefs = null; }
    this.live.set(server.id, handle);
    this.liveCredentialRefs.set(server.id, new Set(refsOf(server)));
    if (automatic && !current.vault) this.rememberAuthentication(null, {});
    return true;
  }
  recordVerification(id, handle) {
    this.lastFailures.delete(id);
    // Standard RPC starts retain their legacy unknown-status contract; startup
    // and Save additionally demand genuine initial verification before calling.
    this.states.set(id, handle.initialVerified === true ? 'activation-verified' : 'mounted-status-unavailable');
    this.lastVerifiedAt.delete(id);
    if (handle.initialVerified === true && Number.isSafeInteger(handle.verifiedAt) && handle.verifiedAt >= 0) this.lastVerifiedAt.set(id, handle.verifiedAt);
  }
  captureToolInventory(id) {
    const handle = this.live.get(id);
    if (typeof handle?.getToolNames === 'function') {
      try {
        const names = handle.getToolNames();
        if (!toolNamesSchema.safeParse(names).success || names.some((name) => !name.startsWith('mcp__' + serverName(id) + '__'))) throw new Error();
        this.toolInventories.set(id, [...names].sort());
        return { names: [...names].sort(), source: 'mounted' };
      } catch { return { names: [], source: 'unavailable' }; }
    }
    const names = this.toolInventories.get(id);
    return { names: names ? [...names] : [], source: names ? 'last-known' : 'unavailable' };
  }
  async publishToolPolicy(current, id, policy, beginPublication) {
    const next = structuredClone(current);
    const server = next.servers.find((row) => row.id === id);
    if (!server) fail('not-owned');
    validateServer({ ...server, toolPolicy: policy });
    if (this.preferenceStateAmbiguous.has(id)) fail('preference-state-ambiguous');
    if (this.toolPolicyStateAmbiguous.has(id)) fail('tool-policy-state-ambiguous');
    if (this.states.get(id) === 'stop-failed') fail('stop-failed');
    const handle = this.live.get(id);
    if (handle && ['pauseTools', 'applyToolPolicy', 'resumeTools'].some((method) => typeof handle[method] !== 'function')) fail('tool-policy-unavailable');
    // The defaults stay implicit and no credential/profile/native config changes.
    if (policy.mode === 'all') delete server.toolPolicy;
    else server.toolPolicy = structuredClone(policy);
    next.revision++;
    this.snapshot(next); // Validate all non-secret output before closing/publishing.
    if (handle) {
      try { handle.pauseTools(); }
      catch { this.lastFailures.set(id, 'tool-policy-apply-failed'); this.states.set(id, 'mounted-status-unavailable'); this.lastVerifiedAt.delete(id); fail('tool-policy-apply-failed'); }
    }
    beginPublication(handle);
    try {
      await this.store.write(next);
      if (!same(validateStore(await this.store.read()), next)) fail('tool-policy-state-ambiguous');
      if (this.closed) fail('disposed');
    } catch {
      // Even an after-rename/fsync failure is not permission to restore all tools.
      // Explicit OFF or a fresh lifecycle load is required after ambiguity.
      this.toolPolicyStateAmbiguous.add(id);
      this.lastFailures.set(id, 'tool-policy-state-ambiguous');
      this.lastVerifiedAt.delete(id);
      if (handle) this.states.set(id, 'mounted-status-unavailable');
      fail('tool-policy-state-ambiguous');
    }
    if (handle) {
      try { handle.applyToolPolicy(policy); handle.resumeTools(); }
      catch {
        try { handle.pauseTools(); } catch {}
        this.lastFailures.set(id, 'tool-policy-apply-failed'); this.lastVerifiedAt.delete(id);
        this.states.set(id, 'mounted-status-unavailable'); fail('tool-policy-apply-failed');
      }
    }
    this.lastFailures.delete(id);
    return this.snapshot(next);
  }
  async publishPreference(current, id, enabled) {
    const next = structuredClone(current); setEnabled(next, id, enabled); next.revision++;
    this.snapshot(next); // Reject invalid output/revision BEFORE publication.
    try {
      await this.store.write(next);
      if (!same(validateStore(await this.store.read()), next)) fail('preference-state-ambiguous');
    } catch (error) {
      // A thrown writer/fsync may have already renamed the file. Under the
      // existing writer transaction only, prove the old value or quarantine.
      // Never compensate: the attempted explicit preference or another writer's
      // data must not be silently rolled back. No mount/teardown follows error.
      let unchanged = false;
      try { unchanged = same(validateStore(await this.store.read()), current); } catch {}
      if (unchanged) throw error;
      this.preferenceStateAmbiguous.add(id); fail('preference-state-ambiguous');
    }
    this.preferenceStateAmbiguous.delete(id);
    return next;
  }
  snapshot(store, stagedSecrets) {
    const envelope = JSON.stringify(store.vault);
    const visibleSecrets = stagedSecrets ?? (this.secrets && envelope === this.envelope ? this.secrets : null);
    const emptyMountedVault = store.vault === null && (this.authenticatedEnvelope === null || this.authenticatedEnvelope === 'null') && (!this.authenticatedRefs || this.authenticatedRefs.size === 0) && [...this.live.keys()].every((id) => this.liveCredentialRefs.has(id) && this.liveCredentialRefs.get(id).size === 0);
    const appendAvailable = this.mode === 'automatic' && !this.secretStateAmbiguous && (!this.live.size || emptyMountedVault || stagedSecrets !== undefined || (this.authenticatedEnvelope === envelope && this.authenticatedRefs !== null));
    let external = { servers: [], available: false };
    try { external = this.inventory(new Set(this.live.keys())); } catch {}
    const result = {
      revision: store.revision,
      capabilities: { saveAndActivate: true, persistentActivation: true, toolPolicy: true, configurableTimeout: true, ...(appendAvailable ? { appendSecretsWhileMounted: true } : {}) },
      servers: store.servers.map((config) => {
        let state = this.states.get(config.id) ?? 'disabled';
        if (!this.live.has(config.id) && (state === 'activation-verified' || state === 'mounted-status-unavailable')) state = 'disabled';
        const handle = this.live.get(config.id);
        let blocked = false; try { blocked = handle?.toolsBlocked?.() === true; } catch { blocked = true; }
        if (blocked && state !== 'stop-failed') state = 'mounted-status-unavailable';
        const lastVerifiedAt = this.live.has(config.id) && !blocked ? this.lastVerifiedAt.get(config.id) : undefined;
        const failure = this.lastFailures.get(config.id) ?? (blocked ? 'tool-policy-apply-failed' : undefined);
        return { config: structuredClone(config), serverName: serverName(config.id), enabled: isEnabled(store, config.id), state, tools: this.captureToolInventory(config.id), ...(failureCodes.has(failure) ? { lastFailure: failure } : {}), ...(lastVerifiedAt === undefined ? {} : { lastVerifiedAt }) };
      }),
      vault: { mode: this.mode, initialized: store.vault !== null, locked: this.mode === 'automatic' ? false : !this.key, expiresAt: this.mode === 'automatic' ? 0 : (this.key ? this.expiresAt : 0), refs: visibleSecrets ? Object.keys(visibleSecrets).sort() : [] },
      external: external.servers.slice(0, 128).map((serverName) => ({ serverName, readOnly: true })), externalInventory: external.available ? 'mounted-only' : 'unavailable'
    };
    if (!resultSchema.safeParse(result).success) fail('snapshot-contract-failed');
    return result;
  }
  rememberAuthentication(envelope, secrets) {
    this.authenticatedEnvelope = JSON.stringify(envelope);
    this.authenticatedRefs = new Set(Object.keys(secrets));
  }
  async checkFailedAppend(current, attempted, secrets) {
    // Read back only while the transaction still owns its writer lock. A proven
    // pre-publication failure keeps the old authenticated cache. Any other result
    // quarantines credential mutations without rollback or mount disposal.
    try {
      const observed = validateStore(await this.store.read());
      if (JSON.stringify(observed) === JSON.stringify(current)) return;
      if (JSON.stringify(observed) === JSON.stringify(attempted)) this.rememberAuthentication(attempted.vault, secrets);
    } catch {}
    this.secretStateAmbiguous = true; this.clearCredentials();
    fail('secret-state-ambiguous');
  }
  async restoreFailedSave(current, attempted) {
    // FileStore can throw after rename (e.g. directory fsync). Compensate only
    // inside the writer transaction and only for our exact attempted value;
    // never overwrite an unrelated observed revision/configuration.
    const same = (value, expected) => JSON.stringify(value) === JSON.stringify(expected);
    try {
      const observed = validateStore(await this.store.read());
      if (same(observed, current)) return;
      if (!same(observed, attempted)) throw new ConsoleError('save-state-ambiguous');
      try { await this.store.write(current); } catch {}
      if (same(validateStore(await this.store.read()), current)) return;
    } catch {}
    this.saveStateAmbiguous = true;
    fail('save-state-ambiguous');
  }
  async stopOne(id) {
    const handle = this.live.get(id);
    if (!handle) { this.lastFailures.delete(id); this.toolPolicyStateAmbiguous.delete(id); return; }
    this.captureToolInventory(id);
    // Cordis/the MCP SDK may fulfill dispose() after logging cleanup failures.
    // Unregistering a local child is not proof a remote server/process shut down.
    try { await handle.dispose(); this.live.delete(id); this.liveCredentialRefs.delete(id); this.pendingSaves.delete(id); this.lastVerifiedAt.delete(id); this.lastFailures.delete(id); this.toolPolicyStateAmbiguous.delete(id); this.states.set(id, 'unmounted-shutdown-unverified'); }
    catch { this.states.set(id, 'stop-failed'); fail('stop-failed'); }
  }
  async getAutomaticKey(create) {
    let key;
    try {
      if (typeof this.automaticKey !== 'function') fail('vault-key-unavailable');
      key = await this.automaticKey({ create });
      if (!Buffer.isBuffer(key) || key.length !== 32) fail('vault-key-unavailable');
      return key;
    } catch { if (Buffer.isBuffer(key)) key.fill(0); fail('vault-key-unavailable'); }
  }
  async loadAutomatic(envelope) {
    // No retained baseline means existing mounted credentials cannot be compared
    // with a newly authenticated disk view. Stop first; do not bless unknown drift.
    // Proven credential-free mounts retain no old strings and therefore need not
    // block authentication for a later enabled credentialed startup sibling.
    if (this.live.size && this.authenticatedEnvelope === null && [...this.live.keys()].some((id) => !this.liveCredentialRefs.has(id) || this.liveCredentialRefs.get(id).size)) fail('vault-locked');
    let key;
    try {
      key = await this.getAutomaticKey(false);
      const secrets = unseal(envelope, key);
      // Automatic rehydration never calls lockMemory or disposes owned mounts.
      this.clearCredentials(); this.key = key; this.secrets = secrets; this.envelope = JSON.stringify(envelope);
      this.rememberAuthentication(envelope, secrets);
    } catch (error) { key?.fill(0); this.clearCredentials(); throw error; }
  }
  clearCredentials() {
    this.clearTimer(this.timer); this.timer = null;
    this.key?.fill(0); this.key = null; this.secrets = null; this.envelope = null; this.expiresAt = 0;
  }
  async lockMemory() {
    this.clearCredentials();
    let failed = false;
    for (const id of [...this.live.keys()]) { try { await this.stopOne(id); } catch { failed = true; } }
    if (failed) fail('stop-failed');
  }
  async dispose() { this.closed = true; await this.enqueue(() => this.lockMemory()); }
}
function targetById(store, id) { if (!store.servers.some((s) => s.id === id)) fail('not-owned'); }
