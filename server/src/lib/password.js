import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    if (expected.length === 0) return false;
    const derived = scryptSync(password, salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

const WEAK = new Set(['123456', 'password', 'admin', 'admin123', 'qwerty', '111111', 'abc123']);

export function passwordIssues(password) {
  const issues = [];
  if (typeof password !== 'string' || password.length < 10) issues.push('密码至少 10 位');
  if (!/[a-zA-Z]/.test(password)) issues.push('需包含字母');
  if (!/[0-9]/.test(password)) issues.push('需包含数字');
  if (WEAK.has(String(password).toLowerCase())) issues.push('属于常见弱密码');
  return issues;
}
