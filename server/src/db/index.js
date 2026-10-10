import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

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
  ['viewer', '访客', '只读，仅能查看概览', 1, ['overview:view']],
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
  });
  run();
}

export default getDb;
