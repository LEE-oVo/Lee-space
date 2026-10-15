import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { NavChart } from '../components/NavChart';
import { FundRecordModal } from '../components/FundRecordModal';
import { formatRelative } from '../lib/format';
import type { FundAdvice, FundAction, FundHolding, FundNavPoint, FundPosition } from '../types';

function pctText(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

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

// 与服务端 FUND_SETTLE_PRIORITY 一致：数字越小越优先入账
const SOURCE_PRIORITY: Record<string, number> = { manual: 0, trae: 1, workbuddy: 2 };
const SOURCE_LABEL: Record<string, string> = {
  workbuddy: 'WorkBuddy',
  trae: 'Trae Work',
  manual: '手动补记',
};

interface Props {
  code: string;
  name: string;
  holding: FundHolding | null;
  advice: FundAdvice | undefined;
  position: FundPosition | undefined;
  canDetail: boolean;
  canManage: boolean;
  /** 页面当前选中的来源；'all' 时显示全部并标出每条来源 */
  source: string;
  onClose: () => void;
}

export function FundDetailModal({
  code, name, holding, advice, position, canDetail, canManage, source, onClose,
}: Props) {
  const [series, setSeries] = useState<FundNavPoint[] | null>(null);
  const [history, setHistory] = useState<FundAdvice[] | null>(null);
  // 弹窗里的补记只写 manual 格子，不动两只工具各自的判断
  const histSource = source === 'manual' ? 'all' : source;
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, h] = await Promise.all([
          api.fundSeries(code, 1000),
          canDetail
            ? api.fundHistory(code, 20, histSource === 'all' ? undefined : histSource)
            : Promise.resolve({ history: [] as FundAdvice[] }),
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
  }, [code, canDetail, reloadKey, histSource]);

  // 只统计「已执行」的记录，那才是真实发生的仓位变化。
  // 同一天两个来源各有一条时只算入账优先级最高的那条，否则会把一笔操作算成两笔
  const totals = useMemo(() => {
    let added = 0;
    let reduced = 0;
    let count = 0;
    const byDate = new Map<string, FundAdvice>();
    for (const h of history || []) {
      const cur = byDate.get(h.tradeDate);
      if (!cur || SOURCE_PRIORITY[String(h.source)] < SOURCE_PRIORITY[String(cur.source)]) {
        byDate.set(h.tradeDate, h);
      }
    }
    for (const h of byDate.values()) {
      if (!h.executed || !h.amount) continue;
      count += 1;
      if (h.action === 'buy' || h.action === 'add') added += h.amount;
      if (h.action === 'reduce' || h.action === 'sell') reduced += h.amount;
    }
    return { added, reduced, count };
  }, [history]);

  async function toggleExecuted(h: FundAdvice) {
    try {
      // 带上来源：服务端会按「同一天所有来源一起改」处理，executed 是账本语义
      await api.setAdviceExecuted(h.code, h.tradeDate, !h.executed, String(h.source));
      setHistory((prev) =>
        prev
          ? prev.map((x) =>
              x.tradeDate === h.tradeDate ? { ...x, executed: !x.executed } : x
            )
          : prev
      );
    } catch {
      /* 标记失败不影响浏览 */
    }
  }

  const price = advice?.estimate ?? advice?.nav ?? null;
  const cost = holding?.cost ?? null;
  void price;
  void cost;

  return (
    <Modal
      wide
      title={
        <span className="row" style={{ gap: 8 }}>
          <span>{name || code}</span>
          {advice && (
            <span className={`fund-chip ${ACTION_CLASS[advice.action]}`}>
              <span className="fund-chip-dot" />
              <span className="fund-chip-label">{ACTION_LABEL[advice.action]}</span>
              {advice.amount ? <b className="mono fund-chip-amt">¥{advice.amount.toLocaleString('zh-CN')}</b> : null}
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
          {/* 真实净值后来补上了（结算入库）就不再提示——那是建议生成那一刻的状态 */}
          {advice?.stale
            && !(position?.navDate && advice.tradeDate && position.navDate >= advice.tradeDate) && (
            <div className="fund-stale">
              <Icon name="alert" size={13} />
              生成建议时未取到当日官方估值，涨跌幅按标的指数代替
              {advice?.navDate ? `（净值日期 ${advice.navDate}）` : ''}，仅供参考
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
                    <td className="muted" style={{ width: 96 }}>持有份额</td>
                    <td className="mono">{position?.shares ?? holding.shares ?? '—'}</td>
                    <td className="muted" style={{ width: 96 }}>成本价</td>
                    <td className="mono">{position?.cost ?? cost ?? '—'}</td>
                  </tr>
                  <tr>
                    <td className="muted">持仓市值</td>
                    <td className="mono">{position?.market != null ? `¥${position.market.toFixed(2)}` : '—'}</td>
                    <td className="muted">浮动盈亏</td>
                    <td className="mono">
                      {position?.unrealized == null ? (
                        '—'
                      ) : (
                        <span className={position.unrealized >= 0 ? 'up' : 'down'}>
                          {position.unrealized >= 0 ? '+' : ''}
                          {position.unrealized.toFixed(2)}
                          {position.unrealizedPct != null ? ` (${pctText(position.unrealizedPct)})` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">累计投入</td>
                    <td className="mono">{position?.invested != null ? `¥${position.invested.toFixed(2)}` : '—'}</td>
                    <td className="muted">已实现盈亏</td>
                    <td className="mono">
                      {position?.realized ? (
                        <span className={position.realized >= 0 ? 'up' : 'down'}>
                          {position.realized >= 0 ? '+' : ''}
                          {position.realized.toFixed(2)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">买入批次</td>
                    <td className="mono">{position?.lots ?? '—'}</td>
                    <td className="muted">净值日期</td>
                    <td className="mono">{position?.navDate || '—'}</td>
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
              <div className="fund-records">
                {history.map((h, i) => (
                  <div
                    className="fund-record"
                    key={`${h.tradeDate}-${h.source}`}
                    style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                  >
                    <div className="fund-record-head">
                      <span className="mono fund-record-date">{h.tradeDate}</span>
                      <span className={`fund-chip ${ACTION_CLASS[h.action]}`}>
                        <span className="fund-chip-dot" />
                        <span className="fund-chip-label">{ACTION_LABEL[h.action]}</span>
                        {h.amount ? (
                          <b className="mono fund-chip-amt">¥{h.amount.toLocaleString('zh-CN')}</b>
                        ) : null}
                      </span>
                      <span className="fund-src-badge" data-source={String(h.source)}>
                        {SOURCE_LABEL[String(h.source)] || String(h.source)}
                      </span>
                      {h.amount && canManage ? (
                        <button
                          className={`btn sm fund-record-act${h.executed ? ' primary' : ''}`}
                          onClick={() => void toggleExecuted(h)}
                          title={h.executed ? '点一下取消「已执行」' : '标记为已执行'}
                        >
                          {h.executed ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
                          {h.executed ? '已执行' : '未执行'}
                        </button>
                      ) : h.amount ? (
                        <span className={`fund-record-state${h.executed ? ' is-done' : ''}`}>
                          {h.executed ? '已执行' : '未执行'}
                        </span>
                      ) : null}
                    </div>

                    <div className="fund-record-meta">
                      {h.settledSource === 'deduped' ? (
                        <span className="fund-record-dup">
                          同一天已有更高优先级的建议入账，本条仅保留参考
                        </span>
                      ) : h.settled ? (
                        h.settledShares ? (
                          <>
                            <span>已结算 · 净值 {(h.settledNav ?? 0).toFixed(4)}</span>
                            <span>{h.settledShares} 份</span>
                            {h.settledFee ? <span>费用 ¥{h.settledFee.toFixed(2)}</span> : null}
                            {h.settledRealized != null ? (
                              <span>
                                已实现{' '}
                                <b className={h.settledRealized >= 0 ? 'up' : 'down'}>
                                  {h.settledRealized >= 0 ? '+' : ''}
                                  {h.settledRealized.toFixed(2)}
                                </b>
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span>无需结算</span>
                        )
                      ) : h.executed ? (
                        <span className="fund-pending">待结算（等收盘净值）</span>
                      ) : (
                        <span>未执行，不用结算</span>
                      )}
                    </div>

                    {h.summary && <div className="fund-record-summary">{h.summary}</div>}
                  </div>
                ))}
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
          {advice.tradeDate} · {SOURCE_LABEL[String(advice.source)] || advice.source} ·{' '}
          {formatRelative(advice.updatedAt)}更新
          {advice.model ? ` · ${advice.model}` : ''}
          {advice.settledSource && advice.settledSource !== 'deduped'
            ? ` · 由 ${SOURCE_LABEL[advice.settledSource] || advice.settledSource} 结算`
            : ''}
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
