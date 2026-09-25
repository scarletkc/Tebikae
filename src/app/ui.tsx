import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Sun, Moon, Monitor, Languages, Check, ChevronDown, ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePreferences } from './preferences';
import { ContextMenu, type MenuAction } from './ContextMenu';
import {
  IconButton,
  buttonVariants,
  cn,
  iconButtonVariants,
  menuContent,
  menuIndicator,
  menuRadioItem,
} from '../ui';

// Kept here so existing imports from app/ui keep working; new code imports from src/ui.
export { IconButton };

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={43} height={43} />
      </span>
      <span>Tebikae</span>
    </div>
  );
}

/** Text trigger for a single-choice dropdown (sort order, language). */
const selectTriggerClass = cn(
  buttonVariants({ variant: 'secondary', size: 'sm' }),
  'max-w-[180px] justify-between gap-1.5 font-normal data-[state=open]:border-accent data-[state=open]:text-accent',
);

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
  const current = LANGUAGES.find((language) => language.value === value) ?? LANGUAGES[0];
  const trigger = (
    <DropdownMenu.Trigger
      id={id}
      className={
        mode === 'icon'
          ? cn('language-menu-trigger-icon', iconButtonVariants())
          : cn('language-menu-trigger', selectTriggerClass)
      }
      title={label}
      aria-label={label}
    >
      {mode === 'icon' ? <Languages size={18} aria-hidden="true" /> : <span>{current.label}</span>}
      {mode === 'icon' ? null : <ChevronDown size={16} aria-hidden="true" />}
    </DropdownMenu.Trigger>
  );
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
      <DropdownMenu.Root>
        {trigger}
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={cn('language-menu-content', menuContent)}
            align="start"
            sideOffset={6}
            loop
          >
            <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as LanguageValue)}>
              {LANGUAGES.map((language) => (
                <DropdownMenu.RadioItem
                  key={language.value}
                  value={language.value}
                  className={cn('language-menu-item', menuRadioItem)}
                >
                  {language.label}
                  <DropdownMenu.ItemIndicator className={menuIndicator}>
                    <Check aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </ContextMenu>
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
  const trigger = (
    <DropdownMenu.Trigger
      className={
        mode === 'icon'
          ? cn('sort-icon-button', iconButtonVariants({ size: 'sm' }), 'data-[state=open]:bg-active')
          : cn('sort-menu-trigger', selectTriggerClass)
      }
      title={t('filter.sort')}
      aria-label={t('filter.sort')}
    >
      {mode === 'icon' ? (
        <ArrowUpDown size={17} aria-hidden="true" />
      ) : (
        <>
          <span className="truncate">{t(`filter.${value}`)}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>
      )}
    </DropdownMenu.Trigger>
  );

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
      <div
        className={cn(
          'sort-control-container relative inline-flex items-center',
          mode === 'icon' ? 'sort-control-icon-mode' : 'sort-control-text-mode',
        )}
      >
        {/* Native fallback kept for assistive tech and form automation; hidden from view. */}
        <select
          aria-label={t('filter.sort')}
          value={value}
          onChange={(e) => onChange(e.target.value as SortOption)}
          tabIndex={-1}
          aria-hidden="true"
          className="sort-hidden-select pointer-events-none absolute inset-0 -z-1 size-full opacity-0"
        >
          {SORT_OPTIONS.map((sort) => (
            <option key={sort} value={sort}>
              {t(`filter.${sort}`)}
            </option>
          ))}
        </select>
        <DropdownMenu.Root>
          {trigger}
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={cn('sort-menu-content', menuContent)}
              align="start"
              sideOffset={6}
              loop
            >
              <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as SortOption)}>
                {SORT_OPTIONS.map((sort) => (
                  <DropdownMenu.RadioItem
                    key={sort}
                    value={sort}
                    className={cn('sort-menu-item', menuRadioItem)}
                  >
                    <span>{t(`filter.${sort}`)}</span>
                    <DropdownMenu.ItemIndicator className={menuIndicator}>
                      <Check aria-hidden="true" />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </ContextMenu>
  );
}

export function PreferencesControls({ compact = false }: { compact?: boolean }) {
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
    <div className="preferences-controls">
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
