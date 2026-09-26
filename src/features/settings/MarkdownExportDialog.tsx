import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { download } from '../../app/ui';
import { Banner, Button, Checkbox, CheckboxLabel, Dialog } from '../../ui';
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
        <p className="field-help mt-2.5 mb-5 text-xs leading-relaxed text-muted [&_a]:mt-1.5 [&_a]:inline-flex [&_a]:items-center [&_a]:gap-1">
          {t('markdownExport.coverage')}
        </p>
        <CheckboxLabel>
          <Checkbox
            checked={includeTrash}
            disabled={busy}
            onChange={(event) => setIncludeTrash(event.target.checked)}
          />
          {t('markdownExport.includeTrash')}
        </CheckboxLabel>
        <dl className="markdown-export-counts my-5" aria-live="polite">
          {(['notes', 'archive', 'trash', 'unsynced', 'total'] as const).map((key) => (
            <div key={key} className="flex justify-between gap-4 py-1.5 last:font-semibold">
              <dt>{t(`markdownExport.${key}`)}</dt>
              <dd className="m-0 tabular-nums">{counts[key]}</dd>
            </div>
          ))}
        </dl>
        {counts.total === 0 && <p role="status">{t('markdownExport.empty')}</p>}
        {failed && (
          <Banner tone="warning" role="alert" className="banner warning">
            {t('markdownExport.failed')}
          </Banner>
        )}
        <div className="button-row flex flex-wrap items-center gap-2.5">
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
