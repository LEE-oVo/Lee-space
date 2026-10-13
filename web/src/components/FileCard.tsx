import { useRef } from 'react';
import type { MouseEvent } from 'react';
import { Icon } from './Icon';
import type { FileItem } from '../types';
import { CATEGORY_LABEL, fileThumbUrl } from '../lib/files';
import { formatBytes } from '../lib/format';

interface Props {
  file: FileItem;
  index: number;
  canManage: boolean;
  onOpen: (rect: DOMRect) => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** 鼠标位置驱动的 3D 倾斜 + 光泽，用 CSS 变量传给样式表 */
const TILT = 7;

export function FileCard({ file, index, canManage, onOpen, onEdit, onDelete }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);

  const isImage = file.mime.startsWith('image/');
  const thumb = isImage ? fileThumbUrl(file) : null;
  const ratio = file.width && file.height ? file.height / file.width : null;

  function move(e: MouseEvent<HTMLDivElement>) {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${(px * TILT * 2).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${(-py * TILT * 2).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  }

  function reset() {
    const el = wrapRef.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--mx', '50%');
    el.style.setProperty('--my', '50%');
  }

  return (
    <div className="fcard-wrap" style={{ '--i': index } as React.CSSProperties}>
      <div
        ref={wrapRef}
        className={`fcard${isImage ? '' : ' doc'}`}
        onMouseMove={move}
        onMouseLeave={reset}
        onClick={() => {
          const rect = mediaRef.current?.getBoundingClientRect();
          if (rect) onOpen(rect);
        }}
      >
        <div
          ref={mediaRef}
          className="fcard-media"
          style={ratio ? { paddingTop: `${Math.min(140, ratio * 100)}%` } : undefined}
        >
          {thumb ? (
            <img src={thumb} alt={file.name} loading="lazy" />
          ) : (
            <div className="fcard-ph">
              <Icon name="audit" size={26} />
              <span>{file.ext.replace('.', '').toUpperCase() || 'FILE'}</span>
            </div>
          )}
          <span className="fcard-shine" />
          <span className="fcard-cat">{CATEGORY_LABEL[file.category]}</span>
        </div>

        <div className="fcard-body">
          <div className="fcard-name">{file.name}</div>
          <div className="fcard-meta">
            <span>{formatBytes(file.size)}</span>
            {file.tags.length > 0 && <span className="faint">· {file.tags.join(' / ')}</span>}
          </div>
        </div>

        {canManage && (
          <div className="fcard-actions" onClick={(e) => e.stopPropagation()}>
            <button className="btn ghost sm" onClick={onEdit} title="编辑信息">
              <Icon name="edit" size={13} />
            </button>
            <button className="btn ghost sm" onClick={onDelete} title="删除">
              <Icon name="trash" size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
