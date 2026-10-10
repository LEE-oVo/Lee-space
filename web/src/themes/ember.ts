import type { Theme } from './types';

export const ember: Theme = {
  id: 'ember',
  name: '暖砂',
  description: '暖色柔和，白天使用舒适度最高',
  swatch: ['#faf5ef', '#e07a3c', '#d4537e'],
  vars: {
    '--c-bg': '#faf5ef',
    '--c-surface': '#ffffff',
    '--c-surface-2': '#f5ece2',
    '--c-border': 'rgba(60,40,20,0.10)',
    '--c-border-strong': 'rgba(60,40,20,0.22)',
    '--c-text': '#3a2c1e',
    '--c-text-dim': '#7a6650',
    '--c-text-faint': '#a08a70',
    '--c-accent': '#e07a3c',
    '--c-accent-2': '#d4537e',
    '--c-accent-contrast': '#ffffff',
    '--c-success': '#3f8f4f',
    '--c-warning': '#c47f14',
    '--c-danger': '#cf3b32',
    '--c-sidebar': '#f2e8dc',
    '--c-sidebar-text': '#5a4632',
    '--c-sidebar-hover': 'rgba(224,122,60,0.16)',
    '--c-shadow': 'rgba(90,60,30,0.14)',
  },
};
