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
  ensureFundAdviceColumns(database);
  ensureFundHoldingColumns(database);
  ensureFundDailySource(database);
  ensureSingleExecuted(database);
  seedBaseline(database);
}

/**
 * 「执行」是单条互斥的：同一只基金同一天最多只能有一条 executed=1。
 * 那条就是我当天真实做的操作，加减仓记录和账本都只认它——
 * 多个工具/模型各给各的建议没问题，但采纳只能选其中一个，选了别的就自动落选。
 * 这样以后再加工具也不会出现「同一天记了两笔」的事故。
 *
 * 唯一性用部分索引在数据库层强制，应用层再怎么改都绕不过去。
 */
function ensureSingleExecuted(database) {
  // 老数据里同一天可能有多条 executed=1（旧语义是整天一起改），先按入账优先级
  // 挑真正结算过的那条保留，其余落选。建索引前必须清干净，否则索引会建失败
  const dup = database
    .prepare(
      `SELECT code, trade_date, COUNT(*) n FROM fund_advice
        WHERE executed = 1 GROUP BY code, trade_date HAVING n > 1`
    )
    .all();
  if (dup.length > 0) {
    const pick = database.prepare(
      `SELECT id, IFNULL(source,'workbuddy') AS source FROM fund_advice
        WHERE code = ? AND trade_date = ? AND executed = 1 ORDER BY id`
    );
    const demote = database.prepare(`UPDATE fund_advice SET executed = 0, updated_at = ? WHERE id = ?`);
    const t = Math.floor(Date.now() / 1000);
    const order = config.fundSettlePriority;
    const rank = (s) => {
      const i = order.indexOf(s);
      return i >= 0 ? i : order.length + 1;
    };
    database.transaction(() => {
      for (const d of dup) {
        const rows = pick.all(d.code, d.trade_date);
        // 保留入账优先级最高的那条（通常与账本里真正结算的一致），其余置未执行
        const winner = rows.reduce((m, r) => (rank(r.source) < rank(m.source) ? r : m));
        for (const r of rows) if (r.id !== winner.id) demote.run(t, r.id);
      }
    })();
  }

  const idx = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_fund_advice_executed'`)
    .get();
  if (!idx) {
    database.exec(
      `CREATE UNIQUE INDEX idx_fund_advice_executed ON fund_advice(code, trade_date) WHERE executed = 1`
    );
  }
}

function addColumn(database, table, column, ddl) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// 老库补列：schema.sql 用的是 CREATE TABLE IF NOT EXISTS，
// 已存在的表不会因为新增字段而重建，需要显式 ALTER
function ensureFundAdviceColumns(database) {
  const cols = database.prepare(`PRAGMA table_info(fund_advice)`).all();
  const has = (name) => cols.some((c) => c.name === name);
  if (!has('amount')) database.exec(`ALTER TABLE fund_advice ADD COLUMN amount REAL`);
  if (!has('executed')) {
    database.exec(`ALTER TABLE fund_advice ADD COLUMN executed INTEGER NOT NULL DEFAULT 0`);
  }
  addColumn(database, 'fund_advice', 'settled', 'settled INTEGER NOT NULL DEFAULT 0');
  addColumn(database, 'fund_advice', 'settled_nav', 'settled_nav REAL');
  addColumn(database, 'fund_advice', 'settled_shares', 'settled_shares REAL');
  addColumn(database, 'fund_advice', 'settled_fee', 'settled_fee REAL');
  addColumn(database, 'fund_advice', 'settled_amount', 'settled_amount REAL');
  addColumn(database, 'fund_advice', 'settled_realized', 'settled_realized REAL');
  addColumn(database, 'fund_advice', 'source', "source TEXT NOT NULL DEFAULT 'workbuddy'");
  addColumn(database, 'fund_advice', 'settled_source', 'settled_source TEXT');

  // 唯一键从 (code, trade_date) 扩成 (code, trade_date, source)。
  // 老索引同名但定义不同，CREATE IF NOT EXISTS 会直接跳过，必须先 DROP 再建
  const idx = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_fund_advice_unique'`)
    .get();
  if (!idx || !String(idx.sql || '').includes('source')) {
    database.exec(`DROP INDEX IF EXISTS idx_fund_advice_unique`);
    database.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_advice_unique ON fund_advice(code, trade_date, source)`
    );
  }
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_fund_advice_date_source ON fund_advice(trade_date, source)`
  );
}

