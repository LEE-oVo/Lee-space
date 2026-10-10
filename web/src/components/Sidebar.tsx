import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import { useAuth } from '../auth';
import type { User } from '../types';

interface NavEntry {
  to: string;
  label: string;
  icon: string;
  permission?: string;
}

const NAV: Array<{ section: string; items: NavEntry[] }> = [
  {
    section: '工作区',
    items: [
      { to: '/', label: '概览', icon: 'overview', permission: 'overview:view' },
      { to: '/harness', label: 'DeepSeek Harness', icon: 'spark', permission: 'dsh:access' },
      { to: '/system', label: '系统状态', icon: 'cpu', permission: 'system:view' },
    ],
  },
  {
    section: '管理',
    items: [
      { to: '/users', label: '用户与角色', icon: 'users', permission: 'user:manage' },
      { to: '/audit', label: '审计日志', icon: 'audit', permission: 'audit:read' },
    ],
  },
  {
    section: '偏好',
    items: [{ to: '/settings', label: '外观与设置', icon: 'settings' }],
  },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: Props) {
  const { user, can, logout } = useAuth();

  const visible = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="brand">
        <div className="brand-mark" />
        <span className="brand-text">Lee&apos;s 工作台</span>
      </div>

      <nav className="menu">
        {visible.map((group) => (
          <div key={group.section}>
            <div className="menu-section">{group.section}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `menu-item${isActive ? ' active' : ''}`}
                title={item.label}
              >
                <span className="menu-icon">
                  <Icon name={item.icon} size={19} />
                </span>
                <span className="menu-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {user && (
          <div className="row" style={{ padding: '4px 6px 10px' }}>
            <div className="avatar" style={{ background: user.avatarColor }}>
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
            {!collapsed && (
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 6, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13, fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {user.displayName}
                  </div>
                  {user.isGuest && <span className="pill guest-tag">游客</span>}
                </div>
                <div className="faint" style={{ fontSize: 11 }}>
                  {user.roles.join(' / ') || '无角色'}
                </div>
              </div>
            )}
          </div>
        )}
        {user?.isGuest && !collapsed && (
          <div className="faint" style={{ fontSize: 11, padding: '0 6px 8px', lineHeight: 1.5 }}>
            游客模式：不能启停服务，也看不到系统资源与管理功能
          </div>
        )}
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost sm" onClick={onToggle} title={collapsed ? '展开菜单' : '收起菜单'} style={{ flex: 1 }}>
            <Icon name={collapsed ? 'expand' : 'collapse'} size={16} />
            {!collapsed && '收起'}
          </button>
          {!collapsed && (
            <button
              className="btn ghost sm"
              onClick={() => void logout()}
              title={user?.isGuest ? '结束游客浏览，回到登录页' : '退出登录'}
            >
              <Icon name={user?.isGuest ? 'login' : 'logout'} size={16} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

export function initials(user: User | null): string {
  return (user?.displayName || '?').slice(0, 1).toUpperCase();
}
