import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zod from 'zod';

const sdkRoot = resolve(process.env.DSH_SDK_ROOT ?? fileURLToPath(new URL('../node_modules/', import.meta.url)));
const sdkRequire = createRequire(join(sdkRoot, 'mcp-console-materialization-test.cjs'));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('actual ClientModuleSystem materializes console with verified shipped shell seeds and real client exports', async () => {
  // Public shipped shell artifact only: no page boot globals, private config,
  // requests, token lookup, live window, or frontend execution.
  const assets = join(dirname(sdkRequire.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist/assets');
  let seedText;
  for (const name of (await readdir(assets)).filter((value) => value.endsWith('.js'))) {
    const source = await readFile(join(assets, name), 'utf8');
    const match = source.match(/function [A-Za-z_$][\w$]*\(\)\{return\{react:[^}]+\}\}/);
    if (match && match[0].includes('zod:') && match[0].includes('"@deepseek-ai/cordis":')) { seedText = match[0]; break; }
  }
  assert.ok(seedText, 'the exact supported installed shell must expose its static seed factory');
  const shellNames = [...seedText.matchAll(/(?:"([^"]+)"|([A-Za-z_$][\w$]*)):[A-Za-z_$][\w$]*/g)].map((match) => match[1] ?? match[2]);
  assert.ok(shellNames.includes('zod')); assert.ok(shellNames.includes('react'));
  assert.deepEqual(manifest.dsh.client.external, ['react', 'zod', '@deepseek-ai/dsh-client-ui-primitives']);
  const zodManifest = JSON.parse(await readFile(sdkRequire.resolve('zod/package.json'), 'utf8'));
  const dshManifest = JSON.parse(await readFile(sdkRequire.resolve('@deepseek-ai/dsh/package.json'), 'utf8'));
  const { major, minor, patch } = zod.z.core.version;
  assert.equal(major, 4, 'Supported peer contract uses Zod major 4');
  assert.equal(`${major}.${minor}.${patch}`, zodManifest.version, 'Runtime validator must be the genuine selected SDK package');
  assert.equal(manifest.peerDependencies.zod, '^4.4.3');
  assert.ok(minor > 4 || (minor === 4 && patch >= 3), 'Selected Zod satisfies the declared ^4.4.3 peer floor');
  for (const name of manifest.dsh.client.external) assert.ok(shellNames.includes(name), name + ' must be a genuine shipped shell seed');
  const staticModules = Object.fromEntries(shellNames.map((name) => [name, Object.freeze({})]));
  staticModules.zod = zod; // Genuine selected host SDK validator; not a fake validator or proof of browser rendering.
  // Factory materialization doesn't render React. This stand-in supplies only
  // createElement; no claim of real browser/React rendering is made.
  staticModules.react = { createElement: () => assert.fail('materialization must not render') };
  const rows = [];
  const sources = new Map();
  const visited = new Set();
  async function inspectClient(name) {
    // The real loader bootstrap is registered separately below. New Settings
    // dependencies can inject it transitively; executing it again is not how
    // the host graph handles its already-materialized bootstrap module.
    if (name === '@deepseek-ai/dsh-client-modules' || visited.has(name) || shellNames.includes(name)) return;
    assert.ok(visited.size < 100, 'bounded public client dependency traversal'); visited.add(name);
    const path = sdkRequire.resolve(name + '/package.json');
    const pkg = JSON.parse(await readFile(path, 'utf8'));
    const declaration = pkg.dsh?.client;
    assert.ok(declaration, name + ' must have genuine dsh.client metadata');
    assert.equal(declaration.platform, 'web', name + ' must support this web client');
    const exported = pkg.exports?.['./client'];
    const relative = typeof exported === 'string' ? exported : exported?.default;
    assert.equal(typeof relative, 'string', name + ' must have the actual browser/default client export');
    assert.ok(relative.startsWith('./') && !relative.includes('..'), 'bounded package-relative client export');
    const source = await readFile(resolve(dirname(path), relative), 'utf8');
    assert.ok(source.includes('window.__ModuleLoader__.load'), name + ' client artifact must really register a lazy factory');
    sources.set(name, source);
    rows.push({ id: name, url: '/synthetic/' + rows.length + '.js', rev: 'synthetic', inject: declaration.inject ?? [], external: declaration.external ?? [] });
    for (const dependency of declaration.inject ?? []) await inspectClient(dependency);
  }
  for (const name of manifest.dsh.client.inject) await inspectClient(name);
  assert.ok(sources.has('@deepseek-ai/dsh-api-gateway'), 'conditional gateway browser export is genuinely supported, not host-only');
  const facade = { mode: 'queue', pendingQueue: [], load(record) { this.pendingQueue.push(record); } };
  const context = vm.createContext({ window: { __ModuleLoader__: facade } });
  const modulesSource = await readFile(sdkRequire.resolve('@deepseek-ai/dsh-client-modules/client'), 'utf8');
  vm.runInContext(modulesSource, context, { timeout: 1000 });
  const bootstrap = facade.pendingQueue.shift();
  const modules = bootstrap.factory(() => assert.fail('bootstrap modules factory requires no external values'));
  for (const [name, source] of sources) {
    const previous = facade.pendingQueue.length;
    vm.runInContext(source, context, { timeout: 1000 });
    assert.equal(facade.pendingQueue.length, previous + 1);
    assert.equal(facade.pendingQueue.at(-1).id, name, 'real injection artifact must register the declared package ID');
  }
  const ownSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  vm.runInContext(ownSource, context, { timeout: 1000 });
  rows.push({ id: manifest.name, url: '/synthetic/console.js', rev: 'synthetic', inject: manifest.dsh.client.inject, external: manifest.dsh.client.external });
  const system = modules.createClientModuleSystem(facade, { id: bootstrap.id, exports: modules }, { staticModules, boot: { rev: 'synthetic', release: { version: dshManifest.version }, entries: rows, batches: [{ phase: 'application', url: '/synthetic/all.js', rev: 'synthetic', entries: rows.map((row) => row.id) }] }, loadBundle: async () => assert.fail('all real factories are registered locally; network transport is forbidden') });
  const materialized = await system.import(manifest.name);
  assert.equal(typeof materialized.apply, 'function'); assert.ok(materialized.inject.includes('remote'));
  assert.equal(await system.import(manifest.name + '/client'), materialized, 'official suffix normalization reuses materialized exports');
  assert.equal(facade.mode, 'live');
  assert.equal(system.importError(manifest.name), undefined);
});
