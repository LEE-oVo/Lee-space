// 生成/轮换某个来源的基金建议写入令牌，写进 .env 的 FUND_INGEST_TOKENS。
//
// 用法：
//   node src/scripts/rotate-fund-token.js            # 默认轮换 workbuddy
//   node src/scripts/rotate-fund-token.js glm        # 给新接入的模型发一个令牌
//
// 令牌 → 来源的映射统一写在 FUND_INGEST_TOKENS="workbuddy:xxx,glm:yyy" 一行里，
// 接入新工具不需要改代码。旧的 FUND_INGEST_TOKEN / FUND_INGEST_TOKEN_TRAE
// 会在首次运行时自动迁移进来。
//
// 轮换后需要：1) systemctl restart workbench  2) 更新该来源定时任务里的令牌
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '..', '.env');

const source = String(process.argv[2] || 'workbuddy').trim().toLowerCase();
if (!/^[a-z0-9_-]{1,20}$/.test(source)) {
  console.error(`来源名不合法：${source}（只能用小写字母、数字、下划线、连字符）`);
  process.exit(1);
}

const token = 'wbk_' + randomBytes(24).toString('base64url');

let content = '';
try {
  content = fs.readFileSync(envPath, 'utf8');
} catch {
  content = '';
}

const unquote = (v) => {
  const s = String(v).trim();
  return (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
    ? s.slice(1, -1)
    : s;
};

// 先把已配置的映射读出来：统一写法优先，旧写法作为迁移来源
const map = new Map();
for (const line of content.split(/\r?\n/)) {
  const m = line.match(/^\s*FUND_INGEST_TOKENS\s*=\s*(.*)\s*$/);
  if (!m) continue;
  for (const seg of unquote(m[1]).split(',')) {
    const part = seg.trim();
    const i = part.indexOf(':');
    if (i <= 0) continue;
    map.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
}
const legacy = { workbuddy: 'FUND_INGEST_TOKEN', trae: 'FUND_INGEST_TOKEN_TRAE' };
for (const [name, key] of Object.entries(legacy)) {
  if (map.has(name)) continue;
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`));
    if (m && unquote(m[1])) map.set(name, unquote(m[1]));
  }
}

const isNew = !map.has(source);
map.set(source, token);

const combined = [...map.entries()].map(([k, v]) => `${k}:${v}`).join(',');
const lines = content.split(/\r?\n/);
const index = lines.findIndex((l) => /^\s*FUND_INGEST_TOKENS\s*=/.test(l));
if (index >= 0) {
  lines[index] = `FUND_INGEST_TOKENS=${combined}`;
} else {
  if (content && !content.endsWith('\n')) lines.push('');
  lines.push('# 基金建议写入令牌：来源:令牌，逗号分隔。定时任务用它写建议、读持仓');
  lines.push('# 接入新模型 = 在这里多加一项，代码不用改。生成：node src/scripts/rotate-fund-token.js <来源>');
  lines.push(`FUND_INGEST_TOKENS=${combined}`);
}

fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });

console.log(`${isNew ? '已新增' : '已轮换'}来源 ${source} 的令牌`);
console.log(`当前映射：${[...map.keys()].join(', ')}`);
console.log(`\n新令牌：${token}`);
console.log(`已写入 ${envPath}（权限 600）`);
console.log('\n接下来：');
console.log('  1) sudo systemctl restart workbench');
console.log(`  2) 用新令牌更新 ${source} 定时任务中的 Authorization 头`);
