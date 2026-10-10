import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { Gauge } from '../components/Gauge';
import { Sparkline } from '../components/Sparkline';
import { formatBps, formatClock, formatDuration, formatMb } from '../lib/format';
import type { DshStatus, SystemStats } from '../types';

const INTERVAL_OPTIONS = [1000, 3000, 5000, 10000];
const HISTORY_MAX = 120;
const INTERVAL_KEY = 'wb.dash.interval';

interface Sample {
  cpu: number;
  mem: number;
  load: number;
  rx: number;
  tx: number;
}

export function SystemPage() {
  const { user, can } = useAuth();
  const canSystem = can('system:view');

  const [dsh, setDsh] = useState<DshStatus | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem(INTERVAL_KEY));
    return INTERVAL_OPTIONS.includes(saved) ? saved : 3000;
  });

  const loadDsh = useCallback(async () => {
    try {
      setDsh(await api.dshStatus());
    } catch {
      setDsh(null);
    }
  }, []);

  useEffect(() => {
    void loadDsh();
    const timer = window.setInterval(() => void loadDsh(), 6000);
    return () => window.clearInterval(timer);
  }, [loadDsh]);

  useEffect(() => {
    window.localStorage.setItem(INTERVAL_KEY, String(intervalMs));
  }, [intervalMs]);

  useEffect(() => {
    if (!canSystem) {
      setStats(null);
      setHistory([]);
      return;
    }
    let alive = true;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const s = await api.systemStats();
        if (!alive) return;
        setStats(s);
        setUpdatedAt(Date.now());
        const total = s.mem?.totalMb || 0;
        const used = s.mem?.usedMb ?? Math.max(0, total - (s.mem?.freeMb ?? 0));
        const sample: Sample = {
          cpu: s.cpu?.usagePct ?? 0,
          mem: total ? (used / total) * 100 : 0,
          load: s.loadAvg?.[0] ?? 0,
          rx: s.net?.rxBps ?? 0,
          tx: s.net?.txBps ?? 0,
        };
        setHistory((prev) => {
          const next = [...prev, sample];
          return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
        });
      } catch {
        /* 无权限或请求失败时静默，保留上一次数据 */
      }
    };

    void tick();
    if (!paused) timer = window.setInterval(() => void tick(), intervalMs);
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [canSystem, intervalMs, paused]);

  const memTotal = stats?.mem?.totalMb ?? 0;
  const memUsed = stats?.mem?.usedMb ?? Math.max(0, memTotal - (stats?.mem?.freeMb ?? 0));
  const memPct = memTotal ? (memUsed / memTotal) * 100 : 0;

  const swapTotal = stats?.swap?.totalMb ?? 0;
  const swapUsed = stats?.swap?.usedMb ?? Math.max(0, swapTotal - (stats?.swap?.freeMb ?? 0));
  const swapPct = swapTotal ? (swapUsed / swapTotal) * 100 : 0;

  const diskTotal = stats?.disk?.totalGb ?? 0;
  const diskUsed = stats?.disk?.usedGb ?? Math.max(0, diskTotal - (stats?.disk?.freeGb ?? 0));
  const diskPct = diskTotal ? (diskUsed / diskTotal) * 100 : 0;

  const cores = stats?.cpu?.cores || stats?.cpuCount || 1;
  const load1 = stats?.loadAvg?.[0] ?? 0;
  const loadPct = Math.min(100, (load1 / cores) * 100);
  const cpuPct = stats?.cpu?.usagePct ?? 0;

  const series = useMemo(
    () => ({
      cpu: history.map((h) => h.cpu),
      mem: history.map((h) => h.mem),
      load: history.map((h) => h.load),
      rx: history.map((h) => h.rx),
    }),
    [history]
  );

  const peakCpu = series.cpu.length ? Math.max(...series.cpu) : 0;
  const peakMem = series.mem.length ? Math.max(...series.mem) : 0;

  function openDsh() {
    if (!dsh?.running) return;
    const url = dsh.token ? `${dsh.path}?token=${encodeURIComponent(dsh.token)}` : dsh.path;
    window.open(url, '_blank', 'noopener');
  }

  if (!canSystem) {
    return (
      <div className="page">
        <div className="card">
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <Icon name="shield" size={16} />
            <div style={{ fontWeight: 500 }}>系统资源看板仅对授权角色开放</div>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
            当前账号没有「系统状态」查看权限，看不到 CPU、内存、磁盘、网络等服务器指标。
            需要查看时请联系管理员开通 <span className="mono">system:view</span> 权限。
          </p>
          <Link className="btn" to="/">回到首页</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card hoverable dash-head">
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>系统资源实时看板</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {stats ? `${cores} 核 CPU · ${formatMb(memTotal)} 内存 · ${stats.host}` : '正在获取首帧数据…'}
            </div>
          </div>

          <div className="row wrap" style={{ gap: 8 }}>
            <span className={`pill ${paused ? 'warn' : 'ok'}`}>
              <span className={`dot ${paused ? 'off' : 'live'}`} />
              {paused ? '已暂停' : '实时'}
            </span>
            <div className="seg">
              {INTERVAL_OPTIONS.map((value) => (
                <button
                  key={value}
                  className={`seg-item${value === intervalMs ? ' active' : ''}`}
                  onClick={() => setIntervalMs(value)}
                  title={`每 ${value / 1000} 秒刷新`}
                >
                  {value / 1000}s
                </button>
              ))}
            </div>
            <button className="btn sm" onClick={() => setPaused((v) => !v)}>
              <Icon name={paused ? 'play' : 'stop'} size={13} />
              {paused ? '继续' : '暂停'}
            </button>
          </div>
        </div>

        <div className="faint dash-updated">
          {updatedAt ? `最后更新 ${formatClock(updatedAt)} · 已采集 ${history.length} 个采样点` : '正在获取首帧数据…'}
        </div>
      </div>

      <div className="dash-gauges">
        <Gauge
          value={cpuPct}
          label="CPU"
          sub={`${cores} 核 · 峰值 ${peakCpu.toFixed(0)}%`}
        />
        <Gauge
          value={memPct}
          label="内存"
          sub={`${formatMb(memUsed)} / ${formatMb(memTotal)}`}
        />
        <Gauge
          value={diskPct}
          label="磁盘"
          sub={`${diskUsed.toFixed(1)} / ${diskTotal.toFixed(1)} GB`}
        />
        <Gauge
          value={swapPct}
          label="SWAP"
          center={swapTotal ? `${Math.round(swapPct)}%` : '未用'}
          sub={swapTotal ? `${formatMb(swapUsed)} / ${formatMb(swapTotal)}` : '当前未占用交换分区'}
          muted={!swapTotal}
        />
      </div>

      <div className="grid cols-2 mb-12">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 500 }}>CPU 使用率</div>
              <div className="faint" style={{ fontSize: 12 }}>按核数归一，实时采样</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{cpuPct.toFixed(1)}%</div>
              <div className="faint" style={{ fontSize: 12 }}>负载 {load1.toFixed(2)} / {cores} 核</div>
            </div>
          </div>
          <Sparkline data={series.cpu} max={100} color="var(--c-accent)" />
          <div className="dash-axis">
            <span>最近 {history.length} 次采样</span>
            <span>负载水位 {(loadPct).toFixed(0)}%</span>
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 500 }}>内存占用</div>
              <div className="faint" style={{ fontSize: 12 }}>
                可用 {formatMb(stats?.mem?.availableMb ?? 0)} · 缓存 {formatMb(stats?.mem?.cachedMb ?? 0)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{memPct.toFixed(1)}%</div>
              <div className="faint" style={{ fontSize: 12 }}>峰值 {peakMem.toFixed(0)}%</div>
            </div>
          </div>
          <Sparkline data={series.mem} max={100} color="var(--c-accent-2)" />
          <div className="dash-axis">
            <span>共 {formatMb(memTotal)}</span>
            <span>进程 {stats?.procs ?? 0}</span>
          </div>
        </div>
      </div>

      <div className="grid cols-3 mb-12">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontWeight: 500 }}>网络</div>
            <Icon name="wind" size={16} />
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">下行</span>
            <span className="dash-metric-value">{formatBps(stats?.net?.rxBps ?? 0)}</span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">上行</span>
            <span className="dash-metric-value">{formatBps(stats?.net?.txBps ?? 0)}</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <Sparkline data={series.rx} height={44} color="var(--c-success)" />
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontWeight: 500 }}>主机</div>
            <Icon name="cpu" size={16} />
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">运行时长</span>
            <span className="dash-metric-value">{formatDuration(stats?.uptimeSeconds)}</span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">平均负载</span>
            <span className="dash-metric-value mono">
              {stats ? stats.loadAvg.map((n) => n.toFixed(2)).join(' / ') : '—'}
            </span>
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            {stats?.host} · {stats?.platform}
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontWeight: 500 }}>磁盘</div>
            <Icon name="terminal" size={16} />
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">已用</span>
            <span className="dash-metric-value">{diskUsed.toFixed(1)} GB</span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">可用</span>
            <span className="dash-metric-value">{stats?.disk?.freeGb?.toFixed(1) ?? '—'} GB</span>
          </div>
          <div className="progress mt-16">
            <div className="progress-bar" style={{ width: `${diskPct}%` }} />
          </div>
        </div>
      </div>

      <div className="card hoverable">
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <span className={`dot ${dsh?.running ? 'live' : 'off'}`} />
            <div>
              <div style={{ fontWeight: 500 }}>
                DeepSeek Harness {dsh?.running ? '运行中' : '已停止'}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>
                {dsh?.running
                  ? `PID ${dsh.pid ?? '—'} · 已运行 ${formatDuration(dsh.uptime)}`
                  : '按需启动，用完即停'}
              </div>
            </div>
          </div>

          <div className="row wrap">
            {dsh?.running && can('dsh:access') && (
              <button className="btn primary" onClick={openDsh}>
                <Icon name="external" size={14} />
                打开 DSH
              </button>
            )}
            <Link className="btn" to="/harness">
              控制面板
              <Icon name="spark" size={14} />
            </Link>
          </div>
        </div>

        {!dsh?.running && (
          <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
            {user?.isGuest
              ? '服务当前未启动，游客无法自行启动，请联系管理员。'
              : '服务未启动时不占用内存，需要时到控制面板启动。'}
          </div>
        )}
      </div>
    </div>
  );
}
