import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { NavChart } from '../components/NavChart';
import { FundDetailModal } from '../components/FundDetailModal';
import { formatRelative } from '../lib/format';
import type {
  FundAdvice, FundAction, FundHolding, FundNavPoint, FundOverview, FundPosition,
} from '../types';

const ACTION_LABEL: Record<FundAction, string> = {
  buy: '买入',
  add: '加仓',
  hold: '持有',
  reduce: '减仓',
  sell: '卖出',
};

const ACTION_CLASS: Record<FundAction, string> = {
  buy: 'act-buy',
  add: 'act-buy',
  hold: 'act-hold',
  reduce: 'act-sell',
  sell: 'act-sell',
};

/** 需要真金白银动手的操作：状态点会缓慢呼吸，提示这条建议是"待执行"的 */
const ACTION_ACTIVE: Record<FundAction, boolean> = {
  buy: true,
  add: true,
  hold: false,
  reduce: true,
  sell: true,
};

// 入账优先级，必须与服务端 FUND_SETTLE_PRIORITY 保持一致：
// 「合并」视图里用同一套规则挑出主建议，否则页面显示的和真正入账的会不是同一条
// 入账优先级：同一天多来源并存时，账本认排在最前的那条（与服务端 FUND_SETTLE_PRIORITY 一致）
const SOURCE_PRIORITY: Record<string, number> = { manual: 0, trae: 1, workbuddy: 2 };

// 页面主展示顺序：主工具优先，对照工具靠后。与上面刻意分开——
// 一个管「账本认哪条」，一个管「给谁看」。Trae 退为对照后不该占主位
const DISPLAY_RANK: Record<string, number> = { manual: 0, workbuddy: 1, trae: 2 };

function sourceRank(source: string) {
  return SOURCE_PRIORITY[source] ?? 9;
}

/** 判断方向：加仓 in / 减仓 out / 持有 flat。方向不同才算「分歧」 */
function directionOf(action: FundAction) {
  if (action === 'buy' || action === 'add') return 'in';
  if (action === 'hold') return 'flat';
  return 'out';
}

