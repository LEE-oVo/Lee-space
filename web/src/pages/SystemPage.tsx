import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { formatDuration, formatMb } from '../lib/format';
import type { SystemStats } from '../types';

export function SystemPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await api.systemStats();
        if (alive) {
          setStats(s);
          setError('');
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '读取失败');
      }
    };
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!stats) {
    return (
      <div className="page">
        <div className="grid cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="stat" key={i}>
              <div className="skeleton" style={{ width: 60 }} />
              <div className="skeleton" style={{ width: 90, height: 24, marginTop: 8 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const memUsed = stats.mem.totalMb - stats.mem.freeMb;
  const memPct = stats.mem.totalMb ? Math.round((memUsed / stats.mem.totalMb) * 100) : 0;
  const swapUsed = stats.swap.totalMb ? stats.swap.totalMb - stats.swap.freeMb : 0;

  return (
    <div className="page">
      <div className="grid cols-4 mb-12">
        <div className="stat">
          <div className="label">内存</div>
          <div className="value">{memPct}%</div>
          <div className="sub">{formatMb(memUsed)} / {formatMb(stats.mem.totalMb)}</div>
        </div>
        <div className="stat">
          <div className="label">Swap</div>
          <div className="value">{stats.swap.totalMb ? formatMb(swapUsed) : '未启用'}</div>
          <div className="sub">{stats.swap.totalMb ? `共 ${formatMb(stats.swap.totalMb)}` : '—'}</div>
        </div>
        <div className="stat">
          <div className="label">磁盘</div>
          <div className="value">{stats.disk.freeGb} GB</div>
          <div className="sub">可用 / 共 {stats.disk.totalGb} GB</div>
        </div>
        <div className="stat">
          <div className="label">负载</div>
          <div className="value">{stats.loadAvg[0].toFixed(2)}</div>
          <div className="sub">{stats.cpuCount} 核 CPU</div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <Icon name="cpu" size={17} />
          <span style={{ fontWeight: 500 }}>主机信息</span>
        </div>
        <table className="data">
          <tbody>
            <tr><td style={{ width: 160 }} className="muted">主机名</td><td className="mono">{stats.host}</td></tr>
            <tr><td className="muted">系统</td><td>{stats.platform}</td></tr>
            <tr><td className="muted">运行时长</td><td>{formatDuration(stats.uptimeSeconds)}</td></tr>
            <tr><td className="muted">平均负载</td><td className="mono">{stats.loadAvg.join(' / ')}</td></tr>
            <tr>
              <td className="muted">DSH 进程</td>
              <td>
                <span className="row" style={{ gap: 8 }}>
                  <span className={`dot ${stats.dsh.running ? 'live' : 'off'}`} />
                  {stats.dsh.running ? `PID ${stats.dsh.pid} · ${formatDuration(stats.dsh.uptime)}` : '未运行'}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
