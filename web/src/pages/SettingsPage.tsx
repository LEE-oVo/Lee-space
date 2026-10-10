import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { useTheme } from '../themes';

export function SettingsPage() {
  const { themes, themeId, setTheme } = useTheme();
  const { user } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setMessage({ type: 'ok', text: '密码已更新' });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '修改失败' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 500 }}>主题</div>
            <div className="faint" style={{ fontSize: 12 }}>切换即时生效，选择会被记住</div>
          </div>
          <Icon name="palette" size={18} />
        </div>

        <div className="grid cols-3">
          {themes.map((t) => (
            <button
              key={t.id}
              className={`theme-option${t.id === themeId ? ' active' : ''}`}
              onClick={() => setTheme(t.id)}
            >
              <span className="theme-swatch">
                {t.swatch.map((c) => (
                  <span key={c} style={{ background: c }} />
                ))}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{t.name}</span>
                <span className="faint" style={{ fontSize: 11 }}>{t.description}</span>
              </span>
              {t.id === themeId && (
                <span className="theme-check"><Icon name="check" size={16} /></span>
              )}
            </button>
          ))}
        </div>

        <div className="faint" style={{ fontSize: 12, marginTop: 14 }}>
          新增主题：在 <code className="mono">src/themes/</code> 下复制一个文件改色值，再在{' '}
          <code className="mono">index.ts</code> 的注册表中加一行即可，业务组件无需改动。
        </div>
      </div>

      <div className="grid cols-2">
        {user?.isGuest ? (
          <div className="card">
            <div style={{ fontWeight: 500, marginBottom: 8 }}>游客模式</div>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              游客账号没有密码，也无需登录，因此不存在修改密码这一项。
              需要使用完整功能时，请退出游客模式后用正式账号登录。
            </p>
          </div>
        ) : (
        <div className="card">
          <div style={{ fontWeight: 500, marginBottom: 12 }}>修改密码</div>
          {message && <div className={`alert ${message.type === 'ok' ? 'ok' : 'error'}`}>{message.text}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label>当前密码</label>
              <input className="input" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required />
            </div>
            <div className="field">
              <label>新密码</label>
              <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </div>
            <div className="field">
              <label>确认新密码</label>
              <input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            <button className="btn primary" disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="shield" size={14} />}
              更新密码
            </button>
          </form>
        </div>
        )}

        <div className="card">
          <div style={{ fontWeight: 500, marginBottom: 12 }}>账号信息</div>
          <table className="data">
            <tbody>
              <tr><td className="muted" style={{ width: 110 }}>用户名</td><td className="mono">{user?.username}</td></tr>
              <tr><td className="muted">显示名</td><td>{user?.displayName}</td></tr>
              <tr><td className="muted">角色</td><td>{user?.roles?.join('、') || '—'}</td></tr>
              <tr>
                <td className="muted">权限数</td>
                <td>{user?.permissions?.length ?? 0} 项</td>
              </tr>
            </tbody>
          </table>
          <div className="faint" style={{ fontSize: 12, marginTop: 12 }}>
            权限项：{user?.permissions?.join('、') || '无'}
          </div>
        </div>
      </div>
    </div>
  );
}
