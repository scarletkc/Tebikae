import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './Menu';
import { cn } from './cn';

export type SelectOption<T extends string> = { value: T; label: string; icon?: LucideIcon };

/**
 * The only single-choice picker: a button that shows the current choice and opens a menu of
 * options with a check mark on the selected one. Use it everywhere a value is chosen from a list
 * (settings, toolbars, dialog forms); native <select> elements are not used.
 *
 *   <Select id="theme-setting" label={t('settings.theme')} value={theme} onChange={setTheme} options={…} />
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  id,
  icon,
  size = 'md',
  align = 'start',
  className,
  contentClassName,
  itemClassName,
  nativeMirror = false,
  containerClassName,
}: {
  value: T;
  onChange(value: T): void;
  options: readonly SelectOption<T>[];
  /** Accessible name, also the tooltip. Omit only when a <label htmlFor={id}> names it. */
  label?: string;
  id?: string;
  /** Icon-only trigger for compact toolbars; the menu still lists the option labels. */
  icon?: ReactNode;
  size?: 'sm' | 'md';
  align?: 'start' | 'end';
  /** Extra classes (hook classes, width) for the trigger. */
  className?: string;
  contentClassName?: string;
  itemClassName?: string;
  /** Also render a visually hidden native <select> with the same value (kept for form automation). */
  nativeMirror?: boolean;
  containerClassName?: string;
}) {
  const current = options.find((choice) => choice.value === value) ?? options[0];
  const trigger = icon ? (
    <IconButton id={id} size={size} label={label ?? current?.label ?? ''} className={className}>
      {icon}
    </IconButton>
  ) : (
    <Button
      id={id}
      size={size}
      title={label}
      aria-label={label}
      className={cn(
        'min-w-0 justify-between gap-1.5 font-normal data-[state=open]:border-accent data-[state=open]:bg-surface',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {current?.icon && <current.icon aria-hidden="true" />}
        <span className="truncate">{current?.label}</span>
      </span>
      <ChevronDown aria-hidden="true" className="text-muted" />
    </Button>
  );
  const menu = (
    <Menu>
      <MenuTrigger>{trigger}</MenuTrigger>
      <MenuContent
        align={align}
        loop
        className={cn('min-w-[max(11rem,var(--radix-dropdown-menu-trigger-width))]', contentClassName)}
      >
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((choice) => (
            <MenuRadioItem key={choice.value} value={choice.value} className={itemClassName}>
              {choice.icon && <choice.icon aria-hidden="true" />}
              <span className="min-w-0 truncate">{choice.label}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
  if (!nativeMirror) return menu;
  return (
    <div className={cn('relative inline-flex min-w-0 items-center', containerClassName)}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-1 size-full opacity-0"
      >
        {options.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      {menu}
    </div>
  );
}
