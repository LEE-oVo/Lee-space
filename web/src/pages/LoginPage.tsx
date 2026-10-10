import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

        <div className="faint" style={{ fontSize: 11, marginTop: 16, textAlign: 'center' }}>
          连续失败 5 次将锁定 15 分钟
        </div>
      </form>
    </div>
  );
}