function pctText(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function toneClass(value: number | null | undefined) {
  if (value === null || value === undefined) return '';
  return value >= 0 ? 'up' : 'down';
}

function profit(cost: number | null, price: number | null) {
  if (!cost || !price) return null;
  return ((price - cost) / cost) * 100;
}

/** 净值序列最后两点的日涨跌；数据不足时返回 null，交给调用方回退 */
function navChangeOf(points?: FundNavPoint[]) {
  if (!points || points.length < 2) return null;
  const prev = points[points.length - 2]?.nav;
  const last = points[points.length - 1]?.nav;
  if (!prev || !last) return null;
  return ((last - prev) / prev) * 100;
}

interface DetailTarget {
  code: string;
  name: string;
  holding: FundHolding | null;
  advice: FundAdvice | undefined;
  position: FundPosition | undefined;
  source: string;
}

export function FundsPage() {
  const { can } = useAuth();
  const canDetail = can('fund:detail');
  const canManage = can('fund:manage');

  const [data, setData] = useState<FundOverview | null>(null);
  const [positions, setPositions] = useState<Record<string, FundPosition>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [series, setSeries] = useState<Record<string, FundNavPoint[]>>({});
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [expandSummary, setExpandSummary] = useState(false);
  // 默认看主工具的判断；Trae 只在我想额外对照时才切过去。
  // 若 WorkBuddy 恰好没有数据（例如刚接入），加载后会自动回退到合并视图
  const [source, setSource] = useState<string>('workbuddy');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await api.funds();
      setData(d);
      setPositions(d.positions || {});
      setError('');
      // 默认来源在该来源还没数据时回退，避免一进来就是空白页
      const has = (s: string) => (d.advice || []).some((a) => (a.source || 'workbuddy') === s);
      setSource((cur) => {
        if (cur !== 'all' && has(cur)) return cur;
        return has('workbuddy') ? 'workbuddy' : 'all';
      });
      const codes = Array.from(
        new Set([...d.holdings.map((h) => h.code), ...d.advice.map((a) => a.code)])
      );
      // 卡片只取近 20 个交易日，完整走势在详情弹窗里再拉
      const results = await Promise.all(codes.map((c) => api.fundSeries(c, 20).catch(() => null)));
      const map: Record<string, FundNavPoint[]> = {};
      codes.forEach((c, i) => {
        const r = results[i];
        if (r && r.series.length > 1) map[c] = r.series;
      });
      setSeries(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="page">
        <div className="grid cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="card" key={i}>
              <div className="skeleton" style={{ width: 110 }} />
              <div className="skeleton" style={{ width: 160, height: 22, marginTop: 10 }} />
              <div className="skeleton" style={{ width: '100%', height: 38, marginTop: 12 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return null;

  const sourceLabels: Record<string, string> = data.sourceLabels || {};
  const labelOf = (s: string) => sourceLabels[s] || s;
  // 只有一个来源时不显示切换器，页面跟以前完全一样。
  // 顺序固定为「主工具 → 其他来源 → 合并」：主视图就在最左边，
  // 每个 tab 带自己最新建议的日期，一眼能看出哪个来源没跟上
  const latestDate = (data.sources || []).reduce<string | null>(
    (m, s) => (!m || (s.lastDate && s.lastDate > m) ? s.lastDate || m : m),
    null
  );
  const sourceTabs = (data.sources || []).length > 1
    ? [
        ...(data.sources || [])
          .slice()
          .sort((a, b) => (a.source === 'workbuddy' ? -1 : b.source === 'workbuddy' ? 1 : 0))
          .map((s) => ({ source: s.source, label: s.label, lastDate: s.lastDate })),
        { source: 'all', label: '合并', lastDate: latestDate },
      ]
    : [];
  // 切了来源但那个来源还没数据时的兜底：退回合并视图的口径，不留空白页
  const settleNote = (data.settleSources || []).length === 1
    ? `账本仅 ${labelOf(data.settleSources[0])} 可写`
    : '';

  // 按来源过滤后按基金分组，「合并」视图下每只基金可能有多条（各来源一条）
  const grouped = new Map<string, FundAdvice[]>();
  for (const a of data.advice || []) {
    // 已采纳的那条即使不属于当前来源也要留下——它是我当天的实际操作，
    // 在任何视图下都该看得见，否则切到 WorkBuddy 就看不到自己采纳了什么
    if (source !== 'all' && a.source !== source && !a.executed) continue;
    const list = grouped.get(a.code) || [];
    list.push(a);
    grouped.set(a.code, list);
  }
  for (const list of grouped.values()) {
    // 展示顺序：日期新的在前；同一天优先主工具（手动补记 > WorkBuddy > Trae）。
    // 注意和入账优先级 sourceRank(manual > trae > workbuddy) 是两回事——
    // 那是决定账本认哪条，这是决定页面主展示哪条。Trae 退为对照后不该压过主工具，
    // 否则它停更几天、或同一天给出另一套判断时，页面主位显示的就不是主工具的结论
    list.sort((x, y) => {
      const byDate = String(y.tradeDate || '').localeCompare(String(x.tradeDate || ''));
      if (byDate !== 0) return byDate;
      return (DISPLAY_RANK[x.source] ?? 9) - (DISPLAY_RANK[y.source] ?? 9);
    });
  }
  const allOf = (code: string) => grouped.get(code) || [];

  const knownCodes = new Set(data.holdings.map((h) => h.code));
  const extras = [...grouped.keys()].filter((c) => !knownCodes.has(c));

  const dailies = data.dailyBySource || [];
  const activeDaily = source === 'all'
    ? data.daily
    : dailies.find((d) => d.source === source) || data.daily;

  function renderCard(code: string, holding: FundHolding | null, index: number) {
    const all = allOf(code);
    // 当天已采纳的那条优先展示：它就是我实际做的操作，比任何候选建议都重要。
    // 采纳是互斥的（一天最多一条），所以这里最多命中一条
    const adopted = all.find((a) => a.executed) || null;
    const advice = adopted || all[0];
    const name = holding?.name || advice?.summary || code;
    const pos = positions[code];
    const pts = series[code];
    // 结算后库里的最新真实净值（fund_nav 最新一条）优先于建议里带的净值。
    // 建议里的 nav 常常是建议日的前一天，结算完还显示它，就会跟同一张卡片上的
    // 市值/盈亏对不上——那两栏用的是真实净值
    const latestNav = pos?.nav ?? advice?.nav ?? null;
    const latestNavDate = pos?.navDate ?? advice?.navDate ?? null;
    const price = latestNav ?? advice?.estimate ?? null;
    const profitPct = canDetail ? profit(holding?.cost ?? null, price) : null;
    // 涨跌按净值序列自己算，别把建议日的涨跌幅套到别的日期上
    const navPct = navChangeOf(pts)
      ?? (latestNavDate && advice && latestNavDate === advice.navDate ? advice.navPct : null);
    // 只有同一天的两条建议方向相反才算真冲突。
    // 跨日期的方向不同不代表两个工具吵起来了，多半只是另一个来源没跑
    const sameDayOthers = advice
      ? all.filter((a) => a.source !== advice.source && a.tradeDate === advice.tradeDate)
      : [];
    // 已经做出选择之后就不再提示分歧——那只会让人怀疑自己选错了
    const conflict = Boolean(advice)
      && !adopted
      && sameDayOthers.length > 0
      && new Set([advice, ...sameDayOthers].map((a) => directionOf(a.action))).size > 1;
    // 真正入账的那条按入账优先级算，未必是页面主展示的这条——
    // 两个顺序现在是分开的，这里必须按账本口径说，不能说错
    const settleWinner = advice
      ? [advice, ...sameDayOthers].reduce((m, a) => (sourceRank(a.source) < sourceRank(m.source) ? a : m))
      : null;
    // 日期更早的其他来源：保留入口但说清楚是哪天的，别让人当成今天的判断
    const olderOthers = advice
      ? all.filter((a) => a.source !== advice.source && a.tradeDate < advice.tradeDate)
      : [];
    // 建议标了 stale，但后来真实净值补上了（结算入库）→ 不算延迟
    const staleNow = Boolean(advice?.stale)
      && !(latestNavDate && advice?.tradeDate && latestNavDate >= advice.tradeDate);

    return (
      <div
        className="card hoverable fund-card"
        key={code}
        style={{ animationDelay: `${index * 70}ms` }}
      >
        <div className="fund-card-top">
          <div className="fund-card-title">
            <div className="fund-name">{name}</div>
            <div className="faint mono fund-code">
              {code}
              {holding?.category ? ` · ${holding.category}` : ''}
            </div>
          </div>

          {/* 状态区：chip 永不换行、永不被长基金名压缩——之前就是被压成竖条才显得变形 */}
          <div className="fund-card-status">
            {advice ? (
              <span
                className={`fund-chip ${ACTION_CLASS[advice.action]}${ACTION_ACTIVE[advice.action] ? ' is-act' : ''}`}
              >
                <span className="fund-chip-dot" />
                <span className="fund-chip-label">{ACTION_LABEL[advice.action]}</span>
                {canDetail && advice.amount ? <b className="mono fund-chip-amt">¥{advice.amount}</b> : null}
              </span>
            ) : (
              <span className="fund-chip is-none">
                <span className="fund-chip-dot" />
                <span className="fund-chip-label">暂无建议</span>
              </span>
            )}
            {/* stale 说的是「生成建议时没取到官方估值、用的是估算口径」。
                一旦该交易日真实净值已入库，数据就不延迟了，再挂着警告只会误导 */}
            {canDetail && staleNow && (
              <span
                className="fund-tag is-warn"
                title={`生成建议时未取到当日官方估值，涨跌幅按标的指数代替；净值日期 ${advice?.navDate || '未知'}`}
              >
                <Icon name="alert" size={11} />
                估算口径
              </span>
            )}
            {canDetail && advice?.executed && !advice.settled && (
              <span className="fund-tag is-warn">
                <Icon name="clock" size={11} />
                待结算
              </span>
            )}
            {/* 建议不是主工具给的、或在合并视图下 → 标出来源与日期。
                单来源且是 WorkBuddy 时不显示，避免多余噪音 */}
            {advice && sourceTabs.length > 0 && (source === 'all' || advice.source !== 'workbuddy') && (
              <span className="fund-src-badge" data-source={advice.source}>
                {labelOf(advice.source)} {advice.tradeDate.slice(5)}
              </span>
            )}
          </div>
        </div>

        <div className="fund-metrics">
          <div className="fund-metric">
            <span className="fund-metric-label">
              最新净值{latestNavDate ? ` ${latestNavDate.slice(5)}` : ''}
            </span>
            <span className="fund-metric-value mono">
              {latestNav ?? '—'}
              {navPct !== null && navPct !== undefined && (
                <span className={`fund-sub ${toneClass(navPct)}`}> {pctText(navPct)}</span>
              )}
            </span>
          </div>
          <div className="fund-metric">
            <span className="fund-metric-label">盘中估值</span>
            <span className="fund-metric-value mono">
              {advice?.estimate ?? '—'}
              {advice?.estimatePct !== null && advice?.estimatePct !== undefined && (
                <span className={`fund-sub ${toneClass(advice.estimatePct)}`}> {pctText(advice.estimatePct)}</span>
              )}
            </span>
          </div>
          {canDetail && (
            <div className="fund-metric">
              <span className="fund-metric-label">持仓盈亏</span>
              <span className="fund-metric-value mono">
                {pos?.unrealizedPct != null ? (
                  <span className={toneClass(pos.unrealizedPct)}>{pctText(pos.unrealizedPct)}</span>
                ) : profitPct === null ? (
                  '—'
                ) : (
                  <span className={toneClass(profitPct)}>{pctText(profitPct)}</span>
                )}
                {pos?.unrealized != null && (
                  <span className={`fund-sub ${toneClass(pos.unrealized)}`}>
                    {' '}
                    {pos.unrealized >= 0 ? '+' : ''}
                    {pos.unrealized.toFixed(0)}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {canDetail && pos && (
          <div className="fund-position-line">
            <span>份额 {pos.shares}</span>
            <span>成本 {pos.cost ?? '—'}</span>
            <span>市值 ¥{pos.market ?? '—'}</span>
            {pos.realized !== 0 && (
              <span>
                已实现{' '}
                <span className={toneClass(pos.realized)}>
                  {pos.realized >= 0 ? '+' : ''}
                  {pos.realized.toFixed(2)}
                </span>
              </span>
            )}
          </div>
        )}

        {conflict && advice && (
          <div className="fund-conflict">
            <span className="fund-conflict-icon">
              <Icon name="alert" size={12} />
            </span>
            <div className="fund-conflict-body">
              <div className="fund-conflict-title">
                {advice.tradeDate.slice(5)} 两只工具判断不一致
              </div>
              <div className="fund-conflict-rows">
                {[advice, ...sameDayOthers].map((a) => (
                  <div className="fund-conflict-row" key={a.source}>
                    <span className="fund-src-badge" data-source={a.source}>{labelOf(a.source)}</span>
                    <span className={`fund-conflict-act ${directionOf(a.action)}`}>
                      {ACTION_LABEL[a.action]}
                      {a.amount ? ` ¥${a.amount.toLocaleString('zh-CN')}` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className="fund-conflict-foot">
                {settleWinner
                  ? `入账时只认${labelOf(settleWinner.source)}的这条——账本只有一本，不会两只都算`
                  : '账本只有一本，不会两只都算'}
              </div>
            </div>
          </div>
        )}

        {/* 其他来源停在更早的日期：只是没跟上，不是分歧，用更轻的提示 */}
        {!conflict && olderOthers.length > 0 && advice && (
          <div className="fund-older-note">
            <Icon name="clock" size={11} />
            另有 {olderOthers.map((a) => `${labelOf(a.source)} ${a.tradeDate.slice(5)}`).join('、')}
            的判断（早于 {advice.tradeDate.slice(5)}），切换来源可查看
          </div>
        )}

        {advice?.summary && <div className="fund-oneline">{advice.summary}</div>}

        {pts && pts.length > 1 && (
          <div className="fund-spark">
            <NavChart points={pts} compact />
          </div>
        )}

        <div className="fund-foot">
          <button
            className="btn sm fund-detail-btn"
            onClick={() =>
              setDetail({ code, name, holding, advice, position: positions[code], source })
            }
          >
            <Icon name="chart" size={13} />
            {canDetail ? '查看详情' : '查看走势'}
            <span className="btn-arrow">
              <Icon name="chevRight" size={13} />
            </span>
          </button>
          {advice?.updatedAt && (
            <span className="faint" style={{ fontSize: 11 }}>{formatRelative(advice.updatedAt)}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card hoverable fund-head">
        <div className="fund-head-glow" aria-hidden="true" />
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="fund-head-icon">
              <Icon name="chart" size={15} />
            </span>
            <span style={{ fontWeight: 500 }}>基金行情与操作建议</span>
            {data.daily?.tradeDate && (
              <span className="fund-live">
                <span className="dot live" />
                {activeDaily?.tradeDate || data.daily.tradeDate}
              </span>
            )}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {canManage && (
              <Link className="btn sm" to="/funds/settings">
                <Icon name="settings" size={13} />
                持仓配置
              </Link>
            )}
            <button
              className="btn ghost sm"
              onClick={() => void load()}
              title="刷新"
              disabled={refreshing}
            >
              <span className={refreshing ? 'icon-spin' : undefined}>
                <Icon name="refresh" size={15} />
              </span>
            </button>
          </div>
        </div>

        {/* 额度与收益一眼看完：模型就是照这几个数决定加仓节奏的 */}
        {canDetail && data.investment && data.investment.totalBudget > 0 && (
          <div className="fund-budget-line">
            <span>
              已投入 <b className="mono">¥{Math.round(data.investment.used).toLocaleString('zh-CN')}</b>
              {' / '}
              {Math.round(data.investment.totalBudget).toLocaleString('zh-CN')}
            </span>
            <span>
              剩余可投{' '}
              <b className="mono up">
                ¥{Math.round(data.investment.remaining ?? 0).toLocaleString('zh-CN')}
              </b>
            </span>
            <span>
              目标{' '}
              <b className="mono">
                {data.investment.targetReturnPct >= 0 ? '+' : ''}
                {data.investment.targetReturnPct}%
              </b>
              {data.investment.targetAmount != null && (
                <span className="faint">
                  {' '}
                  （¥{Math.round(data.investment.targetAmount).toLocaleString('zh-CN')}）
                </span>
              )}
            </span>
            {data.investment.returnPct !== null && (
              <span>
                当前{' '}
                <b className={`mono ${data.investment.returnPct >= 0 ? 'up' : 'down'}`}>
                  {data.investment.returnPct >= 0 ? '+' : ''}
                  {data.investment.returnPct.toFixed(2)}%
                </b>
              </span>
            )}
            {canManage && (
              <Link className="fund-budget-link" to="/funds/settings">
                调整
                <Icon name="chevRight" size={12} />
              </Link>
            )}
          </div>
        )}

        {sourceTabs.length > 0 && (
          <div className="fund-source-tabs" role="tablist" aria-label="建议来源">
            {sourceTabs.map((t) => (
              <button
                key={t.source}
                role="tab"
                aria-selected={source === t.source}
                className={`fund-source-tab${source === t.source ? ' is-on' : ''}`}
                onClick={() => setSource(t.source)}
                title={t.lastDate ? `最新建议日期 ${t.lastDate}` : undefined}
              >
                {t.label}
                {t.lastDate ? (
                  <span
                    className={`fund-tab-date${latestDate && t.lastDate < latestDate ? ' is-old' : ''}`}
                  >
                    {t.lastDate.slice(5)}
                  </span>
                ) : null}
              </button>
            ))}
            {/* 有来源落后时点破：那个日期不是最新的，别拿它当当前判断 */}
            {(() => {
              const notes = [];
              if (settleNote) notes.push(settleNote);
              if (latestDate && sourceTabs.some((t) => t.lastDate && t.lastDate < latestDate)) {
                notes.push('灰色日期＝该来源最近一次分析的时间');
              }
              return notes.length > 0
                ? <span className="fund-source-note">{notes.join(' · ')}</span>
                : null;
            })()}
          </div>
        )}

        {activeDaily?.summary ? (
          <>
            <div className={`fund-market${expandSummary ? '' : ' clamp'}`}>{activeDaily.summary}</div>
            <div className="row" style={{ justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
              <span className="faint" style={{ fontSize: 12 }}>
                {sourceTabs.length > 0 ? `${labelOf(activeDaily.source || 'workbuddy')} · ` : ''}
                由定时任务调用大模型生成 · {formatRelative(activeDaily.updatedAt)}
              </span>
              <button className="btn ghost sm" onClick={() => setExpandSummary((v) => !v)}>
                {expandSummary ? '收起' : '展开全文'}
              </button>
            </div>
          </>
        ) : (
          <div className="fund-empty">
            {source === 'all'
              ? '还没有分析数据。定时任务会在'
              : `${labelOf(source)} 还没有投过建议。它自己的定时任务跑完后这里就会出现，`}
            {source === 'all' && (
              <>
                <b>工作日 14:30</b> 自动运行，
                抓取行情后由大模型给出操作建议并推送到工作台。
              </>
            )}
            {canManage && source === 'all' && ' 也可以先到「持仓配置」录入你的基金。'}
          </div>
        )}
      </div>

      {data.holdings.length > 0 ? (
        <div className="grid cols-3 mb-12">
          {data.holdings.map((h, i) => renderCard(h.code, h, i))}
        </div>
      ) : (
        !data.daily && (
          <div className="card">
            <div className="faint" style={{ fontSize: 13 }}>
              还没有录入持仓。
              {canManage ? '到「持仓配置」里添加基金代码与成本价，定时任务就会开始跟踪它们。' : '请联系管理员录入持仓。'}
            </div>
          </div>
        )
      )}

      {extras.length > 0 && (
        <>
          <div className="faint" style={{ fontSize: 12, margin: '4px 0 10px' }}>
            以下基金有建议但未录入持仓（可能已清仓）：
          </div>
          <div className="grid cols-3 mb-12">
            {extras.map((code, i) => renderCard(code, null, i + data.holdings.length))}
          </div>
        </>
      )}

      <div className="fund-disclaimer">
        <Icon name="alert" size={13} />
        由 AI 自动汇总公开信息生成，仅供参考，不构成投资建议
      </div>

      {detail && (
        <FundDetailModal
          code={detail.code}
          name={detail.name}
          holding={detail.holding}
          advice={detail.advice}
          position={detail.position}
          canDetail={canDetail}
          canManage={canManage}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
