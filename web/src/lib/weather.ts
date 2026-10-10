// Open-Meteo 使用 WMO 天气代码，这里映射成中文描述与图标名
interface WmoInfo {
  label: string;
  icon: string;
}

const TABLE: Record<number, WmoInfo> = {
  0: { label: '晴', icon: 'sun' },
  1: { label: '晴间多云', icon: 'sun' },
  2: { label: '多云', icon: 'cloudSun' },
  3: { label: '阴', icon: 'cloud' },
  45: { label: '雾', icon: 'fog' },
  48: { label: '雾凇', icon: 'fog' },
  51: { label: '小雨', icon: 'drizzle' },
  53: { label: '小到中雨', icon: 'drizzle' },
  55: { label: '密集小雨', icon: 'drizzle' },
  56: { label: '冻雨', icon: 'drizzle' },
  57: { label: '强冻雨', icon: 'drizzle' },
  61: { label: '小雨', icon: 'rain' },
  63: { label: '中雨', icon: 'rain' },
  65: { label: '大雨', icon: 'rain' },
  66: { label: '冻雨', icon: 'rain' },
  67: { label: '强冻雨', icon: 'rain' },
  71: { label: '小雪', icon: 'snow' },
  73: { label: '中雪', icon: 'snow' },
  75: { label: '大雪', icon: 'snow' },
  77: { label: '米雪', icon: 'snow' },
  80: { label: '阵雨', icon: 'rain' },
  81: { label: '强阵雨', icon: 'rain' },
  82: { label: '暴雨', icon: 'rain' },
  85: { label: '阵雪', icon: 'snow' },
  86: { label: '强阵雪', icon: 'snow' },
  95: { label: '雷阵雨', icon: 'thunder' },
  96: { label: '雷阵雨伴冰雹', icon: 'thunder' },
  99: { label: '强雷暴伴冰雹', icon: 'thunder' },
};

export function wmoInfo(code: number): WmoInfo {
  return TABLE[code] || { label: '未知', icon: 'cloud' };
}

/** 夜间用云朵图标代替太阳，避免大半夜显示一个太阳 */
export function wmoIcon(code: number, isDay = true): string {
  const info = wmoInfo(code);
  if (!isDay && (info.icon === 'sun' || info.icon === 'cloudSun')) return 'cloud';
  return info.icon;
}
