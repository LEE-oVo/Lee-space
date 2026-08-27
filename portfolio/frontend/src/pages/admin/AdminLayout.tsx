import { useEffect } from 'react';
import { Layout, Menu, Button, Modal, Typography, message } from 'antd';
import {
  FileOutlined,
  VideoCameraOutlined,
  KeyOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearToken, getToken } from '../../api/client';

const { Header, Sider, Content } = Layout;

/** 后台布局：登录守卫 + 侧边菜单导航 */
export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  // 登录守卫：无 token 一律跳登录页
  useEffect(() => {
    if (!getToken()) {
      navigate('/admin/login', { replace: true });
    }
  }, [navigate, location]);

  if (!getToken()) return null;

  const selected = location.pathname.startsWith('/admin/videos')
    ? '/admin/videos'
    : location.pathname.startsWith('/admin/password')
      ? '/admin/password'
      : '/admin/files';

  const logout = () => {
    Modal.confirm({
      title: '确认退出登录？',
      onOk: () => {
        clearToken();
        message.success('已退出登录');
        navigate('/admin/login', { replace: true });
      },
    });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={60}>
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, padding: '18px 12px', textAlign: 'center' }}>
          作品管理后台
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          onClick={({ key }) => navigate(key)}
          items={[
            { key: '/admin/files', icon: <FileOutlined />, label: '文件管理' },
            { key: '/admin/videos', icon: <VideoCameraOutlined />, label: '视频管理' },
            { key: '/admin/password', icon: <KeyOutlined />, label: '修改密码' },
          ]}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Typography.Text strong>个人作品管理系统</Typography.Text>
          <div>
            <Button type="link" onClick={() => window.open('/', '_blank')}>
              查看前台站点
            </Button>
            <Button type="text" danger icon={<LogoutOutlined />} onClick={logout}>
              退出登录
            </Button>
          </div>
        </Header>
        <Content style={{ margin: 20 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
