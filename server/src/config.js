import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // 无 .env 文件时静默跳过，全部使用环境变量
  }
}

// .env 可能放在 server/ 下（部署约定，systemd 也用 EnvironmentFile 读它），
// 也可能放在仓库根（本地开发）。两个位置都试，已存在的环境变量优先。
// 之前只认仓库根那一个，独立脚本（排查、体检）会读不到令牌，只有 systemd 拉起的服务正常
for (const rel of ['..', path.join('..', '..')]) {
  loadEnvFile(path.join(__dirname, rel, '.env'));
}

// 令牌 → 来源。两种写法都认，混用也行：
//   1) FUND_INGEST_TOKENS="workbuddy:wbk_aaa,trae:wbk_bbb,glm:wbk_ccc"  ← 推荐
//      再接入新工具只改这一行，不用动代码
//   2) FUND_INGEST_TOKEN=xxx / FUND_INGEST_TOKEN_TRAE=yyy                ← 旧写法，兼容保留
// 来源名就是映射里的 key（小写）。服务端只按「用哪个令牌」反查来源，
// 任务 payload 里自报 source 一律忽略——否则模型串了就会把建议写进别人的格子
function parseIngestTokens() {
  const map = {};
  const legacy = {
    workbuddy: process.env.FUND_INGEST_TOKEN || '',
    trae: process.env.FUND_INGEST_TOKEN_TRAE || '',
  };
  for (const [name, token] of Object.entries(legacy)) {
    if (token) map[name] = token;
  }
  for (const part of String(process.env.FUND_INGEST_TOKENS || '').split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const i = seg.indexOf(':');
    if (i <= 0) continue;
    const name = seg.slice(0, i).trim().toLowerCase();
    const token = seg.slice(i + 1).trim();
    if (name && token) map[name] = token;
  }
  return map;
}

// 来源展示名。内置常见来源，其他用 FUND_SOURCE_LABELS="glm:智谱 GLM" 补充/覆盖
const DEFAULT_SOURCE_LABELS = {
  workbuddy: 'WorkBuddy',
  trae: 'Trae Work',
  glm: '智谱 GLM',
  manual: '手动补记',
};

function parseSourceLabels() {
  const labels = { ...DEFAULT_SOURCE_LABELS };
  for (const part of String(process.env.FUND_SOURCE_LABELS || '').split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const i = seg.indexOf(':');
    if (i <= 0) continue;
    const name = seg.slice(0, i).trim().toLowerCase();
    const label = seg.slice(i + 1).trim();
    if (name && label) labels[name] = label;
  }
  return labels;
}

export const config = {
  port: Number(process.env.PORT || 3001),
  dbPath: process.env.DB_PATH || '/opt/workbench/data/workbench.db',
  sessionTtlSeconds: Number(process.env.SESSION_TTL || 60 * 60 * 24 * 7),
  sessionIdleSeconds: Number(process.env.SESSION_IDLE || 60 * 60 * 24 * 30),
  cookieName: 'wb_session',
  secureCookie: String(process.env.SECURE_COOKIE || 'false') === 'true',
  trustProxy: String(process.env.TRUST_PROXY || 'true') === 'true',
  maxFailedLogin: Number(process.env.MAX_FAILED_LOGIN || 5),
  lockSeconds: Number(process.env.LOCK_SECONDS || 60 * 15),
  dshService: process.env.DSH_SERVICE || 'dsh',
  dshLog: process.env.DSH_LOG || '/home/dsh/dsh.log',
  dshPort: Number(process.env.DSH_PORT || 3080),
  publicPath: process.env.PUBLIC_DSH_PATH || '/dsh/',
  // 游客免登录：关闭后登录页不再显示入口，接口也直接拒绝
  guestEnabled: String(process.env.GUEST_ENABLED || 'true') === 'true',
  guestUsername: process.env.GUEST_USERNAME || 'guest',
  // 游客会话比正式登录短很多，避免长期占用
  guestSessionTtlSeconds: Number(process.env.GUEST_SESSION_TTL || 60 * 60 * 12),
  // 同一 IP 在窗口期内最多可领取的游客会话数
  guestRateLimit: Number(process.env.GUEST_RATE_LIMIT || 30),
  guestRateWindowSeconds: Number(process.env.GUEST_RATE_WINDOW || 300),
  // 首页天气：默认城市（服务器所在地，可在 .env 改成自己常驻城市）
  weatherCity: process.env.WEATHER_CITY || '深圳',
  weatherLat: Number(process.env.WEATHER_LAT || 22.54554),
  weatherLon: Number(process.env.WEATHER_LON || 114.0683),
  // 个人文件库：文件一律存在这里，绝不放进 Nginx 静态目录，下载必须过鉴权
  fileDir: process.env.FILE_DIR || '/opt/workbench/data/files',
  // 基金投资约束。默认值只作为兜底，实际值以页面里配的为准（存在 settings 表）。
  // 总投资额：所有基金合计最多投入多少（含已经投进去的），这是唯一硬约束
  fundTotalBudget: Number(process.env.FUND_TOTAL_BUDGET || 15000),
  // 目标收益率（%）：模型据此决定加仓节奏与止盈位置
  fundTargetReturnPct: Number(process.env.FUND_TARGET_RETURN || 15),
  // 每日加仓上限，0 = 不限。默认不限——钱要花在刀刃上而不是被日限额摊平，
  // 真正的约束是上面的总投资额
  fundDailyAddBudget: Number(process.env.FUND_DAILY_ADD_BUDGET || 0),
  // 低于这个金额不值得下单：剩余额度不足时直接判持有，而不是拆出一笔零头
  fundMinAddAmount: Number(process.env.FUND_MIN_ADD || 10),
  fileMaxMb: Number(process.env.FILE_MAX_MB || 20),
  fileQuotaMb: Number(process.env.FILE_QUOTA_MB || 2048),
  // 未配置任何令牌时 ingest 接口直接关闭（返回 503），避免开着无鉴权的写接口。
  // 加新分析工具 = 往这张表里多配一个令牌，代码不用改
  fundIngestTokens: parseIngestTokens(),
  // 旧写法保留：rotate-fund-token.js 与历史脚本仍在用，值就是映射表里同名项
  fundIngestToken: process.env.FUND_INGEST_TOKEN || '',
  fundIngestTokenTrae: process.env.FUND_INGEST_TOKEN_TRAE || '',
  // 页面上怎么称呼每个来源
  fundSourceLabels: parseSourceLabels(),
  // 允许写账本（/settle）的来源，逗号分隔；留空 = 不限制。
  // 角色分离时设成 trae，WorkBuddy 本机任务就只出建议、动不了账本
  fundSettleSources: String(process.env.FUND_SETTLE_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // 低金额门槛：额度剩余不足时直接判持有，而不是拆出一笔零头。
  // 「入账优先级」在「采纳才入账」之后已无实际作用，只在老库兜底路径里用到——
  // 采纳哪条完全由用户在页面点，不需要靠优先级裁决
  fundSettlePriority: String(process.env.FUND_SETTLE_PRIORITY || 'manual,trae,workbuddy')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  isProd: process.env.NODE_ENV !== 'development',
};

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
