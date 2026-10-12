import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { formatRelative } from '../lib/format';
import type { RoleRecord, WorkbenchUser } from '../types';

export function UsersPage() {
  const [users, setUsers] = useState<WorkbenchUser[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', roles: ['viewer'] as string[] });

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([api.listUsers(), api.roles()]);
      setUsers(u.users);
      setRoles(r.roles);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createUser() {
    setError('');
    try {
      await api.createUser({
        username: form.username,
        password: form.password,
        displayName: form.displayName || form.username,
        roles: form.roles,
      });
      setNotice(`用户 ${form.username} 已创建`);
      setCreating(false);
      setForm({ username: '', password: '', displayName: '', roles: ['viewer'] });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  }

  async function patch(id: number, payload: Record<string, unknown>) {
    try {
      await api.updateUser(id, payload);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    }
  }

  async function disable(id: number) {
    try {
      await api.deleteUser(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  function toggleRole(role: string) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
    }));
  }

  return (
    <div className="page">
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 500 }}>用户</div>
          <button className="btn primary sm" onClick={() => setCreating((v) => !v)}>
            <Icon name={creating ? 'collapse' : 'play'} size={14} />
            {creating ? '取消' : '新建用户'}
          </button>
        </div>

        {creating && (
          <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 14, marginBottom: 8, animation: 'page-in 0.24s var(--ease)' }}>
            <div className="grid cols-3">
              <div className="field">
                <label>用户名</label>
                <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="3-32 位" />
              </div>
              <div className="field">
                <label>显示名</label>
                <input className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </div>
              <div className="field">
                <label>初始密码</label>
                <input className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="至少 10 位，含字母与数字" />
              </div>
            </div>
            <div className="field">
              <label>角色</label>
              <div className="row wrap">
                {roles.map((r) => (
                  <button
                    key={r.code}
                    className={`btn sm${form.roles.includes(r.code) ? ' primary' : ''}`}
                    onClick={() => toggleRole(r.code)}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn primary" onClick={() => void createUser()}>创建</button>
          </div>
        )}

        <div className="table-wrap wide">
          <table className="data">
          <thead>
            <tr>
              <th style={{ width: 200 }}>用户</th>
              <th>角色</th>
              <th style={{ width: 110 }}>状态</th>
              <th style={{ width: 150 }}>最近登录</th>
              <th style={{ width: 130 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="row">
                    <div className="avatar" style={{ background: u.avatarColor }}>{u.displayName.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight: 500 }}>{u.displayName}</div>
                      <div className="faint" style={{ fontSize: 11 }}>@{u.username}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {u.roles.length === 0 && <span className="faint">未分配</span>}
                    {u.roles.map((r) => (
                      <span className="pill" key={r}>{roles.find((x) => x.code === r)?.name || r}</span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`pill ${u.status === 'active' ? 'ok' : 'bad'}`}>
                    {u.status === 'active' ? '启用' : '停用'}
                  </span>
                </td>
                <td>
                  <div style={{ fontSize: 12 }}>{formatRelative(u.lastLoginAt)}</div>
                  <div className="faint" style={{ fontSize: 11 }}>{u.lastLoginIp || '—'}</div>
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn ghost sm"
                      onClick={() => void patch(u.id, { status: u.status === 'active' ? 'disabled' : 'active' })}
                    >
                      {u.status === 'active' ? '停用' : '启用'}
                    </button>
                    {u.status === 'active' && (
                      <button className="btn ghost sm" onClick={() => void disable(u.id)} title="停用该用户并注销其会话">
                        <Icon name="logout" size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 500, marginBottom: 10 }}>角色与权限矩阵</div>
        <div className="table-wrap wide">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 120 }}>角色</th>
              <th style={{ width: 220 }}>说明</th>
              <th>权限</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.code}>
                <td>
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                  <div className="faint mono" style={{ fontSize: 11 }}>{r.code}</div>
                </td>
                <td className="muted">{r.description}</td>
                <td>
                  <div className="row wrap" style={{ gap: 5 }}>
                    {r.permissions.map((p) => (
                      <span className="pill" key={p} style={{ fontSize: 11 }}>{p}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
