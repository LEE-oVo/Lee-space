export interface User {
  id: number;
  username: string;
  email: string | null;
  displayName: string;
  avatarColor: string;
  roles: string[];
  permissions: string[];
  isGuest?: boolean;
  lastLoginAt?: number | null;
  lastLoginIp?: string | null;
}

export interface DshStatus {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  uptime: number | null;
  port: number;
  path: string;
  token: string | null;
  canStart: boolean;
  canStop: boolean;
  canAccess: boolean;
}

export interface SystemStats {
  host: string;
  platform: string;
  cpuCount: number;
  loadAvg: number[];
  cpu: { usagePct: number; cores: number };
  net: { rxBps: number; txBps: number };
  procs: number;
  mem: {
    totalMb: number;
    freeMb: number;
    usedMb: number;
    cachedMb: number;
    availableMb: number;
  };
  swap: { totalMb: number; freeMb: number; usedMb: number };
  disk: { totalGb: number; freeGb: number; usedGb: number };
  uptimeSeconds: number;
  dsh: { running: boolean; pid: number | null; uptime: number | null };
  ts: number;
}

export interface WeatherPlace {
  name: string;
  admin1: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface WeatherCurrent {
  time: string;
  temperature: number;
  apparent: number;
  humidity: number;
  wind: number;
  code: number;
  isDay: boolean;
}

export interface WeatherDay {
  date: string;
  code: number;
  max: number;
  min: number;
}

export interface WeatherData {
  ok: boolean;
  place?: WeatherPlace;
  current?: WeatherCurrent;
  daily?: WeatherDay[];
  fetchedAt?: number;
  error?: string;
}

export type FundAction = 'buy' | 'add' | 'hold' | 'reduce' | 'sell';

export interface FundHolding {
  id: number;
  code: string;
  name: string;
  category: string;
  cost: number | null;
  shares: number | null;
  amount: number | null;
  note: string;
  status: string;
  sortOrder: number;
  updatedAt: number;
}

export interface FundSource {
  title: string;
  url: string;
}

export interface FundAdvice {
  code: string;
  tradeDate: string;
  action: FundAction;
  confidence: string | null;
  nav: number | null;
  navDate: string | null;
  estimate: number | null;
  estimatePct: number | null;
  navPct: number | null;
  summary: string;
  reason: string;
  risks: string[];
  sources: FundSource[];
  stale: boolean;
  model: string | null;
  updatedAt: number;
}

export interface FundDaily {
  tradeDate: string;
  summary: string;
  market: string;
  model: string | null;
  updatedAt: number;
}

export interface FundNavPoint {
  date: string;
  nav: number;
}

export interface FundOverview {
  daily: FundDaily | null;
  holdings: FundHolding[];
  advice: FundAdvice[];
  /** public = 未授权 fund:detail，持仓金额与详细分析已被服务端裁掉 */
  scope: 'full' | 'public';
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  result: string;
  created_at: number;
}

export interface WorkbenchUser {
  id: number;
  username: string;
  email: string | null;
  displayName: string;
  avatarColor: string;
  status: string;
  roles: string[];
  lastLoginAt: number | null;
  lastLoginIp: string | null;
  createdAt: number;
}

export interface RoleRecord {
  id: number;
  code: string;
  name: string;
  description: string;
  is_system: number;
  permissions: string[];
}

export interface PermissionRecord {
  code: string;
  module: string;
  description: string;
}
