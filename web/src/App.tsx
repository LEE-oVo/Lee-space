import { useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Sidebar } from './components/Sidebar';
import { ThemePicker } from './components/ThemePicker';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { DshPage } from './pages/DshPage';
import { SystemPage } from './pages/SystemPage';
import { UsersPage } from './pages/UsersPage';
import { AuditPage } from './pages/AuditPage';
import { SettingsPage } from './pages/SettingsPage';

const TITLES: Record<string, string> = {
  '/': '概览',
  '/harness': 'DeepSeek Harness',
  '/system': '系统状态',
  '/users': '用户与角色',
  '/audit': '审计日志',
  '/settings': '外观与设置',
};

export function App() {
  const { user, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const title = useMemo(() => TITLES[location.pathname] || '工作台', [location.pathname]);

  if (loading) {
    return (
      <div className="login-wrap">
        <div className="row" style={{ gap: 10 }}>
          <span className="spinner" />
          <span className="muted">正在验证登录状态…</span>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="app-shell">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <span className="spacer" />
          <ThemePicker />
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/harness" element={<DshPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
