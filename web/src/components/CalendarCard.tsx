import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { lunarShort, lunarText } from '../lib/lunar';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 生成该月的日历格子，周一为一周起点，只保留需要的行数（5 或 6 行） */
function buildMonth(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const rows = Math.ceil((lead + daysInMonth) / 7);
  const start = new Date(first);
  start.setDate(first.getDate() - lead);
  return Array.from({ length: rows * 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function CalendarCard() {
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(() => new Date(today));

  const cells = useMemo(() => buildMonth(view), [view]);
  const monthLabel = `${view.getFullYear()} 年 ${view.getMonth() + 1} 月`;

  function shiftMonth(delta: number) {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));
  }

  function backToToday() {
    const now = new Date();
    setView(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelected(now);
  }

  const selectedInfo = `${selected.getFullYear()} 年 ${selected.getMonth() + 1} 月 ${selected.getDate()} 日 · 星期${WEEKDAYS[(selected.getDay() + 6) % 7]}`;

  return (
    <div className="card cal-card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="calendar" size={17} />
          <span style={{ fontWeight: 500 }}>日历</span>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn ghost sm cal-nav" onClick={() => shiftMonth(-1)} title="上个月">
            <Icon name="chevLeft" size={16} />
          </button>
          <span className="cal-month">{monthLabel}</span>
          <button className="btn ghost sm cal-nav" onClick={() => shiftMonth(1)} title="下个月">
            <Icon name="chevRight" size={16} />
          </button>
        </div>
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map((w) => (
          <div className="cal-weekday" key={w}>{w}</div>
        ))}
        {cells.map((date) => {
          const inMonth = date.getMonth() === view.getMonth();
          const isToday = sameDay(date, today);
          const isSelected = sameDay(date, selected);
          const weekend = date.getDay() === 0 || date.getDay() === 6;
          const classes = [
            'cal-cell',
            inMonth ? '' : 'out',
            isToday ? 'today' : '',
            isSelected ? 'selected' : '',
            weekend && inMonth ? 'weekend' : '',
          ].filter(Boolean).join(' ');
          return (
            <button key={date.toISOString()} className={classes} onClick={() => setSelected(date)}>
              <span className="cal-day">{date.getDate()}</span>
              <span className="cal-lunar">{inMonth ? lunarShort(date) : ''}</span>
            </button>
          );
        })}
      </div>

      <div className="cal-foot">
        <div>
          <div style={{ fontWeight: 500 }}>{selectedInfo}</div>
          <div className="faint" style={{ fontSize: 12 }}>{lunarText(selected) || '—'}</div>
        </div>
        <button className="btn sm" onClick={backToToday}>回到今天</button>
      </div>
    </div>
  );
}
