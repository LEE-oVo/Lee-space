import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Icon } from './Icon';
import { Modal } from './Modal';
import type { FundAction } from '../types';

interface Props {
  code: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}

const ACTIONS: Array<{ value: FundAction; label: string; needAmount: boolean }> = [
  { value: 'add', label: '加仓', needAmount: true },
  { value: 'reduce', label: '减仓', needAmount: true },
  { value: 'buy', label: '买入建仓', needAmount: true },
  { value: 'sell', label: '卖出', needAmount: true },
  { value: 'hold', label: '持有（无操作）', needAmount: false },
];

const QUICK = [100, 200, 300, 400, 500];

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function FundRecordModal({ code, name, onClose, onSaved }: Props) {
  const [date, setDate] = useState(todayStr());
  const [action, setAction] = useState<FundAction>('add');
  const [amount, setAmount] = useState('200');
  const [shares, setShares] = useState('');
  const [nav, setNav] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const needAmount = action !== 'hold';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createFundRecord({
        code,
        tradeDate: date,
        action,
        amount: needAmount ? Number(amount) : 0,
        shares: shares === '' ? null : Number(shares),
        nav: nav === '' ? null : Number(nav),
        note: note.trim() || '手动补记',
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="补记一笔操作" subtitle={`${name} · ${code}`} onClose={onClose}>
      {error && <div className="alert error">{error}</div>}

      <div className="muted" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.7 }}>
        记录你实际发生的交易——比如建议持有但你实际加了 300，或当天没跑任务时的手动操作。
        补记会覆盖当天该基金的记录并标记为「已执行」，定时任务会读到它，据此判断真实仓位。
      </div>

      <form onSubmit={submit}>
        <div className="field">
          <label>日期</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>

        <div className="field">
          <label>操作</label>
          <div className="row wrap" style={{ gap: 6 }}>
            {ACTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                className={`btn sm${a.value === action ? ' primary' : ''}`}
                onClick={() => setAction(a.value)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {needAmount && (
          <div className="field">
            <label>金额（元）</label>
            <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
              {QUICK.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`btn sm${String(v) === amount ? ' primary' : ''}`}
                  onClick={() => setAmount(String(v))}
                >
                  {v}
                </button>
              ))}
            </div>
            <input
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              placeholder="加仓请填整百，如 300"
              required
            />
            <div className="faint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.7 }}>
              金额请填整百；额度规则以工作台「基金持仓配置」为准（不设每日上限，
              硬约束是净投入不超过总投入上限）。
              <br />
              加仓按金额记、结算后自动折算份额；减仓请在下面直接填份额，
              成交金额由结算任务按当日收盘净值回填。
            </div>
          </div>
        )}

        {(action === 'reduce' || action === 'sell') && (
          <div className="field">
            <label>卖出份额（可选，建议填）</label>
            <input
              className="input"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              inputMode="decimal"
              placeholder="如 200.00，留空则按金额折算"
            />
            <div className="faint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.7 }}>
              场外基金赎回按份额下单：填了就以这个份额成交，金额按当日收盘净值回填；
              留空沿用旧口径，由结算任务拿金额 ÷ 净值折算。
            </div>
          </div>
        )}

        <div className="field">
          <label>成交净值（可选）</label>
          <input
            className="input"
            value={nav}
            onChange={(e) => setNav(e.target.value)}
            inputMode="decimal"
            placeholder="如 1.3812，留空则沿用原记录"
          />
        </div>

        <div className="field">
          <label>备注（可选）</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="如：手动补仓、定投扣款"
          />
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={14} />}
            保存
          </button>
          <button className="btn" type="button" onClick={onClose}>取消</button>
        </div>
      </form>
    </Modal>
  );
}
