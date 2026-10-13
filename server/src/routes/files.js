import { Router } from 'express';
import multer from 'multer';
import { requirePermission, denyGuest, clientIp } from '../middleware/auth.js';
import { writeAudit } from '../db/repo.js';
import { config } from '../config.js';
import {
  commitTemp, contentDisposition, deleteFileRow, ensureDirs, extOf, getFileRow,
  insertFile, isAllowed, listFiles, quotaBytes, removeStore, storePath, tmpDir,
  totalBytes, updateFileMeta,
} from '../services/files.js';

const router = Router();
ensureDirs();

const MAX_BYTES = config.fileMaxMb * 1024 * 1024;
const CATEGORIES = ['resume', 'certificate', 'award', 'other'];

const upload = multer({
  dest: tmpDir(),
  limits: { fileSize: MAX_BYTES, files: 2, fields: 12 },
});

function cleanup(req) {
  const files = req.files || {};
  for (const arr of Object.values(files)) {
    for (const f of arr || []) {
      // eslint-disable-next-line no-unused-expressions
      (async () => {
        try {
          const { unlink } = await import('node:fs/promises');
          await unlink(f.path);
        } catch { /* ignore */ }
      })();
    }
  }
}

function audit(req, action, target, detail = '') {
  writeAudit({
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    action,
    target,
    detail,
    ip: clientIp(req),
  });
}

router.get('/', requirePermission('file:view'), denyGuest, (req, res) => {
  const files = listFiles({
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
  });
  res.json({
    files,
    quota: { used: totalBytes(), max: quotaBytes(), maxFileBytes: MAX_BYTES },
    categories: CATEGORIES,
  });
});

router.post(
  '/',
  requirePermission('file:upload'),
  denyGuest,
  (req, res, next) => {
    upload.fields([
      { name: 'file', maxCount: 1 },
      { name: 'thumb', maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        const tooBig = err?.code === 'LIMIT_FILE_SIZE';
        cleanup(req);
        return res
          .status(tooBig ? 413 : 400)
          .json({ error: tooBig ? `单个文件不能超过 ${config.fileMaxMb} MB` : '上传失败' });
      }
      next();
    });
  },
  async (req, res) => {
    const file = req.files?.file?.[0];
    const thumbFile = req.files?.thumb?.[0];
    if (!file) {
      cleanup(req);
      return res.status(400).json({ error: '没有收到文件' });
    }

    const ext = extOf(file.originalname);
    if (!isAllowed(ext, file.mimetype)) {
      cleanup(req);
      return res.status(415).json({ error: `不支持的文件类型：${ext || '未知'}（仅图片与 PDF）` });
    }

    const used = totalBytes();
    if (used + file.size > quotaBytes()) {
      cleanup(req);
      return res.status(413).json({
        error: `空间不足：已用 ${(used / 1048576).toFixed(1)} MB，上限 ${config.fileQuotaMb} MB`,
      });
    }

    let category = String(req.body?.category || 'other');
    if (!CATEGORIES.includes(category)) category = 'other';

    let tags = [];
    if (req.body?.tags) {
      try {
        const parsed = JSON.parse(String(req.body.tags));
        if (Array.isArray(parsed)) tags = parsed.map((t) => String(t).slice(0, 24)).slice(0, 8);
      } catch { /* 忽略非法 tags */ }
    }

    try {
      const store = await commitTemp(file.path, ext);
      let thumb = null;
      if (thumbFile) {
        thumb = await commitTemp(thumbFile.path, '.jpg');
      }
      const now = Math.floor(Date.now() / 1000);
      const id = insertFile({
        name: String(req.body?.name || file.originalname || '未命名').slice(0, 120),
        store,
        thumb,
        ext,
        mime: file.mimetype,
        size: file.size,
        width: Number(req.body?.width) || null,
        height: Number(req.body?.height) || null,
        category,
        tags: JSON.stringify(tags),
        note: String(req.body?.note || '').slice(0, 500),
        uploaderId: req.user?.id ?? null,
        uploader: req.user?.username ?? '',
        now,
      });
      audit(req, 'file.upload', String(id), `${(file.size / 1024).toFixed(0)} KB ${category}`);
      return res.json({ ok: true, id });
    } catch (err) {
      cleanup(req);
      return res.status(500).json({ error: '保存文件失败' });
    }
  }
);

// 原文件 / 缩略图：一律过鉴权，不放进 Nginx 静态目录
function sendStored(kind) {
  return (req, res) => {
    const row = getFileRow(req.params.id);
    if (!row) return res.status(404).json({ error: '文件不存在' });
    const target = kind === 'thumb' ? row.thumb : row.store;
    if (!target) return res.status(404).json({ error: '没有缩略图' });

    const inline = kind === 'thumb' ? true : req.query.dl !== '1';
    res.setHeader('Content-Type', kind === 'thumb' ? 'image/jpeg' : row.mime);
    res.setHeader('Content-Disposition', contentDisposition(kind === 'thumb' ? `${row.name}.thumb.jpg` : row.name, inline));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(storePath(target));
  };
}

router.get('/:id/raw', requirePermission('file:view'), denyGuest, sendStored('raw'));
router.get('/:id/thumb', requirePermission('file:view'), denyGuest, sendStored('thumb'));

router.patch('/:id', requirePermission('file:manage'), denyGuest, (req, res) => {
  const row = getFileRow(req.params.id);
  if (!row) return res.status(404).json({ error: '文件不存在' });
  const patch = {};
  if (req.body?.name !== undefined) patch.name = String(req.body.name).slice(0, 120) || row.name;
  if (req.body?.note !== undefined) patch.note = String(req.body.note).slice(0, 500);
  if (req.body?.category !== undefined && CATEGORIES.includes(req.body.category)) {
    patch.category = req.body.category;
  }
  if (Array.isArray(req.body?.tags)) {
    patch.tags = req.body.tags.map((t) => String(t).slice(0, 24)).slice(0, 8);
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
  updateFileMeta(req.params.id, patch);
  audit(req, 'file.update', String(row.id), row.name);
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('file:manage'), denyGuest, async (req, res) => {
  const row = getFileRow(req.params.id);
  if (!row) return res.status(404).json({ error: '文件不存在' });
  await removeStore(row.store);
  if (row.thumb) await removeStore(row.thumb);
  deleteFileRow(row.id);
  audit(req, 'file.delete', String(row.id), row.name);
  res.json({ ok: true, freed: row.size });
});

export default router;
