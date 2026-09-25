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
import { Banner, Button, Card, Select, SettingRow } from '../../ui';

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
    <section className="settings-page mx-auto w-full max-w-2xl space-y-6 px-4 py-6 md:px-6">
      <h1 className="text-lg font-semibold">{t('nav.settings')}</h1>
      <Card title={t('settings.appearance')} className="settings-section">
        <SettingRow title={t('settings.language')}>
          <LanguageControl
            id="language-setting"
            value={prefs.language}
            onChange={(language) => prefs.setLanguage(language)}
            label={t('settings.language')}
          />
        </SettingRow>
        <SettingRow title={t('settings.theme')}>
          <Select
            id="theme-setting"
            className="w-auto min-w-32"
            value={prefs.theme}
            onChange={(e) => prefs.setTheme(e.target.value as Theme)}
            aria-label={t('settings.theme')}
          >
            {(['light', 'dark', 'system'] as const).map((theme) => (
              <option key={theme} value={theme}>
                {t(`settings.${theme}`)}
              </option>
            ))}
          </Select>
        </SettingRow>
      </Card>
      <Card title={t('settings.connection')} className="settings-section">
        <p className="repository-name text-sm font-medium break-all text-fg">
          {connection.owner}/{connection.repo}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {t(session.remembered ? 'settings.tokenStorage' : 'settings.tokenMemory')}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{t('settings.syncLimit')}</p>
        <div className="button-row mt-4 flex flex-wrap items-center gap-2.5">
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
        <SettingRow title={t('nav.issues')} description={t('home.issuesDescription')}>
          <Button asChild>
            <Link to="/issues">
              <GitBranch size={16} />
              {t('nav.issues')}
            </Link>
          </Button>
        </SettingRow>
      </Card>
      <Card title={t('settings.data')} description={t('settings.dataHelp')} className="settings-section">
        {(!state?.initialLoadComplete || !session.connected) && (
          <Banner tone="warning" className="banner warning mb-3">
            {t('settings.partial')}
          </Banner>
        )}
        <SettingRow title={t('action.export')} description={t('settings.exportHelp')}>
          <Button onClick={() => void exportData().catch(() => setNotice(t('error.generic')))}>
            <Download size={16} />
            {t('action.export')}
          </Button>
        </SettingRow>
        <SettingRow title={t('markdownExport.title')}>
          <Button disabled={preparingExport || busy} onClick={() => void previewMarkdownExport()}>
            <Download size={16} />
            {t(preparingExport ? 'markdownExport.preparing' : 'markdownExport.title')}
          </Button>
        </SettingRow>
        <SettingRow title={t('settings.persist')}>
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
        </SettingRow>
        <SettingRow title={t('backupImport.title')} description={t('settings.recoveries')}>
          <Button disabled={busy || !session.writable} onClick={() => setImportOpen(true)}>
            <Upload size={16} />
            {t('backupImport.title')}
          </Button>
        </SettingRow>
      </Card>
      <Card title={t('settings.about')} className="settings-section">
        <SettingRow
          title={t('settings.version', { version: packageJson.version })}
          description={
            <span className="inline-flex items-center gap-1.5">
              <WifiOff size={14} aria-hidden="true" />
              {t(offlineReady ? 'settings.offlineReady' : 'settings.offlinePreparing')}
            </span>
          }
        />
        <SettingRow title={t('settings.forceUpdate')} description={t('settings.forceUpdateHelp')}>
          <Button disabled={updating} onClick={() => void forceUpdate()}>
            <RefreshCw
              size={16}
              className={updating ? 'animate-spin motion-reduce:animate-none' : undefined}
            />
            {t('settings.forceUpdate')}
          </Button>
        </SettingRow>
        <p className="mt-2 text-sm">
          <a
            href="https://github.com/scarletkc/Tebikae"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1"
          >
            {t('settings.githubLink')} <ExternalLink size={14} aria-hidden="true" />
          </a>
        </p>
      </Card>
      <Card title={t('settings.dangerZone')} className="settings-section">
        <SettingRow title={t('settings.clear')} description={t('settings.clearHelp')}>
          <Button variant="danger-outline" disabled={busy || !session.writable} onClick={() => void clear()}>
            <Trash2 size={16} />
            {t('settings.clear')}
          </Button>
        </SettingRow>
      </Card>
      {notice && (
        <Banner role="status" className="banner">
          {notice}
        </Banner>
      )}
      {markdownExport && (
        <MarkdownExportDialog snapshot={markdownExport} onClose={() => setMarkdownExport(undefined)} />
      )}
      {importOpen && <BackupImportDialog onClose={() => setImportOpen(false)} />}
    </section>
  );
}
