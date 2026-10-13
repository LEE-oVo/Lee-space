import { useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from './Icon';
import { makeThumb, readImageMeta } from '../lib/image';
import { formatBytes } from '../lib/format';

interface Props {
  maxBytes: number;
  onUploaded: () => void;
}

interface Task {
  id: string;
  name: string;
  percent: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

const ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.heic,.pdf';

export function UploadZone({ maxBytes, onUploaded }: Props) {
  const [dragging, setDragging] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function patch(id: string, next: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...next } : t)));
  }

  async function handleFiles(list: File[]) {
    for (const file of list) {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setTasks((prev) => [...prev, { id, name: file.name, percent: 0, status: 'uploading' }]);
      try {
        if (file.size > maxBytes) {
          throw new Error(`超过单文件上限 ${formatBytes(maxBytes)}`);
        }
        const meta = file.type.startsWith('image/') ? await readImageMeta(file) : null;
        const thumb = await makeThumb(file);

        const form = new FormData();
        form.append('file', file);
        if (thumb) form.append('thumb', thumb, 'thumb.jpg');
        if (meta) {
          form.append('width', String(meta.width));
          form.append('height', String(meta.height));
        }
        form.append('name', file.name);

        await api.uploadFile(form, (percent) => patch(id, { percent }));
        patch(id, { status: 'done', percent: 100 });
        onUploaded();
      } catch (err) {
        patch(id, { status: 'error', error: err instanceof Error ? err.message : '上传失败' });
      }
    }
  }

  const active = tasks.filter((t) => t.status === 'uploading').length;

  return (
    <div
      className={`dropzone${dragging ? ' dragging' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer?.files?.length) void handleFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      <div className="dropzone-inner">
        <div className="dropzone-ring">
          <Icon name="plus" size={22} />
        </div>
        <div>
          <div style={{ fontWeight: 500 }}>{dragging ? '松手即上传' : '拖拽文件到此处，或点击选择'}</div>
          <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
            图片与 PDF · 单文件 ≤ {formatBytes(maxBytes)} · 缩略图在你浏览器本地生成
          </div>
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="upload-queue" onClick={(e) => e.stopPropagation()}>
          {tasks.map((t) => (
            <div className="upload-task" key={t.id}>
              <span className="upload-name">{t.name}</span>
              {t.status === 'uploading' && (
                <>
                  <div className="progress" style={{ flex: 1 }}>
                    <div className="progress-bar" style={{ width: `${t.percent}%` }} />
                  </div>
                  <span className="faint" style={{ fontSize: 11 }}>{t.percent}%</span>
                </>
              )}
              {t.status === 'done' && <span className="upload-ok"><Icon name="check" size={13} />完成</span>}
              {t.status === 'error' && <span className="upload-err">{t.error}</span>}
            </div>
          ))}
          {tasks.length > 0 && active === 0 && (
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTasks([])}>
              清空记录
            </button>
          )}
        </div>
      )}
    </div>
  );
}
