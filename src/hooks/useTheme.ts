import { useCallback, useEffect, useState } from 'react';
import { invalidateThemeCache } from '@/config/theme';

export type ThemeMode = 'light' | 'dark';

const KEY = 'prism.theme';

/**
 * Light is the product's default rather than the OS preference: this is an
 * executive reporting surface that gets projected and printed, and the light
 * palette is the one the design is tuned for. A viewer's explicit choice still
 * wins and persists.
 */
function initial(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Private browsing — fall through to the default.
  }
  return 'light';
}

/**
 * Theme is stamped on <html> so the CSS token layer switches wholesale.
 * The D3 colour cache is invalidated on change, otherwise charts would keep
 * painting the previous theme's palette until their next data change.
 */
export function useTheme(): [ThemeMode, () => void] {
  const [mode, setMode] = useState<ThemeMode>(initial);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    invalidateThemeCache();
    try {
      window.localStorage.setItem(KEY, mode);
    } catch {
      // Private browsing — the theme simply will not persist.
    }
  }, [mode]);

  const toggle = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), []);
  return [mode, toggle];
}
