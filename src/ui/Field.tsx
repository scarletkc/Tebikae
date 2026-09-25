import { useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';

/** Text-like control look. 16px on phones (no iOS focus zoom), 14px from 761px. */
export const controlClass =
  'm-0 h-9 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-0 text-base text-fg md:text-sm ' +
  'placeholder:text-muted focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlClass, 'h-auto min-h-20 py-2', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlClass, 'cursor-pointer pe-8', className)} {...props} />;
}

/** Native checkbox tinted with the accent color. Wrap it with its text in <CheckboxLabel>. */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'size-4 shrink-0 cursor-pointer accent-(--accent) disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  );
}

export function CheckboxLabel({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn('check-label flex items-center gap-2 text-sm font-normal text-fg', className)}
      {...props}
    />
  );
}

/**
 * Label + control + help/error text. `children` receives the generated id so the control and
 * its description are linked:  <Field label="Name">{(id, describedBy) => <Input id={id} aria-describedby={describedBy} />}</Field>
 */
export function Field({
  label,
  help,
  error,
  className,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (id: string, describedBy: string | undefined) => ReactElement;
}) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children(id, describedBy)}
      {help && (
        <p id={helpId} className="text-xs leading-relaxed text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
