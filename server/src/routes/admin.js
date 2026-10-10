import express from 'express';
import {
  listUsers, listRoles, listPermissions, getUserById, getUserByUsername,
  createUser, updateProfile, setUserStatus, setUserRoles, updatePassword,
  writeAudit, listAudit, getRolesAndPermissions,
} from '../db/repo.js';
import { requirePermission, clientIp, requireAuth } from '../middleware/auth.js';
import { hashPassword, passwordIssues } from '../lib/password.js';
import { revokeAllSessions } from '../db/repo.js';

const router = express.Router();

function shape(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.display_name || u.display_name === '' ? u.display_name || u.username : u.username,
    avatarColor: u.avatar_color,
    status: u.status,
    lastLoginAt: u.last_login_at,
    lastLoginIp: u.last_login_ip,
    createdAt: u.created_at,
    roles: u.roles || [],
  };
}

router.get('/users', requirePermission('user:manage'), (req, res) => {
  res.json({ users: listUsers().map(shape) });
});

router.post('/users', requirePermission('user:manage'), (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const roles = Array.isArray(req.body?.roles) ? req.body.roles : ['viewer'];

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 3-32 位字母、数字、下划线、点或横线' });
  }
  if (getUserByUsername(username)) return res.status(409).json({ error: '用户名已存在' });
  const issues = passwordIssues(password);
  if (issues.length) return res.status(400).json({ error: issues.join('；') });

  const id = createUser({
    username,
    passwordHash: hashPassword(password),
    displayName: String(req.body?.displayName || username),
    email: req.body?.email || null,
    avatarColor: req.body?.avatarColor || '#7F77DD',
  });
  setUserRoles(id, roles);
  writeAudit({ userId: req.user.id, username: req.user.username, action: 'user.create', target: username, ip: clientIp(req) });
  res.json({ ok: true, id });
});

router.patch('/users/:id', requirePermission('user:manage'), (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const { displayName, email, avatarColor, status, roles, password } = req.body || {};
  if (displayName !== undefined || email !== undefined || avatarColor !== undefined) {
    updateProfile(id, {
      displayName: displayName ?? user.display_name,
      email: email ?? user.email,
      avatarColor: avatarColor ?? user.avatar_color,
    });
  }
  if (status !== undefined) {
    if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: '状态非法' });
    setUserStatus(id, status);
    if (status === 'disabled') revokeAllSessions(id);
  }
  if (Array.isArray(roles)) setUserRoles(id, roles);
  if (password) {
    const issues = passwordIssues(String(password));
    if (issues.length) return res.status(400).json({ error: issues.join('；') });
    updatePassword(id, hashPassword(String(password)));
  }

  writeAudit({ userId: req.user.id, username: req.user.username, action: 'user.update', target: user.username, ip: clientIp(req) });
  res.json({ ok: true });
});

router.delete('/users/:id', requirePermission('user:manage'), (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (id === req.user.id) return res.status(400).json({ error: '不能删除自己' });

  revokeAllSessions(id);
  setUserStatus(id, 'disabled');
  writeAudit({ userId: req.user.id, username: req.user.username, action: 'user.disable', target: user.username, ip: clientIp(req) });
  res.json({ ok: true });
});

router.get('/roles', requireAuth, (req, res) => {
  res.json({ roles: listRoles(), permissions: listPermissions() });
});

router.get('/audit', requirePermission('audit:read'), (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const offset = Number(req.query.offset || 0);
  const action = req.query.action ? String(req.query.action) : undefined;
  res.json({ logs: listAudit({ limit, offset, action }) });
});

router.get('/me/permissions', requireAuth, (req, res) => {
  const { roles, permissions } = getRolesAndPermissions(req.user.id);
  res.json({ roles, permissions });
});

export default router;
