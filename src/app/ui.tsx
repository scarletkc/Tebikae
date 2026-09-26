import { Sun, Moon, Monitor, Languages, ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePreferences, type Theme } from './preferences';
import { ContextMenu, type MenuAction } from './ContextMenu';
import { IconButton, Select, cn } from '../ui';

export function Brand({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <div className="brand flex items-center gap-2 text-sm font-semibold">
      <span className="brand-mark grid size-6 place-items-center">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={24} height={24} />
      </span>
      {!iconOnly && <span>Tebikae</span>}
    </div>
  );
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
] as const;
export type LanguageValue = (typeof LANGUAGES)[number]['value'];

export function LanguageControl({
  value,
  onChange,
  label,
  id,
  mode = 'text',
}: {
  value: string;
  onChange(value: LanguageValue): void;
  label: string;
  id?: string;
  mode?: 'text' | 'icon';
}) {
  return (
    <ContextMenu
      contextName="language"
      items={LANGUAGES.map((language) => ({
        label: language.label,
        checked: value === language.value,
        keepOpen: false,
        run: () => onChange(language.value),
      }))}
    >
      <Select
        id={id}
        label={label}
        value={value as LanguageValue}
        onChange={onChange}
        options={LANGUAGES}
        icon={mode === 'icon' ? <Languages size={18} aria-hidden="true" /> : undefined}
        className={mode === 'icon' ? 'language-menu-trigger-icon' : 'language-menu-trigger min-w-32'}
        contentClassName="language-menu-content"
        itemClassName="language-menu-item"
      />
    </ContextMenu>
  );
}

const THEMES = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
] as const;

/** Light / dark / follow-system choice for the settings page. */
export function ThemeControl({ id, label }: { id?: string; label: string }) {
  const prefs = usePreferences();
  const { t } = useTranslation();
  return (
    <Select<Theme>
      id={id}
      label={label}
      value={prefs.theme}
      onChange={prefs.setTheme}
      options={THEMES.map((theme) => ({ ...theme, label: t(`settings.${theme.value}`) }))}
      className="theme-menu-trigger min-w-32"
      contentClassName="theme-menu-content"
    />
  );
}

export const SORT_OPTIONS = ['updated-desc', 'updated-asc', 'created-desc', 'title'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export function SortControl({
  value,
  onChange,
  mode = 'text',
}: {
  value: SortOption;
  onChange(value: SortOption): void;
  mode?: 'text' | 'icon';
}) {
  const { t } = useTranslation();
  return (
    <ContextMenu
      contextName="sort"
      items={SORT_OPTIONS.map((sort) => ({
        label: t(`filter.${sort}`),
        checked: value === sort,
        keepOpen: false,
        run: () => onChange(sort),
      }))}
    >
      <Select
        label={t('filter.sort')}
        value={value}
        onChange={onChange}
        options={SORT_OPTIONS.map((sort) => ({ value: sort, label: t(`filter.${sort}`) }))}
        size="sm"
        icon={mode === 'icon' ? <ArrowUpDown size={17} aria-hidden="true" /> : undefined}
        className={mode === 'icon' ? 'sort-icon-button' : 'sort-menu-trigger max-w-45'}
        contentClassName="sort-menu-content"
        itemClassName="sort-menu-item"
      />
    </ContextMenu>
  );
}

export function PreferencesControls({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const prefs = usePreferences();
  const { t } = useTranslation();
  const themeIcons = { system: Monitor, light: Sun, dark: Moon } as const;
  const themeItems: MenuAction[] = (['system', 'light', 'dark'] as const).map((theme) => ({
    label: t(`settings.${theme}`),
    icon: themeIcons[theme],
    checked: prefs.theme === theme,
    keepOpen: false,
    run: () => prefs.setTheme(theme),
  }));
  return (
    <div className={cn('preferences-controls flex items-center gap-2.5', className)}>
      <LanguageControl
        value={prefs.language}
        onChange={prefs.setLanguage}
        label={t('settings.language')}
        mode={compact ? 'icon' : 'text'}
      />
      <ContextMenu contextName="theme" items={themeItems}>
        <IconButton
          label={t(`settings.${prefs.theme}`)}
          onClick={() =>
            prefs.setTheme(prefs.theme === 'system' ? 'light' : prefs.theme === 'light' ? 'dark' : 'system')
          }
        >
          {prefs.theme === 'dark' ? (
            <Moon size={18} />
          ) : prefs.theme === 'light' ? (
            <Sun size={18} />
          ) : (
            <Monitor size={18} />
          )}
        </IconButton>
      </ContextMenu>
    </div>
  );
}
export function download(name: string, value: string | Blob, type = 'text/plain') {
  const url = URL.createObjectURL(
    value instanceof Blob ? value : new Blob([value], { type: `${type};charset=utf-8` }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = [...name].map((c) => (c.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(c) ? '_' : c)).join('');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
