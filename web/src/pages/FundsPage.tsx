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

  const adviceByCode = new Map(data.advice.map((a) => [a.code, a]));
  const knownCodes = new Set(data.holdings.map((h) => h.code));
  const extras = data.advice.filter((a) => !knownCodes.has(a.code));

  function renderCard(holding: FundHolding | null, advice: FundAdvice | undefined, index: number) {
    const code = holding?.code || advice?.code || '';
    const name = holding?.name || advice?.summary || code;
    const price = advice?.estimate ?? advice?.nav ?? null;
    const profitPct = canDetail ? profit(holding?.cost ?? null, price) : null;
    const pos = positions[code];
    const pts = series[code];

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

        {advice?.summary && <div className="fund-oneline">{advice.summary}</div>}

        {pts && pts.length > 1 && (
          <div className="fund-spark">
            <NavChart points={pts} compact />
          </div>
        )}

        <div className="fund-foot">
          <button
            className="btn sm fund-detail-btn"
            onClick={() => setDetail({ code, name, holding, advice, position: positions[code] })}
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
                {data.daily.tradeDate}
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

        {data.daily?.summary ? (
          <>
            <div className={`fund-market${expandSummary ? '' : ' clamp'}`}>{data.daily.summary}</div>
            <div className="row" style={{ justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
              <span className="faint" style={{ fontSize: 12 }}>
                由定时任务调用大模型生成 · {formatRelative(data.daily.updatedAt)}
              </span>
              <button className="btn ghost sm" onClick={() => setExpandSummary((v) => !v)}>
                {expandSummary ? '收起' : '展开全文'}
              </button>
            </div>
          </>
        ) : (
          <div className="fund-empty">
            还没有分析数据。定时任务会在<b>工作日 14:30</b> 自动运行，
            抓取行情后由大模型给出操作建议并推送到工作台。
            {canManage && ' 也可以先到「持仓配置」录入你的基金。'}
          </div>
        )}
      </div>

      {data.holdings.length > 0 ? (
        <div className="grid cols-3 mb-12">
          {data.holdings.map((h, i) => renderCard(h, adviceByCode.get(h.code), i))}
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
            {extras.map((a, i) => renderCard(null, a, i + data.holdings.length))}
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
