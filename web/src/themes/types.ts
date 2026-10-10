export interface ThemeVars {
  '--c-bg': string;
  '--c-surface': string;
  '--c-surface-2': string;
  '--c-border': string;
  '--c-border-strong': string;
  '--c-text': string;
  '--c-text-dim': string;
  '--c-text-faint': string;
  '--c-accent': string;
  '--c-accent-2': string;
  '--c-accent-contrast': string;
  '--c-success': string;
  '--c-warning': string;
  '--c-danger': string;
  '--c-sidebar': string;
  '--c-sidebar-text': string;
  '--c-sidebar-hover': string;
  '--c-shadow': string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  swatch: [string, string, string];
  vars: ThemeVars;
}
