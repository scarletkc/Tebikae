import { LoaderCircle, X, type LucideIcon } from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cn } from './cn';
import { IconButton } from './IconButton';

/** Removable filter token. `style` may carry a label color via labelStyle() (user data). */
export function Chip({
  children,
  onRemove,
  removeLabel,
  className,
  style,
}: {
  children: ReactNode;
  onRemove?: () => void;
  /** Accessible name of the remove action, e.g. "Remove filter: Ideas". */
  removeLabel?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const body = (
    <>
      {children}
      {onRemove && <X aria-hidden="true" className="size-3 text-muted" />}
    </>
  );
  const classes = cn(
    'chip inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-xs text-fg',
    onRemove && 'cursor-pointer hover:bg-hover',
    className,
  );
  return onRemove ? (
    <button type="button" className={classes} style={style} onClick={onRemove} aria-label={removeLabel}>
      {body}
    </button>
  ) : (
    <span className={classes} style={style}>
      {body}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'empty-state col-span-full mx-auto flex max-w-sm flex-col items-center gap-2 px-4 py-16 text-center',
        className,
      )}
    >
      <Icon aria-hidden="true" className="mb-2 size-8 text-muted" strokeWidth={1.5} />
      <h2 className="text-base font-medium text-fg">{title}</h2>
      {description && <p className="text-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      size={size}
      className={cn('animate-spin motion-reduce:animate-none', className)}
    />
  );
}

/** Bordered surface for grouped content such as a settings section. */
export function Card({
  title,
  description,
  className,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & { title?: ReactNode; description?: ReactNode }) {
  return (
    <section className={cn('rounded-xl border border-line bg-surface', className)} {...props}>
      {(title || description) && (
        <header className="px-5 pt-4">
          {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </header>
      )}
      <div className="px-5 pt-2 pb-4">{children}</div>
    </section>
  );
}

/** Row inside a Card: title/description left, control right; stacks below 761px. */
export function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 border-line py-3 not-first:border-t max-md:flex-col max-md:items-start',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{title}</div>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Mutually exclusive icon toggles, e.g. grid/list. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange(value: T): void;
  options: { value: T; label: string; icon: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn('inline-flex gap-0.5 rounded-lg border border-line bg-surface p-0.5', className)}>
      {options.map((option) => (
        <IconButton
          key={option.value}
          size="sm"
          label={option.label}
          pressed={value === option.value}
          className={value === option.value ? 'selected' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
        </IconButton>
      ))}
    </div>
  );
}