/**
 * fund_daily 老库主键是 trade_date 单列，装不下「同一天两个来源各一份结论」。
 * 这里补上 source 列并把主键扩成 (trade_date, source)。
 * SQLite 改不了已有主键，只能建新表搬迁再改名——整个搬迁放在一个事务里，
 * 中途失败会自动回滚，不会留下半张表。
 */
function ensureFundDailySource(database) {
  addColumn(database, 'fund_daily', 'source', "source TEXT NOT NULL DEFAULT 'workbuddy'");

  const cols = database.prepare(`PRAGMA table_info(fund_daily)`).all();
  const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name);
  const alreadyComposite = pkCols.length >= 2 && pkCols.includes('source');
  if (alreadyComposite) return;

  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      database.exec(`DROP TABLE IF EXISTS fund_daily_new`);
      database.exec(
        `CREATE TABLE fund_daily_new (
           trade_date TEXT NOT NULL,
           source     TEXT NOT NULL DEFAULT 'workbuddy',
           summary    TEXT,
           market     TEXT,
           model      TEXT,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           PRIMARY KEY (trade_date, source)
         )`
      );
      database.exec(
        `INSERT INTO fund_daily_new (trade_date, source, summary, market, model, created_at, updated_at)
         SELECT trade_date, IFNULL(source, 'workbuddy'), summary, market, model, created_at, updated_at
           FROM fund_daily`
      );
      database.exec(`DROP TABLE fund_daily`);
      database.exec(`ALTER TABLE fund_daily_new RENAME TO fund_daily`);
    })();
  } finally {
    database.pragma('foreign_keys = ON');
  }
}

function ensureFundHoldingColumns(database) {
  addColumn(database, 'fund_holdings', 'realized', 'realized REAL NOT NULL DEFAULT 0');
  addColumn(database, 'fund_holdings', 'purchase_fee', 'purchase_fee REAL NOT NULL DEFAULT 0');
  addColumn(database, 'fund_holdings', 'redemption_fee', 'redemption_fee TEXT');
  addColumn(database, 'fund_holdings', 'fee_source', 'fee_source TEXT');
  addColumn(database, 'fund_holdings', 'fee_updated_at', 'fee_updated_at INTEGER');
  addColumn(database, 'fund_holdings', 'first_buy_date', 'first_buy_date TEXT');
  addColumn(database, 'fund_holdings', 'quote_sources', 'quote_sources TEXT');
  addColumn(database, 'fund_holdings', 'quote_beta', 'quote_beta REAL');
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
  ['fund:view', 'fund', '查看基金行情与操作建议'],
  ['fund:detail', 'fund', '查看详细分析与持仓金额'],
  ['fund:manage', 'fund', '维护基金持仓基础信息'],
  ['file:view', 'file', '浏览与下载文件库'],
  ['file:upload', 'file', '上传文件'],
  ['file:manage', 'file', '修改或删除文件'],
];

const ROLES = [
  ['admin', '管理员', '拥有全部权限', 1, PERMISSIONS.map((p) => p[0])],
  ['operator', '操作者', '可使用 DSH、系统状态、基金行情与文件库', 1, ['overview:view', 'dsh:access', 'dsh:start', 'dsh:stop', 'system:view', 'fund:view', 'fund:detail', 'fund:manage', 'file:view', 'file:upload', 'file:manage']],
  ['viewer', '只读用户', '只读，仅能查看概览', 1, ['overview:view']],
  // 游客：免登录进入，能看到基金行情列表与操作建议，但看不到持仓金额与详细分析
  ['guest', '游客', '免登录，可查看概览、进入已启动的 DSH 与浏览基金行情', 1, ['overview:view', 'dsh:access', 'fund:view']],
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
