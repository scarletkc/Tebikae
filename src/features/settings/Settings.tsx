import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  BookX,
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
import { usePreferences } from '../../app/preferences';
import { usePwaUpdate } from '../../app/pwa';
import { useSession, flushAllDrafts } from '../../app/session';
import { download, LanguageControl, ThemeControl } from '../../app/ui';
import { confirmDialog } from '../../app/confirm';
import { exportScope, clearScope } from '../../application/commands';
import { db } from '../../storage/db';
import packageJson from '../../../package.json';
import { prepareMarkdownExport, type MarkdownExportSnapshot } from '../../application/markdown-export';
import MarkdownExportDialog from './MarkdownExportDialog';
import BackupImportDialog from './BackupImportDialog';
import { Banner, Button, Card, SettingRow } from '../../ui';

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
    // The page title lives in the topbar (Topbar.tsx), like the other workspace views.
    <section className="settings-page mx-auto w-full max-w-2xl space-y-6">
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
          <ThemeControl id="theme-setting" label={t('settings.theme')} />
        </SettingRow>
      </Card>
      <Card title={t('settings.connection')} className="settings-section">
        <SettingRow
          title={
            <span className="repository-name break-all">
              {connection.owner}/{connection.repo}
            </span>
          }
          description={
            <>
              <span className="block">
                {t(session.remembered ? 'settings.tokenStorage' : 'settings.tokenMemory')}
              </span>
              <span className="mt-1 block">{t('settings.syncLimit')}</span>
            </>
          }
        >
          {session.connected || session.remembered ? (
            <Button onClick={() => void session.disconnect().catch(() => {})}>
              <LogOut />
              {t('action.disconnect')}
            </Button>
          ) : (
            <Button variant="primary" onClick={onConnect}>
              {t('action.connect')}
            </Button>
          )}
        </SettingRow>
        <SettingRow title={t('settings.closeNotebook')} description={t('settings.closeNotebookHelp')}>
          <Button onClick={() => void session.leave().catch(() => {})}>
            <BookX />
            {t('settings.closeNotebook')}
          </Button>
        </SettingRow>
        <SettingRow title={t('nav.issues')} description={t('home.issuesDescription')}>
          <Button asChild>
            <Link to="/issues">
              <GitBranch />
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
            <Download />
            {t('action.export')}
          </Button>
        </SettingRow>
        <SettingRow title={t('markdownExport.title')}>
          <Button disabled={preparingExport || busy} onClick={() => void previewMarkdownExport()}>
            <Download />
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
            <HardDrive />
            {t('settings.persist')}
          </Button>
        </SettingRow>
        <SettingRow title={t('backupImport.title')} description={t('settings.recoveries')}>
          <Button disabled={busy || !session.writable} onClick={() => setImportOpen(true)}>
            <Upload />
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
        <SettingRow title={t('settings.source')} description={t('settings.license')}>
          <Button asChild>
            <a href="https://github.com/scarletkc/Tebikae" target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              {t('settings.githubLink')}
            </a>
          </Button>
        </SettingRow>
      </Card>
      <Card title={t('settings.dangerZone')} className="settings-section">
        <SettingRow title={t('settings.clear')} description={t('settings.clearHelp')}>
          <Button variant="danger-outline" disabled={busy || !session.writable} onClick={() => void clear()}>
            <Trash2 />
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
