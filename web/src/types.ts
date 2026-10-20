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

/** 投资目标与额度约束（页面可改，改完立刻生效） */
export interface FundConfig {
  /** 总投资额（元），含已投入；0 = 不限 */
  totalBudget: number;
  /** 目标收益率（%） */
  targetReturnPct: number;
  /** 每日加仓上限（元），0 = 不限 */
  dailyAddBudget: number;
  /** 低于这个金额不下单 */
  minAddAmount: number;
}

/** 投资总览：额度按「净投入」口径算，不随行情涨跌漂移 */
export interface FundInvestment {
  totalBudget: number;
  targetReturnPct: number;
  dailyAddBudget: number;
  /** 累计买入金额 */
  cashIn: number;
  /** 累计赎回金额 */
  cashOut: number;
  /** 净投入 = 买入 − 赎回 */
  netInvested: number;
  /** 已执行但还没入账的加仓（也算占用） */
  pendingAdds: number;
  /** 已占用额度 = 净投入 + 待入账 */
  used: number;
  /** 还能投多少；不限时为 null */
  remaining: number | null;
  market: number;
  costAmount: number;
  unrealized: number;
  realized: number;
  totalProfit: number;
  /** 相对净投入的收益率（%） */
  returnPct: number | null;
  /** 达到目标收益率时对应的金额 */
  targetAmount: number | null;
  /** 额度使用进度（%） */
  progressPct: number | null;
}

/** 组合收益曲线上的一天：口径与页面卡片上的投资总览完全一致 */
export interface FundEquityPoint {
  date: string;
  /** 当日总市值 */
  market: number;
  /** 剩余份额对应的成本 */
  cost: number;
  /** 累计净投入（现金流口径，也是额度的依据） */
  netInvested: number;
  /** 累计已实现盈亏 */
  realized: number;
  /** 累计收益 = 市值 − 成本 + 已实现 */
  profit: number;
  /** 相对净投入的累计收益率（%） */
  returnPct: number;
  /** 时间加权收益率（%）：剔除加减仓现金流的影响 */
  twrPct: number;
  /** 当日盈亏（已剔除当日现金流） */
  dailyProfit: number;
}

/** 曲线上的操作事件（建仓/加仓/减仓） */
export interface FundEquityEvent {
  date: string;
  add: number;
  reduce: number;
  init: number;
  codes: string[];
}

export interface FundEquitySummary {
  from: string;
  to: string;
  days: number;
  market: number;
  netInvested: number;
  profit: number;
  returnPct: number;
  twrPct: number;
  peakPct: number;
  troughPct: number;
  maxDrawdownPct: number;
  maxDrawdownAt: string | null;
  upDays: number;
  downDays: number;
  bestDay: { date: string; profit: number } | null;
  worstDay: { date: string; profit: number } | null;
}

export interface FundEquity {
  points: FundEquityPoint[];
  events: FundEquityEvent[];
  summary: FundEquitySummary | null;
  targetReturnPct: number;
  totalBudget: number;
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
  /** 投资总览（含金额，仅 fund:detail 可见） */
  investment: FundInvestment | null;
  /** 投资配置（含金额语义，仅 fund:detail 可见） */
  config: FundConfig | null;
  sources: FundSourceInfo[];
  sourceLabels: Record<string, string>;
  /** 允许写账本的来源；非空时其他来源只能出建议 */
  settleSources: string[];
  /** 服务端统一抓的盘中估值快照，code -> quote */
  quotes: Record<string, FundQuote>;
  /** public = 未授权 fund:detail，持仓金额与详细分析已被服务端裁掉 */
  scope: 'full' | 'public';
}

/** 盘中估值快照：由服务端定时程序写入，页面与模型都只读 */
export interface FundQuote {
  /** 折算基准：最近一期真实净值 */
  nav: number | null;
  navDate: string | null;
  /** 折算出的盘中估算净值 */
  estimate: number | null;
  /** 估算涨跌幅（百分点） */
  estimatePct: number | null;
  /** official = 官方估值；proxy = 代理标的折算 */
  method: string | null;
  /** 代理标的说明，如「腾讯·细分化工指数」 */
  proxy: string | null;
  proxyPrice: number | null;
  proxyPct: number | null;
  /** 净值对代理标的的回归系数，补偿联接基金的现金仓位 */
  beta: number | null;
  /** 抓取当时是否在盘中 */
  trading: boolean;
  /** 行情时间戳（秒） */
  asOf: number;
  /** 在刷新窗口内才算「实时」；过期数据模型应退回用净值判断 */
  fresh: boolean;
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
