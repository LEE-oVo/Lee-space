import { Layout, Menu } from 'antd';
import { FileTextOutlined, HomeOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const { Header, Content, Footer } = Layout;

const menuItems = [
  { key: '/', icon: <HomeOutlined />, label: '首页' },
  { key: '/files', icon: <FileTextOutlined />, label: '文件展示' },
  { key: '/videos', icon: <PlayCircleOutlined />, label: '视频展示' },
];

/** 访客前台布局：顶部导航 + 内容区 */
export default function SiteLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
        <div
          style={{ color: '#fff', fontWeight: 600, fontSize: 18, marginRight: 40, cursor: 'pointer', whiteSpace: 'nowrap' }}
          onClick={() => navigate('/')}
        >
          Lee'space
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ flex: 1, minWidth: 0 }}
        />
      </Header>
      <Content style={{ maxWidth: 1100, width: '100%', margin: '0 auto', padding: '24px 16px' }}>
        <Outlet />
      </Content>
      <Footer style={{ textAlign: 'center', color: '#999' }}>
        Lee'space · 个人作品集
      </Footer>
    </Layout>
  );
}
