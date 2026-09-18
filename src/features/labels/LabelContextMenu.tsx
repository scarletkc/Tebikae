import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';
import { Modal } from '../../app/ui';
import { useSession } from '../../app/session';
import { db } from '../../storage/db';
import type { Label } from '../../domain/types';

export function LabelContextMenu({
  label,
  children,
  onRemove,
}: {
  label: Label;
  children: ReactNode;
  onRemove?: () => void;
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
  const items: MenuAction[] = [
    ...(onRemove
      ? [
          {
            label: t('context.removeLabel', { name: label.name }),
            run: onRemove,
            disabled: !session.writable,
          },
        ]
      : []),
    {
      label: t('context.labelColor'),
      separator: !!onRemove,
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
      disabled,
      run: () => {
        setName(label.name);
        setRename(true);
      },
    },
    {
      label: t('context.deleteLabel'),
      disabled,
      danger: true,
      separator: true,
      run: () => {
        if (confirm(t('context.deleteLabelConfirm', { name: label.name, count })))
          void perform(() => session.engine!.deleteLabel(label.id));
      },
    },
  ];
  return (
    <>
      <ContextMenu items={items}>{children}</ContextMenu>
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
