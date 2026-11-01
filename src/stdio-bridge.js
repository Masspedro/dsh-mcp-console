// Private stdio forwarding boundary. Invoked only by the owned MCP child.
// The SDK's inherited stderr must never inherit the upstream process's stderr.
// No vaulted env values in argv or diagnostics; mappings decode only AFTER this
// Node runtime starts, so upstream NODE_OPTIONS cannot configure the bridge.
import { spawn } from 'node:child_process';
const prefix = 'DSH_MCP_CONSOLE_ENV_';
let child;
let ending = false;
let endingCode = 1;
let timer;
function finish(code = 1) {
  if (ending) return;
  ending = true;
  endingCode = code;
  process.stdin.unpipe();
  if (!child || child.exitCode !== null || child.signalCode !== null) { process.exit(code); return; }
  try { child.kill('SIGTERM'); } catch {}
  timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} process.exit(code); }, 750);
}
// Errors are intentionally argument-blind; Node must not print an uncaught
// upstream exception, argv, env value, stdout/stderr or stack to engine logs.
process.on('uncaughtException', () => finish(1));
process.on('unhandledRejection', () => finish(1));
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => finish(0));
try {
  const [command, ...args] = process.argv.slice(2);
  if (typeof command !== 'string' || command.length === 0) throw new Error();
  const env = { ...process.env };
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(prefix)) continue;
    delete env[name];
    const encoded = name.slice(prefix.length);
    if (!/^(?:[a-f0-9]{2}){1,64}$/.test(encoded)) throw new Error();
    const original = Buffer.from(encoded, 'hex').toString('ascii');
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(original)) throw new Error();
    env[original] = value;
  }
  child = spawn(command, args, { env, cwd: process.cwd(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  child.on('error', () => finish(1));
  child.on('close', (code) => { clearTimeout(timer); const status = ending ? endingCode : (Number.isInteger(code) && code >= 0 ? code : 1); process.stdout.write('', (error) => process.exit(error ? 1 : status)); });
  process.stdin.on('error', () => finish(1));
  process.stdout.on('error', () => finish(1));
  child.stdin.on('error', () => finish(1));
  child.stdout.on('error', () => finish(1));
  process.stdin.on('end', () => finish(0));
  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);
} catch { finish(1); }
