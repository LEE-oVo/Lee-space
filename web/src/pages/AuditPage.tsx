import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatDateTime } from '../lib/format';
import type { AuditLog } from '../types';

const ACTION_LABEL: Record<string, string> = {
  'auth.login': '登录',
  'auth.logout': '退出',
  'auth.password.change': '修改密码',
  'dsh.start': '启动 DSH',
  'dsh.stop': '停止 DSH',
  'user.create': '创建用户',
  'user.update': '更新用户',
  'user.disable': '停用用户',
};

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.audit(120);
        if (alive) setLogs(res.logs);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '加载失败');
      }
    };
    void load();
    const timer = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (error) return <div className="alert error">{error}</div>;

  return (
    <div className="page">
      <div className="card">
        <div style={{ fontWeight: 500, marginBottom: 12 }}>最近操作记录</div>
        <div className="table-wrap wide">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 150 }}>时间</th>
              <th style={{ width: 130 }}>操作者</th>
              <th style={{ width: 120 }}>动作</th>
              <th style={{ width: 130 }}>来源 IP</th>
              <th style={{ width: 80 }}>结果</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={6} className="faint">暂无记录</td></tr>
            )}
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="muted">{formatDateTime(log.created_at)}</td>
                <td>{log.username || '—'}</td>
                <td>{ACTION_LABEL[log.action] || log.action}</td>
                <td className="mono faint">{log.ip || '—'}</td>
                <td>
                  <span className={`pill ${log.result === 'success' ? 'ok' : 'bad'}`}>
                    {log.result === 'success' ? '成功' : '失败'}
                  </span>
                </td>
                <td className="faint" style={{ fontSize: 12 }}>
                  {log.target ? `目标 ${log.target}` : ''}
                  {log.detail ? ` ${log.detail}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
