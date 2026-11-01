import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rm, chmod, symlink, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { FileStore, MAX_FILE_BYTES } from '../src/storage.js';
const fixtures = fileURLToPath(new URL('./.fixtures/', import.meta.url));
async function fixture(fn) {
  await mkdir(fixtures, { recursive: true, mode: 0o700 });
  const directory = join(fixtures, randomBytes(12).toString('hex'));
  assert.equal(dirname(directory) + '/', fixtures, 'resolved cleanup target must be the generated package-local fixture');
  try { return await fn(new FileStore(directory), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const reject = (promise, code) => assert.rejects(promise, (e) => e.code === code);

test('private atomic filesystem publication and cross-instance writer lock', async () => fixture(async (store, directory) => {
  assert.equal(await store.read(), null);
  const value = { version: 1, revision: 0, servers: [], vault: null };
  await store.transaction(() => store.write(value)); assert.deepEqual(await store.read(), value); assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')), value);
  let release; let entered;
  const gate = new Promise((done) => { release = done; }); const active = new Promise((done) => { entered = done; });
  const running = store.transaction(async () => { entered(); await gate; }); await active;
  await reject(new FileStore(directory).transaction(async () => assert.fail('must not enter')), 'store-busy'); release(); await running;
  await new FileStore(directory).transaction(async () => {});
}));
test('startup metadata read creates nothing and refuses a retained writer lock', async () => fixture(async (store, directory) => {
  assert.equal(await store.readForStartup(), null);
  await assert.rejects(access(directory), error => error.code === 'ENOENT');
  const value = { version: 1, revision: 0, servers: [], vault: null };
  await store.transaction(() => store.write(value));
  const before = await readFile(store.file);
  assert.deepEqual(await store.readForStartup(), value);
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const active = new Promise(resolve => { entered = resolve; });
  const running = store.transaction(async () => { entered(); await gate; });
  await active;
  try { await reject(new FileStore(directory).readForStartup(), 'store-busy'); }
  finally { release(); await running; }
  assert.deepEqual(await readFile(store.file), before);
  await assert.rejects(access(store.keyFile), error => error.code === 'ENOENT');
}));
test('startup metadata read detects a lock appearing during its bounded read', async () => fixture(async (store, directory) => {
  await store.transaction(() => store.write({ synthetic: true }));
  const lockPath = join(directory, 'write.lock');
  assert.equal(dirname(lockPath), directory);
  class RacingStore extends FileStore {
    async read() { const value = await super.read(); await writeFile(lockPath, '', { mode: 0o600, flag: 'wx' }); return value; }
  }
  await reject(new RacingStore(directory).readForStartup(), 'store-busy');
  assert.deepEqual(await store.read(), { synthetic: true });
  assert.equal(await readFile(lockPath, 'utf8'), '', 'Startup never removes an ambiguous lock');
}));
test('bounded reads/writes, malformed files, unsafe permissions and symlinks fail closed', async () => fixture(async (store, directory) => {
  await store.prepare(); await store.transaction(() => store.write({ synthetic: true }));
  await reject(store.transaction(() => store.write({ large: 'x'.repeat(MAX_FILE_BYTES) })), 'store-too-large'); assert.deepEqual(await store.read(), { synthetic: true });
  await chmod(store.file, 0o644); await reject(store.read(), 'store-invalid'); await chmod(store.file, 0o600);
  await writeFile(store.file, '{malformed', { mode: 0o600 }); await reject(store.read(), 'store-invalid');
  await writeFile(store.file, 'x'.repeat(MAX_FILE_BYTES + 1), { mode: 0o600 }); await reject(store.read(), 'store-invalid');
  const linked = join(directory, 'linked-store'); const target = join(directory, 'synthetic-target.json'); await mkdir(linked, { mode: 0o700 }); await writeFile(target, '{}', { mode: 0o600 }); await symlink(target, join(linked, 'store.json'));
  await reject(new FileStore(linked).read(), 'store-invalid'); assert.equal(await readFile(target, 'utf8'), '{}');
  const linkDirectory = join(directory, 'directory-link'); await symlink(linked, linkDirectory); await reject(new FileStore(linkDirectory).prepare(), 'store-permissions'); await reject(new FileStore(linkDirectory).read(), 'store-permissions');
}));
