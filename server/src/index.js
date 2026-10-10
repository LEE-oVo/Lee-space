import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { purgeExpiredSessions } from './db/repo.js';
import { attachUser, resolveUser, hasPermission } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import dshRoutes from './routes/dsh.js';
import adminRoutes from './routes/admin.js';
import systemRoutes from './routes/system.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(__dirname, '..', '..', 'web', 'dist');

getDb();
purgeExpiredSessions();

const app = express();
if (config.trustProxy) app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

// 注意：/api 前缀已整段让给 DeepSeek Harness（Nginx 反代到 127.0.0.1:3080），
// 工作台自身接口统一使用 /wb-api，避免两者路径冲突。
app.get('/wb-api/health', (_req, res) => res.json({ ok: true, service: 'lee-workbench', time: Date.now() }));

// Nginx auth_request 专用：不返回 body，仅用状态码表达结果
// 401 = 未登录，403 = 无权限，200 = 放行
app.get('/__auth', (req, res) => {
  try {
    const user = resolveUser(req);
    if (!user) return res.status(401).end();
    const scope = String(req.headers['x-auth-scope'] || '');
    if (scope.includes('dsh') && !hasPermission(user, 'dsh:access')) {
      return res.status(403).end();
    }
    return res.status(200).end();
  } catch {
    return res.status(500).end();
  }
});

app.use('/wb-api/auth', authRoutes);
app.use('/wb-api/dsh', dshRoutes);
app.use('/wb-api/admin', adminRoutes);
app.use('/wb-api/system', systemRoutes);

app.use('/wb-api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: '7d' }));
  app.get('*', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => res.status(503).type('text/plain').send('前端资源未部署：' + WEB_DIST));
}

const timer = setInterval(() => {
  try { purgeExpiredSessions(); } catch { /* ignore */ }
}, 60 * 60 * 1000);
timer.unref();

app.listen(config.port, '127.0.0.1', () => {
  console.log(`[workbench] 后端已启动 http://127.0.0.1:${config.port}`);
  console.log(`[workbench] 数据库 ${config.dbPath}`);
  console.log(`[workbench] 前端目录 ${WEB_DIST}`);
});
