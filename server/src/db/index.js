import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { hashPassword } from '../lib/password.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(database) {
  database.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  seedBaseline(database);
}

const PERMISSIONS = [
  ['overview:view', 'overview', '查看工作台概览'],
  ['dsh:access', 'dsh', '进入 DeepSeek Harness'],
  ['dsh:start', 'dsh', '启动 DSH 服务'],
  ['dsh:stop', 'dsh', '停止 DSH 服务'],
  ['system:view', 'system', '查看服务器资源状态'],
  ['user:manage', 'user', '管理用户'],
  ['role:manage', 'role', '管理角色与权限'],
  ['audit:read', 'audit', '查看审计日志'],
];

const ROLES = [
  ['admin', '管理员', '拥有全部权限', 1, PERMISSIONS.map((p) => p[0])],
  ['operator', '操作者', '可使用 DSH 并查看系统状态', 1, ['overview:view', 'dsh:access', 'dsh:start', 'dsh:stop', 'system:view']],
  ['viewer', '只读用户', '只读，仅能查看概览', 1, ['overview:view']],
  // 游客：免登录进入，不能启停 DSH、不能看系统资源与任何管理功能
  ['guest', '游客', '免登录，仅可查看概览并进入已启动的 DSH', 1, ['overview:view', 'dsh:access']],
];

export function seedBaseline(database) {
  const insertPerm = database.prepare(
    `INSERT INTO permissions (code, module, description) VALUES (?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET module = excluded.module, description = excluded.description`
  );
  const insertRole = database.prepare(
    `INSERT INTO roles (code, name, description, is_system) VALUES (?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description`
  );
  const roleId = database.prepare(`SELECT id FROM roles WHERE code = ?`);
  const permId = database.prepare(`SELECT id FROM permissions WHERE code = ?`);
  const link = database.prepare(
    `INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)
     ON CONFLICT(role_id, permission_id) DO NOTHING`
  );

  const insertUser = database.prepare(
    `INSERT INTO users (username, email, password_hash, display_name, avatar_color, status)
     VALUES (?, ?, ?, ?, ?, 'active')`
  );
  const linkUserRole = database.prepare(
    `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)
     ON CONFLICT(user_id, role_id) DO NOTHING`
  );

  const run = database.transaction(() => {
    for (const [code, module, desc] of PERMISSIONS) insertPerm.run(code, module, desc);
    for (const [code, name, desc, isSystem, perms] of ROLES) {
      insertRole.run(code, name, desc, isSystem);
      const rid = roleId.get(code).id;
      for (const p of perms) {
        const pid = permId.get(p);
        if (pid) link.run(rid, pid.id);
      }
    }

    // 游客账号：密码设为一次性随机串，任何人都无法用密码登录，只能走 /auth/guest
    const existing = database.prepare(`SELECT id FROM users WHERE username = ?`).get(config.guestUsername);
    if (!existing) {
      const id = insertUser.run(
        config.guestUsername,
        null,
        hashPassword(randomBytes(32).toString('hex')),
        '游客',
        '#888780'
      ).lastInsertRowid;
      const guestRole = roleId.get('guest');
      if (guestRole) linkUserRole.run(id, guestRole.id);
    } else {
      const guestRole = roleId.get('guest');
      if (guestRole) linkUserRole.run(existing.id, guestRole.id);
    }
  });
  run();
}

export default getDb;
