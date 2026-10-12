import { useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from './Icon';
import { Modal } from './Modal';
import type { PermissionRecord, RoleRecord } from '../types';
import { MODULE_LABEL, permissionLabel } from '../lib/permissions';

interface Props {
  role: RoleRecord;
  permissions: PermissionRecord[];
  onClose: () => void;
  onSaved: (roles: RoleRecord[]) => void;
}

export function RolePermissionsModal({ role, permissions, onClose, onSaved }: Props) {
  const [selected, setSelected] = useState<string[]>(() => [...role.permissions]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionRecord[]>();
    for (const p of permissions) {
      const list = map.get(p.module) || [];
      list.push(p);
      map.set(p.module, list);
    }
    return [...map.entries()];
  }, [permissions]);

  function toggle(code: string) {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await api.updateRolePermissions(role.code, selected);
      onSaved(res.roles);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  const removed = role.permissions.filter((p) => !selected.includes(p));
  const added = selected.filter((p) => !role.permissions.includes(p));

  return (
    <Modal
      title={`编辑角色权限 · ${role.name}`}
      subtitle={<span className="mono">{role.code}</span>}
      onClose={onClose}
    >
      {error && <div className="alert error">{error}</div>}

      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        勾选该角色拥有的权限。权限按请求实时生效，已登录的用户下一次操作就会用上新权限，无需重新登录。
      </div>

      <div className="perm-groups">
        {grouped.map(([module, list]) => (
          <div className="perm-group" key={module}>
            <div className="perm-group-title">{MODULE_LABEL[module] || module}</div>
            <div className="row wrap" style={{ gap: 6 }}>
              {list.map((p) => {
                const on = selected.includes(p.code);
                return (
                  <button
                    key={p.code}
                    className={`btn sm${on ? ' primary' : ''}`}
                    onClick={() => toggle(p.code)}
                    title={p.code}
                  >
                    {on ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
                    {permissionLabel(p)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {(added.length > 0 || removed.length > 0) && (
        <div className="perm-diff">
          {added.length > 0 && (
            <div>
              新增 {added.length} 项：
              {added
                .map((c) => permissionLabel(permissions.find((p) => p.code === c)))
                .join('、')}
            </div>
          )}
          {removed.length > 0 && (
            <div>
              移除 {removed.length} 项：
              {removed
                .map((c) => permissionLabel(permissions.find((p) => p.code === c)))
                .join('、')}
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 16 }}>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name="check" size={14} />}
          保存
        </button>
        <button className="btn" onClick={onClose}>取消</button>
        <span className="faint" style={{ fontSize: 12 }}>
          已选 {selected.length} / {permissions.length} 项
        </span>
      </div>
    </Modal>
  );
}
