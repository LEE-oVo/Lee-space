import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { FundHoldings } from '../components/FundHoldings';
import { formatRelative } from '../lib/format';
import type { FundAdvice, FundAction, FundHolding, FundOverview } from '../types';

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

const CONF_LABEL: Record<string, string> = { low: '把握低', medium: '把握中', high: '把握高' };

function pctText(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function toneClass(value: number | null | undefined) {
  if (value === null || value === undefined) return '';
  return value >= 0 ? 'up' : 'down';
}

/** 用估值优先（盘中），没有估值时退回最新净值 */
function currentPrice(a: FundAdvice | undefined) {
  if (!a) return null;
  return a.estimate ?? a.nav ?? null;
}

function profit(cost: number | null, price: number | null) {
  if (!cost || !price) return null;
  return ((price - cost) / cost) * 100;
}

export function FundsPage() {
  const { can } = useAuth();
  const [data, setData] = useState<FundOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [histories, setHistories] = useState<Record<string, FundAdvice[]>>({});
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.funds());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleHistory(code: string) {
    if (openHistory === code) {
      setOpenHistory(null);
      return;
    }
    setOpenHistory(code);
    if (histories[code]) return;
    try {
      const res = await api.fundHistory(code, 10);
      setHistories((prev) => ({ ...prev, [code]: res.history }));
    } catch {
      setHistories((prev) => ({ ...prev, [code]: [] }));
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="grid cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div className="card" key={i}>
              <div className="skeleton" style={{ width: 120 }} />
              <div className="skeleton" style={{ width: 200, height: 24, marginTop: 10 }} />
              <div className="skeleton" style={{ width: '100%', height: 44, marginTop: 12 }} />
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

  function renderCard(holding: FundHolding | null, advice: FundAdvice | undefined) {
    const code = holding?.code || advice?.code || '';
    const name = holding?.name || advice?.summary || code;
    const price = currentPrice(advice);
    const cost = holding?.cost ?? null;
    const profitPct = profit(cost, price);
    const profitAmount =
      holding?.shares && cost !== null && price !== null ? (price - cost) * holding.shares : null;

    return (
      <div className="card fund-card" key={code}>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 15 }}>{name}</div>
            <div className="faint mono" style={{ fontSize: 11 }}>
              {code}
              {holding?.category ? ` · ${holding.category}` : ''}
            </div>
          </div>
          {advice ? (
            <span className={`pill fund-action ${ACTION_CLASS[advice.action]}`}>
              {ACTION_LABEL[advice.action]}
              {advice.confidence ? ` · ${CONF_LABEL[advice.confidence] || advice.confidence}` : ''}
            </span>
          ) : (
            <span className="pill">暂无建议</span>
          )}
        </div>

        <div className="fund-metrics">
          <div className="fund-metric">
            <span className="fund-metric-label">最新净值</span>
            <span className="fund-metric-value mono">
              {advice?.nav ?? '—'}
              {advice?.navPct !== null && advice?.navPct !== undefined ? (
                <span className={`fund-sub ${toneClass(advice.navPct)}`}> {pctText(advice.navPct)}</span>
              ) : null}
            </span>
          </div>
          <div className="fund-metric">
            <span className="fund-metric-label">盘中估值</span>
            <span className="fund-metric-value mono">
              {advice?.estimate ?? '—'}
              {advice?.estimatePct !== null && advice?.estimatePct !== undefined ? (
                <span className={`fund-sub ${toneClass(advice.estimatePct)}`}> {pctText(advice.estimatePct)}</span>
              ) : null}
            </span>
          </div>
          <div className="fund-metric">
            <span className="fund-metric-label">持仓盈亏</span>
            <span className="fund-metric-value mono">
              {profitPct === null ? '—' : <span className={toneClass(profitPct)}>{pctText(profitPct)}</span>}
              {profitAmount !== null ? (
                <span className={`fund-sub ${toneClass(profitAmount)}`}>
                  {' '}
                  {profitAmount >= 0 ? '+' : ''}
                  {profitAmount.toFixed(2)}
                </span>
              ) : null}
            </span>
          </div>
          <div className="fund-metric">
            <span className="fund-metric-label">成本价</span>
            <span className="fund-metric-value mono">{cost ?? '—'}</span>
          </div>
        </div>

        {advice?.stale && (
          <div className="fund-stale">
            <Icon name="alert" size={13} />
            当日净值尚未更新，以上基于收盘估值，仅供参考
          </div>
        )}

        {advice?.summary && <div className="fund-summary">{advice.summary}</div>}
        {advice?.reason && <div className="fund-reason">{advice.reason}</div>}

        {advice && advice.risks.length > 0 && (
          <ul className="fund-risks">
            {advice.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}

        {advice && advice.sources.length > 0 && (
          <div className="fund-sources">
            {advice.sources.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title || s.url}
              </a>
            ))}
          </div>
        )}

        <div className="fund-foot">
          <button className="btn ghost sm" onClick={() => void toggleHistory(code)}>
            <Icon name="chart" size={13} />
            {openHistory === code ? '收起历史' : '建议历史'}
          </button>
          {advice?.updatedAt && (
            <span className="faint" style={{ fontSize: 11 }}>
              {advice.tradeDate} · {formatRelative(advice.updatedAt)}更新
            </span>
          )}
        </div>

        {openHistory === code && (
          <div className="fund-history">
            {histories[code] === undefined ? (
              <span className="faint" style={{ fontSize: 12 }}>加载中…</span>
            ) : histories[code]!.length === 0 ? (
              <span className="faint" style={{ fontSize: 12 }}>暂无历史记录</span>
            ) : (
              histories[code]!.map((h) => (
                <div className="fund-history-row" key={h.tradeDate}>
                  <span className="faint mono" style={{ fontSize: 12 }}>{h.tradeDate}</span>
                  <span className={`pill sm ${ACTION_CLASS[h.action]}`}>{ACTION_LABEL[h.action]}</span>
                  <span className="faint" style={{ fontSize: 12, minWidth: 0 }}>{h.summary || '—'}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card hoverable fund-head">
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <Icon name="chart" size={17} />
            <span style={{ fontWeight: 500 }}>基金行情与操作建议</span>
            {data.daily?.tradeDate && (
              <span className="faint" style={{ fontSize: 12 }}>{data.daily.tradeDate}</span>
            )}
          </div>
          <button className="btn ghost sm" onClick={() => void load()} title="刷新">
            <Icon name="refresh" size={15} />
          </button>
        </div>

        {data.daily?.summary ? (
          <>
            <div className="fund-market">{data.daily.summary}</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              由 WorkBuddy 定时任务调用大模型生成 · {formatRelative(data.daily.updatedAt)}
              {data.daily.model ? ` · ${data.daily.model}` : ''}
            </div>
          </>
        ) : (
          <div className="fund-empty">
            还没有任何分析数据。定时任务会在<b>工作日 14:30</b> 自动运行，
            抓取当日行情后由大模型给出操作建议并推送到工作台。
            也可以先到下方「持仓管理」录入你的基金。
          </div>
        )}
      </div>

      {data.holdings.length > 0 ? (
        <div className="grid cols-2 mb-12">
          {data.holdings.map((h) => renderCard(h, adviceByCode.get(h.code)))}
        </div>
      ) : (
        !data.daily && (
          <div className="card">
            <div className="faint" style={{ fontSize: 13 }}>
              还没有录入持仓。在下方「持仓管理」里添加基金代码与成本价，定时任务就会开始跟踪它们。
            </div>
          </div>
        )
      )}

      {extras.length > 0 && (
        <>
          <div className="faint" style={{ fontSize: 12, margin: '4px 0 10px' }}>
            以下基金有建议但未录入持仓（可能已清仓）：
          </div>
          <div className="grid cols-2 mb-12">{extras.map((a) => renderCard(null, a))}</div>
        </>
      )}

      {can('fund:manage') && <FundHoldings holdings={data.holdings} onChanged={() => void load()} />}

      <div className="fund-disclaimer">
        <Icon name="alert" size={13} />
        以上内容由 AI 自动汇总公开信息生成，仅作参考，不构成任何投资建议。市场有风险，决策请自行判断。
      </div>
    </div>
  );
}
