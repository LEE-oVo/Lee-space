import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { NavChart } from '../components/NavChart';
import { formatRelative } from '../lib/format';
import type { FundAdvice, FundAction, FundHolding, FundNavPoint } from '../types';

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

interface Props {
  code: string;
  name: string;
  holding: FundHolding | null;
  advice: FundAdvice | undefined;
  canDetail: boolean;
  onClose: () => void;
}

export function FundDetailModal({ code, name, holding, advice, canDetail, onClose }: Props) {
  const [series, setSeries] = useState<FundNavPoint[] | null>(null);
  const [history, setHistory] = useState<FundAdvice[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, h] = await Promise.all([
          api.fundSeries(code, 1000),
          canDetail ? api.fundHistory(code, 10) : Promise.resolve({ history: [] as FundAdvice[] }),
        ]);
        if (!alive) return;
        setSeries(s.series);
        setHistory(h.history);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '加载失败');
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [code, canDetail]);

  const price = advice?.estimate ?? advice?.nav ?? null;
  const cost = holding?.cost ?? null;
  const profitPct = cost && price ? ((price - cost) / cost) * 100 : null;
  const profitAmount =
    holding?.shares && cost !== null && price !== null ? (price - cost) * holding.shares : null;

  return (
    <Modal
      title={
        <span className="row" style={{ gap: 8 }}>
          <span>{name || code}</span>
          {advice && (
            <span className={`pill fund-action ${ACTION_CLASS[advice.action]}`}>
              {ACTION_LABEL[advice.action]}
            </span>
          )}
        </span>
      }
      subtitle={<span className="mono">{code}</span>}
      onClose={onClose}
    >
      {error && <div className="alert error">{error}</div>}

      <div className="fund-detail-block">
        <div style={{ fontWeight: 500, marginBottom: 8 }}>
          净值走势
          {series && series.length > 1 && (
            <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
              {' '}
              · 全部 {series.length} 个交易日
            </span>
          )}
        </div>
        {series === null ? (
          <div className="skeleton" style={{ height: 190 }} />
        ) : (
          <NavChart points={series} />
        )}
      </div>

      {!canDetail && (
        <div className="fund-locked">
          <Icon name="shield" size={15} />
          <div>
            当前角色（游客）不能查看持仓金额与详细分析。
            <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
              净值与操作建议是公开的，涉及个人持仓的部分已由服务端屏蔽。
            </div>
          </div>
        </div>
      )}

      {canDetail && (
        <>
          {advice?.stale && (
            <div className="fund-stale">
              <Icon name="alert" size={13} />
              当日净值尚未更新，以上基于收盘估值，仅供参考
            </div>
          )}

          {advice?.reason && (
            <div className="fund-detail-block">
              <div style={{ fontWeight: 500, marginBottom: 6 }}>分析依据</div>
              <div className="fund-reason">{advice.reason}</div>
            </div>
          )}

          {advice && advice.risks.length > 0 && (
            <div className="fund-detail-block">
              <div style={{ fontWeight: 500, marginBottom: 6 }}>风险提示</div>
              <ul className="fund-risks">
                {advice.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {advice && advice.sources.length > 0 && (
            <div className="fund-detail-block">
              <div style={{ fontWeight: 500, marginBottom: 6 }}>信息来源</div>
              <div className="fund-sources">
                {advice.sources.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title || s.url}
                  </a>
                ))}
              </div>
            </div>
          )}

          {holding && (
            <div className="fund-detail-block">
              <div style={{ fontWeight: 500, marginBottom: 8 }}>我的持仓</div>
              <table className="data">
                <tbody>
                  <tr>
                    <td className="muted" style={{ width: 110 }}>成本价</td>
                    <td className="mono">{cost ?? '—'}</td>
                    <td className="muted" style={{ width: 110 }}>持有份额</td>
                    <td className="mono">{holding.shares ?? '—'}</td>
                  </tr>
                  <tr>
                    <td className="muted">投入金额</td>
                    <td className="mono">{holding.amount ?? '—'}</td>
                    <td className="muted">浮动盈亏</td>
                    <td className="mono">
                      {profitPct === null ? (
                        '—'
                      ) : (
                        <span className={profitPct >= 0 ? 'up' : 'down'}>
                          {profitPct >= 0 ? '+' : ''}
                          {profitPct.toFixed(2)}%
                          {profitAmount !== null ? ` (${profitAmount >= 0 ? '+' : ''}${profitAmount.toFixed(2)})` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                  {holding.note && (
                    <tr>
                      <td className="muted">备注</td>
                      <td colSpan={3}>{holding.note}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="fund-detail-block">
            <div style={{ fontWeight: 500, marginBottom: 8 }}>建议历史</div>
            {history === null ? (
              <span className="faint" style={{ fontSize: 12 }}>加载中…</span>
            ) : history.length === 0 ? (
              <span className="faint" style={{ fontSize: 12 }}>暂无历史记录</span>
            ) : (
              <div className="fund-history">
                {history.map((h) => (
                  <div className="fund-history-row" key={h.tradeDate}>
                    <span className="faint mono" style={{ fontSize: 12 }}>{h.tradeDate}</span>
                    <span className={`pill sm ${ACTION_CLASS[h.action]}`}>{ACTION_LABEL[h.action]}</span>
                    <span className="faint" style={{ fontSize: 12, minWidth: 0 }}>{h.summary || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {advice?.updatedAt && (
        <div className="faint" style={{ fontSize: 11, marginTop: 12 }}>
          {advice.tradeDate} · {formatRelative(advice.updatedAt)}更新
          {advice.model ? ` · ${advice.model}` : ''}
        </div>
      )}
    </Modal>
  );
}
