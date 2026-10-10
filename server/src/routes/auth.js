import express from 'express';
import { config, nowSeconds } from '../config.js';
import {
  getUserByUsername, getRolesAndPermissions, registerFailure, clearFailures,
  touchLogin, createSession, revokeSession, listSessions, purgeExpiredSessions,
  recordLoginAttempt, recentFailures, writeAudit, updatePassword,
} from '../db/repo.js';
import { verifyPassword, hashPassword, passwordIssues } from '../lib/password.js';
import { generateToken, hashToken } from '../lib/session.js';
import { requireAuth, clientIp, setSessionCookie, clearSessionCookie } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', (req, res) => {
  const ip = clientIp(req);
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }

  if (recentFailures(username, 300) >= 10 || recentFailures(ip, 300) >= 10) {
    recordLoginAttempt({ username, ip, success: false, reason: 'throttled' });
    return res.status(429).json({ error: '尝试过于频繁，请 5 分钟后再试' });
  }

  const user = getUserByUsername(username);
  if (!user) {
    recordLoginAttempt({ username, ip, success: false, reason: 'no-user' });
    writeAudit({ username, action: 'auth.login', ip, result: 'failure', detail: { reason: 'no-user' } });
    return res.status(401).json({ error: '账号或密码错误' });
  }

  if (user.status === 'disabled') {
    recordLoginAttempt({ username, ip, success: false, reason: 'disabled' });
    writeAudit({ userId: user.id, username, action: 'auth.login', ip, result: 'failure', detail: { reason: 'disabled' } });
    return res.status(403).json({ error: '账号已被停用' });
  }

  if (user.locked_until && user.locked_until > nowSeconds()) {
    const wait = Math.ceil((user.locked_until - nowSeconds()) / 60);
    recordLoginAttempt({ username, ip, success: false, reason: 'locked' });
    return res.status(423).json({ error: `账号已锁定，请 ${wait} 分钟后重试` });
  }

  if (!verifyPassword(password, user.password_hash)) {
    registerFailure(user.id);
    recordLoginAttempt({ username, ip, success: false, reason: 'bad-password' });
    writeAudit({ userId: user.id, username, action: 'auth.login', ip, result: 'failure', detail: { reason: 'bad-password' } });
    return res.status(401).json({ error: '账号或密码错误' });
  }

  clearFailures(user.id);
  touchLogin(user.id, ip);
  recordLoginAttempt({ username, ip, success: true });

  const token = generateToken();
  createSession({
    tokenHash: hashToken(token),
    userId: user.id,
    ip,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
    expiresAt: nowSeconds() + config.sessionTtlSeconds,
  });
  setSessionCookie(res, token);
  writeAudit({ userId: user.id, username, action: 'auth.login', ip, result: 'success' });
  purgeExpiredSessions();

  const { roles } = getRolesAndPermissions(user.id);
  res.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name || user.username,
      avatarColor: user.avatar_color,
      roles,
    },
  });
});

router.post('/logout', (req, res) => {
  const token = req.cookies?.wb_session;
  if (token) revokeSession(hashToken(token));
  if (req.user) {
    writeAudit({ userId: req.user.id, username: req.user.username, action: 'auth.logout', ip: clientIp(req) });
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/password', requireAuth, (req, res) => {
  const oldPassword = String(req.body?.oldPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const user = getUserByUsername(req.user.username);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  if (!verifyPassword(oldPassword, user.password_hash)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  const issues = passwordIssues(newPassword);
  if (issues.length) return res.status(400).json({ error: issues.join('；') });

  updatePassword(user.id, hashPassword(newPassword));
  writeAudit({ userId: user.id, username: user.username, action: 'auth.password.change', ip: clientIp(req) });
  res.json({ ok: true });
});

router.get('/sessions', requireAuth, (req, res) => {
  res.json({ sessions: listSessions(req.user.id) });
});

export default router;
