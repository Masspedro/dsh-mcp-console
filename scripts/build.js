import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const names = (await readdir(resolve(root, 'src'))).filter((name) => name.endsWith('.js')).sort();
const contract = (await readFile(resolve(root, 'src/contract.js'), 'utf8')).replace(/^export /gm, '');
await mkdir(resolve(root, 'lib'), { recursive: true });
for (const name of names) {
  let source = await readFile(resolve(root, 'src', name), 'utf8');
  if (name === 'client.js') source = source.replace('/* BUILD_SHARED_CONTRACT */', contract);
  const parsed = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
  if (parsed.status !== 0) { process.stderr.write(parsed.stderr); process.exit(1); }
  const output = resolve(root, 'lib', name);
  if (check) {
    let existing; try { existing = await readFile(output, 'utf8'); } catch { throw new Error('Build artifact missing: ' + name); }
    if (existing !== source) throw new Error('Build artifact stale: ' + name);
  } else {
    // Observe an existing artifact before replacing it. Only package-local lib is written.
    await readFile(output, 'utf8').catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await writeFile(output, source, { mode: 0o644 });
  }
}
process.stdout.write((check ? 'Verified' : 'Built') + ' ' + names.length + ' pure-JavaScript artifacts; no install, server, activation or MCP connection.\n');
