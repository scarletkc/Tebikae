import { useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';

/** Text-like control look. 16px on phones (no iOS focus zoom), 14px from 761px. */
const controlClass =
  'm-0 h-9 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-0 text-base text-fg md:text-sm ' +
  'placeholder:text-muted focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

/** No box at all: for text that is typed in place, such as the search field or a note title. */
const bareClass =
  'm-0 w-full min-w-0 border-0 bg-transparent p-0 text-base text-fg outline-none placeholder:text-muted md:text-sm';

type ControlVariant = 'default' | 'bare';

export function Input({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'input'> & { variant?: ControlVariant }) {
  return <input className={cn(variant === 'bare' ? bareClass : controlClass, className)} {...props} />;
}

export function Textarea({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'textarea'> & { variant?: ControlVariant }) {
  return (
    <textarea
      className={cn(variant === 'bare' ? bareClass : cn(controlClass, 'h-auto min-h-20 py-2'), className)}
      {...props}
    />
  );
}

/** File picker with the control look; the browse button inherits the kit's secondary style. */
export function FileInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="file"
      className={cn(
        controlClass,
        'h-auto cursor-pointer py-1.5 text-sm file:me-3 file:h-7 file:cursor-pointer file:rounded-md file:border-0 file:bg-hover file:px-3 file:text-xs file:font-medium file:text-fg',
        className,
      )}
      {...props}
    />
  );
}

/** Native color picker (label colors are user data, so the value is a raw hex color). */
export function ColorInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="color"
      className={cn(
        'm-0 h-9 w-14 cursor-pointer rounded-lg border border-line-strong bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
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
