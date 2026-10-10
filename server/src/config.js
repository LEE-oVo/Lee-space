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
  isProd: process.env.NODE_ENV !== 'development',
};

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
