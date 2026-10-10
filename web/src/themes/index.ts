import { useCallback, useEffect, useState } from 'react';
import type { Theme } from './types';
import { aurora } from './aurora';
import { ember } from './ember';
import { nebula } from './nebula';

/** 主题注册表：新增主题只需在这里加一行 */
export const THEMES: Theme[] = [aurora, ember, nebula];

export const DEFAULT_THEME_ID = 'aurora';
const STORAGE_KEY = 'wb.theme';

function buildCss(): string {
  return THEMES.map((theme) => {
    const body = Object.entries(theme.vars)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n');
    return `:root[data-theme="${theme.id}"] {\n${body}\n}`;
  }).join('\n\n');
}

let injected = false;

function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.id = 'wb-theme-vars';
  style.textContent = buildCss();
  document.head.appendChild(style);
  injected = true;
}

export function applyTheme(id: string): string {
  ensureStyles();
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    /* 隐私模式下忽略 */
  }
  return theme.id;
}

export function currentThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function useTheme() {
  const [themeId, setThemeId] = useState<string>(currentThemeId);
  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);
  const setTheme = useCallback((id: string) => {
    setThemeId(id);
    applyTheme(id);
  }, []);
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  return { themeId, theme, setTheme, themes: THEMES };
}
