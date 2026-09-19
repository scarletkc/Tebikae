import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { X, Sun, Moon, Monitor, Languages, Check, ChevronDown, ArrowUpDown } from 'lucide-react';
import './menus.css';
import { useTranslation } from 'react-i18next';
import { type ReactNode } from 'react';
import { usePreferences } from './preferences';
import { ContextMenu, type MenuAction } from './ContextMenu';
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
export function IconButton({
  label,
  children,
  onClick,
  disabled,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
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
  const current = LANGUAGES.find((language) => language.value === value) ?? LANGUAGES[0];
  const trigger = (
    <DropdownMenu.Trigger
      id={id}
      className={mode === 'icon' ? 'icon-button language-menu-trigger-icon' : 'language-menu-trigger'}
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
          <DropdownMenu.Content className="language-menu-content" align="start" sideOffset={6} loop>
            <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as LanguageValue)}>
              {LANGUAGES.map((language) => (
                <DropdownMenu.RadioItem
                  key={language.value}
                  value={language.value}
                  className="language-menu-item"
                >
                  <span className="language-menu-check">
                    <DropdownMenu.ItemIndicator>
                      <Check size={15} aria-hidden="true" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  {language.label}
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
      className={mode === 'icon' ? 'icon-button sort-icon-button' : 'sort-menu-trigger'}
      title={t('filter.sort')}
      aria-label={t('filter.sort')}
    >
      {mode === 'icon' ? (
        <ArrowUpDown size={17} aria-hidden="true" />
      ) : (
        <>
          <span>{t(`filter.${value}`)}</span>
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
        className={`sort-control-container ${mode === 'icon' ? 'sort-control-icon-mode' : 'sort-control-text-mode'}`}
      >
        <select
          aria-label={t('filter.sort')}
          value={value}
          onChange={(e) => onChange(e.target.value as SortOption)}
          tabIndex={-1}
          aria-hidden="true"
          className="sort-hidden-select"
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
            <DropdownMenu.Content className="sort-menu-content" align="start" sideOffset={6} loop>
              <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as SortOption)}>
                {SORT_OPTIONS.map((sort) => (
                  <DropdownMenu.RadioItem key={sort} value={sort} className="sort-menu-item">
                    <span className="sort-menu-check">
                      <DropdownMenu.ItemIndicator>
                        <Check size={15} aria-hidden="true" />
                      </DropdownMenu.ItemIndicator>
                    </span>
                    <span>{t(`filter.${sort}`)}</span>
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
export function Modal({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`dialog ${className}`}
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="dialog-header">
            <Dialog.Title>{title}</Dialog.Title>
            <IconButton label={t('action.close')} onClick={onClose}>
              <X size={19} />
            </IconButton>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
