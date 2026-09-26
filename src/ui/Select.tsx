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
 *
 * Screen readers hear the label and the current choice ("Theme, Light"), like a native select.
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
}: {
  value: T;
  onChange(value: T): void;
  options: readonly SelectOption<T>[];
  /** What is being chosen, e.g. "Theme". Also the tooltip. Required even inside a <Field>. */
  label: string;
  id?: string;
  /** Icon-only trigger for compact toolbars; the menu still lists the option labels. */
  icon?: ReactNode;
  size?: 'sm' | 'md';
  align?: 'start' | 'end';
  /** Extra classes (hook classes, width) for the trigger. */
  className?: string;
  contentClassName?: string;
  itemClassName?: string;
}) {
  const current = options.find((choice) => choice.value === value) ?? options[0];
  const name = current ? `${label}, ${current.label}` : label;
  const trigger = icon ? (
    <IconButton id={id} size={size} label={label} aria-label={name} className={className}>
      {icon}
    </IconButton>
  ) : (
    <Button
      id={id}
      size={size}
      title={label}
      aria-label={name}
      className={cn(
        // Same border as Input: a Select is a form control, not an action.
        'min-w-0 justify-between gap-1.5 border-line-strong font-normal data-[state=open]:border-accent data-[state=open]:bg-surface',
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
  return (
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
}
