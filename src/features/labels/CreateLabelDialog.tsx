import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../ui';
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
        className="label-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <p>{t('label.createHelp')}</p>
        <label>
          {t('label.name')}
          <input autoFocus value={name} maxLength={50} required onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('label.color')}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !session.engine}>
          {t('action.create')}
        </Button>
      </form>
    </Dialog>
  );
}
