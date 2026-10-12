import express from 'express';
import {
  listUsers, listRoles, listPermissions, getUserById, getUserByUsername,
  createUser, updateProfile, setUserStatus, setUserRoles, updatePassword,
  writeAudit, listAudit, getRolesAndPermissions, setRolePermissions,
} from '../db/repo.js';
import { requirePermission, clientIp, requireAuth, denyGuest } from '../middleware/auth.js';
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

router.get('/roles', requireAuth, denyGuest, (req, res) => {
  res.json({ roles: listRoles(), permissions: listPermissions() });
});

// 修改角色的权限（仅 role:manage）。admin 角色由启动时的基线种子固定为全权限，
// 改了也会被下次启动重新补齐，因此直接拒绝，避免误导。
router.patch('/roles/:code', requirePermission('role:manage'), denyGuest, (req, res) => {
  const code = String(req.params.code || '').trim();
  if (code === 'admin') {
    return res.status(400).json({ error: '管理员角色固定拥有全部权限，不可修改' });
  }
  if (!Array.isArray(req.body?.permissions)) {
    return res.status(400).json({ error: 'permissions 必须是数组' });
  }

  const perms = req.body.permissions.map(String).slice(0, 200);
  if (!setRolePermissions(code, perms)) {
    return res.status(404).json({ error: '角色不存在' });
  }

  writeAudit({
    userId: req.user.id,
    username: req.user.username,
    action: 'role.update',
    target: code,
    detail: perms.join(','),
    ip: clientIp(req),
  });
  // 权限是按请求实时从库里读的，改完对已登录会话下一次请求即生效
  res.json({ ok: true, roles: listRoles() });
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
