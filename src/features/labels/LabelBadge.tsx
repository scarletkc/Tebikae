import type { Label } from '../../domain/types';
import { cn } from '../../ui';
import { labelStyle, safeLabelColor } from './color';

/** Tinted badge surface derived from the user-provided --label-color. */
const badgeTint =
  'border-[color-mix(in_srgb,var(--label-color,var(--muted))_45%,var(--border))] bg-[color-mix(in_srgb,var(--label-color,var(--muted))_22%,var(--surface))]';

/**
 * Small colored dot for navigation entries. The color is only a private CSS variable;
 * the dot always uses the theme text for its readable tone and falls back to muted.
 */
export function LabelDot({ color, muted = false }: { color?: string; muted?: boolean }) {
  const hex = safeLabelColor(color);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'label-dot inline-block size-2.5 shrink-0 rounded-full bg-[var(--label-color,var(--muted))] inset-ring inset-ring-[color-mix(in_srgb,var(--text)_18%,transparent)]',
        (muted || !hex) && 'is-fallback bg-[color-mix(in_srgb,var(--muted)_70%,transparent)]',
      )}
      style={labelStyle(color)}
    />
  );
}

/**
 * Pill with a real color dot, a tinted fill derived from the label color, and the
 * theme text color so both themes stay readable.
 */
export function LabelBadge({
  label,
  fallback,
  className,
}: {
  label?: { name: string; color: string };
  fallback?: string;
  className?: string;
}) {
  const name = label?.name ?? fallback;
  if (!name) return null;
  return (
    <span
      className={cn(
        'label-badge inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs leading-relaxed text-fg',
        label ? badgeTint : 'is-fallback border-line bg-hover',
        className,
      )}
      style={labelStyle(label?.color)}
    >
      <span
        aria-hidden="true"
        className="label-dot size-2 shrink-0 rounded-full bg-[var(--label-color,var(--muted))]"
      />
      <span className="label-badge-name truncate">{name}</span>
    </span>
  );
}

/** Resolve the stored label behind a filter id without guessing. */
export function labelById(labels: Label[], id: number): { name: string; color: string } | undefined {
  const label = labels.find((candidate) => candidate.id === id);
  return label ? { name: label.name, color: label.color } : undefined;
}
