// Reviewed one-shot public source assembler. Built-in modules only; never executes source, npm, tests or servers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = await realpath(process.cwd());
const verifyOnly = process.argv[2] === '--verify-only';
assert.ok(verifyOnly || process.argv[2] === '--assemble', 'Use --verify-only or --assemble');
const metadataPath = process.argv[3] || join(here, 'manifest.json');
const metadataStat = await lstat(metadataPath);
assert.ok(metadataStat.isFile() && !metadataStat.isSymbolicLink() && metadataStat.size > 0 && metadataStat.size <= 128 * 1024, 'Bounded regular manifest required');
const metadataBytes = await readFile(metadataPath);
const metadata = JSON.parse(metadataBytes.toString('utf8'));
function sha(bytes, kind = 'sha256') { return createHash(kind).update(bytes).digest('hex'); }
function blob(bytes) { return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'); }
const rootFiles = new Set(['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'NOTICE', '.gitignore', 'cordis.patch.yml']);
function allowed(name) {
  return rootFiles.has(name) || /^(?:src\/.+\.js|test\/.+\.js|scripts\/[^/]+\.(?:js|mjs)|docs\/[^/]+\.md|\.github\/workflows\/[^/]+\.yml)$/.test(name);
}
function safeName(name) {
  assert.ok(typeof name === 'string' && !name.startsWith('/') && !name.includes('\\'));
  assert.ok(name.split('/').every(segment => segment && segment !== '.' && segment !== '..'));
  return name;
}
async function regularPath(base, name, missingAllowed = false) {
  safeName(name);
  let target = base;
  const segments = name.split('/');
  for (let index = 0; index < segments.length; index++) {
    target = join(target, segments[index]);
    let stat;
    try { stat = await lstat(target); } catch (error) { if (missingAllowed && error.code === 'ENOENT') return target; throw error; }
    assert.ok(!stat.isSymbolicLink(), 'Symlink refused: ' + name);
    assert.ok(index === segments.length - 1 ? stat.isFile() : stat.isDirectory());
  }
  assert.equal(await realpath(target), target);
  return target;
}
assert.equal(metadata.format, 'dsh-source-transport-v1');
assert.equal(metadata.repository, 'Masspedro/dsh-mcp-console');
assert.equal(metadata.branch, 'main');
assert.equal(metadata.baselineCommit, '8262486186b0d6d96f681534ac1228d52683c1a0');
assert.equal(metadata.baselineReadmeBlob, '9f5f55432889a3c5cd317698a56aa1dccfe981a1');
assert.equal(metadata.fileCount, 50);
assert.ok(Number.isSafeInteger(metadata.jsonBytes) && metadata.jsonBytes > 0 && metadata.jsonBytes <= 8 * 1024 * 1024);
assert.ok(Number.isSafeInteger(metadata.compressedBytes) && metadata.compressedBytes > 0 && metadata.compressedBytes <= 1024 * 1024);
assert.ok(Number.isSafeInteger(metadata.base64Chars) && metadata.base64Chars > 0 && metadata.base64Chars <= 1400000);
assert.ok(Array.isArray(metadata.parts) && metadata.parts.length > 0 && metadata.parts.length <= 256);
assert.equal(new Set(metadata.parts.map(part => part.path)).size, metadata.parts.length);
const texts = [];
const transportRoot = dirname(metadataPath);
for (const [index, part] of metadata.parts.entries()) {
  assert.equal(part.path, '.source-upload/part-' + String(index + 1).padStart(4, '0') + '.b64');
  assert.ok(Number.isSafeInteger(part.chars) && part.chars > 0 && part.chars <= 4096);
  const target = await regularPath(transportRoot, part.path.slice('.source-upload/'.length));
  assert.equal((await lstat(target)).size, part.chars, 'Part exceeds declared bound');
  const bytes = await readFile(target);
  assert.equal(bytes.length, part.chars); assert.equal(sha(bytes), part.sha256); assert.equal(blob(bytes), part.gitBlobSha1);
  const text = bytes.toString('ascii');
  assert.equal(Buffer.from(text, 'ascii').compare(bytes), 0);
  assert.match(text, /^[A-Za-z0-9+/]*={0,2}$/);
  if (index < metadata.parts.length - 1) assert.ok(!text.includes('='));
  texts.push(text);
}
const encoded = texts.join('');
assert.equal(encoded.length, metadata.base64Chars);
const compressed = Buffer.from(encoded, 'base64');
assert.equal(compressed.toString('base64'), encoded, 'Non-canonical transport base64');
assert.equal(compressed.length, metadata.compressedBytes);
assert.equal(sha(compressed), metadata.compressedSha256);
const jsonBytes = gunzipSync(compressed, { maxOutputLength: metadata.jsonBytes });
assert.equal(jsonBytes.length, metadata.jsonBytes);
assert.equal(sha(jsonBytes), metadata.jsonSha256);
if (!verifyOnly) {
  assert.equal(process.env.SOURCE_TRANSPORT_SHA256, metadata.compressedSha256, 'Workflow transport binding mismatch');
  assert.equal(process.env.SOURCE_JSON_SHA256, metadata.jsonSha256, 'Workflow JSON binding mismatch');
  assert.equal(metadata.state, 'FROZEN_PUBLIC_SOURCE');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_REPOSITORY, 'Masspedro/dsh-mcp-console');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.match(process.env.GITHUB_SHA || '', /^[0-9a-f]{40}$/);
  assert.equal(resolve(metadataPath), join(root, '.source-upload/manifest.json'));
  assert.equal(await realpath(here), join(root, '.source-upload'));
}
const payload = JSON.parse(jsonBytes.toString('utf8'));
assert.equal(payload.format, 'dsh-public-source-v1');
assert.ok(Array.isArray(payload.files)); assert.equal(payload.files.length, metadata.fileCount);
assert.equal(new Set(payload.files.map(file => file.path)).size, metadata.fileCount);
const files = [];
for (const file of payload.files) {
  safeName(file.path); assert.ok(allowed(file.path), 'Path not whitelisted: ' + file.path);
  assert.equal(file.mode, '100644');
  assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 2 * 1024 * 1024);
  assert.equal(typeof file.content, 'string');
  const bytes = Buffer.from(file.content, 'utf8');
  assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256); assert.equal(blob(bytes), file.gitBlobSha1);
  files.push({ path: file.path, mode: file.mode, bytes: file.bytes, sha256: file.sha256, gitBlobSha1: file.gitBlobSha1, contentBytes: bytes });
}
files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
const identity = files.map(file => [file.path, file.bytes, file.sha256, file.gitBlobSha1].join('\t')).join('\n') + '\n';
assert.equal(sha(identity), metadata.sourceManifestSha256);
assert.deepEqual(files.map(({ contentBytes, ...file }) => file), metadata.files);
const deferred = files.filter(file => file.path.startsWith('.github/workflows/')).map(file => file.path);
assert.deepEqual(deferred, metadata.directWorkflowPaths);
if (verifyOnly) {
  console.log(JSON.stringify({ state: 'TRANSPORT_VERIFIED_ONLY', sourceState: metadata.state, fileCount: files.length, sourceManifestSha256: metadata.sourceManifestSha256, compressedSha256: metadata.compressedSha256, directWorkflowPaths: deferred }, null, 2));
  process.exit(0);
}
function git(args, acceptedStatuses = [0]) {
  const result = spawnSync('git', ['-c', 'http.sslVerify=true', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.attributesFile=/dev/null', ...args], {
    cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1' }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.ok(acceptedStatuses.includes(result.status), result.stderr || 'Git failed');
  return result.stdout;
}
const start = process.env.GITHUB_SHA;
assert.equal(git(['rev-parse', 'HEAD']).trim(), start);
assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']).trim(), '', 'Checkout not clean');
git(['merge-base', '--is-ancestor', metadata.baselineCommit, start]);
function currentMain() {
  const lines = git(['ls-remote', 'origin', 'refs/heads/main']).trim().split('\n');
  assert.equal(lines.length, 1); const [hash, ref] = lines[0].split('\t'); assert.equal(ref, 'refs/heads/main'); return hash;
}
assert.equal(currentMain(), start, 'main changed; stop without overwrite');
const helperPaths = ['.source-upload/manifest.json', '.source-upload/assemble.mjs', ...metadata.parts.map(part => part.path)].sort();
const oneShot = '.github/workflows/source-assemble-once.yml';
const currentTree = git(['ls-tree', '-rz', '--full-tree', start]).split('\0').filter(Boolean).map(record => {
  const [fields, name] = record.split('\t'); const [mode, type, hash] = fields.split(' '); assert.equal(mode, '100644'); assert.equal(type, 'blob'); return { path: name, hash };
});
assert.deepEqual(currentTree.map(file => file.path).sort(), ['README.md', oneShot, ...helperPaths].sort(), 'Unknown existing remote paths');
assert.equal(currentTree.find(file => file.path === 'README.md').hash, metadata.baselineReadmeBlob);
assert.equal(sha(await readFile(join(root, '.source-upload/assemble.mjs'))), metadata.assemblerSha256);
for (const name of helperPaths) await regularPath(root, name);
for (const file of files.filter(file => !deferred.includes(file.path))) {
  await regularPath(root, file.path, true);
  const destination = join(root, file.path);
  let existing;
  try { existing = await readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing !== undefined) { assert.equal(file.path, 'README.md'); assert.equal(blob(existing), metadata.baselineReadmeBlob); }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, file.contentBytes, { flag: existing === undefined ? 'wx' : 'w', mode: 0o644 });
  assert.equal(sha(await readFile(destination)), file.sha256);
}
// Verify absolute deletion targets and checksums before removing only our transport files.
for (const name of helperPaths) {
  const target = await regularPath(root, name);
  assert.ok(target.startsWith(join(root, '.source-upload') + '/'));
  const deletionBytes = await readFile(target);
  if (name === '.source-upload/assemble.mjs') assert.equal(sha(deletionBytes), metadata.assemblerSha256);
  else if (name === '.source-upload/manifest.json') assert.equal(sha(deletionBytes), sha(metadataBytes));
  else assert.equal(sha(deletionBytes), metadata.parts.find(part => part.path === name).sha256);
}
git(['add', '--', ...files.filter(file => !deferred.includes(file.path)).map(file => file.path)]);
git(['rm', '--', ...helperPaths]);
const staged = git(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean).sort();
assert.deepEqual(staged, [...files.filter(file => !deferred.includes(file.path)).map(file => file.path), ...helperPaths].sort());
assert.ok(!staged.some(name => name.startsWith('.github/workflows/')), 'Action must not modify workflow files');
const futureTree = git(['ls-files', '-z']).split('\0').filter(Boolean).sort();
assert.deepEqual(futureTree, [...files.filter(file => !deferred.includes(file.path)).map(file => file.path), oneShot].sort());
assert.equal(currentMain(), start, 'main changed immediately before commit');
git(['config', '--local', 'user.name', 'Masspedro']);
git(['config', '--local', 'user.email', '74119477+Masspedro@users.noreply.github.com']);
git(['commit', '--no-gpg-sign', '-m', 'Publish byte-verified source 0.7.0-preview.1 [source-assembled]']);
assert.equal(git(['rev-parse', 'HEAD^']).trim(), start);
assert.equal(currentMain(), start, 'main changed before push');
git(['push', 'origin', 'HEAD:refs/heads/main']);
console.log(JSON.stringify({ state: 'SOURCE_ASSEMBLED_PENDING_MCP_WORKFLOW_CLEANUP', commit: git(['rev-parse', 'HEAD']).trim(), sourceFilesMaterialized: files.length - deferred.length, deferredWorkflowPaths: deferred, temporaryWorkflowToDeleteViaMcp: oneShot, finalSourceManifestSha256: metadata.sourceManifestSha256 }, null, 2));
