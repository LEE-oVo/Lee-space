import type { Theme } from './types';

export const aurora: Theme = {
  id: 'aurora',
  name: '极光',
  description: '冷调通透，长时间使用不易疲劳',
  swatch: ['#0d1117', '#6ea8ff', '#a78bfa'],
  vars: {
    '--c-bg': '#0d1117',
    '--c-surface': '#151b24',
    '--c-surface-2': '#1c2430',
    '--c-border': 'rgba(255,255,255,0.08)',
    '--c-border-strong': 'rgba(255,255,255,0.18)',
    '--c-text': '#e6edf3',
    '--c-text-dim': '#9aa7b4',
    '--c-text-faint': '#6b7785',
    '--c-accent': '#6ea8ff',
    '--c-accent-2': '#a78bfa',
    '--c-accent-contrast': '#0d1117',
    '--c-success': '#3fb950',
    '--c-warning': '#d29922',
    '--c-danger': '#f85149',
    '--c-sidebar': '#0b0f14',
    '--c-sidebar-text': '#c9d4de',
    '--c-sidebar-hover': 'rgba(110,168,255,0.14)',
    '--c-shadow': 'rgba(0,0,0,0.45)',
  },
};
