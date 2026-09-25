import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { download } from '../../app/ui';
import { Button, Dialog } from '../../ui';
import {
  createMarkdownArchive,
  summarizeMarkdownExport,
  type MarkdownExportSnapshot,
} from '../../application/markdown-export';

export default function MarkdownExportDialog({
  snapshot,
  onClose,
}: {
  snapshot: MarkdownExportSnapshot;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const [includeTrash, setIncludeTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const exporting = useRef(false);
  const counts = summarizeMarkdownExport(snapshot, includeTrash);
  async function exportArchive() {
    if (exporting.current) return;
    exporting.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const result = await createMarkdownArchive(snapshot, includeTrash);
      download(result.filename, result.blob);
      onClose();
    } catch {
      setFailed(true);
    } finally {
      exporting.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={t('markdownExport.title')}
      onClose={() => {
        if (!exporting.current) onClose();
      }}
    >
      <div className="markdown-export-body" aria-busy={busy}>
        <p>{t('markdownExport.help')}</p>
        <p className="field-help">{t('markdownExport.coverage')}</p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={includeTrash}
            disabled={busy}
            onChange={(event) => setIncludeTrash(event.target.checked)}
          />
          {t('markdownExport.includeTrash')}
        </label>
        <dl className="markdown-export-counts" aria-live="polite">
          {(['notes', 'archive', 'trash', 'unsynced', 'total'] as const).map((key) => (
            <div key={key}>
              <dt>{t(`markdownExport.${key}`)}</dt>
              <dd>{counts[key]}</dd>
            </div>
          ))}
        </dl>
        {counts.total === 0 && <p role="status">{t('markdownExport.empty')}</p>}
        {failed && (
          <p className="banner warning" role="alert">
            {t('markdownExport.failed')}
          </p>
        )}
        <div className="button-row">
          <Button
            variant="primary"
            disabled={busy || counts.total === 0}
            onClick={() => void exportArchive()}
          >
            <Download size={16} />
            {t(busy ? 'markdownExport.preparing' : 'markdownExport.download')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
