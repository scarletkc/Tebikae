import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field, Input } from '../../ui';
import { useSession } from '../../app/session';

export default function CreateLabelDialog({
  busy,
  setBusy,
  onClose,
  report,
}: {
  busy: boolean;
  setBusy(value: boolean): void;
  onClose(): void;
  report(error: unknown): void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#62836a');
  async function create() {
    if (!session.engine || !name.trim()) return;
    setBusy(true);
    try {
      await session.engine.createLabel(name.trim(), color.slice(1));
      onClose();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={t('label.new')} onClose={onClose} size="sm">
      <form
        className="label-form flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <p className="text-xs text-muted">{t('label.createHelp')}</p>
        <Field label={t('label.name')}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={name}
              maxLength={50}
              required
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('label.color')}>
          {(id) => (
            <input
              id={id}
              type="color"
              className="h-9 w-14 cursor-pointer rounded-lg border border-line-strong bg-surface p-1"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" className="self-start" disabled={busy || !session.engine}>
          {t('action.create')}
        </Button>
      </form>
    </Dialog>
  );
}
