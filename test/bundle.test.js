import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadOverlayPatches, composeEntries, evaluatePluginCompatibility, bundlePatchPaths } from '@deepseek-ai/dsh-app-boot';
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('../', import.meta.url));
test('official app-boot parses a self-registration bundle without touching any profile', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml'); assert.equal(manifest.exports['./cordis.patch.yml'], './cordis.patch.yml');
  const paths = bundlePatchPaths(root, manifest.dsh.bundle); assert.equal(paths.length, 1);
  const patches = loadOverlayPatches('synthetic-mcp-console-test', paths[0]);
  assert.equal(patches.length, 1); assert.deepEqual(Object.keys(patches[0]), ['insert']);
  const external = { id: 'synthetic-external-server', name: '@synthetic/untouched-mcp' };
  const entries = composeEntries([[{ insert: [external] }], patches]);
  assert.equal(entries.length, 2); assert.equal(entries[0].name, external.name); assert.equal(entries[1].name, manifest.name); assert.equal(entries[1].id, 'personal-mcp-console');
  assert.equal(entries[1].config, undefined, 'no example commands or secrets in registration overlay');
});
test('exact runtime compatibility is declared and package allowlist excludes store and fixtures', () => {
  assert.equal(manifest.engines.dsh, '0.2.1-rc.5'); assert.equal(evaluatePluginCompatibility(manifest, {}, '0.2.1-rc.5'), undefined);
  assert.ok(evaluatePluginCompatibility(manifest, {}, '0.2.1-rc.2'), 'community preview must reject the unvalidated older runtime');
  assert.ok(evaluatePluginCompatibility(manifest, {}, '0.2.1'));
  assert.deepEqual(manifest.files, ['lib/*.js', 'docs/*.md', 'README.md', 'LICENSE', 'NOTICE', 'cordis.patch.yml']); assert.ok(!manifest.files.some((file) => /data|test|sessions|credentials/.test(file)));
});
