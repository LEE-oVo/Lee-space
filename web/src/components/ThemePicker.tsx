import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useTheme } from '../themes';

export function ThemePicker() {
  const { themeId, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn ghost sm" onClick={() => setOpen((v) => !v)} title="切换主题">
        <Icon name="palette" size={16} />
        {themes.find((t) => t.id === themeId)?.name}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 268,
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: 12,
            zIndex: 60,
            boxShadow: '0 20px 44px -20px var(--c-shadow)',
            animation: 'page-in 0.22s var(--ease)',
          }}
        >
          <div className="faint" style={{ fontSize: 11, marginBottom: 8, letterSpacing: '0.06em' }}>
            主题
          </div>
          <div className="col" style={{ gap: 8 }}>
            {themes.map((t) => (
              <button
                key={t.id}
                className={`theme-option${t.id === themeId ? ' active' : ''}`}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
              >
                <span className="theme-swatch">
                  {t.swatch.map((c) => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{t.name}</span>
                  <span className="faint" style={{ fontSize: 11 }}>{t.description}</span>
                </span>
                {t.id === themeId && (
                  <span className="theme-check">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 10 }}>
            选择会记住，刷新后保持
          </div>
        </div>
      )}
    </div>
  );
}
