import { useCallback, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

const listeners = new Set<() => void>();

function getSnapshot(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'light';
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot);

  const toggleTheme = useCallback(() => {
    const next: Theme = getSnapshot() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    listeners.forEach((fn) => fn());
  }, []);

  return { theme, toggleTheme } as const;
}
