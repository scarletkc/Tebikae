import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Download,
  ExternalLink,
  GitBranch,
  HardDrive,
  LogOut,
  RefreshCw,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { usePreferences, type Theme } from '../../app/preferences';
import { usePwaUpdate } from '../../app/pwa';
import { useSession, flushAllDrafts } from '../../app/session';
import { download, LanguageControl } from '../../app/ui';
import { confirmDialog } from '../../app/confirm';
import { exportScope, clearScope } from '../../application/commands';
import { db } from '../../storage/db';
import packageJson from '../../../package.json';
import { prepareMarkdownExport, type MarkdownExportSnapshot } from '../../application/markdown-export';
import MarkdownExportDialog from './MarkdownExportDialog';
import BackupImportDialog from './BackupImportDialog';
import { Button } from '../../ui';

export default function Settings({ onConnect, offlineReady }: { onConnect(): void; offlineReady: boolean }) {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const session = useSession();
  const pwa = usePwaUpdate();
  const connection = session.connection!;
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [preparingExport, setPreparingExport] = useState(false);
  const [markdownExport, setMarkdownExport] = useState<MarkdownExportSnapshot>();
  const [importOpen, setImportOpen] = useState(false);
  const state = useLiveQuery(() => db.syncState.get(connection.scopeId), [connection.scopeId]);
  async function exportData() {
    await flushAllDrafts();
    const data = await exportScope(connection.scopeId);
    if (!session.connected) data.coverage.issueListingComplete = false;
    download(
      `Tebikae-${connection.repo}-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
      'application/json',
    );
  }
  async function clear() {
    const pending = await db.notes
      .where('scopeId')
      .equals(connection.scopeId)
      .filter((n) => n.syncStatus !== 'synced')
      .count();
    if (
      !(await confirmDialog({
        title: t('settings.clearConfirm', { count: pending }),
        confirmLabel: t('settings.clear'),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await session.disconnect();
      await clearScope(connection.scopeId);
      await session.leave();
    } catch {
      setNotice(t('error.storage'));
    } finally {
      setBusy(false);
    }
  }
  async function previewMarkdownExport() {
    setPreparingExport(true);
    setNotice('');
    try {
      await flushAllDrafts();
      setMarkdownExport(await prepareMarkdownExport(connection.scopeId));
    } catch {
      setNotice(t('markdownExport.failed'));
    } finally {
      setPreparingExport(false);
    }
  }
  async function forceUpdate() {
    // Reloaded offline without a service worker, the app could not come back at all.
    if (!navigator.onLine) {
      setNotice(t('home.offline'));
      return;
    }
    setUpdating(true);
    setNotice('');
    try {
      await pwa.forceUpdate();
    } catch {
      setUpdating(false);
      setNotice(t('error.generic'));
    }
  }
  return (
    <section className="settings-page">
      <div className="page-heading">
        <div className="eyebrow">TEBIKAE</div>
        <h1>{t('settings.title')}</h1>
      </div>
      <div className="settings-section">
        <h2>{t('settings.appearance')}</h2>
        <div className="settings-row">
          <label htmlFor="language-setting">{t('settings.language')}</label>
          <LanguageControl
            id="language-setting"
            value={prefs.language}
            onChange={(language) => prefs.setLanguage(language)}
            label={t('settings.language')}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="theme-setting">{t('settings.theme')}</label>
          <select
            id="theme-setting"
            value={prefs.theme}
            onChange={(e) => prefs.setTheme(e.target.value as Theme)}
          >
            {(['light', 'dark', 'system'] as const).map((theme) => (
              <option key={theme} value={theme}>
                {t(`settings.${theme}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="settings-section">
        <h2>{t('settings.connection')}</h2>
        <p className="repository-name">
          {connection.owner}/{connection.repo}
        </p>
        <p>{t(session.remembered ? 'settings.tokenStorage' : 'settings.tokenMemory')}</p>
        <p>{t('settings.syncLimit')}</p>
        <div className="button-row">
          {session.connected || session.remembered ? (
            <Button onClick={() => void session.disconnect().catch(() => {})}>
              <LogOut size={16} />
              {t('action.disconnect')}
            </Button>
          ) : (
            <Button variant="primary" onClick={onConnect}>
              {t('action.connect')}
            </Button>
          )}
          <Button variant="link" size="sm" onClick={() => void session.leave().catch(() => {})}>
            {t('action.close')}
          </Button>
        </div>
      </div>
      <div className="settings-section">
        <h2>{t('nav.issues')}</h2>
        <p>{t('home.issuesDescription')}</p>
        <Button asChild>
          <Link to="/issues">
            <GitBranch size={16} />
            {t('nav.issues')}
          </Link>
        </Button>
      </div>
      <div className="settings-section">
        <h2>{t('settings.data')}</h2>
        <p>{t('settings.dataHelp')}</p>
        <p>{t('settings.exportHelp')}</p>
        {(!state?.initialLoadComplete || !session.connected) && (
          <p className="banner warning">{t('settings.partial')}</p>
        )}
        <div className="button-row">
          <Button onClick={() => void exportData().catch(() => setNotice(t('error.generic')))}>
            <Download size={16} />
            {t('action.export')}
          </Button>
          <Button disabled={preparingExport || busy} onClick={() => void previewMarkdownExport()}>
            <Download size={16} />
            {t(preparingExport ? 'markdownExport.preparing' : 'markdownExport.title')}
          </Button>
          <Button
            onClick={() =>
              void navigator.storage
                ?.persist?.()
                .then((granted) =>
                  setNotice(t(granted ? 'settings.persistGranted' : 'settings.persistDenied')),
                )
                .catch(() => setNotice(t('settings.persistDenied')))
            }
          >
            <HardDrive size={16} />
            {t('settings.persist')}
          </Button>
        </div>
        <p className="field-help">{t('settings.recoveries')}</p>
        <Button disabled={busy || !session.writable} onClick={() => setImportOpen(true)}>
          <Upload size={16} />
          {t('backupImport.title')}
        </Button>
        <hr />
        <p>{t('settings.clearHelp')}</p>
        <Button variant="danger-outline" disabled={busy || !session.writable} onClick={() => void clear()}>
          <Trash2 size={16} />
          {t('settings.clear')}
        </Button>
      </div>
      <div className="settings-section">
        <h2>{t('settings.about')}</h2>
        <p>{t('tagline')}</p>
        <p>{t('settings.version', { version: packageJson.version })}</p>
        <p className="inline-icon">
          <WifiOff size={15} />
          {t(offlineReady ? 'settings.offlineReady' : 'settings.offlinePreparing')}
        </p>
        <Button disabled={updating} onClick={() => void forceUpdate()}>
          <RefreshCw size={16} className={updating ? 'spin' : ''} />
          {t('settings.forceUpdate')}
        </Button>
        <p className="field-help">{t('settings.forceUpdateHelp')}</p>
        <a href="https://github.com/scarletkc/Tebikae" target="_blank" rel="noopener noreferrer">
          {t('settings.githubLink')} <ExternalLink size={14} />
        </a>
      </div>
      {notice && (
        <p role="status" className="banner">
          {notice}
        </p>
      )}
      {markdownExport && (
        <MarkdownExportDialog snapshot={markdownExport} onClose={() => setMarkdownExport(undefined)} />
      )}
      {importOpen && <BackupImportDialog onClose={() => setImportOpen(false)} />}
    </section>
  );
}
