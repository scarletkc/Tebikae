import './labels.css';
import type { Label } from '../../domain/types';
import { labelStyle, safeLabelColor } from './color';

/**
 * Small colored dot for navigation entries. The color is only a private CSS variable;
 * the dot always uses the theme text for its readable tone and falls back to muted.
 */
export function LabelDot({ color, muted = false }: { color?: string; muted?: boolean }) {
  const hex = safeLabelColor(color);
  return (
    <span
      aria-hidden="true"
      className={muted || !hex ? 'label-dot is-fallback' : 'label-dot'}
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
  onRemove,
  removeLabel,
}: {
  label?: { name: string; color: string };
  fallback?: string;
  onRemove?(): void;
  removeLabel?: string;
}) {
  const name = label?.name ?? fallback;
  if (!name) return null;
  return (
    <span className={label ? 'label-badge' : 'label-badge is-fallback'} style={labelStyle(label?.color)}>
      <span aria-hidden="true" className="label-dot" />
      <span className="label-badge-name">{name}</span>
      {onRemove && (
        <button type="button" className="label-badge-remove" aria-label={removeLabel} onClick={onRemove} />
      )}
    </span>
  );
}

/** Resolve the stored label behind a filter id without guessing. */
export function labelById(labels: Label[], id: number): { name: string; color: string } | undefined {
  const label = labels.find((candidate) => candidate.id === id);
  return label ? { name: label.name, color: label.color } : undefined;
}
