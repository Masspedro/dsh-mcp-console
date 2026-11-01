import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export class ConsoleError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const fail = (code) => { throw new ConsoleError(code); };
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Fixed filenames, private directory, bounded reads, no symlink following.
// The lock is never automatically removed as stale: ambiguous ownership fails closed.
export class FileStore {
  constructor(directory) { this.directory = resolve(directory); this.file = join(this.directory, 'store.json'); this.keyFile = join(this.directory, 'private-key.bin'); this.writerLocked = false; }
  // The app-private key is not AndroidKeystore and cannot protect against root or
  // this process. Never create/replace it outside the existing store writer lock.
  async privateKey({ create = false } = {}) {
    let file; let bytes; let temporary; let generated; let published = false;
    try {
      if (create && !this.writerLocked) fail('vault-key-unavailable');
      const directory = await lstat(this.directory);
      const owned = (st) => typeof process.getuid !== 'function' || st.uid === process.getuid();
      if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o777) !== 0o700 || !owned(directory)) fail('vault-key-unavailable');
      try {
        const before = await lstat(this.keyFile);
        if (!before.isFile() || before.isSymbolicLink() || before.size !== 32 || (before.mode & 0o777) !== 0o600 || !owned(before) || before.nlink !== 1) fail('vault-key-unavailable');
        file = await open(this.keyFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const st = await file.stat();
        if (!st.isFile() || st.size !== 32 || (st.mode & 0o777) !== 0o600 || !owned(st) || st.nlink !== 1 || st.ino !== before.ino || st.dev !== before.dev) fail('vault-key-unavailable');
        bytes = Buffer.alloc(33);
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        if (bytesRead !== 32) fail('vault-key-unavailable');
        if (create) await this.syncDirectory();
        return Buffer.from(bytes.subarray(0, 32));
      } catch (error) {
        if (error.code !== 'ENOENT' || !create) throw error;
      }
      if (!this.writerLocked) fail('vault-key-unavailable');
      generated = randomBytes(32);
      temporary = join(this.directory, 'key-' + randomBytes(12).toString('hex') + '.tmp');
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(generated); await file.sync(); await file.close(); file = null;
      // All cooperating writers hold write.lock; an existing key is never replaced.
      try { await lstat(this.keyFile); fail('vault-key-unavailable'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rename(temporary, this.keyFile); published = true;
      // Persist the key's directory entry before ciphertext can be published.
      await this.syncDirectory();
      return Buffer.from(generated);
    } catch { fail('vault-key-unavailable'); }
    finally {
      bytes?.fill(0); generated?.fill(0);
      await file?.close().catch(() => {});
      // Keep a published/orphan key after ambiguous store publication. It is only
      // reusable when the controller proves no persisted envelope exists.
      if (temporary && !published) await unlink(temporary).catch(() => {});
    }
  }
  async syncDirectory() {
    let directory;
    try { directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); await directory.sync(); }
    finally { await directory?.close().catch(() => {}); }
  }
  async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const st = await lstat(this.directory);
    if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) !== 0) fail('store-permissions');
  }
  async read() {
    let file;
    try {
      const directory = await lstat(this.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) fail('store-permissions');
      file = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const st = await file.stat();
      if (!st.isFile() || st.size > MAX_FILE_BYTES || (st.mode & 0o077) !== 0) fail('store-invalid');
      const bytes = Buffer.alloc(st.size + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > st.size) fail('store-invalid');
      return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error instanceof ConsoleError) throw error;
      fail('store-invalid');
    } finally { await file?.close(); }
  }
  async readForStartup() {
    // A lingering writer lock is ambiguous, not permission to replay an intent
    // observed during publication. Never create/remove locks during restoration.
    const unlocked = async () => {
      try { await lstat(join(this.directory, 'write.lock')); }
      catch (error) { if (error.code === 'ENOENT') return; fail('store-busy'); }
      fail('store-busy');
    };
    await unlocked();
    const value = await this.read();
    await unlocked();
    return value;
  }
  async transaction(operation) {
    await this.prepare();
    let lock;
    try { lock = await open(join(this.directory, 'write.lock'), 'wx', 0o600); }
    catch { fail('store-busy'); }
    this.writerLocked = true;
    try { return await operation(); }
    finally { this.writerLocked = false; await lock.close(); await unlink(join(this.directory, 'write.lock')); }
  }
  async write(value) {
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > MAX_FILE_BYTES) fail('store-too-large');
    const temporary = join(this.directory, 'store-' + randomBytes(12).toString('hex') + '.tmp');
    let file;
    let published = false;
    try {
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(data); await file.sync(); await file.close(); file = null;
      await rename(temporary, this.file); published = true;
      await this.syncDirectory();
    } catch { fail('store-write-failed'); }
    finally {
      await file?.close();
      if (!published) await unlink(temporary).catch(() => {});
    }
  }
}
