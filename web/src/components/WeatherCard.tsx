import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Icon } from './Icon';
import { wmoIcon, wmoInfo } from '../lib/weather';
import type { WeatherData } from '../types';

const CITY_KEY = 'wb.home.city';
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dayLabel(dateStr: string, index: number) {
  if (index === 0) return '今天';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return WEEKDAYS[d.getDay()];
}

export function WeatherCard() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [city, setCity] = useState('');
  const [input, setInput] = useState('');
  const [switching, setSwitching] = useState(false);
  const lastCity = useRef<string | undefined>(undefined);

  const load = useCallback(async (q?: string) => {
    lastCity.current = q;
    setLoading(true);
    setError('');
    try {
      const res = await api.weather(q);
      // 慢请求返回时可能已经被新城市覆盖，丢弃过期结果
      if (lastCity.current !== q) return;
      if (!res.ok) {
        setError(res.error || '天气获取失败');
        setData(null);
      } else {
        setData(res);
      }
    } catch (err) {
      if (lastCity.current !== q) return;
      setError(err instanceof Error ? err.message : '天气获取失败');
      setData(null);
    } finally {
      if (lastCity.current === q) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(CITY_KEY) || '';
    setCity(saved);
    setInput(saved);
    void load(saved || undefined);
  }, [load]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = input.trim();
    if (!next || next === city) return;
    setSwitching(true);
    setCity(next);
    window.localStorage.setItem(CITY_KEY, next);
    void load(next).finally(() => setSwitching(false));
  }

  const current = data?.current;
  const place = data?.place;
  const info = wmoInfo(current?.code ?? 0);
  const icon = wmoIcon(current?.code ?? 0, current?.isDay ?? true);
  const forecast = (data?.daily || []).slice(1, 4);

  return (
    <div className="card wx-card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="mapPin" size={17} />
          <span style={{ fontWeight: 500 }}>天气</span>
          {place && <span className="faint" style={{ fontSize: 12 }}>{place.name}{place.admin1 ? ` · ${place.admin1}` : ''}</span>}
        </div>
        <button
          className="btn ghost sm"
          onClick={() => void load(city || undefined)}
          title="刷新"
          disabled={loading}
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {loading && !data ? (
        <div className="wx-now">
          <div className="skeleton" style={{ width: 92, height: 64 }} />
          <div className="col" style={{ gap: 8, flex: 1 }}>
            <div className="skeleton" style={{ width: 120 }} />
            <div className="skeleton" style={{ width: 170 }} />
          </div>
        </div>
      ) : error ? (
        <div className="wx-error">
          <Icon name="cloud" size={18} />
          <span>{error}</span>
        </div>
      ) : current ? (
        <>
          <div className="wx-now">
            <div className="wx-icon">
              <Icon name={icon} size={46} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="wx-temp">
                {Math.round(current.temperature)}
                <span className="wx-unit">°C</span>
              </div>
              <div className="wx-desc">{info.label}</div>
            </div>
            <div className="wx-meta">
              <div className="row" style={{ gap: 6 }}><Icon name="sun" size={13} />体感 {Math.round(current.apparent)}°C</div>
              <div className="row" style={{ gap: 6 }}><Icon name="droplet" size={13} />湿度 {current.humidity}%</div>
              <div className="row" style={{ gap: 6 }}><Icon name="wind" size={13} />风速 {current.wind} km/h</div>
            </div>
          </div>

          {forecast.length > 0 && (
            <div className="wx-forecast">
              {forecast.map((d, i) => (
                <div className="wx-day" key={d.date}>
                  <div className="faint" style={{ fontSize: 12 }}>{dayLabel(d.date, i + 1)}</div>
                  <Icon name={wmoIcon(d.code)} size={22} />
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {Math.round(d.max)}° / {Math.round(d.min)}°
                  </div>
                  <div className="faint" style={{ fontSize: 11 }}>{wmoInfo(d.code).label}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      <form className="wx-switch" onSubmit={onSubmit}>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入城市名，如 北京 / 杭州"
          aria-label="切换城市"
        />
        <button className="btn" type="submit" disabled={switching || !input.trim() || input.trim() === city}>
          {switching ? <span className="spinner" /> : <Icon name="search" size={14} />}
          切换
        </button>
      </form>
      {data?.fetchedAt && (
        <div className="faint wx-updated">
          {new Date(data.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新
        </div>
      )}
    </div>
  );
}
