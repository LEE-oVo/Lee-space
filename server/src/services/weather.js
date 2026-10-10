import { config } from '../config.js';

// 天气数据来自 Open-Meteo（免费、无需 API Key）。
// 由后端代理而不是浏览器直连，原因有三：
//   1. 服务器出网稳定，用户网络环境不可控
//   2. 结果可在进程内缓存，多个用户共享一份，不重复打上游
//   3. 不把上游地址暴露给前端，日后换服务商不用改前端
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const FORECAST_TTL_MS = 10 * 60 * 1000;
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;
const CACHE_MAX = 64;

const forecastCache = new Map();
const geoCache = new Map();
// 同 key 的并发请求合并，避免缓存失效瞬间打爆上游
const inflight = new Map();

function remember(cache, key, value) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`上游返回 ${res.status}`);
  return res.json();
}

function once(key, producer) {
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = producer().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

async function geocode(name) {
  const key = name.trim().toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < GEO_TTL_MS) return hit.value;

  const value = await once(`geo:${key}`, async () => {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`;
    const data = await fetchJson(url);
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    if (!first) return null;
    return {
      name: first.name,
      admin1: first.admin1 || '',
      country: first.country || '',
      latitude: first.latitude,
      longitude: first.longitude,
      timezone: first.timezone || '',
    };
  });
  if (value) remember(geoCache, key, { at: Date.now(), value });
  return value;
}

function defaultPlace() {
  return {
    name: config.weatherCity,
    admin1: '',
    country: '',
    latitude: config.weatherLat,
    longitude: config.weatherLon,
    timezone: '',
  };
}

async function forecast(place) {
  const key = `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
  const hit = forecastCache.get(key);
  if (hit && Date.now() - hit.at < FORECAST_TTL_MS) return hit.value;

  const value = await once(`fc:${key}`, async () => {
    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: 'auto',
      forecast_days: '4',
    });
    const data = await fetchJson(`${FORECAST_URL}?${params.toString()}`);
    const cur = data?.current || {};
    const daily = data?.daily || {};
    const days = Array.isArray(daily.time) ? daily.time.length : 0;
    const list = [];
    for (let i = 0; i < days; i += 1) {
      list.push({
        date: daily.time[i],
        code: Number(daily.weather_code?.[i] ?? 0),
        max: Number(daily.temperature_2m_max?.[i] ?? 0),
        min: Number(daily.temperature_2m_min?.[i] ?? 0),
      });
    }
    return {
      timezone: data?.timezone || place.timezone || '',
      current: {
        time: cur.time || '',
        temperature: Number(cur.temperature_2m ?? 0),
        apparent: Number(cur.apparent_temperature ?? 0),
        humidity: Number(cur.relative_humidity_2m ?? 0),
        wind: Number(cur.wind_speed_10m ?? 0),
        code: Number(cur.weather_code ?? 0),
        isDay: Number(cur.is_day ?? 1) === 1,
      },
      daily: list,
    };
  });

  remember(forecastCache, key, { at: Date.now(), value });
  return value;
}

/**
 * 查询天气。query 为空时使用 .env 配置的默认城市。
 * 返回 { ok: true, ... } 或 { ok: false, error }，不抛异常由调用方决定降级方式。
 */
export async function getWeather(query) {
  const q = String(query || '').trim();
  let place = defaultPlace();
  if (q) {
    const found = await geocode(q);
    if (!found) return { ok: false, error: `没有找到「${q}」，换个城市名试试` };
    place = found;
  }

  try {
    const fc = await forecast(place);
    return {
      ok: true,
      place: { ...place, timezone: fc.timezone || place.timezone },
      current: fc.current,
      daily: fc.daily,
      fetchedAt: Date.now(),
      cached: Boolean(forecastCache.get(`${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`)),
    };
  } catch (err) {
    return { ok: false, error: '天气服务暂时不可用，请稍后重试', detail: err?.message || '' };
  }
}
