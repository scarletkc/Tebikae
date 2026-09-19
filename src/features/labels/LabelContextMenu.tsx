import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Palette, Pencil, Tag, Trash2 } from 'lucide-react';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';
import { Modal } from '../../app/ui';
import { confirmDialog } from '../../app/confirm';
import { useSession } from '../../app/session';
import { db } from '../../storage/db';
import type { Label } from '../../domain/types';
import { safeLabelColor } from './color';

export function LabelContextMenu({
  label,
  children,
  onRemove,
  onSelect,
  selectionMode = false,
  selectedForSelection = false,
  onToggleSelection,
}: {
  label: Label;
  children: ReactNode;
  onRemove?: () => void;
  onSelect?: () => void;
  selectionMode?: boolean;
  selectedForSelection?: boolean;
  onToggleSelection?: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const scope = session.connection?.scopeId ?? '';
  const count = useLiveQuery(
    () =>
      db.notes
        .where('scopeId')
        .equals(scope)
        .filter((n) => n.current.labelIds.includes(label.id))
        .count(),
    [scope, label.id],
    0,
  );
  const [rename, setRename] = useState(false);
  const [name, setName] = useState(label.name);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const disabled = !session.writable || !session.engine || !navigator.onLine || busy;
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(false);
    try {
      await action();
      setRename(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const items: MenuAction[] = selectionMode
    ? [
        {
          label: selectedForSelection ? t('label.removeFromSelection') : t('context.select'),
          swatch: safeLabelColor(label.color) ?? 'var(--muted)',
          checked: selectedForSelection,
          keepOpen: false,
          run: onToggleSelection,
        },
      ]
    : [
        ...(onSelect
          ? [
              {
                label: t('context.select'),
                swatch: safeLabelColor(label.color) ?? 'var(--muted)',
                run: onSelect,
              },
            ]
          : []),
        ...(onRemove
          ? [
              {
                label: t('context.removeLabel', { name: label.name }),
                icon: Tag,
                run: onRemove,
                disabled: !session.writable,
              },
            ]
          : []),
        {
          label: t('context.labelColor'),
          icon: Palette,
          separator: !!onRemove || !!onSelect,
          disabled,
          children: ['62836a', 'b1c6b0', 'dec8a7', '6a9bcc', 'a985bf', 'd47770', '888888'].map((color) => ({
            label: `#${color}`,
            swatch: `#${color}`,
            checked: label.color.toLowerCase() === color,
            run: () => void perform(() => session.engine!.updateLabel(label.id, { color })),
          })),
        },
        {
          label: t('context.rename'),
          icon: Pencil,
          disabled,
          run: () => {
            setName(label.name);
            setRename(true);
          },
        },
        {
          label: t('context.deleteLabel'),
          icon: Trash2,
          disabled,
          danger: true,
          separator: true,
          run: () => {
            void confirmDialog({
              title: t('context.deleteLabelConfirm', { name: label.name, count }),
              confirmLabel: t('context.deleteLabel'),
              danger: true,
            }).then((ok) => {
              if (ok) void perform(() => session.engine!.deleteLabel(label.id));
            });
          },
        },
      ];
  return (
    <>
      <ContextMenu contextName="label" items={items}>
        {children}
      </ContextMenu>
      {error && (
        <Modal title={t('error.generic')} onClose={() => setError(false)}>
          <p role="alert">{t('error.generic')}</p>
        </Modal>
      )}
      {rename && (
        <Modal title={t('context.rename')} onClose={() => setRename(false)}>
          <form
            className="label-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim())
                void perform(() => session.engine!.updateLabel(label.id, { new_name: name.trim() }));
            }}
          >
            <label>
              {t('label.name')}
              <input
                autoFocus
                maxLength={50}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={disabled || !name.trim()}>
              {t('context.apply')}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
