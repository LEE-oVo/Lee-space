// 生成/轮换基金建议写入令牌，写入 .env 的 FUND_INGEST_TOKEN。
// 用法：node src/scripts/rotate-fund-token.js
// 轮换后需要：1) systemctl restart workbench  2) 更新定时任务里的令牌
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '..', '.env');
const token = 'wbk_' + randomBytes(24).toString('base64url');

let content = '';
try {
  content = fs.readFileSync(envPath, 'utf8');
} catch {
  content = '';
}

const lines = content.split(/\r?\n/);
const index = lines.findIndex((l) => /^\s*FUND_INGEST_TOKEN\s*=/.test(l));
if (index >= 0) {
  lines[index] = `FUND_INGEST_TOKEN=${token}`;
  console.log('已替换已有的 FUND_INGEST_TOKEN');
} else {
  if (content && !content.endsWith('\n')) lines.push('');
  lines.push('# 基金建议写入令牌（定时任务专用，仅能写建议 + 读持仓）');
  lines.push(`FUND_INGEST_TOKEN=${token}`);
  console.log('已新增 FUND_INGEST_TOKEN');
}

fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
console.log(`\n新令牌：${token}`);
console.log(`已写入 ${envPath}（权限 600）`);
console.log('\n接下来：');
console.log('  1) sudo systemctl restart workbench');
console.log('  2) 用新令牌更新 WorkBuddy 定时任务中的 Authorization 头');
