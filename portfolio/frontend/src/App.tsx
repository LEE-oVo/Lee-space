import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import SiteLayout from './pages/site/SiteLayout';
import Home from './pages/site/Home';
import Files from './pages/site/Files';
import Videos from './pages/site/Videos';

// 后台页面按需加载，减小前台首屏体积
const AdminLogin = lazy(() => import('./pages/admin/Login'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const FileManage = lazy(() => import('./pages/admin/FileManage'));
const VideoManage = lazy(() => import('./pages/admin/VideoManage'));
const PasswordPage = lazy(() => import('./pages/admin/Password'));

const FullSpin = (
  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
    <Spin size="large" />
  </div>
);

/**
 * 路由规划：
 *   /            访客前台（首页 / 文件展示 / 视频展示）
 *   /admin       管理后台（JWT 鉴权，未登录跳转登录页）
 */
export default function App() {
  return (
    <Suspense fallback={FullSpin}>
      <Routes>
        {/* ---------- 访客前台 ---------- */}
        <Route element={<SiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/files" element={<Files />} />
          <Route path="/videos" element={<Videos />} />
        </Route>

        {/* ---------- 管理后台 ---------- */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/files" replace />} />
          <Route path="files" element={<FileManage />} />
          <Route path="videos" element={<VideoManage />} />
          <Route path="password" element={<PasswordPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
