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

-- ---------- 个人文件库 ----------
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,          -- 展示用的原始文件名
  store       TEXT    NOT NULL UNIQUE,   -- 磁盘上的存储名（UUID+扩展名，绝不直接用原名拼路径）
  thumb       TEXT,                      -- 缩略图存储名（浏览器端生成后一并上传）
  ext         TEXT    NOT NULL,
  mime        TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  category    TEXT    NOT NULL DEFAULT 'other' CHECK (category IN ('resume', 'certificate', 'award', 'other')),
  tags        TEXT,                      -- JSON 字符串数组
  note        TEXT,
  uploader_id INTEGER,
  uploader    TEXT,
  created_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_at DESC);
-- 说明：本模块只做「存储 + 展示」，行情获取与判断由 WorkBuddy 定时任务调用大模型完成，
--       结果通过 POST /wb-api/funds/ingest 写入。

-- 持仓基础信息（用户在工作台页面维护）
CREATE TABLE IF NOT EXISTS fund_holdings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  category   TEXT,
  -- 持仓由买入批次推导，下面三个是缓存值（结算后刷新）
  cost       REAL,
  shares     REAL,
  amount     REAL,
  -- 累计已实现盈亏（卖出结算累计）
  realized   REAL    NOT NULL DEFAULT 0,
  -- 费率：申购费率百分比；赎回费率按持有天数分档，JSON：
  -- [{"days":7,"fee":1.5},{"days":30,"fee":0.5},{"days":null,"fee":0}]
  purchase_fee   REAL NOT NULL DEFAULT 0,
  redemption_fee TEXT,
  fee_source     TEXT,
  fee_updated_at INTEGER,
  -- 初始建仓日（用户填，缺省按净值序列起点估算）：赎回费按持有天数分档，估短了会算贵一档
  first_buy_date TEXT,
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
  -- 建议金额（元）：正数=买入/加仓，负数=减仓/卖出，0 或空=维持不动
  amount       REAL,
  -- 用户是否按建议实际操作了，供模型回看真实仓位变化
  executed     INTEGER NOT NULL DEFAULT 0,
  -- 结算：用当日收盘净值算出真实份额与费用后回填，settled=1 保证幂等
  settled        INTEGER NOT NULL DEFAULT 0,
  settled_nav    REAL,
  settled_shares REAL,
  settled_fee    REAL,
  settled_amount REAL,
  settled_realized REAL,
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
  -- 建议来源：workbuddy（本机任务）/ trae（Trae Work 云端任务）。
  -- 建议层允许多来源并存对比；账本层（份额/成本/盈亏）始终只有一份
  source       TEXT    NOT NULL DEFAULT 'workbuddy',
  -- 结算由哪一端完成，仅作追溯；账本只结算一次
  settled_source TEXT,
  created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
-- 唯一键含 source：同一天同一只基金允许存在两个工具的各一份建议，各自覆盖更新
CREATE INDEX IF NOT EXISTS idx_fund_advice_date ON fund_advice(trade_date);
-- 另外两个索引引用 source 列，对老库来说该列还没 ALTER 出来，
-- 放在 schema.sql 里会直接报错——统一由 db/index.js 的补列逻辑在 ALTER 之后创建

-- 买入批次：卖出时按先进先出逐笔结清，才能算准持有天数与赎回费
CREATE TABLE IF NOT EXISTS fund_lots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL,
  buy_date   TEXT    NOT NULL,
  nav        REAL    NOT NULL,          -- 买入当日净值
  amount     REAL    NOT NULL,          -- 实付申购金额（含费）
  shares     REAL    NOT NULL,          -- 买入份额
  unit_cost  REAL    NOT NULL,          -- 该批单位成本（含费）
  fee        REAL    NOT NULL DEFAULT 0, -- 申购费
  remain     REAL    NOT NULL,          -- 剩余份额
  source     TEXT,                       -- 'advice' | 'manual' | 'import'
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_fund_lots_code ON fund_lots(code, buy_date);

-- 净值序列（用于走势图）：由定时任务随建议一起写入，服务端按天累积
CREATE TABLE IF NOT EXISTS fund_nav (
  code       TEXT    NOT NULL,
  nav_date   TEXT    NOT NULL,
  nav        REAL    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  PRIMARY KEY (code, nav_date)
);
CREATE INDEX IF NOT EXISTS idx_fund_nav_date ON fund_nav(nav_date);

-- 每日整体结论（市场简述 + 生成来源）
-- 主键含 source：两只工具各自的市场判断都留着，页面按来源切换着看
CREATE TABLE IF NOT EXISTS fund_daily (
  trade_date TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'workbuddy',
  summary    TEXT,
  market     TEXT,
  model      TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  PRIMARY KEY (trade_date, source)
);

-- 盘中估值快照：由服务端定时程序统一拉取，每只基金一行。
-- 为什么不交给模型自己拉：行情接口的可用性高度依赖出口网络（本机常被挡、服务器通），
-- 各家拿到的数不一样、还常常是拼凑出来的。统一在服务端拉，模型只读结果。
CREATE TABLE IF NOT EXISTS fund_quote (
  code          TEXT    PRIMARY KEY,
  nav           REAL,             -- 折算基准：最近一期净值
  nav_date      TEXT,
  estimate      REAL,             -- 折算出的盘中估算净值
  estimate_pct  REAL,             -- 估算涨跌幅（百分点）
  method        TEXT,             -- official（官方估值）/ proxy（代理标的折算）
  proxy         TEXT,             -- 代理标的说明，如「腾讯·细分有色指数」
  proxy_price   REAL,
  proxy_pct     REAL,
  beta          REAL,             -- 净值对代理标的的回归系数，补偿联接基金的现金仓位
  trading       INTEGER NOT NULL DEFAULT 0, -- 抓取当时是否处于盘中
  as_of         INTEGER,          -- 行情时间戳
  updated_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
