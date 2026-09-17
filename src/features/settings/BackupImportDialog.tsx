import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { Modal } from '../../app/ui';
import { useSession, flushAllDrafts } from '../../app/session';
import { BackupImportError, IMPORT_MAX_BYTES, parseBackup } from '../../domain/backup-import';
import { classify } from '../../domain/codec';
import { importBackupNotes, previewBackupImport, type ImportPreview } from '../../application/backup-import';

const PAGE_SIZE = 25;
export default function BackupImportDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const session = useSession();
  const scope = session.connection!.scopeId;
  const [preview, setPreview] = useState<ImportPreview>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filename, setFilename] = useState('');
  const [acceptMissing, setAcceptMissing] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number }>();
  const running = useRef(false);
  const writable = useRef(session.writable);
  const mounted = useRef(true);
  useEffect(() => {
    writable.current = session.writable;
  }, [session.writable]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function checkWritable() {
    if (!mounted.current || !writable.current) throw new BackupImportError('readonly');
  }
  const rows = preview?.rows ?? [];
  const selectedRows = rows.filter((row) => selected.has(row.index));
  const missing = [
    ...new Set(
      selectedRows.flatMap((row) => [...row.missingLabels, ...row.unknownLabelIds.map((id) => `#${id}`)]),
    ),
  ];
  const selectable = rows.filter((row) => !row.duplicate);
  function fail(reason: unknown) {
    setError(t(`backupImport.errors.${reason instanceof BackupImportError ? reason.code : 'storage'}`));
  }
  async function loadFile(file: File) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setResult(undefined);
    setPreview(undefined);
    setFilename(file.name);
    setSelected(new Set());
    setPage(0);
    setAcceptMissing(false);
    try {
      if (file.size > IMPORT_MAX_BYTES) throw new BackupImportError('size');
      const text = await file.text().catch(() => {
        throw new BackupImportError('read');
      });
      const parsed = parseBackup(text);
      await flushAllDrafts();
      const next = await previewBackupImport(scope, parsed);
      if (!mounted.current) return;
      setPreview(next);
      setSelected(
        new Set(
          next.rows
            .filter((row) => !row.duplicate && classify(row.document) !== 'trash')
            .map((row) => row.index),
        ),
      );
    } catch (reason) {
      if (mounted.current) fail(reason);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function importSelected() {
    if (!preview || running.current || (missing.length && !acceptMissing)) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      checkWritable();
      const imported = await importBackupNotes(preview, [...selected], checkWritable);
      if (!mounted.current) return;
      setResult(imported);
      // Local commit is complete; network failures are reported by the ordinary sync UI.
      void session.engine?.flush(false).catch(() => {});
    } catch (reason) {
      if (mounted.current) fail(reason);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Modal
      title={t('backupImport.title')}
      className="backup-import-dialog"
      onClose={() => {
        if (!running.current) onClose();
      }}
    >
      <div className="backup-import-body" aria-busy={busy}>
        <p>{t('backupImport.help')}</p>
        <p className="field-help">{t('backupImport.coverage')}</p>
        {!session.writable && <p className="banner warning">{t('backupImport.errors.readonly')}</p>}
        {!result && (
          <label className="backup-import-file">
            <span>{t('backupImport.file')}</span>
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void loadFile(file);
              }}
            />
          </label>
        )}
        {filename && <p className="field-help backup-import-filename">{filename}</p>}
        {busy && <p role="status">{t('backupImport.working')}</p>}
        {error && (
          <p role="alert" className="banner warning">
            {error}
          </p>
        )}
        {result ? (
          <div className="backup-import-result">
            <p role="status">{t('backupImport.success', result)}</p>
            <p>{t('backupImport.syncHelp')}</p>
            <button className="button primary" onClick={onClose}>
              {t('backupImport.done')}
            </button>
          </div>
        ) : (
          preview && (
            <>
              {preview.repository && <p>{t('backupImport.source', { repository: preview.repository })}</p>}
              <p role="status">
                {t('backupImport.summary', {
                  valid: selectable.length,
                  invalid: preview.invalid.length,
                  duplicates: rows.length - selectable.length,
                })}
              </p>
              {preview.invalid.length > 0 && (
                <details className="backup-import-invalid">
                  <summary>{t('backupImport.invalid', { count: preview.invalid.length })}</summary>
                  <ul>
                    {preview.invalid.slice(0, 20).map((row) => (
                      <li key={row.index}>
                        {t('backupImport.row', { number: row.index + 1 })}: {row.title || t('home.untitled')}{' '}
                        — {t(`backupImport.invalidReason.${row.reason}`)}
                      </li>
                    ))}
                  </ul>
                  {preview.invalid.length > 20 && <p>{t('backupImport.firstErrors')}</p>}
                </details>
              )}
              <div className="button-row">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setSelected(new Set(selectable.map((row) => row.index)))}
                >
                  {t('backupImport.selectAll')}
                </button>
                <button className="text-button" disabled={busy} onClick={() => setSelected(new Set())}>
                  {t('backupImport.selectNone')}
                </button>
              </div>
              <ul className="backup-import-notes">
                {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row) => (
                  <li key={row.index}>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        disabled={busy || row.duplicate}
                        checked={selected.has(row.index)}
                        onChange={(event) =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(row.index);
                            else next.delete(row.index);
                            return next;
                          })
                        }
                      />
                      <span className="backup-import-note-title">
                        {row.document.title || t('home.untitled')}
                      </span>
                    </label>
                    <p className="field-help">
                      {t(`nav.${classify(row.document)}`)}
                      {row.duplicate ? ` · ${t('backupImport.duplicate')}` : ''}
                    </p>
                    <p className="backup-import-excerpt">{row.document.markdown.slice(0, 180)}</p>
                  </li>
                ))}
              </ul>
              {rows.length > PAGE_SIZE && (
                <div className="button-row">
                  <button
                    className="button secondary"
                    disabled={busy || page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    {t('backupImport.previous')}
                  </button>
                  <span>
                    {t('backupImport.page', { page: page + 1, total: Math.ceil(rows.length / PAGE_SIZE) })}
                  </span>
                  <button
                    className="button secondary"
                    disabled={busy || (page + 1) * PAGE_SIZE >= rows.length}
                    onClick={() => setPage(page + 1)}
                  >
                    {t('backupImport.next')}
                  </button>
                </div>
              )}
              {missing.length > 0 && (
                <div className="banner warning">
                  <p>{t('backupImport.missing', { names: missing.join(', ') })}</p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={acceptMissing}
                      disabled={busy}
                      onChange={(event) => setAcceptMissing(event.target.checked)}
                    />
                    {t('backupImport.acceptMissing')}
                  </label>
                </div>
              )}
              <p className="field-help">{t('backupImport.trashHelp')}</p>
              <button
                className="button primary"
                disabled={
                  busy || !session.writable || selected.size === 0 || (missing.length > 0 && !acceptMissing)
                }
                onClick={() => void importSelected()}
              >
                <Upload size={16} />
                {t('backupImport.import', { count: selected.size })}
              </button>
            </>
          )
        )}
      </div>
    </Modal>
  );
}
