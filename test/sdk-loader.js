// Test-only resolution: never creates links or installs dependencies.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as pathResolve } from 'node:path';
const root = process.env.DSH_SDK_ROOT ?? fileURLToPath(new URL('../node_modules/', import.meta.url));
const requireSdk = createRequire(pathResolve(root, 'dsh-mcp-console-test-resolver.cjs'));
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/')) return { url: pathToFileURL(requireSdk.resolve(specifier)).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
