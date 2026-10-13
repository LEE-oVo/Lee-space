import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { NavChart } from '../components/NavChart';
import { FundRecordModal } from '../components/FundRecordModal';
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
  canManage: boolean;
  onClose: () => void;
}

export function FundDetailModal({ code, name, holding, advice, canDetail, canManage, onClose }: Props) {
  const [series, setSeries] = useState<FundNavPoint[] | null>(null);
  const [history, setHistory] = useState<FundAdvice[] | null>(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [code, canDetail, reloadKey]);

  // 只统计「已执行」的记录，那才是真实发生的仓位变化
  const totals = useMemo(() => {
    let added = 0;
    let reduced = 0;
    let count = 0;
    for (const h of history || []) {
      if (!h.executed || !h.amount) continue;
      count += 1;
      if (h.action === 'buy' || h.action === 'add') added += h.amount;
      if (h.action === 'reduce' || h.action === 'sell') reduced += h.amount;
    }
    return { added, reduced, count };
  }, [history]);

  async function toggleExecuted(h: FundAdvice) {
    try {
      await api.setAdviceExecuted(h.code, h.tradeDate, !h.executed);
      setHistory((prev) =>
        prev ? prev.map((x) => (x.tradeDate === h.tradeDate ? { ...x, executed: !x.executed } : x)) : prev
      );
    } catch {
      /* 标记失败不影响浏览 */
    }
  }

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
              {advice.amount ? ` ¥${advice.amount.toLocaleString('zh-CN')}` : ''}
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
            <div className="row wrap" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 500 }}>加减仓记录</div>
              <div className="row wrap" style={{ gap: 6 }}>
                {totals.count > 0 && (
                  <span className="faint" style={{ fontSize: 12 }}>
                    已执行累计：加仓 ¥{totals.added.toLocaleString('zh-CN')} · 减仓 ¥{totals.reduced.toLocaleString('zh-CN')}
                  </span>
                )}
                {canManage && (
                  <button className="btn sm" onClick={() => setRecording(true)}>
                    <Icon name="plus" size={13} />
                    补记操作
                  </button>
                )}
              </div>
            </div>

            {history === null ? (
              <span className="faint" style={{ fontSize: 12 }}>加载中…</span>
            ) : history.length === 0 ? (
              <span className="faint" style={{ fontSize: 12 }}>暂无记录</span>
            ) : (
              <div className="table-wrap wide">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 96 }}>日期</th>
                      <th style={{ width: 118 }}>操作</th>
                      <th style={{ width: 96 }}>金额</th>
                      <th style={{ width: 96 }}>执行</th>
                      <th>结论</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.tradeDate}>
                        <td className="mono" style={{ fontSize: 12 }}>{h.tradeDate}</td>
                        <td>
                          <span className={`pill sm ${ACTION_CLASS[h.action]}`}>
                            {ACTION_LABEL[h.action]}
                          </span>
                        </td>
                        <td className="mono">{h.amount ? `¥${h.amount.toLocaleString('zh-CN')}` : '—'}</td>
                        <td>
                          {h.amount && canManage ? (
                            <button
                              className={`btn sm${h.executed ? ' primary' : ''}`}
                              onClick={() => void toggleExecuted(h)}
                              title={h.executed ? '点一下取消「已执行」' : '标记为已执行'}
                            >
                              {h.executed ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
                              {h.executed ? '已执行' : '未执行'}
                            </button>
                          ) : (
                            <span className="faint" style={{ fontSize: 12 }}>
                              {h.amount ? (h.executed ? '已执行' : '未执行') : '—'}
                            </span>
                          )}
                        </td>
                        <td className="faint" style={{ fontSize: 12 }}>{h.summary || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="faint" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>
              定时任务每次都会读取这张表：已执行的记录代表真实仓位变化，
              未执行的只代表当时的建议。标记后模型能更准确地判断后续操作。
            </div>
          </div>
        </>
      )}

      {advice?.updatedAt && (
        <div className="faint" style={{ fontSize: 11, marginTop: 12 }}>
          {advice.tradeDate} · {formatRelative(advice.updatedAt)}更新
          {advice.model ? ` · ${advice.model}` : ''}
        </div>
      )}

      {recording && (
        <FundRecordModal
          code={code}
          name={name}
          onClose={() => setRecording(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
    </Modal>
  );
}
