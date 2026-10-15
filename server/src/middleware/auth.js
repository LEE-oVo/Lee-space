import { timingSafeEqual } from 'node:crypto';
import { config, nowSeconds } from '../config.js';
import { findSession, getUserById, getRolesAndPermissions, touchSession } from '../db/repo.js';
import { hashToken, SESSION_COOKIE } from '../lib/session.js';

export function resolveUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const session = findSession(hashToken(token));
  if (!session) return null;
  if (session.revoked_at) return null;
  if (session.expires_at < nowSeconds()) return null;

  const user = getUserById(session.user_id);
  if (!user) return null;
  if (user.status !== 'active') return null;
  if (user.locked_until && user.locked_until > nowSeconds()) return null;

  const { roles, permissions } = getRolesAndPermissions(user.id);
  if (nowSeconds() - (session.last_seen_at || 0) > 30) touchSession(session.id);

  req.sessionId = session.id;
  req.sessionRow = session;
  req.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name || user.username,
    avatarColor: user.avatar_color,
    roles,
    permissions,
    isGuest: roles.includes('guest'),
    lastLoginAt: user.last_login_at,
    lastLoginIp: user.last_login_ip,
  };
  return req.user;
}

export function attachUser(req, _res, next) {
  try {
    resolveUser(req);
  } catch {
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  next();
}

export function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!req.user.permissions.includes(code)) {
      return res.status(403).json({ error: `缺少权限：${code}` });
    }
    next();
  };
}

export function hasPermission(user, code) {
  return Boolean(user && Array.isArray(user.permissions) && user.permissions.includes(code));
}

// 游客护栏：用于那些「登录即可访问」但不应暴露给游客的接口
export function denyGuest(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  if (req.user.isGuest) return res.status(403).json({ error: '游客不可访问该功能' });
  next();
}

function bearerMatches(header, token) {
  if (!token) return false;
  const given = Buffer.from(String(header).trim());
  const expect = Buffer.from(token);
  if (given.length !== expect.length) return false;
  return timingSafeEqual(given, expect);
}

// 基金建议写入：使用独立令牌而不是登录会话。
// 令牌只授予「写建议 + 读持仓」，即使泄露也无法操作服务器或访问其他接口。
//
// 多工具隔离的关键：来源由「用哪个令牌」唯一决定，不接受任务里自报 source。
// 令牌→来源的映射写在 FUND_INGEST_TOKENS 里，这里只做反查——
// 接入新模型不需要改这个文件，配一个新令牌即可
export function requireFundIngest(req, res, next) {
  const entries = Object.entries(config.fundIngestTokens || {});
  if (!entries.length) {
    return res.status(503).json({ error: '服务端未配置 FUND_INGEST_TOKEN(S)，写入接口已关闭' });
  }

  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '缺少 Bearer 令牌' });
  }
  const presented = header.slice(7).trim();
  if (!presented) return res.status(401).json({ error: '缺少 Bearer 令牌' });

  for (const [source, token] of entries) {
    if (bearerMatches(presented, token)) {
      req.fundSource = source;
      return next();
    }
  }
  return res.status(401).json({ error: '令牌无效' });
}

// 账本写入（结算）比写建议更危险：会真的改份额和成本。
// 在令牌之外再加一层来源白名单，用于「角色分离」——
// 例如 FUND_SETTLE_SOURCES=trae 时，WorkBuddy 的令牌只能投建议、动不了账本。
export function requireFundSettle(req, res, next) {
  const allow = config.fundSettleSources;
  if (allow.length && !allow.includes(req.fundSource)) {
    return res.status(403).json({
      error: `当前来源（${req.fundSource || '未知'}）无账本写入权限`,
      allowedSources: allow,
    });
  }
  next();
}

export function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

export function setSessionCookie(res, token, maxAge = config.sessionTtlSeconds) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookie,
    path: '/',
    maxAge: maxAge * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}
