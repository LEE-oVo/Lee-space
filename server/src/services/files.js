import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { config } from '../config.js';

// 允许的类型：图片 + PDF（与前端保持一致，后端再校验一次，不信任浏览器）
export const ALLOWED = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  '.gif': ['image/gif'],
  '.heic': ['image/heic', 'image/heif', 'application/octet-stream'],
  '.pdf': ['application/pdf'],
};

export function extOf(name) {
  const m = String(name || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function isAllowed(ext, mime) {
  const list = ALLOWED[ext];
  if (!list) return false;
  return list.includes(String(mime || '').toLowerCase());
}

/** 磁盘路径：按 UUID 前两位分片，避免单目录文件过多 */
export function storePath(store) {
  return path.join(config.fileDir, store.slice(0, 2), store);
}

export function ensureDirs() {
  const tmp = path.join(config.fileDir, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  for (let i = 0; i < 256; i += 1) {
    // 只建十六进制前缀目录（UUID 前两位）
    const hex = i.toString(16).padStart(2, '0');
    fs.mkdirSync(path.join(config.fileDir, hex), { recursive: true });
  }
  return tmp;
}

export function tmpDir() {
  return path.join(config.fileDir, 'tmp');
}

export function newStoreName(ext) {
  return `${randomUUID()}${ext}`;
}

/** 把 multer 落地的临时文件挪到分片目录，返回存储名；失败时清理临时文件 */
export async function commitTemp(tempPath, ext) {
  const store = newStoreName(ext);
  const target = storePath(store);
  try {
    await fsp.rename(tempPath, target);
    return store;
  } catch {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(tempPath, target);
    return store;
  }
}

export async function removeStore(store) {
  if (!store) return;
  try {
    await fsp.unlink(storePath(store));
  } catch {
    /* 文件已不存在时忽略 */
  }
}

export function totalBytes() {
  const row = getDb().prepare(`SELECT COALESCE(SUM(size), 0) AS total FROM files`).get();
  return row?.total || 0;
}

export function quotaBytes() {
  return config.fileQuotaMb * 1024 * 1024;
}

function parseTags(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapFile(row) {
  return {
    id: row.id,
    name: row.name,
    ext: row.ext,
    mime: row.mime,
    size: row.size,
    width: row.width || null,
    height: row.height || null,
    category: row.category || 'other',
    tags: parseTags(row.tags),
    note: row.note || '',
    hasThumb: Boolean(row.thumb),
    uploader: row.uploader || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listFiles({ category, tag, q, limit = 200 } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (category && category !== 'all') {
    where.push('category = @category');
    params.category = category;
  }
  if (q) {
    where.push('(name LIKE @q OR note LIKE @q OR tags LIKE @q)');
    params.q = `%${q}%`;
  }
  const sql = `SELECT * FROM files ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY created_at DESC LIMIT @limit`;
  params.limit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const rows = db.prepare(sql).all(params);
  const list = rows.map(mapFile);
  if (tag) return list.filter((f) => f.tags.includes(tag));
  return list;
}

export function getFileRow(id) {
  return getDb().prepare(`SELECT * FROM files WHERE id = ?`).get(Number(id));
}

export function insertFile(row) {
  const db = getDb();
  const info = db.prepare(
    `INSERT INTO files (name, store, thumb, ext, mime, size, width, height, category, tags, note, uploader_id, uploader, created_at, updated_at)
     VALUES (@name, @store, @thumb, @ext, @mime, @size, @width, @height, @category, @tags, @note, @uploaderId, @uploader, @now, @now)`
  ).run(row);
  return Number(info.lastInsertRowid);
}

export function updateFileMeta(id, patch) {
  const db = getDb();
  const sets = [];
  const params = { id: Number(id), now: Math.floor(Date.now() / 1000) };
  const map = { name: 'name', category: 'category', note: 'note', tags: 'tags' };
  for (const [key, column] of Object.entries(map)) {
    if (patch[key] === undefined) continue;
    sets.push(`${column} = @${key}`);
    params[key] = key === 'tags' ? JSON.stringify(patch[key] || []) : patch[key];
  }
  if (sets.length === 0) return false;
  sets.push('updated_at = @now');
  return db.prepare(`UPDATE files SET ${sets.join(', ')} WHERE id = @id`).run(params).changes > 0;
}

export function deleteFileRow(id) {
  return getDb().prepare(`DELETE FROM files WHERE id = ?`).run(Number(id)).changes > 0;
}

/** 内容协商下载名：RFC 5987，兼容中文文件名 */
export function contentDisposition(name, inline) {
  const ascii = String(name || 'file').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(String(name || 'file'));
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
