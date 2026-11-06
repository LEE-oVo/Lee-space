import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { NavChart } from '../components/NavChart';
import { EquityChart } from '../components/EquityChart';
import { FundDetailModal } from '../components/FundDetailModal';
import { formatRelative } from '../lib/format';
import type {
  FundAdvice, FundAction, FundEquity, FundHolding, FundNavPoint, FundOverview, FundPosition,
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

// 2026-11-06 起只保留一个分析模型：页面不再有来源切换、冲突对比、入账优先级。
// 历史 WorkBuddy / Trae 建议仍留在库里，由服务端过滤，前端拿不到也就不会画出来。
const MANUAL_RANK: Record<string, number> = { manual: 0 };

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

/** 估值抓取时间转成 HH:MM，让用户一眼判断数据新鲜度 */
function timeText(sec?: number | null) {
  if (!sec) return '';
  return new Date(sec * 1000).toLocaleTimeString('zh-CN', {
    hour12: false, hour: '2-digit', minute: '2-digit',
  });
}

interface DetailTarget {
  code: string;
  name: string;
  holding: FundHolding | null;
  advice: FundAdvice | undefined;
  position: FundPosition | undefined;
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
  // 组合收益曲线：含金额，只有能看金额的人才会去拉。
  // 'loading' / 'ready' / 'error' 分开存，否则拉取失败会一直卡在「加载中」
  const [equity, setEquity] = useState<FundEquity | null>(null);
  const [equityState, setEquityState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [equityAt, setEquityAt] = useState<number | null>(null);
  // 「刷新估值」按钮的状态：拉完顺便把整页数据一起重载，这样卡片上显示的
  // 就是刚拉到的最新估值，不用再手动点一次刷新
  const [quotePulling, setQuotePulling] = useState(false);
  const [quoteNote, setQuoteNote] = useState('');
  const lastLoadAt = useRef(0);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [expandSummary, setExpandSummary] = useState(false);

  const load = useCallback(async () => {
    lastLoadAt.current = Date.now();
    setRefreshing(true);
    try {
      const d = await api.funds();
      setData(d);
      setPositions(d.positions || {});
      setError('');
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
      // 收益曲线单独一个请求：它算的是全量历史，慢一点也不该拖住上面的卡片。
      // 每次都是重新从库里算，结算跑完只要刷新就是新的。
      // 决策复盘已经挪到独立页面 /funds/evaluation，这里不再跟着它一起重算
      if (canDetail) {
        try {
          setEquity(await api.fundEquity());
          setEquityAt(Date.now());
          setEquityState('ready');
        } catch {
          setEquityState('error');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canDetail]);

  /** 手动拉一次盘中估值：先刷新估值，再重载整页，让卡片立刻反映最新数 */
  const pullQuotes = useCallback(async () => {
    setQuotePulling(true);
    setQuoteNote('');
    try {
      const r = await api.refreshFundQuotes();
      if (!r.trading) {
        setQuoteNote('当前不在盘中时段，展示的是最近一次估值');
      } else if ((r.unresolved || []).length > 0) {
        setQuoteNote(`已更新 ${r.written} 只，${r.unresolved!.join('、')} 未取到`);
      } else {
        setQuoteNote(`已更新 ${r.written} 只`);
      }
      await load();
    } catch (err) {
      setQuoteNote(err instanceof Error ? err.message : '拉取失败');
    } finally {
      setQuotePulling(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  // 切回这个标签页时自动刷新：定时任务常在后台跑完（13:00 结算、14:30 建议），
  // 一直开着页面反而看不到新数据。节流 30 秒，避免来回切标签刷个不停
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadAt.current < 30000) return;
      void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (loading) {
    return (
      <div className="page">
        <div className="fund-list">
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
  // 唯一分析模型的名字：页面只在页头标一次，不再有来源切换器
  const modelLabel = data.model?.label || '';

  // 按基金分组。服务端已经只下发「唯一模型 + 手动补记」，同一天最多两条：
  // 一条是 AI 建议，一条是我自己的补记（只有我改主意时才会有）
  const grouped = new Map<string, FundAdvice[]>();
  for (const a of data.advice || []) {
    const list = grouped.get(a.code) || [];
    list.push(a);
    grouped.set(a.code, list);
  }
  for (const list of grouped.values()) {
    // 日期新的在前；同一天优先我的手动的补记——那才是我实际做的事
    list.sort((x, y) => {
      const byDate = String(y.tradeDate || '').localeCompare(String(x.tradeDate || ''));
      if (byDate !== 0) return byDate;
      return (MANUAL_RANK[x.source] ?? 9) - (MANUAL_RANK[y.source] ?? 9);
    });
  }
  const allOf = (code: string) => grouped.get(code) || [];

  const knownCodes = new Set(data.holdings.map((h) => h.code));
  const extras = [...grouped.keys()].filter((c) => !knownCodes.has(c));

  const activeDaily = data.daily;

  function renderCard(code: string, holding: FundHolding | null, index: number) {
    const all = allOf(code);
    // 已经采纳/执行的那条优先展示：它就是我实际做的操作，比任何候选建议都重要。
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
    // 建议标了 stale，但后来真实净值补上了（结算入库）→ 不算延迟
    const staleNow = Boolean(advice?.stale)
      && !(latestNavDate && advice?.tradeDate && latestNavDate >= advice.tradeDate);

    // 盘中估值优先读服务端快照：定时器每 5 分钟刷新一次 fund_quote，
    // 而 advice.estimate 是模型写入那一刻冻结的，不会跟着定时任务更新。
    // 只有快照不可用（跨日或太久没刷新）时才退回模型带的那一份。
    const live = data?.quotes?.[code];
    const est = live && live.estimate != null
      ? { estimate: live.estimate, estimatePct: live.estimatePct }
      : { estimate: advice?.estimate ?? null, estimatePct: advice?.estimatePct ?? null };
    const estStale = Boolean(live && !live.fresh);

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
            {/* 结算完也要留个痕迹，否则看不出今天到底操作过没有 */}
            {canDetail && advice?.executed && advice?.settled && (
              <span className="fund-tag is-done">
                <Icon name="check" size={11} />
                已入账
              </span>
            )}
            {/* 只有手动补记才需要标出来：它代表我当天改了自己的主意，不是 AI 的建议 */}
            {advice && advice.source === 'manual' && (
              <span className="fund-src-badge" data-source="manual">
                {labelOf('manual')} {advice.tradeDate.slice(5)}
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
          <div
            className={`fund-metric${estStale ? ' is-stale' : ''}`}
            title={live?.proxy
              ? `来源：${live.proxy}${live.fresh ? '' : '（已过期，仅供参考）'}`
              : undefined}
          >
            <span className="fund-metric-label">
              盘中估值{live?.asOf ? ` ${timeText(live.asOf)}` : ''}
            </span>
            <span className="fund-metric-value mono">
              {est.estimate ?? '—'}
              {est.estimatePct !== null && est.estimatePct !== undefined && (
                <span className={`fund-sub ${toneClass(est.estimatePct)}`}> {pctText(est.estimatePct)}</span>
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
            <span>成本 {pos.cost != null ? Number(pos.cost).toFixed(4) : '—'}</span>
            <span>市值 ¥{pos.market ?? '—'}</span>
            {pos.sellPlan && pos.sellPlan.feeFreeAmount > 0 && (
              <span title="按 FIFO 顺序，卖出这个金额以内不扣赎回费">
                可 0 费卖 <span className="up">¥{pos.sellPlan.feeFreeAmount.toFixed(0)}</span>
              </span>
            )}
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
              setDetail({ code, name, holding, advice, position: positions[code] })
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
            {modelLabel && (
              <span className="fund-tag is-done" title="工作台现在只保留这一个分析模型">
                <Icon name="check" size={11} />
                {modelLabel}
              </span>
            )}
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
            {/* 手动拉一次盘中估值。平时靠定时任务每 5 分钟自己刷，
                想临时看一眼最新的（比如刚有大波动）就点这里 */}
            <button
              className="btn sm"
              onClick={() => void pullQuotes()}
              title="立即拉取实时盘中估值"
              disabled={quotePulling}
            >
              <span className={quotePulling ? 'icon-spin' : undefined}>
                <Icon name="refresh" size={13} />
              </span>
              {quotePulling ? '拉取中' : '刷新估值'}
            </button>
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

        {quoteNote && (
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>{quoteNote}</div>
        )}

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

        {/* 组合收益曲线：单独拉，免得它慢了把整个页面拖住 */}
        {canDetail && (
          <div className="card equity-card">
            {equityState === 'ready' && equity ? (
              <EquityChart data={equity} updatedAt={equityAt} onRefresh={() => void load()} />
            ) : equityState === 'error' ? (
              <div className="equity-empty">
                收益曲线加载失败
                <button type="button" className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => void load()}>
                  重试
                </button>
              </div>
            ) : (
              <div className="equity-empty">收益曲线加载中…</div>
            )}
          </div>
        )}

        {/* 决策复盘不再塞在这页里——它回答的是「过去准不准」，和「今天怎么做」是两种心态，
            而且全量重算不该跟着基金页一起触发。这里只留一个入口 */}
        {canDetail && (
          <div className="card eval-entry">
            <div className="eval-entry-text">
              <div className="eval-entry-title">决策复盘</div>
              <div className="faint">
                {modelLabel || 'AI'} 的每条建议按自己的未来净值单独打分，再看你的实际操作比它好还是差
              </div>
            </div>
            <Link className="btn ghost sm" to="/funds/evaluation">
              查看
              <Icon name="chevRight" size={12} />
            </Link>
          </div>
        )}

        {activeDaily?.summary ? (
          <>
            <div className={`fund-market${expandSummary ? '' : ' clamp'}`}>{activeDaily.summary}</div>
            <div className="row" style={{ justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
              <span className="faint" style={{ fontSize: 12 }}>
                {modelLabel ? `${modelLabel} · ` : ''}
                由定时任务调用大模型生成 · {formatRelative(activeDaily.updatedAt)}
              </span>
              <button className="btn ghost sm" onClick={() => setExpandSummary((v) => !v)}>
                {expandSummary ? '收起' : '展开全文'}
              </button>
            </div>
          </>
        ) : (
          <div className="fund-empty">
            还没有分析数据。{modelLabel || 'AI'} 的定时任务会在
            <b> 工作日 14:30 </b>
            自动运行，抓取行情后给出操作建议并推送到工作台。
            {canManage && ' 也可以先到「持仓配置」录入你的基金。'}
          </div>
        )}
      </div>

      {data.holdings.length > 0 ? (
        <div className="fund-list mb-12">
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
          <div className="fund-list mb-12">
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
          sourceLabels={sourceLabels}
          onClose={() => setDetail(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
