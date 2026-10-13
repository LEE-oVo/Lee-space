import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { CATEGORY_LABEL, fileDownloadUrl, fileRawUrl } from '../lib/files';
import { formatBytes, formatDateTime } from '../lib/format';
import type { FileItem } from '../types';

interface Props {
  files: FileItem[];
  startIndex: number;
  /** 打开动画的起点：被点击卡片的位置，用于 FLIP 过渡 */
  fromRect: DOMRect | null;
  onClose: () => void;
}

const DURATION = 420;

export function Lightbox({ files, startIndex, fromRect, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [entered, setEntered] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const file = files[index];

  // FLIP：先把舞台摆到目标位置，再用 transform 从卡片位置飞过去
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function go(delta: number) {
    setZoomed(false);
    setIndex((i) => (i + delta + files.length) % files.length);
  }

  function close() {
    setEntered(false);
    window.setTimeout(onClose, DURATION);
  }

  // 目标尺寸（居中、按视口收缩），初始 transform 把舞台拉回卡片位置
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const maxW = vw * 0.86;
  const maxH = vh * 0.78;
  const ratio = file?.width && file?.height ? file.height / file.width : 0.72;
  let tw = Math.min(maxW, file?.width || maxW);
  let th = tw * ratio;
  if (th > maxH) {
    th = maxH;
    tw = th / ratio;
  }
  const tx = (vw - tw) / 2;
  const ty = (vh - th) / 2 - 18;

  const flip = fromRect
    ? `translate(${(fromRect.left - tx).toFixed(1)}px, ${(fromRect.top - ty).toFixed(1)}px) scale(${(fromRect.width / tw).toFixed(4)}, ${(fromRect.height / th).toFixed(4)})`
    : 'scale(0.94)';

  return (
    <div className={`lb-backdrop${entered ? ' on' : ''}`} onClick={close}>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lb-title">{file?.name}</span>
        <span className="faint" style={{ fontSize: 12 }}>
          {index + 1} / {files.length}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => setZoomed((v) => !v)} title="缩放">
          <Icon name="search" size={15} />
        </button>
        <a className="btn ghost sm" href={fileDownloadUrl(file)} title="下载">
          <Icon name="cloud" size={15} />
        </a>
        <button className="btn ghost sm" onClick={close} title="关闭（Esc）">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div
        ref={stageRef}
        className="lb-stage"
        style={{
          left: tx,
          top: ty,
          width: tw,
          height: th,
          transform: entered ? 'none' : flip,
          transitionDuration: `${DURATION}ms`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {file?.mime.startsWith('image/') ? (
          <img
            key={file.id}
            className={`lb-img${zoomed ? ' zoomed' : ''}`}
            src={fileRawUrl(file)}
            alt={file.name}
          />
        ) : (
          <iframe className="lb-doc" src={fileRawUrl(file)} title={file.name} />
        )}
      </div>

      {files.length > 1 && (
        <>
          <button className="lb-nav prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="上一张">
            <Icon name="chevLeft" size={22} />
          </button>
          <button className="lb-nav next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="下一张">
            <Icon name="chevRight" size={22} />
          </button>
        </>
      )}

      <div className="lb-info" onClick={(e) => e.stopPropagation()}>
        <span className="pill">{CATEGORY_LABEL[file?.category || 'other']}</span>
        <span className="faint" style={{ fontSize: 12 }}>
          {formatBytes(file?.size || 0)} · {file?.width && file?.height ? `${file.width}×${file.height} · ` : ''}
          {formatDateTime(file?.createdAt)}
        </span>
        {file?.note && <span className="faint" style={{ fontSize: 12 }}>{file.note}</span>}
      </div>
    </div>
  );
}
