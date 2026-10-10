import { createHash, randomBytes } from 'node:crypto';

export function generateToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export const SESSION_COOKIE = 'wb_session';
