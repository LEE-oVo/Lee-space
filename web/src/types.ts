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
  /** 减仓/卖出的指令份额；null = 老记录，按金额折算 */
  shares: number | null;
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
  /** 批次明细（FIFO 顺序，卖出按这个顺序消耗） */
  lotList?: FundLotDetail[];
  /** 0 费卖出额度：这次能卖多少钱不扣赎回费 */
  sellPlan?: FundSellPlan | null;
  /** 波段参考：该不该卖。与 lotList[0]（底仓）无关 */
  swingBasis?: FundSwingBasis | null;
}

/**
 * 波段判断：**逐个加仓批次**算浮盈，达标的合计，再和 0 费额度取小。
 *
 * 两个坑都记在这里：① 不能用 FIFO 队首（那是原始底仓，成本高于现价 10~22%，
 * 「浮盈 ≥3%」永远不成立）；② 也不能只看最近一次加仓——每次加仓是独立的小仓位。
 */
export interface FundSwingLot {
  buyDate: string;
  unitCost: number;
  /** 扣掉已做过波段的部分后，这一批还剩多少份额 */
  shares: number;
  /** 这一批里已经减仓过、不再重复计入的份额 */
  closedShares: number;
  gainPct: number | null;
  /** 这一批按现价能卖多少钱 */
  marketValue: number;
  qualifies: boolean;
}

export interface FundSwingBasis {
  price: number;
  /** 这个价是哪来的：estimate=盘中实时估值，nav=最近一期已公布净值 */
  priceSource: 'estimate' | 'nav';
  /** 目标止盈线（%） */
  targetPct: number;
  /** 实际触发线（%），含估值噪声余量 */
  triggerPct: number;
  lots: FundSwingLot[];
  qualifiedCount: number;
  qualifiedShares: number;
  /** 达标批次按现价合计能卖多少钱 */
  candidateAmount: number;
  /** 实际可卖金额（已和 0 费额度取小） */
  sellableAmount: number;
  /** 减仓主指令：今天该赎回的份额（场外只能按份额下单） */
  suggestedShares: number;
  /** 参考金额 = suggestedShares × 现价，只是账本用的换算结果 */
  suggestedAmount: number;
  /** true = 剩余不足一手，今天不该卖 */
  belowMinLot: boolean;
  /** 已做过波段、不再重复计入的份额与笔数 */
  closedShares: number;
  closedAmount: number;
  closedSellCount: number;
  /** candidates=受限于达标金额；feeFree=受限于 0 费额度；null=没有达标批次 */
  cappedBy: 'candidates' | 'feeFree' | null;
  feeFreeAmount: number | null;
  note: string;
}

/**
 * 一个持仓批次。
 *
 * base = 原始底仓：前半年反复投入累积的结果，没有单一买入日、
 * 也没有单一单位净值，unitCost 是加权平均。它整批豁免赎回费。
 * buy = 系统上线后按建议买入的批次，日期与净值都真实。
 */
export interface FundLotDetail {
  kind: 'base' | 'buy';
  /** base 为 null —— 底仓没有可信买入日，宁可空着也不给假日期 */
  buyDate: string | null;
  dateKnown: boolean;
  unitCost: number;
  shares: number;
  costAmount: number;
  /** base 为 null —— 半年累积，算不出一个持有天数 */
  daysHeld: number | null;
  feePct: number;
  /** true 表示整批豁免赎回费（原始底仓） */
  feeExempt: boolean;
  source: string | null;
}

export interface FundSellSegment {
  feePct: number;
  shares: number;
  /** 卖到这个份额时的累计上限 */
  uptoShares: number;
  /** 卖到这个金额时的累计上限 */
  uptoAmount: number;
}

export interface FundSellPlan {
  nav: number;
  totalShares: number;
  feeFreeShares: number;
  feeFreeAmount: number;
  /** 原始底仓的汇总，页面单独展示成「历史累积仓位」 */
  base: { shares: number; costAmount: number; unitCost: number; feeExempt: boolean } | null;
  segments: FundSellSegment[];
  note: string;
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
  /** 波段止盈线（%）：单次加仓浮盈到这个比例就卖掉那部分 */
  swingTargetPct: number;
}

/** 一个提示词模板（工作台托管，各执行方都从这里取） */
export interface FundPromptTemplate {
  kind: string;
  label: string;
  text: string;
  /** true = 页面上改过（存在 settings 里）；false = 用代码里的出厂默认 */
  isCustom: boolean;
  updatedAt: number | null;
  /** 必须保留的占位符，删了渲染出来就缺令牌 */
  requires: string[];
}

