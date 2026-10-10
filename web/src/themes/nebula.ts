import type { Theme } from './types';

export const nebula: Theme = {
  id: 'nebula',
  name: '深空',
  description: '深底高饱和，对比强烈，夜间沉浸',
  swatch: ['#08080f', '#7c5cff', '#22d3ee'],
  vars: {
    '--c-bg': '#08080f',
    '--c-surface': '#12121d',
    '--c-surface-2': '#1a1a2a',
    '--c-border': 'rgba(255,255,255,0.09)',
    '--c-border-strong': 'rgba(255,255,255,0.20)',
    '--c-text': '#f0f0ff',
    '--c-text-dim': '#a0a0c0',
    '--c-text-faint': '#6e6e8c',
    '--c-accent': '#7c5cff',
    '--c-accent-2': '#22d3ee',
    '--c-accent-contrast': '#ffffff',
    '--c-success': '#34d399',
    '--c-warning': '#fbbf24',
    '--c-danger': '#fb7185',
    '--c-sidebar': '#0a0a14',
    '--c-sidebar-text': '#d0d0ee',
    '--c-sidebar-hover': 'rgba(124,92,255,0.20)',
    '--c-shadow': 'rgba(0,0,0,0.55)',
  },
};
