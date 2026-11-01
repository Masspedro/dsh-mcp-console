// Owned synthetic stdio bridge fixture. No network, business tool or user file.
const mode = process.argv[2];
const taint = 'SYNTHETIC-STDIO-BRIDGE-PRIVATE-ONLY';
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
if (mode === 'metadata') {
  process.stdout.write(JSON.stringify({
    cwd: process.cwd(), args: process.argv.slice(3),
    credentialMatched: process.env.SYNTHETIC_API_KEY === taint,
    arbitraryMappingMatched: process.env.SYNTHETIC_MAPPING === 'literal value',
    reservedNameMatched: process.env.DSH_MCP_CONSOLE_ENV_TEST === 'reserved value',
    nodeOptionsMatched: process.env.NODE_OPTIONS === '--stack-trace-limit=37',
    stackTraceLimit: Error.stackTraceLimit,
  }) + '\n', () => process.exit(0));
} else if (mode === 'stderr-flood') {
  process.stderr.write(taint.repeat(Math.ceil(4 * 1024 * 1024 / taint.length)), () => {
    process.stdout.write('STDERR_DISCARDED\n', () => process.exit(0));
  });
} else if (mode === 'stdout-drain') {
  process.stdout.write('x'.repeat(3 * 1024 * 1024) + 'STDOUT_DRAINED\n', () => process.exit(0));
} else if (mode === 'throw-taint') {
  process.stderr.write(taint + '\n');
  throw new Error(taint);
} else if (mode === 'malicious-error') {
  const error = new Error(taint);
  Object.defineProperty(error, 'stack', { get() { throw new Error(taint); } });
  throw error;
} else if (mode === 'hold' || mode === 'write-forever' || mode === 'write-cooperative') {
  // Keep the owned child alive even after input EOF. Ignoring SIGTERM proves
  // escalation for THIS direct child; cooperative mode proves status retention.
  process.on('SIGTERM', () => { if (mode === 'write-cooperative') process.exit(0); });
  process.stdin.on('end', () => {});
  process.stdin.resume();
  process.stderr.write(taint + '\n');
  emit({ ready: true, pid: process.pid });
  setInterval(() => { if (mode === 'write-forever' || mode === 'write-cooperative') process.stdout.write('BRIDGE_PIPE_TEST\n'); }, 25);
} else {
  throw new Error(taint);
}
