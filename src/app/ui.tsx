import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { X, Sun, Moon, Monitor, Languages, Check, ChevronDown } from 'lucide-react';
import './menus.css';
import { useTranslation } from 'react-i18next';
import { type ReactNode } from 'react';
import { usePreferences } from './preferences';
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
  );
}

export function PreferencesControls({ compact = false }: { compact?: boolean }) {
  const prefs = usePreferences();
  const { t } = useTranslation();
  return (
    <div className="preferences-controls">
      <LanguageControl
        value={prefs.language}
        onChange={prefs.setLanguage}
        label={t('settings.language')}
        mode={compact ? 'icon' : 'text'}
      />
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
