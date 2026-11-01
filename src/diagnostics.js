// Diagnostics are literals, never upstream prose. Error messages, stacks,
// stdout/stderr, headers and URLs are deliberately outside this contract.
import { ConsoleError } from './storage.js';

export const CONNECTION_REASON_CODES = Object.freeze([
  'connection-auth-denied',
  'connection-endpoint-unavailable',
  'connection-rate-limited',
  'connection-service-unavailable',
  'connection-timeout',
  'connection-refused',
  'connection-unreachable',
  'connection-tls-failed',
  'connection-invalid-response',
]);
const localCodes = new Set([...CONNECTION_REASON_CODES, 'mount-failed']);

// Descriptors avoid invoking error getters. Proxies can still reject reflection;
// the bounded catch returns no evidence, without coercing or logging the error.
function ownData(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}
export function safeConnectionCode(error, fallback = 'mount-failed') {
  const safeFallback = typeof fallback === 'string' && localCodes.has(fallback) ? fallback : 'mount-failed';
  try {
    if (!(error instanceof ConsoleError)) return safeFallback;
    const code = ownData(error, 'code');
    return typeof code === 'string' && localCodes.has(code) ? code : safeFallback;
  } catch { return safeFallback; }
}

export function httpStatusFailureReason(status) {
  if (typeof status !== 'number' || !Number.isInteger(status)) return undefined;
  if (status === 401 || status === 403) return 'connection-auth-denied';
  if (status === 404 || status === 405) return 'connection-endpoint-unavailable';
  if (status === 429) return 'connection-rate-limited';
  if (status >= 500 && status <= 599) return 'connection-service-unavailable';
  return undefined;
}

// Exact Node/Undici/OpenSSL codes only. Names, prose, errno numbers, arbitrary
// prefixes and constructor names cannot prove a transport diagnosis.
const networkCodes = Object.freeze({
  ECONNREFUSED: 'connection-refused',
  ENOTFOUND: 'connection-unreachable', EAI_AGAIN: 'connection-unreachable',
  EAI_FAIL: 'connection-unreachable', ENETUNREACH: 'connection-unreachable',
  EHOSTUNREACH: 'connection-unreachable', ENETDOWN: 'connection-unreachable',
  ECONNRESET: 'connection-unreachable', EPIPE: 'connection-unreachable',
  ETIMEDOUT: 'connection-timeout', UND_ERR_CONNECT_TIMEOUT: 'connection-timeout',
  UND_ERR_HEADERS_TIMEOUT: 'connection-timeout', UND_ERR_BODY_TIMEOUT: 'connection-timeout',
  ERR_TLS_HANDSHAKE_TIMEOUT: 'connection-timeout',
  CERT_HAS_EXPIRED: 'connection-tls-failed', CERT_NOT_YET_VALID: 'connection-tls-failed',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'connection-tls-failed', SELF_SIGNED_CERT_IN_CHAIN: 'connection-tls-failed',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'connection-tls-failed', UNABLE_TO_GET_ISSUER_CERT: 'connection-tls-failed',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'connection-tls-failed', CERT_UNTRUSTED: 'connection-tls-failed',
  CERT_REJECTED: 'connection-tls-failed', ERR_TLS_CERT_ALTNAME_INVALID: 'connection-tls-failed',
  ERR_SSL_WRONG_VERSION_NUMBER: 'connection-tls-failed', ERR_SSL_UNSUPPORTED_PROTOCOL: 'connection-tls-failed',
  ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION: 'connection-tls-failed',
});
// The official fiber rethrows Error(cause: firstAttemptError). SDK errors use
// own string codes, but their custom instanceof brand check reads getters. The
// intrinsic Error prototype check below never invokes that SDK brand protocol.
const errorHasInstance = Function.prototype[Symbol.hasInstance];
const startupCodes = Object.freeze({
  REQUEST_TIMEOUT: 'connection-timeout',
  INVALID_RESULT: 'connection-invalid-response',
  CLIENT_HTTP_UNEXPECTED_CONTENT: 'connection-invalid-response',
  CLIENT_HTTP_AUTHENTICATION: 'connection-auth-denied',
  CLIENT_HTTP_FORBIDDEN: 'connection-auth-denied',
});
export function startupFailureReason(error) {
  const seen = new Set();
  let remaining = 12;
  function inspect(value, depth) {
    if (depth > 4 || remaining-- <= 0 || value === null || typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    try { if (!errorHasInstance.call(Error, value)) return undefined; } catch { return undefined; }
    const code = ownData(value, 'code');
    if (typeof code === 'string') {
      if (Object.hasOwn(startupCodes, code)) return startupCodes[code];
      if (Object.hasOwn(networkCodes, code)) return networkCodes[code];
    }
    const reason = inspect(ownData(value, 'cause'), depth + 1);
    if (reason !== undefined) return reason;
    const errors = ownData(value, 'errors');
    try { if (!Array.isArray(errors)) return undefined; } catch { return undefined; }
    const length = ownData(errors, 'length');
    if (!Number.isInteger(length) || length < 1 || length > 4) return undefined;
    let common;
    for (let index = 0; index < length; index++) {
      const next = inspect(ownData(errors, '' + index), depth + 1);
      if (next === undefined || (common !== undefined && common !== next)) return undefined;
      common = next;
    }
    return common;
  }
  return inspect(error, 0);
}

export function networkFailureReason(error) {
  const seen = new Set();
  let remaining = 12;
  function inspect(value, depth) {
    if (depth > 4 || remaining-- <= 0 || value === null || typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    const code = ownData(value, 'code');
    if (typeof code === 'string' && Object.hasOwn(networkCodes, code)) return networkCodes[code];
    const cause = ownData(value, 'cause');
    const reason = inspect(cause, depth + 1);
    if (reason !== undefined) return reason;
    // Node's dual-stack connect may report an AggregateError. Accept only a
    // small own-data array whose every member proves the SAME diagnosis.
    const errors = ownData(value, 'errors');
    try { if (!Array.isArray(errors)) return undefined; } catch { return undefined; }
    const length = ownData(errors, 'length');
    if (!Number.isInteger(length) || length < 1 || length > 4) return undefined;
    let common;
    for (let index = 0; index < length; index++) {
      const next = inspect(ownData(errors, '' + index), depth + 1);
      if (next === undefined || (common !== undefined && common !== next)) return undefined;
      common = next;
    }
    return common;
  }
  return inspect(error, 0);
}
