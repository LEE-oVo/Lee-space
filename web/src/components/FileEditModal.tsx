import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../lib/files';
import type { FileCategory, FileItem } from '../types';

interface Props {
  file: FileItem;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function FileEditModal({ file, onClose, onSaved, onDeleted }: Props) {
  const [name, setName] = useState(file.name);
  const [category, setCategory] = useState<FileCategory>(file.category);
  const [tags, setTags] = useState(file.tags.join('、'));
  const [note, setNote] = useState(file.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.updateFile(file.id, {
        name: name.trim() || file.name,
        category,
        tags: tags.split(/[、,，\s]+/).filter(Boolean).slice(0, 8),
        note: note.trim(),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`删除「${file.name}」？文件会从服务器彻底移除，不可恢复。`)) return;
    setBusy(true);
    try {
      await api.deleteFile(file.id);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setBusy(false);
    }
  }

  return (
    <Modal title="编辑文件信息" subtitle={file.name} onClose={onClose}>
      {error && <div className="alert error">{error}</div>}

      <form onSubmit={save}>
        <div className="field">
          <label>名称</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <label>分类</label>
          <div className="row wrap" style={{ gap: 6 }}>
            {CATEGORY_ORDER.map((c) => (
              <button
                key={c}
                type="button"
                className={`btn sm${c === category ? ' primary' : ''}`}
                onClick={() => setCategory(c)}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>标签</label>
          <input
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="用顿号或逗号分隔，如：2026、校级"
          />
        </div>

        <div className="field">
          <label>备注</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={14} />}
            保存
          </button>
          <button className="btn" type="button" onClick={onClose}>取消</button>
          <button className="btn danger" type="button" onClick={() => void remove()} disabled={busy}>
            <Icon name="trash" size={14} />
            删除文件
          </button>
        </div>
      </form>
    </Modal>
  );
}
