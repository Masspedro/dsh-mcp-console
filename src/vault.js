import { randomBytes, scrypt as scryptCallback, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from './storage.js';
const scrypt = promisify(scryptCallback);
const AAD = Buffer.from('dsh-personal-mcp-console:v1');
export const AUTOMATIC_KDF = 'app-private-key-v1';
const aadFor = (kdf, salt) => kdf === AUTOMATIC_KDF ? Buffer.concat([Buffer.from('dsh-personal-mcp-console:app-private-key:v1:'), salt]) : AAD;
export const KDF = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
export async function derive(passphrase, salt) {
  const input = Buffer.from(passphrase, 'utf8');
  try { return await scrypt(input, salt, 32, KDF); }
  finally { input.fill(0); }
}
export function seal(secrets, key, salt, kdf = 'scrypt-N32768-r8-p1') {
  if (!['scrypt-N32768-r8-p1', AUTOMATIC_KDF].includes(kdf)) fail('vault-invalid');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aadFor(kdf, salt));
  const plaintext = Buffer.from(JSON.stringify(secrets));
  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { version: 1, kdf, salt: salt.toString('base64'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  } finally { plaintext.fill(0); }
}
export function validateEnvelope(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'ciphertext,kdf,nonce,salt,tag,version' || value.version !== 1 || !['scrypt-N32768-r8-p1', AUTOMATIC_KDF].includes(value.kdf)) fail('vault-invalid');
  for (const [name, length] of [['salt', 16], ['nonce', 12], ['tag', 16], ['ciphertext', null]]) {
    const str = value[name];
    if (typeof str !== 'string' || str.length > 1500000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(str)) fail('vault-invalid');
    const buf = Buffer.from(str, 'base64');
    if (length !== null && buf.length !== length || name === 'ciphertext' && buf.length < 2) fail('vault-invalid');
  }
}
export function unseal(envelope, key) {
  let plaintext; let decoded; let final;
  try {
    validateEnvelope(envelope);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
    decipher.setAAD(aadFor(envelope.kdf, Buffer.from(envelope.salt, 'base64'))); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    // GCM may emit unauthenticated bytes before final() rejects: wipe those too.
    decoded = decipher.update(Buffer.from(envelope.ciphertext, 'base64'));
    final = decipher.final(); plaintext = Buffer.concat([decoded, final]);
    const secrets = JSON.parse(plaintext.toString('utf8'));
    if (!secrets || Array.isArray(secrets) || typeof secrets !== 'object' || Object.keys(secrets).length > 128) fail('vault-invalid');
    for (const [ref, value] of Object.entries(secrets)) if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(ref) || typeof value !== 'string' || value.length < 1 || value.length > 8192 || /[\x00\r\n]/.test(value)) fail('vault-invalid');
    return secrets;
  } catch { fail('vault-unlock-failed'); }
  finally { plaintext?.fill(0); decoded?.fill(0); final?.fill(0); }
}
