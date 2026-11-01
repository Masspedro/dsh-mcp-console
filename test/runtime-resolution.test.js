// Run STANDALONE, without test/register.js, --import, or a custom loader:
//   node --expose-internals --test test/runtime-resolution.test.js
// To prove an actual installed profile as well (read-only metadata, no activation):
//   DSH_MCP_CONSOLE_PROFILE_DIR=/absolute/profile/directory node --expose-internals --test test/runtime-resolution.test.js
// Android's installed require-builtin public adapter uses exposed genuine Node
// internals; the DSH engine itself starts with this flag. No fake loader is used.
// The first test simulates ONLY a linked-root table entry. It uses the genuine
// installation dependency closure, ProfileRuntimeResolution and PluginPackages.
// The second test discovers actual installed/link metadata through the real SDK.
// Neither test calls console.apply(), mounts an MCP client, opens a listener,
// reads credentials/config contents, writes profile files, or installs packages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE = '@masspedro/dsh-mcp-console';
const PEERS = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-typert-protocol', 'zod'];
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const sdkRoot = resolve(process.env.DSH_SDK_ROOT ?? fileURLToPath(new URL('../node_modules/', import.meta.url)));
const home = resolve(process.env.DSH_TEST_HOME ?? fileURLToPath(new URL('../.test-home/', import.meta.url)));
const requireSdk = createRequire(join(sdkRoot, 'mcp-console-resolution-preflight.cjs'));
// General suite bootstrap deliberately substitutes SDK imports. Do not allow it
// to turn this production-resolution regression into another bootstrap test.
const inheritedHook = process.execArgv.some(arg => /(?:--import|--(?:experimental-)?loader|test[/\\]register\.js|sdk-loader\.js)/.test(arg)) ||
  /(?:--import|--(?:experimental-)?loader)/.test(process.env.NODE_OPTIONS ?? '');
const standaloneOptions = { skip: inheritedHook ? 'Run standalone without --import/test register or custom loaders' : false };

async function installedSdk() {
  const boot = await import(pathToFileURL(requireSdk.resolve('@deepseek-ai/dsh-app-boot')).href);
  const installAnchor = resolve(process.env.DSH_INSTALL_ANCHOR ?? requireSdk.resolve('@deepseek-ai/dsh/package.json'));
  const anchorUrl = pathToFileURL(installAnchor).href;
  const installation = await boot.createRuntimeResolution({ installAnchor, home });
  assert.ok(installation instanceof boot.ProfileRuntimeResolution);
  const paths = new Map();
  const modules = new Map();
  for (const name of PEERS) {
    const entry = installation.entries.find(item => item.name === name);
    assert.ok(entry, `Installation closure must contain ${name}`);
    assert.equal(entry.scope, 'installation');
    // Use the real public ESM resolver, not require.resolve's possibly different
    // import/require export conditions (particularly important for Zod).
    const filename = await realpath(boot.resolvePluginResource(name, anchorUrl));
    paths.set(name, filename);
    modules.set(name, await import(pathToFileURL(filename).href));
  }
  return { boot, installAnchor, anchorUrl, installation, paths, modules };
}

async function withInterception(sdk, resolution, fn) {
  const { Context } = sdk.modules.get('@deepseek-ai/cordis');
  const ctx = new Context();
  try {
    const packages = new sdk.boot.PluginPackages(ctx, { resolution });
    assert.equal(packages.resolution, resolution);
    return await fn(packages);
  } finally {
    // Restores the genuine process resolver and worker-resolution metadata.
    // This is an isolated test Context, never the live DSH application Context.
    await ctx.fiber.dispose();
  }
}

