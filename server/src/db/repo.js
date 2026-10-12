import { getDb } from './index.js';
import { nowSeconds } from '../config.js';

export function getUserByUsername(username) {
  return getDb().prepare(`SELECT * FROM users WHERE username = ?`).get(username);
}

export function getUserById(id) {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

export function listUsers() {
  return getDb()
    .prepare(
      `SELECT u.id, u.username, u.email, u.display_name, u.avatar_color, u.status,
              u.last_login_at, u.last_login_ip, u.created_at,
              COALESCE(GROUP_CONCAT(r.code), '') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
        GROUP BY u.id
        ORDER BY u.id`
    )
    .all()
    .map((u) => ({ ...u, roles: u.roles ? u.roles.split(',') : [] }));
}

export function getRolesAndPermissions(userId) {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT r.code AS role, p.code AS permission
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = ?`
    )
    .all(userId);
  const roles = [...new Set(rows.map((r) => r.role))];
  const permissions = [...new Set(rows.map((r) => r.permission).filter(Boolean))];
  return { roles, permissions };
}

export function assignRole(userId, roleCode) {
  const role = getDb().prepare(`SELECT id FROM roles WHERE code = ?`).get(roleCode);
  if (!role) throw new Error(`角色不存在: ${roleCode}`);
  getDb()
    .prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT(user_id, role_id) DO NOTHING`)
    .run(userId, role.id);
}

export function setUserRoles(userId, roleCodes) {
  const db = getDb();
  const tx = db.transaction((codes) => {
    db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).run(userId);
    for (const code of codes) {
      const role = db.prepare(`SELECT id FROM roles WHERE code = ?`).get(code);
      if (role) db.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`).run(userId, role.id);
    }
  });
  tx(roleCodes);
}

export function createUser({ username, passwordHash, displayName = '', email = null, avatarColor = '#7F77DD' }) {
  const info = getDb()
    .prepare(
      `INSERT INTO users (username, email, password_hash, display_name, avatar_color)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(username, email, passwordHash, displayName, avatarColor);
  return info.lastInsertRowid;
}

export function updatePassword(userId, passwordHash) {
  getDb()
    .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
    .run(passwordHash, nowSeconds(), userId);
}

export function updateProfile(userId, { displayName, email, avatarColor }) {
  getDb()
    .prepare(`UPDATE users SET display_name = ?, email = ?, avatar_color = ?, updated_at = ? WHERE id = ?`)
    .run(displayName, email, avatarColor, nowSeconds(), userId);
}

export function setUserStatus(userId, status) {
  getDb().prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowSeconds(), userId);
}

export function registerFailure(userId) {
  const db = getDb();
  const lockUntil = nowSeconds() + Number(process.env.LOCK_SECONDS || 900);
  db.prepare(
    `UPDATE users
        SET failed_count = failed_count + 1,
            locked_until = CASE WHEN failed_count + 1 >= ? THEN ? ELSE locked_until END,
            status = CASE WHEN failed_count + 1 >= ? THEN 'locked' ELSE status END,
            updated_at = ?
      WHERE id = ?`
  ).run(Number(process.env.MAX_FAILED_LOGIN || 5), lockUntil, Number(process.env.MAX_FAILED_LOGIN || 5), nowSeconds(), userId);
}

export function clearFailures(userId) {
  getDb()
    .prepare(`UPDATE users SET failed_count = 0, locked_until = NULL, status = 'active', updated_at = ? WHERE id = ?`)
    .run(nowSeconds(), userId);
}

export function touchLogin(userId, ip) {
  getDb()
    .prepare(`UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?`)
    .run(nowSeconds(), ip, userId);
}

export function createSession({ tokenHash, userId, ip, userAgent, expiresAt }) {
  getDb()
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(tokenHash, userId, ip, userAgent, expiresAt, nowSeconds());
}

export function findSession(tokenHash) {
  return getDb().prepare(`SELECT * FROM sessions WHERE token_hash = ?`).get(tokenHash);
}

export function touchSession(id) {
  getDb().prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(nowSeconds(), id);
}

export function revokeSession(tokenHash) {
  getDb().prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`).run(nowSeconds(), tokenHash);
}

export function revokeAllSessions(userId) {
  getDb().prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(nowSeconds(), userId);
}

export function purgeExpiredSessions() {
  getDb().prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(nowSeconds() - 86400 * 30);
}

export function listSessions(userId) {
  return getDb()
    .prepare(
      `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
         FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(userId);
}

export function recordLoginAttempt({ username, ip, success, reason }) {
  getDb()
    .prepare(`INSERT INTO login_attempts (username, ip, success, reason) VALUES (?, ?, ?, ?)`)
    .run(username, ip, success ? 1 : 0, reason || null);
}

export function recentFailures(key, seconds) {
  const since = nowSeconds() - seconds;
  return getDb()
    .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE (username = ? OR ip = ?) AND success = 0 AND created_at > ?`)
    .get(key, key, since).n;
}

export function writeAudit({ userId, username, action, target, detail, ip, result = 'success' }) {
  getDb()
    .prepare(
      `INSERT INTO audit_logs (user_id, username, action, target, detail, ip, result) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId || null, username || null, action, target || null, detail ? JSON.stringify(detail) : null, ip || null, result);
}

export function listAudit({ limit = 100, offset = 0, action } = {}) {
  const where = action ? `WHERE action = ?` : '';
  const params = action ? [action, limit, offset] : [limit, offset];
  return getDb()
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params);
}

export function recordDshRun({ userId, username, action, pid, note }) {
  getDb()
    .prepare(`INSERT INTO dsh_runs (user_id, username, action, pid, note) VALUES (?, ?, ?, ?, ?)`)
    .run(userId || null, username || null, action, pid || null, note || null);
}

export function listDshRuns(limit = 20) {
  return getDb().prepare(`SELECT * FROM dsh_runs ORDER BY id DESC LIMIT ?`).all(limit);
}

export function listRoles() {
  return getDb()
    .prepare(
      `SELECT r.id, r.code, r.name, r.description, r.is_system,
              COALESCE(GROUP_CONCAT(p.code), '') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        GROUP BY r.id ORDER BY r.id`
    )
    .all()
    .map((r) => ({ ...r, permissions: r.permissions ? r.permissions.split(',') : [] }));
}

export function listPermissions() {
  return getDb().prepare(`SELECT code, module, description FROM permissions ORDER BY module, code`).all();
}

/** 全量覆盖某个角色的权限（不在 permissions 表里的 code 直接忽略） */
export function setRolePermissions(roleCode, permCodes) {
  const db = getDb();
  const role = db.prepare(`SELECT id FROM roles WHERE code = ?`).get(roleCode);
  if (!role) return false;

  const valid = new Set(db.prepare(`SELECT code FROM permissions`).all().map((p) => p.code));
  const codes = Array.isArray(permCodes) ? permCodes.filter((c) => valid.has(String(c))) : [];

  const clear = db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`);
  const insert = db.prepare(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT ?, id FROM permissions WHERE code = ?`
  );
  const run = db.transaction(() => {
    clear.run(role.id);
    for (const c of codes) insert.run(role.id, String(c));
  });
  run();
  return true;
}
