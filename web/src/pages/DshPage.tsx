import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { formatDuration } from '../lib/format';
import type { DshStatus } from '../types';

export function DshPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<DshStatus | null>(null);
  const [busy, setBusy] = useState<'start' | 'stop' | 'open' | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [log, setLog] = useState('');
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.dshStatus());
    } catch {
      /* 忽略轮询失败 */
    }
  }, []);

  useEffect(() => {
    if (params.get('dsh') === 'down') {
      setMessage({ type: 'error', text: '访问被拦截：DSH 当前未启动，请先启动再打开' });
    } else if (params.get('denied') === '1') {
      setMessage({ type: 'error', text: '访问被拦截：登录状态无效，或当前角色缺少 dsh:access 权限' });
    }
  }, [params]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(kind: 'start' | 'stop') {
    setBusy(kind);
    setMessage(null);
    try {
      const next = kind === 'start' ? await api.dshStart() : await api.dshStop();
      setStatus(next);
      setMessage({ type: 'ok', text: kind === 'start' ? 'DSH 已启动' : 'DSH 已停止' });
      setLog('');
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '操作失败' });
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function openDsh() {
    setBusy('open');
    setMessage(null);
    try {
      const current = status ?? (await api.dshStatus());
      setStatus(current);
      if (!current.running) {
        setMessage({ type: 'error', text: 'DSH 尚未启动，请先启动' });
        return;
      }
      if (!current.canAccess) {
        setMessage({ type: 'error', text: '当前角色没有进入 DSH 的权限' });
        return;
      }
      const url = current.token ? `${current.path}?token=${encodeURIComponent(current.token)}` : current.path;
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '获取入口失败' });
    } finally {
      setBusy(null);
    }
  }

  async function toggleLog() {
    if (showLog) {
      setShowLog(false);
      return;
    }
    try {
      const res = await api.dshLog(120);
      setLog(res.log || '（暂无日志）');
      setShowLog(true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '读取日志失败' });
    }
  }

  const running = status?.running ?? false;

  return (
    <div className="page">
      {message && <div className={`alert ${message.type === 'ok' ? 'ok' : 'error'}`}>{message.text}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div className="row" style={{ gap: 10 }}>
              <span className={`dot ${running ? 'live' : 'off'}`} />
              <span style={{ fontSize: 17, fontWeight: 600 }}>
                {status ? (running ? '运行中' : '已停止') : '状态加载中…'}
              </span>
              <span className="pill">
                <Icon name="terminal" size={12} />
                127.0.0.1:{status?.port ?? 3080}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              {running
                ? `进程 PID ${status?.pid ?? '—'} · 已运行 ${formatDuration(status?.uptime)}`
                : '服务处于关闭状态，不占用内存。点击「启动」后约需 20 秒完成初始化。'}
            </div>
          </div>

          <div className="row wrap">
            {can('dsh:start') && (
              <button className="btn primary" onClick={() => void act('start')} disabled={busy !== null || running}>
                {busy === 'start' ? <span className="spinner" /> : <Icon name="play" size={14} />}
                {busy === 'start' ? '启动中…' : '启动'}
              </button>
            )}
            {can('dsh:stop') && (
              <button className="btn" onClick={() => void act('stop')} disabled={busy !== null || !running}>
                {busy === 'stop' ? <span className="spinner" /> : <Icon name="stop" size={14} />}
                {busy === 'stop' ? '停止中…' : '停止'}
              </button>
            )}
            {can('dsh:access') && (
              <button className="btn" onClick={() => void openDsh()} disabled={busy !== null || !running}>
                {busy === 'open' ? <span className="spinner" /> : <Icon name="external" size={14} />}
                打开 DSH
              </button>
            )}
            <button className="btn ghost" onClick={() => void load()} title="刷新状态">
              <Icon name="refresh" size={15} />
            </button>
          </div>
        </div>

        {!can('dsh:start') && !can('dsh:stop') && (
          <div className="faint" style={{ fontSize: 12, marginTop: 12 }}>
            当前角色没有启停权限，仅可查看状态。
          </div>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div style={{ fontWeight: 500, marginBottom: 8 }}>访问方式</div>
          <ul className="muted" style={{ fontSize: 13, margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>DSH 只监听本机 127.0.0.1，公网无法直接访问其端口</li>
            <li>进入前必须通过工作台的登录会话与权限校验</li>
            <li>打开的是 DSH 官方原生界面，模型 Key 在其中的 Settings 内配置</li>
            <li>首次打开会携带一次性凭证换取登录状态，之后可直接进入</li>
          </ul>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 500 }}>运行日志</div>
            <button className="btn ghost sm" onClick={() => void toggleLog()}>
              {showLog ? '收起' : '查看'}
            </button>
          </div>
          {showLog ? (
            <div className="log-view">
              {log.split('\n').map((line, i) => (
                <div className="log-line" key={i}>{line}</div>
              ))}
            </div>
          ) : (
            <div className="faint" style={{ fontSize: 13 }}>点击「查看」读取最近 120 行启动日志</div>
          )}
        </div>
      </div>
    </div>
  );
}
