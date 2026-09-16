import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ExternalLink, HardDrive, LogOut, Trash2, WifiOff } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { usePreferences, type Theme } from '../../app/preferences';
import { useSession, flushAllDrafts } from '../../app/session';
import { download, LanguageControl } from '../../app/ui';
import { exportScope, clearScope } from '../../application/commands';
import { db } from '../../storage/db';
import packageJson from '../../../package.json';
import { prepareMarkdownExport, type MarkdownExportSnapshot } from '../../application/markdown-export';
import MarkdownExportDialog from './MarkdownExportDialog';

export default function Settings({ onConnect, offlineReady }: { onConnect(): void; offlineReady: boolean }) {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const session = useSession();
  const connection = session.connection!;
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [preparingExport, setPreparingExport] = useState(false);
  const [markdownExport, setMarkdownExport] = useState<MarkdownExportSnapshot>();
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
    if (!confirm(t('settings.clearConfirm', { count: pending }))) return;
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
            <button className="button secondary" onClick={() => void session.disconnect().catch(() => {})}>
              <LogOut size={16} />
              {t('action.disconnect')}
            </button>
          ) : (
            <button className="button primary" onClick={onConnect}>
              {t('action.connect')}
            </button>
          )}
          <button className="text-button" onClick={() => void session.leave().catch(() => {})}>
            {t('action.close')}
          </button>
        </div>
      </div>
      <div className="settings-section">
        <h2>{t('settings.data')}</h2>
        <p>{t('settings.dataHelp')}</p>
        <p>{t('settings.exportHelp')}</p>
        {(!state?.initialLoadComplete || !session.connected) && (
          <p className="banner warning">{t('settings.partial')}</p>
        )}
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() => void exportData().catch(() => setNotice(t('error.generic')))}
          >
            <Download size={16} />
            {t('action.export')}
          </button>
          <button
            className="button secondary"
            disabled={preparingExport || busy}
            onClick={() => void previewMarkdownExport()}
          >
            <Download size={16} />
            {t(preparingExport ? 'markdownExport.preparing' : 'markdownExport.title')}
          </button>
          <button
            className="button secondary"
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
          </button>
        </div>
        <p className="field-help">{t('settings.recoveries')}</p>
        <hr />
        <p>{t('settings.clearHelp')}</p>
        <button
          className="button danger-button"
          disabled={busy || !session.writable}
          onClick={() => void clear()}
        >
          <Trash2 size={16} />
          {t('settings.clear')}
        </button>
      </div>
      <div className="settings-section">
        <h2>{t('settings.about')}</h2>
        <p>{t('tagline')}</p>
        <p>{t('settings.version', { version: packageJson.version })}</p>
        <p className="inline-icon">
          <WifiOff size={15} />
          {t(offlineReady ? 'settings.offlineReady' : 'settings.offlinePreparing')}
        </p>
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
    </section>
  );
}
