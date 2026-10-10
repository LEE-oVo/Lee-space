import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { formatDuration } from '../lib/format';
import type { DshStatus, SystemStats } from '../types';

export function OverviewPage() {
  const { user, can } = useAuth();
  const [dsh, setDsh] = useState<DshStatus | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);

  const loadDsh = useCallback(async () => {
    try {
      setDsh(await api.dshStatus());
    } catch {
      setDsh(null);
    }
  }, []);

  useEffect(() => {
    void loadDsh();
    const timer = setInterval(loadDsh, 6000);
    return () => clearInterval(timer);
  }, [loadDsh]);

  useEffect(() => {
    if (!can('system:view')) return;
    let alive = true;
    const load = async () => {
      try {
        const s = await api.systemStats();
        if (alive) setStats(s);
      } catch {
        /* 无权限或失败时静默 */
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [can]);

  const memUsed = stats ? stats.mem.totalMb - stats.mem.freeMb : 0;
  const memPct = stats && stats.mem.totalMb ? Math.round((memUsed / stats.mem.totalMb) * 100) : 0;

  return (
    <div className="page">
      <div className="card hoverable" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              你好，{user?.displayName || user?.username}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              当前角色：{user?.roles?.length ? user.roles.join('、') : '未分配'} · 共 {user?.permissions?.length ?? 0} 项权限
            </div>
          </div>
          <div className="row">
            <span className="pill">
              <Icon name="shield" size={13} />
              登录保护已开启
            </span>
          </div>
        </div>
      </div>

      <div className="grid cols-4 mb-12">
        <div className="stat">
          <div className="label">DSH 状态</div>
          <div className="value row" style={{ gap: 8 }}>
            <span className={`dot ${dsh?.running ? 'live' : 'off'}`} />
            {dsh?.running ? '运行中' : '已停止'}
          </div>
          <div className="sub">
            {dsh?.running ? `已运行 ${formatDuration(dsh.uptime)}` : '按需启动，用完即停'}
          </div>
        </div>
        <div className="stat">
          <div className="label">内存占用</div>
          <div className="value">{stats ? `${memPct}%` : '—'}</div>
          <div className="sub">{stats ? `${formatMb(memUsed)} / ${formatMb(stats.mem.totalMb)}` : '无权限'}</div>
        </div>
        <div className="stat">
          <div className="label">磁盘可用</div>
          <div className="value">{stats ? `${stats.disk.freeGb} GB` : '—'}</div>
          <div className="sub">{stats ? `共 ${stats.disk.totalGb} GB` : '无权限'}</div>
        </div>
        <div className="stat">
          <div className="label">负载</div>
          <div className="value">{stats ? stats.loadAvg[0].toFixed(2) : '—'}</div>
          <div className="sub">{stats ? `${stats.cpuCount} 核 · ${stats.host}` : '无权限'}</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card hoverable">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 500 }}>DeepSeek Harness</div>
            <Icon name="spark" size={17} />
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            服务默认关闭。需要时启动，进入的是 DSH 官方原生界面，用完后停止即可释放内存。
          </p>
          <div className="row">
            <Link className="btn primary" to="/harness">
              进入控制面板
              <Icon name="external" size={14} />
            </Link>
          </div>
        </div>

        <div className="card hoverable">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 500 }}>外观</div>
            <Icon name="palette" size={17} />
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            内置三套主题，切换即时生效并记住选择。新增主题只需增加一个色值文件。
          </p>
          <div className="row">
            <Link className="btn" to="/settings">前往设置</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
