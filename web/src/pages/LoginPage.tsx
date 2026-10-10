import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';

export function LoginPage() {
  const { login, loginAsGuest } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  async function enterAsGuest() {
    setError('');
    setGuestBusy(true);
    try {
      await loginAsGuest();
    } catch (err) {
      setError(err instanceof Error ? err.message : '游客进入失败');
    } finally {
      setGuestBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <div className="brand-mark" />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Lee&apos;s 工作台</div>
            <div className="faint" style={{ fontSize: 12 }}>登录后可进入全部功能</div>
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="field mt-24">
          <label htmlFor="username">用户名</label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">密码</label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name="shield" size={16} />}
          {busy ? '登录中…' : '登录'}
        </button>

        <div className="guest-divider"><span>或</span></div>

        <button
          className="btn guest-btn"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => void enterAsGuest()}
          disabled={guestBusy || busy}
        >
          {guestBusy ? <span className="spinner" /> : <Icon name="external" size={16} />}
          {guestBusy ? '进入中…' : '以游客身份进入'}
        </button>

        <div className="guest-note">
          游客无需密码，可查看概览并在 DSH 已启动时进入使用；<br />
          不能启停服务，也看不到系统资源与任何管理功能。
        </div>

        <div className="faint" style={{ fontSize: 11, marginTop: 14, textAlign: 'center' }}>
          连续失败 5 次将锁定 15 分钟
        </div>
      </form>
    </div>
  );
}