async function verifyConsoleImport(sdk, moduleUrl, manifest) {
  assert.equal(manifest.name, PACKAGE);
  for (const name of PEERS) {
    assert.ok(Object.hasOwn(manifest.peerDependencies ?? {}, name), `${name} must be a declared peer`);
    const scopedPath = await realpath(sdk.boot.resolvePluginResource(name, moduleUrl));
    assert.equal(scopedPath, sdk.paths.get(name), `${name} ESM import must use the installation's canonical file`);
    assert.equal(await import(pathToFileURL(scopedPath).href), sdk.modules.get(name), `${name} must share ESM module identity`);
    const importer = createRequire(moduleUrl);
    assert.equal(await realpath(importer.resolve(name)), await realpath(requireSdk.resolve(name)), `${name} CommonJS resolution must share the installation`);
  }
  const consoleModule = await import(moduleUrl);
  assert.equal(consoleModule.name, 'personal-mcp-console');
  assert.deepEqual(consoleModule.inject, ['typert', 'tools', 'profileContext']);
  const typert = sdk.modules.get('@deepseek-ai/dsh-typert-protocol');
  const cordis = sdk.modules.get('@deepseek-ai/cordis');
  assert.equal(Object.getPrototypeOf(consoleModule.McpConsoleService.prototype), typert.TypertRemoteService.prototype);
  assert.equal(Object.getPrototypeOf(typert.TypertRemoteService.prototype), cordis.Service.prototype);
  assert.equal(consoleModule.REMOTE.zod, sdk.modules.get('zod').z, 'Console schemas must use the installation Zod object');
  assert.equal(consoleModule.REMOTE.package, PACKAGE);
  assert.equal(consoleModule.REMOTE.descriptors.length, 13, '0.6 preserves 12 RPCs and adds guarded tool policy');
  assert.ok(consoleModule.REMOTE.descriptors.some(item => item.method === 'saveAndActivate'));
  assert.ok(consoleModule.REMOTE.descriptors.some(item => item.method === 'reconnect'));
  assert.ok(consoleModule.REMOTE.descriptors.every(item => item.invocation.kind === 'direct'));
  // Import-only: never construct the console Service or call any apply/mount/RPC.
  return consoleModule;
}

function liesWithin(directory, filename) {
  const rest = relative(directory, filename);
  return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith('..' + sep));
}

test('standalone source import through genuine installation interception (synthetic linked-root metadata)', standaloneOptions, async t => {
  const sdk = await installedSdk();
  const root = await realpath(packageRoot);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const resolution = new sdk.boot.ProfileRuntimeResolution({ installAnchor: sdk.installAnchor, home }, {
    profilesDir: sdk.installation.profilesDir,
    profileDir: undefined,
    localPackageNames: sdk.installation.localPackageNames,
    entries: sdk.installation.entries,
    linkedRoots: Object.freeze([{ name: PACKAGE, realPath: root }]),
  });
  await withInterception(sdk, resolution, async () => {
    await verifyConsoleImport(sdk, pathToFileURL(join(root, 'src/index.js')).href, manifest);
  });
  t.diagnostic('PASS: current source imports and shares installation peers using genuine interception; linked-root metadata was synthetic, not proof of profile installation.');
});

test('standalone installed-profile import using actual package/link metadata (no profile activation)', {
  ...standaloneOptions,
  skip: standaloneOptions.skip || (!process.env.DSH_MCP_CONSOLE_PROFILE_DIR ? 'Set DSH_MCP_CONSOLE_PROFILE_DIR to prove the actual installed profile' : false),
}, async t => {
  const sdk = await installedSdk();
  const supplied = process.env.DSH_MCP_CONSOLE_PROFILE_DIR;
  assert.ok(isAbsolute(supplied), 'Profile directory must be supplied as an absolute path');
  const profileDir = await realpath(supplied);
  // Do NOT call loadProfile/loadProfileDirectory/computeLatestResolution here:
  // those helpers can migrate retired bundle manifests. Empty bundle layers
  // intentionally limit this read-only proof to actual local/link metadata and
  // installation peer resolution, not a full bundle-composition/activation audit.
  const profile = { dir: profileDir, layers: [], skippedBundles: [] };
  const resolution = await sdk.boot.createRuntimeResolution({ installAnchor: sdk.installAnchor, home, profile });
  assert.ok(resolution instanceof sdk.boot.ProfileRuntimeResolution);
  assert.ok(resolution.localPackageNames.includes(PACKAGE), 'Console must be an actually installed direct profile dependency');
  const profileAnchor = pathToFileURL(join(profileDir, 'package.json')).href;
  await withInterception(sdk, resolution, async packages => {
    const metadata = packages.packageOf(PACKAGE, profileAnchor);
    assert.ok(metadata, 'Real scoped profile lookup must locate the installed console');
    const root = await realpath(metadata.dir);
    const linked = resolution.linkedRoots.find(item => item.name === PACKAGE);
    if (linked) assert.equal(await realpath(linked.realPath), root, 'Discovered linked root must match the real installed package');
    else assert.ok(liesWithin(profileDir, root), 'Non-linked package must reside in the actual profile resolver scope');
    const entry = await realpath(sdk.boot.resolvePluginResource(PACKAGE, profileAnchor));
    assert.ok(liesWithin(root, entry), 'Resolved production entry must belong to the installed console package');
    await verifyConsoleImport(sdk, pathToFileURL(entry).href, metadata.manifest);
    t.diagnostic(`PASS: actual profile-installed console v${metadata.version ?? 'unknown'} imports through genuine scoped interception; ${linked ? 'external linked root' : 'profile-local package'} verified. This proves import identity, not activation or current-source artifact freshness.`);
  });
});
