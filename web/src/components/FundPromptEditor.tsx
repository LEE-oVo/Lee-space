import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from './Icon';
import type { FundPromptOverview } from '../types';

function timeText(sec: number | null) {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 提示词托管。
 *
 * 所有执行方本地只留一句「先取提示词再执行」，全部规则都在这里维护——
 * 改一处，下次运行立刻生效。存的是模板原文，占位符（{{TOKEN}} 之类）
 * 由服务端按调用方的令牌渲染。
 *
 * 2026-11-06 起只保留一个分析模型：分析提示词只发给它；
 * 其他令牌仍可取结算提示词（收盘结算不跟着模型一起换）。
 */
export function FundPromptEditor() {
  const [data, setData] = useState<FundPromptOverview | null>(null);
  const [kind, setKind] = useState('analysis');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.fundPrompt();
      setData(d);
      const first = d.kinds.find((k) => k.kind === kind) || d.kinds[0];
      if (first) {
        setKind(first.kind);
        setDraft(first.text);
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [kind]);

  useEffect(() => {
    void load();
    // 只在首次加载；切 tab 用本地已有数据，不重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = useMemo(
    () => data?.kinds.find((k) => k.kind === kind) ?? null,
    [data, kind]
  );
  const dirty = current ? draft !== current.text : false;

  function switchKind(next: string) {
    if (dirty && !window.confirm('当前改动还没保存，切换会丢失。继续？')) return;
    setKind(next);
    setDraft(data?.kinds.find((k) => k.kind === next)?.text ?? '');
    setSaved('');
  }

  async function save(text: string, note: string) {
    setSaving(true);
    setError('');
    setSaved('');
    try {
      const r = await api.updateFundPrompt(kind, text);
      setData((prev) => prev
        ? { ...prev, kinds: prev.kinds.map((k) => (k.kind === kind ? r.template : k)) }
        : prev);
      setDraft(r.template.text);
      setSaved(note);
      setTimeout(() => setSaved(''), 2600);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <div className="card">
        <div style={{ fontWeight: 500, marginBottom: 6 }}>提示词托管</div>
        {error ? <div className="down" style={{ fontSize: 13 }}>{error}</div>
          : <span className="faint" style={{ fontSize: 13 }}>加载中…</span>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          <Icon name="file" size={15} />
          <span style={{ fontWeight: 500 }}>提示词托管</span>
        </div>
        <button className="btn ghost sm" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开编辑'}
        </button>
      </div>

      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: '0 0 10px' }}>
        所有定时任务都从这里取提示词，本地只留一句「先取提示词再执行」。
        <b> 改这里一处，下次运行立刻同步。</b>
        分析提示词只发给唯一分析模型；结算提示词所有令牌都能取。
      </p>

      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
        {data.kinds.map((k) => (
          <button
            key={k.kind}
            className={`btn sm${k.kind === kind ? '' : ' ghost'}`}
            onClick={() => switchKind(k.kind)}
          >
            {k.label}
            {k.isCustom && <span className="faint" style={{ marginLeft: 4 }}>·已改</span>}
          </button>
        ))}
      </div>

      <div className="faint" style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 8 }}>
        执行方用这个地址取（按令牌自动渲染成它自己的版本）：
        <code className="mono" style={{ marginLeft: 6 }}>
          {data.base}/wb-api/funds/prompt?kind={kind}
        </code>
        <br />
        可用令牌：
        {data.sources.map((s) => (
          <span key={s.source} style={{ marginRight: 8 }}>
            {s.label}
            {s.canAnalyze === false ? '（仅结算）' : '（分析模型）'}
          </span>
        ))}
      </div>

      {open && (
        <>
          <textarea
            className="input mono"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: '100%', height: 380, fontSize: 12, lineHeight: 1.6, resize: 'vertical' }}
          />
          <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.8, margin: '8px 0' }}>
            必须保留这些占位符，删掉会渲染出缺令牌的提示词：
            {current?.requires.map((p) => (
              <code key={p} className="mono" style={{ marginRight: 6 }}>{p}</code>
            ))}
            <br />
            {current?.isCustom
              ? `当前是自定义版本（${timeText(current.updatedAt)} 更新）`
              : '当前是代码里的出厂默认版本'}
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button
              className="btn sm"
              disabled={!dirty || saving}
              onClick={() => void save(draft, '已保存，下次运行生效')}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              className="btn ghost sm"
              disabled={saving || !current?.isCustom}
              onClick={() => {
                if (window.confirm('恢复出厂默认？你在页面上的改动会丢失。')) {
                  void save('', '已恢复出厂默认');
                }
              }}
            >
              恢复出厂默认
            </button>
            {dirty && <span className="faint" style={{ fontSize: 12 }}>有未保存的改动</span>}
            {saved && <span className="up" style={{ fontSize: 12 }}>{saved}</span>}
            {error && <span className="down" style={{ fontSize: 12 }}>{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
