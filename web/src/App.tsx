import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Icon } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { ThemePicker } from './components/ThemePicker';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { DshPage } from './pages/DshPage';
import { SystemPage } from './pages/SystemPage';
import { FundsPage } from './pages/FundsPage';
import { FundSettingsPage } from './pages/FundSettingsPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { FilesPage } from './pages/FilesPage';
import { UsersPage } from './pages/UsersPage';
import { AuditPage } from './pages/AuditPage';
import { SettingsPage } from './pages/SettingsPage';

const TITLES: Record<string, string> = {
  '/': '首页',
  '/harness': 'DeepSeek Harness',
  '/system': '系统状态',
  '/funds': '基金行情',
  '/funds/settings': '基金持仓配置',
  '/funds/evaluation': '决策复盘',
  '/files': '文件库',
  '/users': '用户与角色',
  '/audit': '审计日志',
  '/settings': '外观与设置',
};

export function App() {
  const { user, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  // 小屏下侧边栏是抽屉，默认收起，点遮罩或切换页面自动关闭
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  const title = useMemo(() => TITLES[location.pathname] || '工作台', [location.pathname]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

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
    <div className={`app-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        onNavigate={() => setDrawerOpen(false)}
      />
      <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button
            className="btn ghost sm topbar-menu"
            onClick={() => setDrawerOpen((v) => !v)}
            title={drawerOpen ? '关闭菜单' : '打开菜单'}
            aria-label={drawerOpen ? '关闭菜单' : '打开菜单'}
          >
            <Icon name={drawerOpen ? 'close' : 'menu'} size={19} />
          </button>
          <h1>{title}</h1>
          <span className="spacer" />
          <ThemePicker />
        </header>
        <main className="content">
          <ErrorBoundary>
            <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/harness" element={<DshPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/funds" element={<FundsPage />} />
            <Route path="/funds/settings" element={<FundSettingsPage />} />
            <Route path="/funds/evaluation" element={<EvaluationPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
