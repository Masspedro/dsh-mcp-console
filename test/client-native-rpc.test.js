import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { FileStore } from '../src/storage.js';
import { ConsoleController } from '../src/controller.js';
import { Context } from '@deepseek-ai/cordis';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import * as gateway from '@deepseek-ai/dsh-api-gateway/client';
import { z } from 'zod';

const plain = (value) => JSON.parse(JSON.stringify(value));
const snapshot = { revision: 0, servers: [], vault: { initialized: false, locked: true, expiresAt: 0, refs: [] }, external: [], externalInventory: 'unavailable' };

// Evaluate the installed browser SDK module, including its actual LocaleRuntime.
// React/rendering, durable settings, browser storage and network are never invoked.
async function nativeLocale(ctx, language = 'en') {
  const source = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-locale/client')), 'utf8');
  let definition;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { definition = value; } } } });
  const plugin = definition.factory((name) => {
    assert.ok(['react/jsx-runtime', 'react', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'].includes(name), name);
    return {};
  });
  const runtime = new plugin.LocaleRuntime(ctx, undefined, { languages: [language], preference: language });
  if (language !== 'en') runtime.addLanguage({ id: language, label: 'Português', fallback: 'en' });
  return runtime;
}

async function fixture(language = 'en', options = {}) {
  const raw = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  const contract = (await readFile(new URL('../src/contract.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
  let definition, section, calls = 0, respond = () => ({ ok: true, value: snapshot });
  const warnings = [], infos = [], iconWarnings = [], styles = [];
  vm.runInNewContext(raw.replace('/* BUILD_SHARED_CONTRACT */', contract), {
    URL, window: { crypto: options.React ? webcrypto : undefined, __ModuleLoader__: { load(value) { definition = value; } } },
    document: { createElement() { return { dataset: {}, remove() { this.removed = true; } }; }, head: { appendChild(value) { styles.push(value); } }, addEventListener() {}, removeEventListener() {} },
    // Synthetic timers are never executed: no network, wall-clock waits or store.
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {},
    console: { warn(...args) { (args[0]?.startsWith('[personal-mcp-console] nav icon category=') ? iconWarnings : warnings).push(args.join(' ')); }, info(...args) { infos.push(args.join(' ')); } }
  });
  const plugin = definition.factory((name) => {
    if (name === 'zod') return { z };
    if (name === 'react') return options.React ?? { createElement() { assert.fail('RPC regression must not render'); } };
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return options.primitives ?? {};
    assert.fail('Unexpected external ' + name);
  });
  const ctx = new Context(); new TypertRegistry(ctx);
  const locale = await nativeLocale(ctx, language);
  ctx.provide('connection', {
    interactions: 'none', isLoopback: true,
    generation: { getSnapshot: () => null, subscribe: () => () => {} },
    openWebSocket() { assert.fail('network forbidden'); },
    rpc: {
      open() { assert.fail('stream forbidden'); },
      async call(channel, endpoint, payload) {
        calls++;
        assert.equal(channel, '/api');
        assert.match(endpoint, /^personalMcpConsole\/(snapshot|setSecret|saveAndActivate)$/);
        const method = endpoint.slice('personalMcpConsole/'.length), request = plain(payload.args.request);
        assert.deepEqual(plain(payload), { args: { request } });
        if (method === 'snapshot') assert.deepEqual(request, {});
        return respond(method, request);
      }
    }
  });
  ctx.provide('slots', {
    inject(name, callback) { assert.equal(name, 'settings.section'); return callback(); },
    register(options, component) { section = { options, component }; return () => {}; }
  });
  ctx.provide('locale', locale);
  try {
    await ctx.plugin(gateway);
    const own = ctx.plugin(plugin); await own;
    assert.equal(own.state, 2, 'Console must activate in a genuine non-root child fiber');
    assert.ok(section, 'Dynamic namespace injection must register the actual console Panel');
    return { ctx, own, section, locale, warnings, infos, iconWarnings, styles, calls: () => calls, respond: (next) => { respond = next; } };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}

test('actual console Panel API invokes native Gateway from a genuine Cordis child, never the unguarded root', async () => {
  const f = await fixture();
  try {
    // Counterexample reproduces the deployed failure even though the root can
    // read the namespace: a child declaring only remote cannot read its service.
    await f.ctx.plugin({
      name: 'synthetic-missing-namespace-dependency', inject: ['remote'],
      apply(child) { assert.throws(() => child.remote.personalMcpConsole.snapshot({}), /cannot get property "remote.personalMcpConsole" without inject/); }
    });
    assert.equal(f.calls(), 0, 'Guard failure must happen before the carrier');
    const result = await f.section.options.inject().api('snapshot', {});
    assert.deepEqual(plain(result), snapshot);
    assert.equal(f.calls(), 1);
    assert.deepEqual(f.warnings, []);
    assert.deepEqual(f.infos, ['[personal-mcp-console] snapshot verified']);
    await f.section.options.inject().api('snapshot', {});
    assert.equal(f.infos.length, 1, 'Snapshot polling does not repeat the success marker');
    await f.own.dispose();
    assert.equal(f.ctx.get('remote.personalMcpConsole'), undefined, 'Remote contribution withdraws with its owning console child');
    assert.equal(f.locale.bind('personal.mcpConsole')('rpcDiagnostics.uncategorized-transport'), 'rpcDiagnostics.uncategorized-transport', 'Child lifetime unregisters dictionaries');
    assert.ok(f.styles.every((style) => style.removed));
  } finally { await f.ctx.fiber.dispose(); }
});

test('native LocaleRuntime resolves flat console error/category keys in English and Portuguese', async () => {
  for (const language of ['en', 'pt-BR', 'pt']) {
    const f = await fixture(language);
    try {
      const t = f.locale.bind('personal.mcpConsole');
      for (const key of ['errors.invalid-input', 'errors.secure-random-unavailable', 'errors.vault-key-unavailable', 'errors.automatic-mode', 'automaticSecurity', 'automaticSecurityNote', 'savedAuthentication', 'savedHeaderValue', 'reloadAutomaticHost', 'reloadSaveHost', 'saveActivationNote', 'savePending', 'activationUnconfirmed', 'integration', 'integrationNote', 'errors.save-cleanup-required', 'errors.save-state-ambiguous', 'errors.secret-state-ambiguous', 'errors.append-secrets-upgrade-required', 'targetEditBlocked', 'appendSecretsNote', 'reloadMountedSecretsHost', 'token', 'tokenNote', 'tokenAuthNote', 'advancedHeaders', 'advancedVault', 'tokenPending', 'tokenUncertain', 'tokenMissing', 'rpcDiagnostics.uncategorized-transport', 'rpcDiagnostics.gateway/internal', 'rpcDiagnostics.remote-access/denied', 'rpcDiagnostics.snapshot-contract-failed']) {
        const value = t(key);
        assert.equal(typeof value, 'string');
        assert.notEqual(value, key, 'Real SDK exact-key lookup must localize ' + language + ': ' + key);
        assert.ok(!value.includes('rpcDiagnostics.') && !value.includes('errors.'));
      }
      assert.match(t('error'), language === 'en' ? /could not be confirmed/i : /não foi possível confirmar/i);
    } finally { await f.ctx.fiber.dispose(); }
  }
});

test('native Gateway failures retain only safe categories and genuine Locale text', async () => {
  const f = await fixture('pt-BR');
  try {
    f.respond(() => { throw new Error('SYNTHETIC-PRIVATE-TRANSPORT-CREDENTIAL'); });
    await assert.rejects(f.section.options.inject().api('snapshot', {}), (error) => {
      assert.deepEqual(plain(error), { consoleCode: 'operation-failed', rpcCategory: 'gateway/internal' });
      const t = f.locale.bind('personal.mcpConsole');
      // The actual native Gateway normalizes carrier exceptions to internal;
      // the console never invents a category from the exception's private text.
      const localized = t('error') + ' · ' + t('rpcDiagnostics.' + error.rpcCategory) + ' [' + error.rpcCategory + ']';
      assert.ok(!localized.includes('rpcDiagnostics.') && !localized.includes('PRIVATE'));
      assert.match(localized, /não foi possível confirmar/i);
      return true;
    });
    assert.deepEqual(f.warnings, ['[personal-mcp-console] snapshot category=gateway/internal']);
    assert.deepEqual(f.infos, []);
    f.respond(() => ({ ok: true, value: snapshot }));
    assert.deepEqual(plain(await f.section.options.inject().api('snapshot', {})), snapshot);
    assert.equal(f.calls(), 2);
    assert.deepEqual(f.infos, ['[personal-mcp-console] snapshot verified']);
  } finally { await f.ctx.fiber.dispose(); }
});


test('automatic private FileStore through genuine native Gateway writes secrets then validated Save RPC at exact revisions', async()=>{
 const directory=await mkdtemp(join(tmpdir(),'mcp-console-native-auto-')), store=new FileStore(directory), calls=[], mounted=[];let controller,f;
 try{
  controller=new ConsoleController({store,automaticKey:(options)=>store.privateKey(options),mount:async(config)=>{mounted.push(config);return {initialVerified:true,verifiedAt:1760000000000,dispose:async()=>{}};}});
  f=await fixture('pt-BR');f.respond(async(method,request)=>{calls.push({method,request});try{return {ok:true,value:await controller.invoke(method,request,{kind:'owner'})};}catch(error){return {ok:false,error:{message:'MCP console: '+error.code}};}});
  const api=f.section.options.inject().api, initial=await api('snapshot',{});assert.deepEqual(plain(initial.vault),{mode:'automatic',initialized:false,locked:false,expiresAt:0,refs:[]});assert.equal(initial.revision,0);await assert.rejects(access(store.keyFile),error=>error.code==='ENOENT');
  const first=await api('setSecret',{revision:0,ref:'synthetic_token_ref',value:'Bearer SYNTHETIC_NATIVE_AUTO_TOKEN'});assert.equal(first.revision,1);assert.equal(first.vault.mode,'automatic');assert.equal(first.vault.expiresAt,0);assert.equal(first.vault.locked,false);assert.deepEqual(first.vault.refs,['synthetic_token_ref']);
  const second=await api('setSecret',{revision:first.revision,ref:'synthetic_header_ref',value:'Literal SYNTHETIC_NATIVE_HEADER'});assert.equal(second.revision,2);
  assert.deepEqual(plain(initial.capabilities),{saveAndActivate:true,persistentActivation:true,appendSecretsWhileMounted:true,toolPolicy:true,configurableTimeout:true});
   const server={label:'Synthetic automatic native RPC',transport:'streamable-http',url:'https://example.invalid/mcp',headerRefs:{Authorization:'synthetic_token_ref',Authentication:'synthetic_header_ref'}};
   const before=calls.length;await assert.rejects(api('saveAndActivate',{revision:second.revision,server}),error=>error.consoleCode==='invalid-input');assert.equal(calls.length,before,'Missing confirmation rejected before genuine gateway carrier');
   const saved=await api('saveAndActivate',{revision:second.revision,server,confirmation:'SAVE AND ACTIVATE THIS SERVER'});assert.equal(saved.revision,3);assert.equal(saved.servers.length,1);assert.equal(saved.servers[0].state,'activation-verified');assert.equal(saved.servers[0].lastVerifiedAt,1760000000000);assert.deepEqual(calls.map(({method})=>method),['snapshot','setSecret','setSecret','saveAndActivate']);assert.equal(mounted.length,1);assert.deepEqual(mounted[0].headers,{Authorization:'Bearer SYNTHETIC_NATIVE_AUTO_TOKEN',Authentication:'Literal SYNTHETIC_NATIVE_HEADER'});assert.deepEqual(calls.at(-1).request,{revision:2,server,confirmation:'SAVE AND ACTIVATE THIS SERVER'});
  const disk=await readFile(store.file,'utf8');assert.ok(!disk.includes('SYNTHETIC_NATIVE_AUTO_TOKEN'));assert.ok(!disk.includes('SYNTHETIC_NATIVE_HEADER'));for(const value of [saved,f.warnings,f.infos])assert.ok(!JSON.stringify(value).includes('SYNTHETIC_NATIVE_AUTO_TOKEN'));assert.deepEqual(f.warnings,[]);
  await controller.dispose();controller=new ConsoleController({store,automaticKey:(options)=>store.privateKey(options),mount:async()=>assert.fail('Snapshot must never activate')});const restarted=await api('snapshot',{});assert.equal(restarted.vault.mode,'automatic');assert.equal(restarted.vault.locked,false);assert.equal(restarted.vault.expiresAt,0);assert.equal(restarted.servers.length,1);assert.equal(restarted.servers[0].state,'disabled');assert.equal(restarted.revision,3);assert.equal(mounted.length,1,'Restart snapshot never reconnects');
 }finally{
  await f?.ctx.fiber.dispose();await controller?.dispose();
  // Verify the exact absolute temporary target before recursive cleanup.
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^mcp-console-native-auto-[A-Za-z0-9]+$/);await rm(directory,{recursive:true,force:true});
 }
});


// A small hook/element face renders the OWN Panel; the API and locale carrier
// remain genuine Cordis/native Gateway. No FileStore, key, profile or IO is used.
function nativePanelHooks() {
  const hooks = []; let cursor = 0, effects = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
  const React = {
    Fragment: Symbol('Fragment'), createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, (next) => { hooks[i].value = typeof next === 'function' ? next(hooks[i].value) : next; }]; },
    useRef(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { current: initial }; return hooks[i]; },
    useId() { const i = cursor++; if (!hooks[i]) hooks[i] = { value: ':native-append:' + i }; return hooks[i].value; },
    useCallback(fn, deps) { const i = cursor++; if (!hooks[i] || changed(hooks[i].deps, deps)) hooks[i] = { fn, deps }; return hooks[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || changed(hooks[i].deps, deps)) { const previous = hooks[i], record = { deps }; hooks[i] = record; effects.push(() => { previous?.cleanup?.(); record.cleanup = fn(); }); } },
    useLayoutEffect(fn, deps) { return React.useEffect(fn, deps); }
  };
  return { React, begin() { cursor = 0; }, effects() { const queued = effects; effects = []; for (const effect of queued) effect(); }, values: () => hooks.map((hook) => hook?.value), dispose() { for (const hook of hooks) hook?.cleanup?.(); } };
}
const nativePanelPrimitives = { Button: function Button() {}, Modal: function Modal() {}, Checkbox: function Checkbox() {}, Switch: function Switch() {} };
function nativePanelNodes(node, result = []) {
  if (Array.isArray(node)) { for (const child of node) nativePanelNodes(child, result); return result; }
  if (!node || typeof node !== 'object' || !node.type) return result;
  result.push(node); for (const child of node.children ?? []) nativePanelNodes(child, result);
  if (typeof node.type === 'function' && !Object.values(nativePanelPrimitives).includes(node.type)) nativePanelNodes(node.type(node.props), result);
  if (node.props.footer) nativePanelNodes(node.props.footer, result); return result;
}
function nativePanelText(node) { return Array.isArray(node) ? node.map(nativePanelText).join(' ') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? (node.children ?? []).map(nativePanelText).join(' ') : String(node); }

test('mounted append: genuine native Gateway carries OWN Panel sequential fresh credentials with OTHER active MCP and exact Portuguese target helper', async () => {
  const hooks = nativePanelHooks(), f = await fixture('pt-BR', { React: hooks.React, primitives: nativePanelPrimitives });
  const id = 'a'.repeat(24), otherId = 'c'.repeat(24), calls = [], secrets = new Map([['shared_ref', 'SYNTHETIC_OLD_VALUE']]);
  const config = { id, label: 'Synthetic inactive MCP', transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: { Authorization: 'shared_ref' } };
  const other = { config: { ...config, id: otherId, label: 'Synthetic OTHER active MCP' }, serverName: 'pc_' + otherId, state: 'activation-verified', lastVerifiedAt: 1760000000000 };
  let ledger = { ...snapshot, revision: 4, capabilities: { saveAndActivate: true, appendSecretsWhileMounted: true }, vault: { mode: 'automatic', initialized: true, locked: false, expiresAt: 0, refs: ['shared_ref'] }, servers: [{ config, serverName: 'pc_' + id, state: 'disabled' }, other] }, tree;
  try {
    f.respond((method, request) => {
      calls.push({ method, request });
      if (method === 'setSecret') { assert.equal(request.revision, ledger.revision); assert.ok(!secrets.has(request.ref)); secrets.set(request.ref, request.value); ledger = { ...ledger, revision: ledger.revision + 1, vault: { ...ledger.vault, refs: [...ledger.vault.refs, request.ref] } }; }
      if (method === 'saveAndActivate') { assert.equal(request.revision, ledger.revision); assert.equal(request.confirmation, 'SAVE AND ACTIVATE THIS SERVER'); ledger = { ...ledger, revision: ledger.revision + 1, servers: [{ config: request.server, serverName: 'pc_' + id, state: 'activation-verified', lastVerifiedAt: 1760000001000 }, other] }; }
      return { ok: true, value: ledger };
    });
    const t = f.locale.bind('personal.mcpConsole'), injected = f.section.options.inject(), root = { querySelectorAll: () => [] };
    const render = () => { hooks.begin(); tree = f.section.component({ ...injected, t }); tree.props.ref.current = root; return nativePanelNodes(tree); };
    const settle = async () => { for (let i = 0; i < 14; i++) { await Promise.resolve(); render(); hooks.effects(); } render(); };
    const button = (key) => { const found = nativePanelNodes(tree).find((node) => node.type === nativePanelPrimitives.Button && (nativePanelText(node).trim() === t(key) || node.props['aria-label'] === t(key))); assert.ok(found, key); return found; };
    const input = (name) => { const found = nativePanelNodes(tree).find((node) => ['input', 'select'].includes(node.type) && node.props.name === name); assert.ok(found, name); return found; };
    const form = () => { const found = nativePanelNodes(tree).find((node) => node.type === 'form' && node.props['aria-label'] === t('edit')); assert.ok(found); return found; };
    render(); hooks.effects(); await settle(); button('edit').props.onClick(); render();
    assert.equal(input('token').props.disabled, false); assert.ok(!nativePanelText(form()).includes('Para editar, desative este MCP.'));
    const stale = form(); ledger = { ...ledger, servers: [{ config, serverName: 'pc_' + id, state: 'stop-failed' }, other] }; await button('refresh').props.onClick(); render();
    const token = { value: 'SYNTHETIC_REFUSED_TOKEN' }; input('token').props.ref.current = token; await stale.props.onSubmit({ preventDefault() {}, currentTarget: { elements: { token } } }); await settle();
    assert.ok(calls.every(({ method }) => method === 'snapshot')); assert.equal(nativePanelNodes(tree).filter((node) => node.type === 'span' && nativePanelText(node) === 'Para editar, desative este MCP.').length, 2); assert.equal(input('token').props.disabled, true);
    ledger = { ...ledger, servers: [{ config, serverName: 'pc_' + id, state: 'disabled' }, other] }; await button('refresh').props.onClick(); render();
    button('addHeader').props.onClick(); render(); input('mapping-header-1').props.onChange({ target: { value: 'X-API-Key' } }); render();
    const header = nativePanelNodes(tree).filter((node) => node.type === 'input' && node.props.name?.startsWith('header-value-'))[1], value = { value: 'SYNTHETIC_NATIVE_HEADER' }; header.props.ref.current = value; token.value = 'SYNTHETIC_NATIVE_TOKEN'; input('token').props.ref.current = token;
    await form().props.onSubmit({ preventDefault() {}, currentTarget: { elements: { token } } }); await settle();
    const writes = calls.filter(({ method }) => method !== 'snapshot'); assert.deepEqual(writes.map(({ method }) => method), ['setSecret', 'setSecret', 'saveAndActivate']); assert.deepEqual(writes.map(({ request }) => request.revision), [4, 5, 6]); assert.notEqual(writes[0].request.ref, writes[1].request.ref);
    assert.equal(token.value, ''); assert.equal(value.value, ''); assert.equal(secrets.get('shared_ref'), 'SYNTHETIC_OLD_VALUE'); assert.equal(secrets.get(writes[0].request.ref), 'Bearer SYNTHETIC_NATIVE_TOKEN'); assert.equal(secrets.get(writes[1].request.ref), 'SYNTHETIC_NATIVE_HEADER'); assert.deepEqual(ledger.servers[1], other);
    for (const output of [tree, hooks.values(), f.warnings, f.infos, writes.at(-1).request]) assert.ok(!JSON.stringify(output).includes('SYNTHETIC_NATIVE_TOKEN') && !JSON.stringify(output).includes('SYNTHETIC_NATIVE_HEADER')); assert.deepEqual(f.warnings, []);
  } finally { hooks.dispose(); await f.ctx.fiber.dispose(); }
});

test('persistent Switch: native strict carrier rejects malformed capability/row preferences before Panel', async () => {
  const f = await fixture();
  const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const row = { config: { id, label: 'Synthetic preference', transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: {} }, serverName: 'pc_' + id, state: 'disabled' };
  try {
    for (const capabilities of [{ saveAndActivate: true, persistentActivation: false }, { saveAndActivate: true, persistentActivation: 'true' }, { saveAndActivate: true, persistentActivation: 1 }]) {
      f.respond(() => ({ ok: true, value: { ...snapshot, capabilities } }));
      await assert.rejects(f.section.options.inject().api('snapshot', {}), error => error.consoleCode === 'snapshot-contract-failed' || ['gateway/result-invalid', 'gateway/internal'].includes(error.rpcCategory));
    }
    for (const malformed of [row, { ...row, enabled: 'true' }, { ...row, enabled: 1 }, { ...row, enabled: null }]) {
      f.respond(() => ({ ok: true, value: { ...snapshot, capabilities: { saveAndActivate: true, persistentActivation: true }, servers: [malformed] } }));
      await assert.rejects(f.section.options.inject().api('snapshot', {}), error => error.consoleCode === 'snapshot-contract-failed' || ['gateway/result-invalid', 'gateway/internal'].includes(error.rpcCategory));
    }
    assert.ok(f.warnings.every(message => /^\[personal-mcp-console\] snapshot category=(snapshot-contract-failed|gateway\/(result-invalid|internal))$/.test(message)));
    const valid = { ...snapshot, capabilities: { saveAndActivate: true, persistentActivation: true }, servers: [{ ...row, enabled: true }] };
    f.respond(() => ({ ok: true, value: valid }));
    assert.deepEqual(plain(await f.section.options.inject().api('snapshot', {})), valid);
  } finally { await f.ctx.fiber.dispose(); }
});

test('mounted append: native strict carrier rejects false/nonliteral capability without exposing diagnostics or credentials', async () => {
  const f = await fixture();
  try {
    for (const appendSecretsWhileMounted of [false, 'true', 1]) {
      f.respond(() => ({ ok: true, value: { ...snapshot, capabilities: { saveAndActivate: true, appendSecretsWhileMounted }, vault: { mode: 'automatic', initialized: false, locked: false, expiresAt: 0, refs: [] } } }));
      // The installed native Gateway wraps its strict decode failure as internal;
      // newer carriers may preserve result-invalid. Neither reaches Panel state.
      await assert.rejects(f.section.options.inject().api('snapshot', {}), (error) => error.consoleCode === 'snapshot-contract-failed' || ['gateway/result-invalid', 'gateway/internal'].includes(error.rpcCategory));
    }
    assert.ok(f.warnings.every((message) => /^\[personal-mcp-console\] snapshot category=(snapshot-contract-failed|gateway\/(result-invalid|internal))$/.test(message))); assert.deepEqual(f.infos, []);
  } finally { await f.ctx.fiber.dispose(); }
});
