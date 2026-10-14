import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from './Icon';
import type { FundConfig, FundInvestment } from '../types';

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `¥${Math.round(value).toLocaleString('zh-CN')}`;
}

interface Props {
  /** 页面已有数据时直接传入，避免重复请求 */
  initial?: { config: FundConfig; investment: FundInvestment } | null;
  onChanged?: () => void;
}

/**
 * 投资目标与额度。
 *
 * 这里配的三个数字会直接进到定时任务的系统提示里：
 * 总投资额决定了模型还能投多少，目标收益率决定它是继续摊平还是准备止盈，
 * 每日上限默认关掉——钱要留给确定性高的机会，而不是被日限额摊平成定投。
 */
export function FundInvestmentConfig({ initial, onChanged }: Props) {
  const [config, setConfig] = useState<FundConfig | null>(initial?.config ?? null);
  const [investment, setInvestment] = useState<FundInvestment | null>(initial?.investment ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.fundConfig();
      setConfig(d.config);
      setInvestment(d.investment);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);

  useEffect(() => {
    if (initial?.config) setConfig(initial.config);
    if (initial?.investment) setInvestment(initial.investment);
  }, [initial]);

  const dirty = useMemo(() => {
    if (!config || !initial?.config) return false;
    return (
      config.totalBudget !== initial.config.totalBudget
      || config.targetReturnPct !== initial.config.targetReturnPct
      || config.dailyAddBudget !== initial.config.dailyAddBudget
    );
  }, [config, initial]);

  async function save() {
    if (!config) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const r = await api.updateFundConfig({
        totalBudget: config.totalBudget,
        targetReturnPct: config.targetReturnPct,
        dailyAddBudget: config.dailyAddBudget,
      });
      setConfig(r.config);
      setInvestment(r.investment);
      setSaved(true);
      onChanged?.();
      setTimeout(() => setSaved(false), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return (
      <div className="card">
        <div className="skeleton" style={{ width: 180 }} />
        <div className="skeleton" style={{ width: '100%', height: 90, marginTop: 12 }} />
      </div>
    );
  }

  const num = (v: number | null | undefined) => (Number.isFinite(v) ? (v as number) : 0);

  return (
    <div className="card fund-invest-card">
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="fund-head-icon">
            <Icon name="chart" size={15} />
          </span>
          <span style={{ fontWeight: 500 }}>投资目标与额度</span>
        </div>
        <span className="faint" style={{ fontSize: 11 }}>改完立刻生效，不用重启</span>
      </div>

      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.75, marginBottom: 12 }}>
        额度约束是<b>总投资额</b>（含已经投进去的钱），不是每日限额。
        定时任务会按这里的余额与目标收益率来决定加仓节奏：余额多、离目标远就敢下手，
        接近目标或余额见底就转向守成与止盈。
      </div>

      {investment && investment.totalBudget > 0 && (
        <div className="fund-invest-bar">
          <div className="fund-invest-track">
            <div
              className="fund-invest-fill"
              style={{ width: `${Math.min(100, Math.max(0, num(investment.progressPct)))}%` }}
            />
          </div>
          <div className="fund-invest-legend">
            <span>
              已投入 <b className="mono">{money(investment.used)}</b>
              {investment.pendingAdds > 0 && (
                <span className="faint"> （含待结算 {money(investment.pendingAdds)}）</span>
              )}
            </span>
            <span>
              剩余可投{' '}
              <b className="mono up">{money(investment.remaining)}</b>
            </span>
            <span>总额 {money(investment.totalBudget)}</span>
          </div>
        </div>
      )}

      <div className="fund-form-grid">
        <label className="field">
          <span className="field-label">总投资额（元）</span>
          <input
            className="input mono"
            type="number"
            min={0}
            step={1000}
            value={num(config.totalBudget)}
            onChange={(e) => setConfig({ ...config, totalBudget: Number(e.target.value) })}
          />
          <span className="field-hint">
            所有基金累计最多投入多少，含已投入。填 0 表示不限
          </span>
        </label>

        <label className="field">
          <span className="field-label">目标收益率（%）</span>
          <input
            className="input mono"
            type="number"
            min={0}
            step={1}
            value={num(config.targetReturnPct)}
            onChange={(e) => setConfig({ ...config, targetReturnPct: Number(e.target.value) })}
          />
          <span className="field-hint">
            达到后模型会转向止盈与减仓，不再建议继续加仓
          </span>
        </label>

        <label className="field">
          <span className="field-label">每日加仓上限（元）</span>
          <input
            className="input mono"
            type="number"
            min={0}
            step={100}
            value={num(config.dailyAddBudget)}
            onChange={(e) => setConfig({ ...config, dailyAddBudget: Number(e.target.value) })}
          />
          <span className="field-hint">
            填 0 = 不限（推荐）。好机会来了不必被日限额卡住
          </span>
        </label>
      </div>

      {investment && (
        <div className="fund-invest-stats">
          <div className="fund-invest-stat">
            <span className="fund-metric-label">当前市值</span>
            <span className="mono">{money(investment.market)}</span>
          </div>
          <div className="fund-invest-stat">
            <span className="fund-metric-label">累计盈亏</span>
            <span className={`mono ${investment.totalProfit >= 0 ? 'up' : 'down'}`}>
              {investment.totalProfit >= 0 ? '+' : ''}
              {money(investment.totalProfit)}
            </span>
          </div>
          <div className="fund-invest-stat">
            <span className="fund-metric-label">收益率</span>
            <span className={`mono ${(investment.returnPct ?? 0) >= 0 ? 'up' : 'down'}`}>
              {investment.returnPct === null
                ? '—'
                : `${investment.returnPct >= 0 ? '+' : ''}${investment.returnPct.toFixed(2)}%`}
            </span>
          </div>
          <div className="fund-invest-stat">
            <span className="fund-metric-label">目标金额</span>
            <span className="mono">{money(investment.targetAmount)}</span>
          </div>
        </div>
      )}

      {error && <div className="alert error" style={{ marginTop: 10 }}>{error}</div>}

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn sm primary" onClick={() => void save()} disabled={saving || !dirty}>
          <Icon name="check" size={13} />
          {saving ? '保存中…' : '保存配置'}
        </button>
        {saved && <span className="fund-save-ok">已保存</span>}
        {!dirty && !saved && (
          <span className="faint" style={{ fontSize: 12 }}>
            {investment ? '与当前配置一致' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
