import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import i18n from '../i18n';
export type Theme = 'light' | 'dark' | 'system';
type Preferences = {
  theme: Theme;
  setTheme(value: Theme): void;
  language: string;
  setLanguage(value: string): void;
  layout: 'grid' | 'list';
  setLayout(value: 'grid' | 'list'): void;
};
const Context = createContext<Preferences>(null!);
function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(`tebikae.${key}`) || fallback;
  } catch {
    return fallback;
  }
}
function persist(key: string, value: string) {
  try {
    localStorage.setItem(`tebikae.${key}`, value);
  } catch {
    /* Work even when preferences cannot be persisted. */
  }
}
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(() => {
    const t = stored('theme', 'system');
    return t === 'dark' || t === 'light' ? t : 'system';
  });
  const [language, updateLanguage] = useState(i18n.language);
  const [layout, updateLayout] = useState<'grid' | 'list'>(() =>
    stored('layout', 'grid') === 'list' ? 'list' : 'grid',
  );
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      // Status bar follows the canvas token; public/theme.js sets the same value before first paint.
      const canvas = getComputedStyle(root).getPropertyValue('--bg').trim();
      if (canvas) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key === 'tebikae.theme')
        updateTheme(event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system');
      if (event.key === 'tebikae.language' && (event.newValue === 'en' || event.newValue === 'zh-CN')) {
        updateLanguage(event.newValue);
        void i18n.changeLanguage(event.newValue);
      }
      if (event.key === 'tebikae.layout') updateLayout(event.newValue === 'list' ? 'list' : 'grid');
    };
    window.addEventListener('storage', receive);
    return () => window.removeEventListener('storage', receive);
  }, []);
  return (
    <Context.Provider
      value={{
        theme,
        language,
        layout,
        setTheme: (value) => {
          updateTheme(value);
          persist('theme', value);
        },
        setLanguage: (value) => {
          updateLanguage(value);
          persist('language', value);
          void i18n.changeLanguage(value);
        },
        setLayout: (value) => {
          updateLayout(value);
          persist('layout', value);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const usePreferences = () => useContext(Context);
