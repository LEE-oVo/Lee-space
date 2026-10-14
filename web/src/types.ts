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
  /** 累计已实现盈亏 */
  realized: number;
  /** 申购费率百分比 */
  purchaseFee: number;
  /** 赎回费率分档：[{days:7,fee:1.5},{days:null,fee:0}] */
  redemptionFee: Array<{ days: number | null; fee: number }>;
  feeSource: string;
  /** 初始建仓日 YYYY-MM-DD，影响赎回费的持有天数档位；留空按净值序列起点估算 */
  firstBuyDate: string;
  note: string;
  status: string;
  sortOrder: number;
  updatedAt: number;
}

export interface FundSource {
  title: string;
  url: string;
}

/** 建议的产出方：两个工具各写各的判断，账本只有一份 */
export type FundAdviceSource = 'workbuddy' | 'trae' | 'manual';

export interface FundAdvice {
  code: string;
  tradeDate: string;
  source: FundAdviceSource | string;
  action: FundAction;
  confidence: string | null;
  /** 建议金额（元），非负；方向由 action 决定。hold 时为 null */
  amount: number | null;
  /** 用户是否按建议实际操作过 */
  executed: boolean;
  /** 是否已用真实收盘净值结算 */
  settled: boolean;
  settledNav: number | null;
  settledShares: number | null;
  settledFee: number | null;
  settledRealized: number | null;
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
  /** 实际把这笔写进账本的工具（角色分离时可据此看出是谁结算的） */
  settledSource: string | null;
  updatedAt: number;
}

export interface FundDaily {
  tradeDate: string;
  source: string;
  sourceLabel: string;
  summary: string;
  market: string;
  model: string | null;
  updatedAt: number;
}

/** 库里实际存在哪些来源，前端据此决定要不要显示来源切换 */
export interface FundSourceInfo {
  source: string;
  label: string;
  count: number;
  lastDate: string | null;
}

export interface FundNavPoint {
  date: string;
  nav: number;
}

/** 结算后的真实持仓：由买入批次汇总而来 */
export interface FundPosition {
  code: string;
  name: string;
  shares: number;
  cost: number | null;
  costAmount: number;
  invested: number;
  realized: number;
  nav: number | null;
  navDate: string | null;
  market: number | null;
  unrealized: number | null;
  unrealizedPct: number | null;
  totalProfit: number | null;
  purchaseFee: number;
  redemptionFee: Array<{ days: number | null; fee: number }>;
  feeSource: string;
  lots: number;
}

export interface FundOverview {
  daily: FundDaily | null;
  /** 每个来源各自最新一天的整体结论，页面切来源时跟着换 */
  dailyBySource: FundDaily[];
  holdings: FundHolding[];
  /** 不指定来源时是「每只基金 × 每个来源」各自的最新一条 */
  advice: FundAdvice[];
  /** 结算后的持仓（含金额，仅 fund:detail 可见） */
  positions: Record<string, FundPosition>;
  sources: FundSourceInfo[];
  sourceLabels: Record<string, string>;
  /** 允许写账本的来源；非空时其他来源只能出建议 */
  settleSources: string[];
  /** public = 未授权 fund:detail，持仓金额与详细分析已被服务端裁掉 */
  scope: 'full' | 'public';
}

export type FileCategory = 'resume' | 'certificate' | 'award' | 'other';

export interface FileItem {
  id: number;
  name: string;
  ext: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  category: FileCategory;
  tags: string[];
  note: string;
  hasThumb: boolean;
  uploader: string;
  createdAt: number;
  updatedAt: number;
}

export interface FileQuota {
  used: number;
  max: number;
  maxFileBytes: number;
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