export interface FundPromptOverview {
  base: string;
  kinds: FundPromptTemplate[];
  /** canAnalyze=能不能出分析建议（现在只有唯一模型）；canSettle=能不能写账本 */
  sources: Array<{ source: string; label: string; canSettle: boolean; canAnalyze?: boolean }>;
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

/* ---------- 决策复盘（事后评估） ---------- */

/** 某组建议在某个前瞻窗口上的统计（三大口径各一套） */
export interface EvalStat {
  label: string;
  count: number;
  /** 样本不足门槛（默认 5），不足时数字只作参考 */
  insufficient: boolean;
  avgScorePct: number | null;
  medianScorePct: number | null;
  stdScorePct: number | null;
  winRate: number | null;
  wins: number;
  losses: number;
  /** 得 0 分的行（机会成本口径下的 hold）：既不算胜也不算负 */
  even: number;
  bestScorePct: number | null;
  best: EvalBrief | null;
  worstScorePct: number | null;
  worst: EvalBrief | null;
}

export interface EvalBrief {
  id: number;
  code: string;
  name: string;
  tradeDate: string;
  action: FundAction;
  source: string;
  amount: number;
  value: number;
}

/** 金额口径：按各自建议金额折算成元 */
export interface EvalMoneyStat {
  label: string;
  count: number;
  insufficient: boolean;
  totalProfit: number;
  avgProfit: number;
  avgReturnPct: number | null;
  wins: number;
  losses: number;
}

export interface EvalWindowStat {
  key: string;
  label: string;
  days: number;
  /** 方向口径：只算真正下注的建议 */
  directional: EvalStat;
  /** 机会成本口径：所有建议都算，hold 记 0 */
  opportunity: EvalStat;
  money: EvalMoneyStat;
  hold: {
    count: number;
    avgFwdPct: number | null;
    /** 持有期间基金下跌的次数（避开了亏损） */
    avoidedDrop: number;
    /** 持有期间基金上涨的次数（踏空了） */
    missedRise: number;
  };
}

/** 一条建议的前瞻得分 */
export interface EvalRow {
  id: number;
  code: string;
  name: string;
  tradeDate: string;
  source: string;
  sourceLabel: string;
  action: FundAction;
  confidence: string | null;
  amount: number;
  adopted: boolean;
  settled: boolean;
  bet: 'long' | 'short' | 'none';
  status: 'ok' | 'awaiting' | 'pending-nav';
  baseNav: number | null;
  /** 基金自身的前瞻涨跌（百分点），key 为窗口 key */
  fwd: Record<string, number | null>;
  /** 方向口径得分 */
  score: Record<string, number | null>;
  /** 机会成本口径得分 */
  unit: Record<string, number | null>;
  /** 金额口径：照这条建议做，这笔钱 N 天后多赚（元） */
  profit: Record<string, number | null>;
  hit: Record<string, boolean | null>;
}

/** 按来源 / 基金 / 置信度拆分出来的分组，key 由 groupStats 拼成 */
export interface EvalGroup extends EvalWindowStat {
  source?: string;
  sourceLabel?: string;
  code?: string;
  name?: string;
  confidence?: string;
}

/** 层 ②：某来源（或完全不操作）的模拟组合 */
export interface EvalSimulation {
  source: string;
  sourceLabel: string;
  isBaseline: boolean;
  points: FundEquityPoint[];
  trades: number;
  adviceDays: number;
  startDate: string | null;
  summary: FundEquitySummary | null;
}

/** 层 ③：一次决策里的一方（AI 建议或我的操作） */
export interface EvalMySide {
  source: string;
  sourceLabel: string;
  action: FundAction;
  confidence: string | null;
  amount: number;
  scorePct: number | null;
  profit: number | null;
}

/** 层 ③：同一天同一只基金，AI 建议 vs 我的实际操作 */
export interface EvalMyDecision {
  code: string;
  name: string;
  tradeDate: string;
  /** 实际用到的前瞻窗口；null = 还没走到任何窗口 */
  window: string | null;
  windowLabel: string;
  fundFwdPct: number | null;
  /** same 照做 / changed 我改主意 / none 该动没动 */
  status: 'same' | 'changed' | 'none';
  model: EvalMySide;
  mine: EvalMySide;
  /** 我方得分 − AI 得分（百分点）；正数说明我改得更好 */
  deltaPct: number | null;
  deltaYuan: number | null;
}

export interface EvalMySideStats {
  count: number;
  avgScorePct: number | null;
  winRate: number | null;
  totalProfit: number;
}

export interface EvalMyVsModel {
  model: string;
  modelLabel: string;
  windowNote: string;
  primary: string;
  count: number;
  evaluated: number;
  same: number;
  changed: number;
  noAction: number;
  deviations: number;
  insufficient: boolean;
  minSamples: number;
  agreeRate: number | null;
  avgDeltaPct: number | null;
  totalDeltaYuan: number;
  better: number;
  worse: number;
  modelStats: EvalMySideStats;
  mineStats: EvalMySideStats;
  decisions: EvalMyDecision[];
}

export interface FundEvaluation {
  generatedAt: number;
  primary: string;
  minSamples: number;
  windows: { key: string; days: number; label: string }[];
  /** 当前唯一的分析模型；null 表示还处在多来源模式 */
  model: string | null;
  modelLabel: string | null;
  notes: string[];
  scorecard: {
    rows: EvalRow[];
    allRows: EvalRow[];
    rowCount: number;
    truncated: boolean;
    windows: Record<string, EvalWindowStat>;
    windowSampleCounts: Record<string, number>;
    windowBetCounts: Record<string, number>;
    primary: string;
    primaryInsufficient: boolean;
    minSamples: number;
    model: string | null;
    modelLabel: string | null;
    span: { from: string; to: string; days: number } | null;
    bySource: EvalGroup[];
    byFund: EvalGroup[];
    byConfidence: EvalGroup[];
    bySourceFund: EvalGroup[];
    bySourceConfidence: EvalGroup[];
    sources: string[];
  };
  simulations: EvalSimulation[];
  vsBaseline: Record<
    string,
    {
      sourceLabel: string;
      twrPct: number | null;
      twrVsBaselinePct: number | null;
      returnVsBaselinePct: number | null;
      extraInvested: number;
      trades: number;
    }
  >;
  syncNote: string;
  baselineKey: string;
  /** 层 ③：我的操作 vs AI 建议 */
  myVsModel: EvalMyVsModel | null;
  actualSummary: FundEquitySummary | null;
  /** 真实组合曲线点位：与 simulations 共用同一条时间轴 */
  actualPoints: FundEquityPoint[];
  isolation: {
    feedbackAllowed: boolean;
    allowed: string[];
    forbidden: string[];
    reason: string;
  };
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
  /** 唯一分析模型；null = 多来源模式 */
  model: { source: string; label: string } | null;
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
