// Shared auth helpers — uses only the Web Crypto API (no imports), so this runs
// identically in the Vercel Edge middleware and in plain Node 18+ (for local
// tests).
//
// SECURITY: the password is never stored in this file. It is read from the
// DASHBOARD_PASSWORD environment variable at request time. This file holds only
// the (non-secret) token algorithm — its safety rests on the secret password,
// not on the algorithm being hidden.

export const COOKIE_NAME = 'bs_auth';
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const encoder = new TextEncoder();

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(str));
  return toHex(digest);
}

async function hmacHex(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return toHex(sig);
}

// Constant-time comparison of two strings (used on equal-length hex digests).
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Verify a submitted password against the configured one, in constant time.
// Both are hashed first so neither the length nor the contents leak via timing.
export async function passwordMatches(submitted, configured) {
  if (!configured) return false;
  const [a, b] = await Promise.all([
    sha256Hex(String(submitted ?? '')),
    sha256Hex(String(configured)),
  ]);
  return timingSafeEqual(a, b);
}

// Create a signed session token "<expiry>.<hmac>", signed with the password.
// `now` is passed in (Date.now()) to keep this function pure and testable.
export async function createToken(password, now) {
  const expiry = now + SESSION_MS;
  const sig = await hmacHex(password, String(expiry));
  return `${expiry}.${sig}`;
}

// Validate a session token. Returns true only if the signature matches AND the
// token has not expired. Because it is signed with the password, changing the
// password invalidates every existing session.
export async function verifyToken(token, password, now) {
  if (!token || !password) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const expiry = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expiry)) return false;
  if (Number(expiry) <= now) return false;
  const expected = await hmacHex(password, expiry);
  return timingSafeEqual(sig, expected);
}
