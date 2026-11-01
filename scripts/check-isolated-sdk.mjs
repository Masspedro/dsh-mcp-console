// SDK-only fixtures; never starts DSH or activates a user's profile.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
const sdkVersion = '0.2.1-rc.5';
if (manifest.engines?.dsh !== sdkVersion) throw new Error('This checker proves only the exact rc.5 target');
const runs = join(project, '.test-runs');
await mkdir(runs, { recursive: true });
const run = await mkdtemp(join(runs, 'sdk-rc5-'));
for (const dir of ['home', 'tmp', 'cache', 'config', 'evidence', 'home/profiles/fixture']) await mkdir(join(run, dir), { recursive: true });
const sdk = await realpath(process.env.DSH_SDK_ROOT ?? join(project, 'node_modules'));
if (!isAbsolute(sdk)) throw new Error('SDK root must resolve to an absolute isolated SDK path');
for (const file of ['config/user.npmrc', 'config/global.npmrc', 'config/openssl.cnf']) await writeFile(join(run, file), '', { flag: 'wx' });
const env = { PATH: process.env.PATH, HOME: join(run, 'home'), DSH_HOME: join(run, 'home'), DSH_TEST_HOME: join(run, 'home'), TMPDIR: join(run, 'tmp'), OPENSSL_CONF: join(run, 'config/openssl.cnf'), DSH_SDK_ROOT: sdk,
  npm_config_userconfig: join(run, 'config/user.npmrc'), npm_config_globalconfig: join(run, 'config/global.npmrc'), npm_config_cache: join(run, 'cache'), npm_config_registry: 'https://registry.npmjs.org', npm_config_logs_max: '0' };
// Public TLS trust paths are not credentials. Keep certificate verification enabled.
for (const key of ['LD_LIBRARY_PATH', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA']) if (process.env[key]) env[key] = process.env[key];
const commands = [];
async function execute(label, executable, args, cwd) {
  console.log(label + ': ' + executable + ' ' + args.join(' '));
  const log = createWriteStream(join(run, 'evidence', label + '.log'), { flags: 'wx' });
  const start = Date.now();
  const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const result = await new Promise((resolveResult, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolveResult({ code, signal })); });
  await new Promise(resolveLog => log.end(resolveLog));
  commands.push({ label, executable, args, cwd, ...result, durationMs: Date.now() - start });
  await writeFile(join(run, 'evidence/commands.json'), JSON.stringify(commands, null, 2) + '\n');
  console.log(label + ': exit ' + result.code);
  if (result.code !== 0 || result.signal) throw new Error(label + ' failed; inspect ' + join(run, 'evidence', label + '.log'));
}
try {
  const actualSdk = JSON.parse(await readFile(join(sdk, '@deepseek-ai/dsh/package.json'), 'utf8'));
  if (actualSdk.version !== sdkVersion) throw new Error('Selected SDK is not genuine exact rc.5');
  await execute('build', process.execPath, ['scripts/build.js'], project);
  const profile = join(run, 'home/profiles/fixture');
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'synthetic-profile-fixture', version: '1.0.0', private: true, dependencies: {} }) + '\n', { flag: 'wx' });
  // Local npm file-link installation metadata only; no peer copies or scripts.
  // This is not the Mobile profile installer, bundle activation or an APK test.
  await execute('install-fixture-plugin', 'npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--package-lock=false', '--registry=https://registry.npmjs.org', 'file:' + project], profile);
  env.DSH_MCP_CONSOLE_PROFILE_DIR = profile;
  const tests = (await readdir(join(project, 'test'))).filter(file => file.endsWith('.test.js')).sort().map(file => 'test/' + file);
  await execute('source-suite', process.execPath, ['--expose-internals', '--import', './test/register.js', '--test', ...tests], project);
  // Missing platform-native SDK bindings FAIL this gate; do not skip or borrow
  // an adapter from a live engine. Mobile recipe adaptations belong in an
  // explicitly separate SDK fixture, never in this plugin's runtime package.
  await execute('standalone-profile-resolution', process.execPath, ['--expose-internals', '--test', 'test/runtime-resolution.test.js'], project);
  await execute('build-freshness', process.execPath, ['scripts/build.js', '--check'], project);
  console.log('Checks passed: fixtures/import identity, not GUI rendering or production activation.');
} finally { console.log('Retained isolated SDK/profile/evidence at ' + run); }
