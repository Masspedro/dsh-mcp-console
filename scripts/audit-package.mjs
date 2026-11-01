// Audit npm's selected runtime files; never reads user stores or credentials.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', env: process.env });
if (result.status !== 0) { process.stderr.write(result.stderr ?? 'npm pack failed\n'); process.exit(result.status ?? 1); }
const decoded = JSON.parse(result.stdout);
let pack;
if (Array.isArray(decoded)) {
  assert.equal(decoded.length, 1, 'Exactly one package must be selected');
  pack = decoded[0];
} else if (decoded && Array.isArray(decoded.files)) {
  pack = decoded;
} else {
  assert.ok(decoded && typeof decoded === 'object', 'Unexpected npm pack JSON contract');
  assert.deepEqual(Object.keys(decoded), [manifest.name], 'Exactly the expected named package must be selected');
  pack = decoded[manifest.name];
}
assert.ok(pack && Array.isArray(pack.files), 'Unexpected npm pack JSON contract');
assert.equal(pack.name, manifest.name); assert.equal(pack.version, manifest.version);
const required = ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'NOTICE', 'docs/SECURITY.md', 'docs/COMPATIBILITY.md'];
const names = pack.files.map(file => file.path).sort();
for (const name of required) assert.ok(names.includes(name), 'Missing runtime file: ' + name);
for (const file of pack.files) {
  assert.ok(/^(?:lib\/[a-z-]+\.js|docs\/[A-Z_]+\.md|package\.json|cordis\.patch\.yml|README\.md|LICENSE|NOTICE)$/.test(file.path), 'Unexpected runtime path: ' + file.path);
  assert.ok(!file.path.includes('..') && !file.path.startsWith('/'), 'Unsafe runtime path');
  const metadata = await lstat(resolve(root, file.path));
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), 'Runtime input must be a regular file: ' + file.path);
}
assert.ok(!names.some(name => /(?:^|\/)(?:test|src|node_modules|profiles|storages|sessions|\.verification|\.artifacts)(?:\/|$)/.test(name)));
console.log(JSON.stringify({ name: pack.name, version: pack.version, runtimeFiles: names, fileCount: names.length, packedBytes: pack.size, unpackedBytes: pack.unpackedSize, sha1: pack.shasum, integrity: pack.integrity, note: 'Dry-run package selection audit, not npm publication or security certification' }, null, 2));
