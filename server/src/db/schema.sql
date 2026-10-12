-- 个人工作台 数据库结构（SQLite）
-- 设计目标：RBAC 权限模型，后期可平滑增加角色与权限点，无需改动业务代码

PRAGMA foreign_keys = ON;

-- 用户
CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  username         TEXT    NOT NULL UNIQUE,
  email            TEXT    UNIQUE,
  password_hash    TEXT    NOT NULL,
  display_name     TEXT    NOT NULL DEFAULT '',
  avatar_color     TEXT    NOT NULL DEFAULT '#7F77DD',
  status           TEXT    NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'disabled', 'locked')),
  failed_count     INTEGER NOT NULL DEFAULT 0,
  locked_until     INTEGER,
  last_login_at    INTEGER,
  last_login_ip    TEXT,
  created_at       INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at       INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 角色
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- 权限点（新增功能时在此插一行，再分配给角色）
CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  module      TEXT    NOT NULL DEFAULT 'general',
  description TEXT    NOT NULL DEFAULT ''
);

-- 用户 <-> 角色（多对多，一个用户可兼任多角色）
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  PRIMARY KEY (user_id, role_id)
);

-- 角色 <-> 权限
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 登录会话（只存 token 哈希，明文不下落）
CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT    NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip          TEXT,
  user_agent  TEXT,
  expires_at  INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 登录尝试（用于防爆破）
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT,
  ip         TEXT,
  success    INTEGER NOT NULL DEFAULT 0,
  reason     TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(username, created_at);

-- 操作审计
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT,
  action     TEXT    NOT NULL,
  target     TEXT,
  detail     TEXT,
  ip         TEXT,
  result     TEXT    NOT NULL DEFAULT 'success',
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- DSH 启停记录
CREATE TABLE IF NOT EXISTS dsh_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT,
  action     TEXT    NOT NULL,
  pid        INTEGER,
  note       TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_dsh_runs_created ON dsh_runs(created_at);

-- 键值配置（预留，供后续功能扩展）
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_by INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- ---------- 基金行情分析 ----------
-- 说明：本模块只做「存储 + 展示」，行情获取与判断由 WorkBuddy 定时任务调用大模型完成，
--       结果通过 POST /wb-api/funds/ingest 写入。

-- 持仓基础信息（用户在工作台页面维护）
CREATE TABLE IF NOT EXISTS fund_holdings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  category   TEXT,
  cost       REAL,
  shares     REAL,
  amount     REAL,
  note       TEXT,
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_fund_holdings_status ON fund_holdings(status);

-- 每日操作建议（定时任务写入，同一基金同一交易日覆盖）
CREATE TABLE IF NOT EXISTS fund_advice (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL,
  trade_date   TEXT    NOT NULL,
  action       TEXT    NOT NULL CHECK (action IN ('buy', 'add', 'hold', 'reduce', 'sell')),
  confidence   TEXT    CHECK (confidence IN ('low', 'medium', 'high')),
  nav          REAL,
  nav_date     TEXT,
  estimate     REAL,
  estimate_pct REAL,
  nav_pct      REAL,
  summary      TEXT,
  reason       TEXT,
  risks        TEXT,
  sources      TEXT,
  stale        INTEGER NOT NULL DEFAULT 0,
  model        TEXT,
  created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_advice_unique ON fund_advice(code, trade_date);
CREATE INDEX IF NOT EXISTS idx_fund_advice_date ON fund_advice(trade_date);

-- 每日整体结论（市场简述 + 生成来源）
CREATE TABLE IF NOT EXISTS fund_daily (
  trade_date TEXT PRIMARY KEY,
  summary    TEXT,
  market     TEXT,
  model      TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
