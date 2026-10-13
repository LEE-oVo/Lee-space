import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Icon } from './Icon';
import type { FundHolding } from '../types';

interface Props {
  holdings: FundHolding[];
  onChanged: () => void;
}

const EMPTY = { code: '', name: '', category: '', cost: '', shares: '', amount: '', note: '', purchaseFee: '0' };
const DEFAULT_RULES = [
  { days: '7', fee: '1.5' },
  { days: '30', fee: '0.5' },
  { days: '', fee: '0' },
];

function optionalNumber(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function FundHoldings({ holdings, onChanged }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [feeRules, setFeeRules] = useState<Array<{ days: string; fee: string }>>(DEFAULT_RULES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setForm({ ...EMPTY });
    setFeeRules(DEFAULT_RULES);
    setEditingId(null);
    setShowForm(false);
    setError('');
  }

  function startEdit(h: FundHolding) {
    setEditingId(h.id);
    setShowForm(true);
    setError('');
    setForm({
      code: h.code,
      name: h.name,
      category: h.category || '',
      cost: h.cost === null ? '' : String(h.cost),
      shares: h.shares === null ? '' : String(h.shares),
      amount: h.amount === null ? '' : String(h.amount),
      note: h.note || '',
      purchaseFee: String(h.purchaseFee ?? 0),
    });
    const rules = Array.isArray(h.redemptionFee) && h.redemptionFee.length > 0
      ? h.redemptionFee.map((r) => ({ days: r.days === null ? '' : String(r.days), fee: String(r.fee) }))
      : DEFAULT_RULES;
    setFeeRules(rules);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category.trim() || null,
      cost: optionalNumber(form.cost),
      shares: optionalNumber(form.shares),
      amount: optionalNumber(form.amount),
      note: form.note.trim() || null,
      purchaseFee: Number(form.purchaseFee) || 0,
      redemptionFee: feeRules
        .map((r) => ({
          days: r.days.trim() === '' ? null : Number(r.days),
          fee: Number(r.fee),
        }))
        .filter((r) => Number.isFinite(r.fee) && (r.days === null || Number.isFinite(r.days))),
    };
    try {
      if (editingId === null) {
        await api.createFundHolding(payload);
      } else {
        await api.updateFundHolding(editingId, payload);
      }
      reset();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number, name: string) {
    if (!window.confirm(`删除持仓「${name}」？历史建议会保留。`)) return;
    try {
      await api.deleteFundHolding(id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  }

  return (
    <div className="card">
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 500 }}>持仓管理</div>
          <div className="faint" style={{ fontSize: 12 }}>
            定时任务会读取这里的代码清单，新增基金后无需改动任务配置
          </div>
        </div>
        <button className="btn primary sm" onClick={() => (showForm ? reset() : setShowForm(true))}>
          <Icon name={showForm ? 'close' : 'plus'} size={14} />
          {showForm ? '收起' : '新增基金'}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {showForm && (
        <form className="fund-form" onSubmit={submit}>
          <div className="grid cols-3">
            <div className="field">
              <label>基金代码</label>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="161725" required disabled={editingId !== null} />
            </div>
            <div className="field">
              <label>名称</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="招商中证白酒指数" required />
            </div>
            <div className="field">
              <label>类型</label>
              <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="指数 / 主动 / 债券 / QDII" />
            </div>
            <div className="field">
              <label>成本价</label>
              <input className="input" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="1.1000" inputMode="decimal" />
            </div>
            <div className="field">
              <label>持有份额</label>
              <input className="input" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} placeholder="1000" inputMode="decimal" />
            </div>
            <div className="field">
              <label>投入金额</label>
              <input className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="1100" inputMode="decimal" />
            </div>
          </div>
          <div className="field">
            <label>备注 / 目标</label>
            <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="如：定投，目标收益率 15%" />
          </div>

          <div className="field">
            <label>申购费率（%）</label>
            <input
              className="input"
              value={form.purchaseFee}
              onChange={(e) => setForm({ ...form, purchaseFee: e.target.value })}
              inputMode="decimal"
              placeholder="如 0.15；C 类通常为 0"
            />
            <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
              管理费、托管费、销售服务费已从净值中每日计提，不需要在这里填
            </div>
          </div>

          <div className="field">
            <label>赎回费率分档（按持有天数）</label>
            <div className="fee-rules">
              {feeRules.map((rule, i) => (
                <div className="fee-rule" key={i}>
                  <span className="faint" style={{ fontSize: 12 }}>持有少于</span>
                  <input
                    className="input"
                    style={{ width: 82 }}
                    value={rule.days}
                    onChange={(e) => setFeeRules(feeRules.map((r, j) => (j === i ? { ...r, days: e.target.value } : r)))}
                    placeholder="天数"
                    inputMode="numeric"
                  />
                  <span className="faint" style={{ fontSize: 12 }}>天，费率</span>
                  <input
                    className="input"
                    style={{ width: 72 }}
                    value={rule.fee}
                    onChange={(e) => setFeeRules(feeRules.map((r, j) => (j === i ? { ...r, fee: e.target.value } : r)))}
                    placeholder="%"
                    inputMode="decimal"
                  />
                  <span className="faint" style={{ fontSize: 12 }}>%</span>
                  <button
                    className="btn ghost sm"
                    onClick={() => setFeeRules(feeRules.filter((_, j) => j !== i))}
                    title="删除这一档"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
            </div>
            <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setFeeRules([...feeRules, { days: '', fee: '0' }])}>
              <Icon name="plus" size={13} />
              添加一档
            </button>
            <div className="faint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.7 }}>
              从上往下匹配第一条命中的规则；天数为空表示兜底（例如 7 天 1.5%、30 天 0.5%、空 0%）。
              定时任务首次运行会尝试自动抓取费率，你也可以在这里改。
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="check" size={14} />}{editingId === null ? '添加' : '保存'}</button>
            <button className="btn" type="button" onClick={reset}>取消</button>
          </div>
        </form>
      )}

      <div className="table-wrap wide">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 150 }}>基金</th>
              <th style={{ width: 90 }}>类型</th>
              <th style={{ width: 100 }}>成本价</th>
              <th style={{ width: 100 }}>份额</th>
              <th style={{ width: 100 }}>投入金额</th>
              <th style={{ width: 110 }}>费率</th>
              <th>备注</th>
              <th style={{ width: 110 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 && (
              <tr><td colSpan={7} className="faint">还没有持仓，点右上角「新增基金」添加</td></tr>
            )}
            {holdings.map((h) => (
              <tr key={h.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{h.name}</div>
                  <div className="faint mono" style={{ fontSize: 11 }}>{h.code}</div>
                </td>
                <td>{h.category || '—'}</td>
                <td className="mono">{h.cost ?? '—'}</td>
                <td className="mono">{h.shares ?? '—'}</td>
                <td className="mono">{h.amount ?? '—'}</td>
                <td className="faint" style={{ fontSize: 11 }}>
                  购 {h.purchaseFee ?? 0}%
                  {h.redemptionFee?.length
                    ? ` · 赎 ${h.redemptionFee.map((r) => (r.days === null ? `${r.fee}%` : `${r.days}天内${r.fee}%`)).join('/')}`
                    : ''}
                </td>
                <td className="faint" style={{ fontSize: 12 }}>{h.note || '—'}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn ghost sm" onClick={() => startEdit(h)} title="编辑">
                      <Icon name="edit" size={13} />
                    </button>
                    <button className="btn ghost sm" onClick={() => void remove(h.id, h.name)} title="删除">
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
