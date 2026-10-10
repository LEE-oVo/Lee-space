import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { CalendarCard } from '../components/CalendarCard';
import { WeatherCard } from '../components/WeatherCard';
import { lunarText } from '../lib/lunar';
import type { DshStatus } from '../types';

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function greetingFor(hour: number) {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '午间好';
  if (hour < 18) return '下午好';
  if (hour < 23) return '晚上好';
  return '夜深了';
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function OverviewPage() {
  const { user, can } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [dsh, setDsh] = useState<DshStatus | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await api.dshStatus();
        if (alive) setDsh(s);
      } catch {
        if (alive) setDsh(null);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const year = now.getFullYear();
  const yearStart = useMemo(() => new Date(year, 0, 1).getTime(), [year]);
  const yearEnd = useMemo(() => new Date(year + 1, 0, 1).getTime(), [year]);
  const yearPct = ((now.getTime() - yearStart) / (yearEnd - yearStart)) * 100;

  const dayStart = useMemo(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), [now]);
  const dayPct = ((now.getTime() - dayStart) / 86400000) * 100;

  const dayOfYear = Math.floor((dayStart - yearStart) / 86400000) + 1;
  const daysLeft = Math.max(0, Math.floor((yearEnd - dayStart) / 86400000) - 1);

  const dateLine = `${year} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAYS[now.getDay()]}`;
  const lunar = lunarText(now);

  function openDsh() {
    if (!dsh?.running) return;
    const url = dsh.token ? `${dsh.path}?token=${encodeURIComponent(dsh.token)}` : dsh.path;
    window.open(url, '_blank', 'noopener');
  }

  return (
    <div className="page">
      <div className="card hoverable home-hero">
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 18 }}>
          <div style={{ minWidth: 0 }}>
            <div className="home-greet">
              {greetingFor(now.getHours())}，{user?.displayName || user?.username || '朋友'}
              {user?.isGuest && <span className="pill guest-tag" style={{ marginLeft: 8 }}>游客</span>}
            </div>
            <div className="home-date">{dateLine}</div>
            <div className="faint home-lunar">{lunar || '　'}</div>
          </div>

          <div className="home-clock">
            <span className="home-time">{pad(now.getHours())}:{pad(now.getMinutes())}</span>
            <span className="home-sec">{pad(now.getSeconds())}</span>
          </div>
        </div>

        <div className="home-progress">
          <div className="home-progress-item">
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">今日已过 {dayPct.toFixed(0)}%</span>
              <span className="faint">还剩 {24 - now.getHours()} 小时</span>
            </div>
            <div className="progress"><div className="progress-bar" style={{ width: `${dayPct}%` }} /></div>
          </div>
          <div className="home-progress-item">
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">{year} 年已过 {yearPct.toFixed(1)}%</span>
              <span className="faint">第 {dayOfYear} 天 · 剩余 {daysLeft} 天</span>
            </div>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${yearPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-2 mb-12">
        <CalendarCard />
        <WeatherCard />
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <Icon name="spark" size={16} />
          <span style={{ fontWeight: 500 }}>快捷入口</span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {dsh?.running && can('dsh:access') ? (
            <button className="btn primary" onClick={openDsh}>
              <Icon name="external" size={14} />
              打开 DeepSeek Harness
            </button>
          ) : null}
          {can('dsh:access') && (
            <Link className="btn" to="/harness">
              <Icon name="spark" size={14} />
              Harness 控制面板
            </Link>
          )}
          {can('system:view') && (
            <Link className="btn" to="/system">
              <Icon name="cpu" size={14} />
              系统状态
            </Link>
          )}
          {user?.isGuest && (
            <span className="faint" style={{ fontSize: 12 }}>
              游客模式：只能使用已启动的 Harness，看不到系统资源与管理功能
            </span>
          )}
        </div>
        {dsh?.running === false && can('dsh:start') && (
          <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
            Harness 当前未启动，未启动时不占用内存。
          </div>
        )}
      </div>
    </div>
  );
}
