// Shared strict wire contract. Also embedded into the lazy browser factory by build.js.
export const PACKAGE = '@masspedro/dsh-mcp-console';
export const NAMESPACE = 'personalMcpConsole';
export const SERVICE = 'personalMcpConsoleController';
export const METHODS = ['snapshot', 'save', 'saveAndActivate', 'deleteServer', 'start', 'reconnect', 'stop', 'initializeVault', 'unlock', 'lock', 'setSecret', 'deleteSecret', 'setToolPolicy'];
export const CONNECTION_FAILURE_CODES = ['mount-failed', 'connection-auth-denied', 'connection-endpoint-unavailable', 'connection-rate-limited', 'connection-service-unavailable', 'connection-timeout', 'connection-refused', 'connection-unreachable', 'connection-tls-failed', 'connection-invalid-response'];
export const TOOL_FAILURE_CODES = ['invalid-tool-policy', 'tool-inventory-limit', 'tool-policy-unavailable', 'tool-policy-apply-failed', 'tool-policy-state-ambiguous'];

export function makeSchemas(z) {
  const id = z.string().regex(/^[a-f0-9]{24}$/);
  const ref = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
  const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
  const text = (max) => z.string().max(max).refine((v) => !/[\x00-\x1f\x7f]/.test(v));
  const refs = (key) => z.record(key, ref).refine((v) => Object.keys(v).length <= 32);
  const toolName = z.string().max(64).regex(/^mcp__pc_[a-f0-9]{24}__[A-Za-z0-9_-]+$/);
  const toolNames = z.array(toolName).max(512).refine((names) => new Set(names).size === names.length);
  const toolPolicy = z.strictObject({ mode: z.enum(['all', 'include', 'exclude']), names: toolNames }).refine((policy) => policy.mode !== 'all' || policy.names.length === 0);
  // Optional defaults keep existing stores unchanged: absent means all / 60s.
  const options = { toolPolicy: toolPolicy.optional(), toolCallTimeoutMs: z.number().int().min(1000).max(3600000).optional() };
  const common = { id: id.optional(), label: text(80).min(1), ...options };
  const server = z.discriminatedUnion('transport', [
    z.strictObject({ ...common, transport: z.literal('stdio'), command: text(1024).min(1).refine((v) => /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(v) || (v.startsWith('/') && !/[\s\\;&|<>`$"'()]/.test(v))), args: z.array(text(2048)).max(64), cwd: text(1024).refine((v) => v === '' || v.startsWith('/')), envRefs: refs(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)) }),
    z.strictObject({ ...common, transport: z.literal('streamable-http'), url: text(2048).min(1), headerRefs: refs(z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/)) })
  ]);
  const empty = z.strictObject({});
  const target = z.strictObject({ revision, id });
  const passphrase = z.string().min(12).max(512);
  const schemas = {
    snapshot: empty, save: z.strictObject({ revision, server }),
    saveAndActivate: z.strictObject({ revision, server, confirmation: z.literal('SAVE AND ACTIVATE THIS SERVER') }), deleteServer: target,
    start: z.strictObject({ revision, id, confirmation: z.literal('START THIS SERVER') }),
    reconnect: z.strictObject({ revision, id, confirmation: z.literal('RECONNECT THIS SERVER') }), stop: target,
    initializeVault: z.strictObject({ revision, passphrase }),
    unlock: z.strictObject({ revision, passphrase, ttlSeconds: z.number().int().min(30).max(900) }),
    lock: z.strictObject({ revision }), setSecret: z.strictObject({ revision, ref, value: z.string().min(1).max(8192).refine((v) => !/[\x00\r\n]/.test(v)) }), deleteSecret: z.strictObject({ revision, ref }),
    setToolPolicy: z.strictObject({ revision, id, toolPolicy })
  };
  const states = z.enum(['disabled', 'activation-verified', 'mounted-status-unavailable', 'unmounted-shutdown-unverified', 'mount-failed', 'stop-failed']);
  const saved = z.intersection(server, z.strictObject({ id, label: text(80).min(1), ...options, transport: z.enum(['stdio','streamable-http']), command: text(1024).optional(), args: z.array(text(2048)).max(64).optional(), cwd: text(1024).optional(), envRefs: refs(z.string()).optional(), url: text(2048).optional(), headerRefs: refs(z.string()).optional() }));
  // Names-only tool metadata. No descriptions, schemas, provider errors or secrets.
  const tools = z.strictObject({ names: toolNames, source: z.enum(['mounted', 'last-known', 'unavailable']) });
  const failure = z.enum([...CONNECTION_FAILURE_CODES, ...TOOL_FAILURE_CODES]);
  const result = z.strictObject({ revision, capabilities: z.strictObject({ saveAndActivate: z.literal(true), appendSecretsWhileMounted: z.literal(true).optional(), persistentActivation: z.literal(true).optional(), toolPolicy: z.literal(true).optional(), configurableTimeout: z.literal(true).optional() }).optional(), servers: z.array(z.strictObject({ config: saved, serverName: z.string().regex(/^pc_[a-f0-9]{24}$/), state: states, enabled: z.boolean().optional(), lastVerifiedAt: z.number().int().min(0).optional(), lastFailure: failure.optional(), tools: tools.optional() })).max(32), vault: z.strictObject({ mode: z.enum(['automatic', 'passphrase']).optional(), initialized: z.boolean(), locked: z.boolean(), expiresAt: z.number().int().min(0), refs: z.array(ref).max(128) }), external: z.array(z.strictObject({ serverName: text(32), readOnly: z.literal(true) })).max(128), externalInventory: z.enum(['mounted-only', 'unavailable']) }).refine((value) => value.capabilities?.persistentActivation !== true || value.servers.every((row) => typeof row.enabled === 'boolean'));
  return { schemas, result, server, toolPolicy, toolNames };
}

export function makeRemoteSpec(z) {
  const { schemas, result } = makeSchemas(z);
  const codec = (schema, typeSymbol) => ({ mode: 'strict', typeSymbol, create: () => schema, decode: (v) => schema.parse(v), encode: (v) => schema.parse(v) });
  const methods = Object.fromEntries(METHODS.map((method) => {
    const input = codec(schemas[method], 'McpConsoleRequest.' + method);
    return [NAMESPACE + '/' + method, { service: SERVICE, invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: input, strictCodec: input }], result: codec(result, 'McpConsoleSnapshot') }];
  }));
  return { package: PACKAGE, methods };
}

export function makeClientContribution(z) {
  const spec = makeRemoteSpec(z);
  return { package: spec.package, descriptors: Object.entries(spec.methods).map(([endpoint, definition]) => ({ ...definition, id: spec.package + '#' + endpoint, namespace: NAMESPACE, method: endpoint.split('/')[1] })) };
}
