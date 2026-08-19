import axios from 'axios';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 10000,
});

export interface DayCount {
  day: string;
  count: number;
}

export interface SiteStats {
  totalVisits: number;
  todayVisits: number;
  totalVisitors: number;
  last7Days: DayCount[];
}

interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

export async function trackVisit(page: string): Promise<void> {
  try {
    await client.post('/visitor/track', { page });
  } catch {
    // 统计失败不影响页面体验
  }
}

export async function fetchStats(): Promise<SiteStats> {
  const res = await client.get<ApiResult<SiteStats>>('/visitor/stats');
  return res.data.data;
}

export async function chatWithAi(message: string): Promise<string> {
  const res = await client.post<ApiResult<string>>('/ai/chat', { message });
  return res.data.data;
}
