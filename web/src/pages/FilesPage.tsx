import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { UploadZone } from '../components/UploadZone';
import { FileCard } from '../components/FileCard';
import { Lightbox } from '../components/Lightbox';
import { FileEditModal } from '../components/FileEditModal';
import { CATEGORY_LABEL, CATEGORY_ORDER, fileDownloadUrl, fileThumbUrl } from '../lib/files';
import { formatBytes, formatRelative } from '../lib/format';
import type { FileCategory, FileItem, FileQuota } from '../types';

type ViewMode = 'masonry' | 'grid' | 'list';

export function FilesPage() {
  const { can } = useAuth();
  const canUpload = can('file:upload');
  const canManage = can('file:manage');

  const [files, setFiles] = useState<FileItem[]>([]);
  const [quota, setQuota] = useState<FileQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [category, setCategory] = useState<FileCategory | 'all'>('all');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<ViewMode>('masonry');
  // 每次筛选变化都换容器 key，让卡片重新播放入场动画
  const [renderKey, setRenderKey] = useState(0);

  const [lightbox, setLightbox] = useState<{ index: number; rect: DOMRect | null } | null>(null);
  const [editing, setEditing] = useState<FileItem | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.files();
      setFiles(res.files);
      setQuota(res.quota);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) for (const t of f.tags) set.add(t);
    return [...set].sort();
  }, [files]);

  const visible = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return files.filter((f) => {
      if (category !== 'all' && f.category !== category) return false;
      if (tag && !f.tags.includes(tag)) return false;
      if (keyword && !`${f.name} ${f.note} ${f.tags.join(' ')}`.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [files, category, tag, q]);

  function applyFilter(next: Partial<{ category: FileCategory | 'all'; tag: string; q: string }>) {
    if (next.category !== undefined) setCategory(next.category);
    if (next.tag !== undefined) setTag(next.tag);
    if (next.q !== undefined) setQ(next.q);
    setRenderKey((v) => v + 1);
  }

  async function removeFile(file: FileItem) {
    if (!window.confirm(`删除「${file.name}」？文件会从服务器彻底移除，不可恢复。`)) return;
    try {
      await api.deleteFile(file.id);
      setNotice('文件已删除');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  }

  const usedPct = quota && quota.max ? Math.min(100, (quota.used / quota.max) * 100) : 0;

  return (
    <div className="page">
      <div className="card hoverable files-head">
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 14 }}>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <Icon name="audit" size={17} />
              <span style={{ fontSize: 17, fontWeight: 600 }}>文件库</span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {files.length} 个文件 · {formatBytes(quota?.used || 0)}
              {quota ? ` / ${formatBytes(quota.max)}` : ''}
            </div>
          </div>

          <div className="row" style={{ gap: 6 }}>
            <div className="seg">
              {(['masonry', 'grid', 'list'] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  className={`seg-item${v === view ? ' active' : ''}`}
                  onClick={() => {
                    setView(v);
                    setRenderKey((k) => k + 1);
                  }}
                >
                  {v === 'masonry' ? '瀑布流' : v === 'grid' ? '网格' : '列表'}
                </button>
              ))}
            </div>
            <button className="btn ghost sm" onClick={() => void load()} title="刷新">
              <Icon name="refresh" size={15} />
            </button>
          </div>
        </div>

        {quota && (
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <div className="progress" style={{ flex: 1 }}>
              <div className="progress-bar" style={{ width: `${usedPct}%` }} />
            </div>
            <span className="faint" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              已用 {usedPct.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      {canUpload && quota && (
        <UploadZone maxBytes={quota.maxFileBytes} onUploaded={() => void load()} />
      )}

      <div className="files-filters">
        <div className="row wrap" style={{ gap: 6, flex: 1 }}>
          <button
            className={`chip${category === 'all' ? ' on' : ''}`}
            onClick={() => applyFilter({ category: 'all' })}
          >
            全部 {files.length}
          </button>
          {CATEGORY_ORDER.map((c) => {
            const n = files.filter((f) => f.category === c).length;
            if (n === 0 && category !== c) return null;
            return (
              <button
                key={c}
                className={`chip${category === c ? ' on' : ''}`}
                onClick={() => applyFilter({ category: c })}
              >
                {CATEGORY_LABEL[c]} {n}
              </button>
            );
          })}
        </div>
        <input
          className="input files-search"
          value={q}
          onChange={(e) => applyFilter({ q: e.target.value })}
          placeholder="搜索文件名、标签、备注"
        />
      </div>

      {allTags.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
          {allTags.map((t) => (
            <button
              key={t}
              className={`chip sm${tag === t ? ' on' : ''}`}
              onClick={() => applyFilter({ tag: tag === t ? '' : t })}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="mason">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="fcard-wrap" key={i}>
              <div className="fcard">
                <div className="skeleton" style={{ height: 120 }} />
                <div className="fcard-body">
                  <div className="skeleton" style={{ width: '70%' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="files-empty">
          <div className="files-empty-ring">
            <Icon name="audit" size={28} />
          </div>
          <div style={{ fontWeight: 500, marginTop: 12 }}>
            {files.length === 0 ? '文件库还是空的' : '当前筛选没有匹配的文件'}
          </div>
          <div className="faint" style={{ fontSize: 13, marginTop: 4 }}>
            {files.length === 0
              ? canUpload
                ? '把简历、证书、奖状拖到上面的区域，或点击选择文件'
                : '等待管理员上传文件'
              : '换个分类或清空搜索试试'}
          </div>
        </div>
      ) : view === 'list' ? (
        <div className="file-list" key={renderKey}>
          {visible.map((f, i) => (
            <div className="file-row" key={f.id} style={{ '--i': i } as React.CSSProperties}>
              <div
                className="file-row-thumb"
                onClick={(e) => setLightbox({ index: i, rect: e.currentTarget.getBoundingClientRect() })}
              >
                {fileThumbUrl(f) ? (
                  <img src={fileThumbUrl(f)} alt={f.name} loading="lazy" />
                ) : (
                  <Icon name="audit" size={18} />
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="fcard-name">{f.name}</div>
                <div className="fcard-meta">
                  <span className="pill" style={{ fontSize: 11 }}>{CATEGORY_LABEL[f.category]}</span>
                  <span>{formatBytes(f.size)}</span>
                  <span className="faint">{formatRelative(f.createdAt)}</span>
                </div>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <a className="btn ghost sm" href={fileDownloadUrl(f)} title="下载">
                  <Icon name="cloud" size={14} />
                </a>
                {canManage && (
                  <>
                    <button className="btn ghost sm" onClick={() => setEditing(f)} title="编辑">
                      <Icon name="edit" size={14} />
                    </button>
                    <button className="btn ghost sm" onClick={() => void removeFile(f)} title="删除">
                      <Icon name="trash" size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={view === 'masonry' ? 'mason' : 'fgrid'} key={renderKey}>
          {visible.map((f, i) => (
            <FileCard
              key={f.id}
              file={f}
              index={i}
              canManage={canManage}
              onOpen={(rect) => setLightbox({ index: i, rect })}
              onEdit={() => setEditing(f)}
              onDelete={() => void removeFile(f)}
            />
          ))}
        </div>
      )}

      {lightbox && visible.length > 0 && (
        <Lightbox
          files={visible}
          startIndex={lightbox.index}
          fromRect={lightbox.rect}
          onClose={() => setLightbox(null)}
        />
      )}

      {editing && (
        <FileEditModal
          file={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setNotice('已保存');
            void load();
          }}
          onDeleted={() => {
            setNotice('文件已删除');
            void load();
          }}
        />
      )}
    </div>
  );
}
