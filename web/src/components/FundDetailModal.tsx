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

// 入账优先级已经不再决定「采纳谁」——用户点哪条账本就认哪条，
// 同一天只能有一条被执行（服务端唯一索引强制），这里不再需要它
// 兜底标签：实际以服务端下发的 sourceLabels 为准，
// 这样新接入一个模型（服务端配令牌即可）不需要改前端
const FALLBACK_SOURCE_LABEL: Record<string, string> = {
  workbuddy: 'WorkBuddy',
  trae: 'Trae Work',
  glm: '智谱 GLM',
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
  sourceLabels?: Record<string, string>;
  onClose: () => void;
}

export function FundDetailModal({
  code, name, holding, advice, position, canDetail, canManage, sourceLabels, onClose,
}: Props) {
  const labelOf = (s: string) => sourceLabels?.[s] || FALLBACK_SOURCE_LABEL[s] || s;
  const [series, setSeries] = useState<FundNavPoint[] | null>(null);
  const [history, setHistory] = useState<FundAdvice[] | null>(null);
  // 记录区必须能看到同一天所有工具的候选，才能选择采纳哪条——
  // 所以不受页面当前来源筛选的影响，始终拉全部来源
  const histSource = 'all';
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // 哪些日期展开了「未采纳的建议」
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, h] = await Promise.all([
          api.fundSeries(code, 1000),
          canDetail ? api.fundHistory(code, 20) : Promise.resolve({ history: [] as FundAdvice[] }),
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
  // 「执行」是互斥的：同一天最多一条，所以直接累加即可，不用再按天去重
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

  // 记录按天分组：同一天可能有多个工具各给一条建议，但只有被采纳的那条
  // 是「我当天做的事」，其余收起为一行候选，避免把建议当成已发生的操作
  const dayGroups = useMemo(() => {
    const m = new Map<string, FundAdvice[]>();
    for (const h of history || []) {
      const list = m.get(h.tradeDate) || [];
      list.push(h);
      m.set(h.tradeDate, list);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }, [history]);

  /**
   * 单条记录。被采纳的那条就是「我当天做的事」，不标来源、
   * 也不提是哪个工具建议的——记录只回答「做了什么」。
   * locked 表示同一天已经有被采纳的了，这条只能看不能选。
   */
  function renderRecord(h: FundAdvice, opts: { delay: number; locked: boolean; choosable: boolean }) {
    const isAdopted = h.executed;
    return (
      <div
        className={`fund-record${opts.locked ? ' is-locked' : ''}${isAdopted ? ' is-adopted' : ''}`}
        key={`${h.tradeDate}-${h.source}`}
        style={{ animationDelay: `${opts.delay}ms` }}
      >
        <div className="fund-record-head">
          <span className="mono fund-record-date">{h.tradeDate}</span>
          <span className={`fund-chip ${ACTION_CLASS[h.action]}`}>
            <span className="fund-chip-dot" />
            <span className="fund-chip-label">{ACTION_LABEL[h.action]}</span>
            {h.amount ? <b className="mono fund-chip-amt">¥{h.amount.toLocaleString('zh-CN')}</b> : null}
          </span>
          {/* 只有候选才标来源，被采纳的那条不需要——我不关心是谁建议的 */}
          {!isAdopted && (
            <span className="fund-src-badge" data-source={String(h.source)}>
              {labelOf(String(h.source))}
            </span>
          )}
          {/* 有金额的随时能采纳；「持有」这类只在当天有多个候选时才给按钮——
              那时才存在「选哪个」的问题，否则满屏按钮反而吵 */}
          {opts.choosable && canManage ? (
            <button
              className={`btn sm fund-record-act${isAdopted ? ' primary' : ''}`}
              disabled={opts.locked}
              onClick={() => void toggleExecuted(h)}
              title={
                opts.locked
                  ? '同一天只能执行一个建议：先取消已执行的那条，再来选这条'
                  : isAdopted
                    ? '取消后同一天其他建议可重新选择'
                    : '采纳这条作为当天的实际操作'
              }
            >
              {isAdopted ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
              {isAdopted ? '已执行' : '采纳'}
            </button>
          ) : h.amount ? (
            <span className={`fund-record-state${isAdopted ? ' is-done' : ''}`}>
              {isAdopted ? '已执行' : '未采纳'}
            </span>
          ) : null}
        </div>

        <div className="fund-record-meta">
          {h.settledSource === 'deduped' ? (
            <span className="fund-record-dup">同一天已采纳另一条建议，本条仅保留参考</span>
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
            <span>未采纳，不进账本</span>
          )}
        </div>

        {h.summary && <div className="fund-record-summary">{h.summary}</div>}
      </div>
    );
  }

  async function toggleExecuted(h: FundAdvice) {
    try {
      // 带上来源：服务端只改这一条，并把同一天其他建议自动落选（一天只执行一个）
      await api.setAdviceExecuted(h.code, h.tradeDate, !h.executed, String(h.source));
      setHistory((prev) =>
        prev
          ? prev.map((x) =>
              x.tradeDate === h.tradeDate
                ? { ...x, executed: x.source === h.source ? !x.executed : false }
                : x
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
                {dayGroups.map(([date, rows], gi) => {
                  const adopted = rows.find((r) => r.executed) || null;
                  // 已采纳：记录里只留这一条；其余收进「未采纳的建议」
                  const shown = adopted ? [adopted] : rows;
                  const hidden = adopted ? rows.filter((r) => !r.executed) : [];
                  const open = Boolean(expanded[date]);
                  return (
                    <div className="fund-record-day" key={date}>
                      {shown.map((h) => renderRecord(h, {
                        delay: Math.min(gi, 8) * 45,
                        locked: false,
                        choosable: Boolean(h.amount) || rows.length > 1,
                      }))}
                      {hidden.length > 0 && (
                        <>
                          <button
                            className="fund-record-more"
                            onClick={() => setExpanded((s) => ({ ...s, [date]: !s[date] }))}
                          >
                            <Icon name="chevRight" size={11} />
                            {open ? '收起' : `另有 ${hidden.length} 条未采纳的建议`}
                            {!open && <span className="faint">（同一天只能执行一个）</span>}
                          </button>
                          {open &&
                            hidden.map((h) => renderRecord(h, {
                              delay: 0,
                              locked: true,
                              choosable: Boolean(h.amount) || rows.length > 1,
                            }))}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="faint" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>
              同一天可能有多个工具/模型各给一条建议，但只能采纳其中一个——
              被采纳的那条就是我当天真实做的操作，账本与统计只认它，其余仅作对照。
              定时任务读取的也是这份「我做过什么」，不含任何来源信息。
            </div>
          </div>
        </>
      )}

      {advice?.updatedAt && (
        <div className="faint" style={{ fontSize: 11, marginTop: 12 }}>
          {advice.tradeDate} · {labelOf(String(advice.source))} ·{' '}
          {formatRelative(advice.updatedAt)}更新
          {advice.model ? ` · ${advice.model}` : ''}
          {advice.settledSource && advice.settledSource !== 'deduped'
            ? ` · 由 ${labelOf(String(advice.settledSource))} 结算`
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
