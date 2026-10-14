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

loadEnvFile(path.join(__dirname, '..', '..', '.env'));

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
  // 未配置时 ingest 接口直接关闭（返回 503），避免开着无鉴权的写接口。
  fundIngestToken: process.env.FUND_INGEST_TOKEN || '',
  // Trae Work 专用令牌：与主令牌分开，服务端据此自动判定建议来源，也便于单独吊销
  fundIngestTokenTrae: process.env.FUND_INGEST_TOKEN_TRAE || '',
  // 允许写账本（/settle）的来源，逗号分隔；留空 = 不限制。
  // 角色分离时设成 trae，WorkBuddy 本机任务就只出建议、动不了账本
  fundSettleSources: String(process.env.FUND_SETTLE_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // 同一基金同一天多个来源都给了建议时的入账优先级（账本只有一本，只认排在最前的那个）。
  // manual 是用户自己补记的真实操作，永远最可信
  fundSettlePriority: String(process.env.FUND_SETTLE_PRIORITY || 'manual,trae,workbuddy')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // 低于这个金额不值得下单：额度剩余不足时直接判持有，而不是拆出一笔零头
  fundMinAddAmount: Number(process.env.FUND_MIN_ADD || 10),
  isProd: process.env.NODE_ENV !== 'development',
};

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
