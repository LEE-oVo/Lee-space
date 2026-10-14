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
const SOURCE_PRIORITY: Record<string, number> = { manual: 0, trae: 1, workbuddy: 2 };

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
  const [source, setSource] = useState<string>('all');

  const load = useCallback(async () => {
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
  // 只有一个来源时不显示切换器，页面跟以前完全一样
  const sourceTabs = (data.sources || []).length > 1
    ? [{ source: 'all', label: '合并' }, ...(data.sources || []).map((s) => ({ source: s.source, label: s.label }))]
    : [];
  // 切了来源但那个来源还没数据时的兜底：退回合并视图的口径，不留空白页
  const settleNote = (data.settleSources || []).length === 1
    ? `账本仅 ${labelOf(data.settleSources[0])} 可写`
    : '';

  // 按来源过滤后按基金分组，「合并」视图下每只基金可能有多条（各来源一条）
  const grouped = new Map<string, FundAdvice[]>();
  for (const a of data.advice || []) {
    if (source !== 'all' && a.source !== source) continue;
    const list = grouped.get(a.code) || [];
    list.push(a);
    grouped.set(a.code, list);
  }
  for (const list of grouped.values()) {
    list.sort((x, y) => sourceRank(x.source) - sourceRank(y.source));
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
    const advice = all[0];
    const name = holding?.name || advice?.summary || code;
    const price = advice?.estimate ?? advice?.nav ?? null;
    const profitPct = canDetail ? profit(holding?.cost ?? null, price) : null;
    const pos = positions[code];
    const pts = series[code];
    // 同一天两只工具方向相反 → 明确标出来，别让用户自己去两条记录里对
    const conflict = all.length > 1
      && new Set(all.map((a) => directionOf(a.action))).size > 1;

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
            {canDetail && advice?.stale && <span className="fund-tag is-warn">数据延迟</span>}
            {canDetail && advice?.executed && !advice.settled && (
              <span className="fund-tag is-warn">
                <Icon name="clock" size={11} />
                待结算
              </span>
            )}
            {/* 合并视图下标出主建议是谁给的；单来源时不显示，避免多余噪音 */}
            {source === 'all' && advice && sourceTabs.length > 0 && (
              <span className="fund-src-badge" data-source={advice.source}>
                {labelOf(advice.source)}
              </span>
            )}
          </div>
        </div>

        <div className="fund-metrics">
          <div className="fund-metric">
            <span className="fund-metric-label">最新净值</span>
            <span className="fund-metric-value mono">
              {advice?.nav ?? '—'}
              {advice?.navPct !== null && advice?.navPct !== undefined && (
                <span className={`fund-sub ${toneClass(advice.navPct)}`}> {pctText(advice.navPct)}</span>
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

        {conflict && (
          <div className="fund-conflict">
            <span className="fund-conflict-icon">
              <Icon name="alert" size={12} />
            </span>
            <div className="fund-conflict-body">
              <div className="fund-conflict-title">两只工具判断不一致</div>
              <div className="fund-conflict-rows">
                {all.map((a) => (
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
                入账时只认{labelOf(all[0].source)}的这条——账本只有一本，不会两只都算
              </div>
            </div>
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

        {sourceTabs.length > 0 && (
          <div className="fund-source-tabs" role="tablist" aria-label="建议来源">
            {sourceTabs.map((t) => (
              <button
                key={t.source}
                role="tab"
                aria-selected={source === t.source}
                className={`fund-source-tab${source === t.source ? ' is-on' : ''}`}
                onClick={() => setSource(t.source)}
              >
                {t.label}
              </button>
            ))}
            {settleNote && <span className="fund-source-note">{settleNote}</span>}
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
          source={detail.source}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
