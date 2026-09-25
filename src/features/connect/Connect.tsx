import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  GitBranch,
  LockKeyhole,
  NotebookPen,
  CloudOff,
  Check,
  LoaderCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Brand, PreferencesControls } from '../../app/ui';
import { useSession } from '../../app/session';
import { db } from '../../storage/db';
import { ApiError } from '../../adapters/github/client';
import { Button } from '../../ui';

export function ConnectForm({ onConnected }: { onConnected?: () => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const [repository, setRepository] = useState(
    session.connection ? `${session.connection.owner}/${session.connection.repo}` : '',
  );
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await session.connect(repository.trim(), token.trim(), remember);
      setToken('');
      onConnected?.();
    } catch (error) {
      setError(error instanceof ApiError ? error.code : 'generic');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="connect-form">
      <div className="connect-form-header">
        <div className="form-symbol">
          <GitBranch size={26} />
        </div>
        <h2>{t('connect.formTitle')}</h2>
        <p>{t('connect.formIntro')}</p>
      </div>
      <div className="connect-field">
        <label>
          {t('connect.repository')}
          <input
            autoFocus
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            placeholder={t('connect.repositoryPlaceholder')}
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
        </label>
        <p className="field-help">
          {t('connect.noRepository')}{' '}
          <a
            href="https://github.com/new?name=tebikae-notes&visibility=private&owner=%40me"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('connect.createRepository')} <ArrowUpRight size={13} />
          </a>
        </p>
      </div>
      <div className="connect-field">
        <label>
          {t('connect.token')}
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            placeholder={t('connect.tokenPlaceholder')}
            required
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </label>
        <p className="field-help">
          {t('connect.tokenHelp')}{' '}
          <a
            href="https://github.com/settings/personal-access-tokens/new?name=Tebikae&issues=write&expires_in=90"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('connect.createToken')} <ArrowUpRight size={13} />
          </a>
        </p>
      </div>
      <div className="connect-actions">
        <label className="check-label">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={busy}
            aria-describedby="connection-privacy"
          />
          {t('connect.remember')}
        </label>
        {(error || session.notice) && (
          <p role="alert" className="error-box">
            {t(`error.${error || session.notice}`)}
          </p>
        )}
        <Button variant="primary" size="lg" className="w-full" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <GitBranch size={18} />}{' '}
          {t(busy ? 'action.connecting' : 'action.connect')} {!busy && <ArrowRight size={18} />}
        </Button>
      </div>
      <div className="privacy-note">
        <LockKeyhole size={16} />
        <span id="connection-privacy">{t(remember ? 'connect.privacy' : 'connect.sessionPrivacy')}</span>
      </div>
    </form>
  );
}
export default function ConnectPage() {
  const { t } = useTranslation();
  const session = useSession();
  const [error, setError] = useState(false);
  const cached = useLiveQuery(() => db.connections.toArray(), [], []);
  return (
    <div className="welcome-page">
      <header className="welcome-header">
        <Brand />
        <PreferencesControls />
      </header>
      <main className="welcome-main">
        <section className="welcome-intro">
          <div className="eyebrow">
            <span className="tiny-line" />
            {t('connect.eyebrow')}
          </div>
          <h1>{t('connect.title')}</h1>
          <p className="welcome-description">{t('connect.intro')}</p>
          <div className="sample-notes" aria-hidden="true">
            <div className="sample-note sample-sage">
              <NotebookPen size={20} />
              <span>Tebikae</span>
              <div className="ink-line long" />
              <div className="ink-line" />
              <div className="ink-line short" />
            </div>
            <div className="sample-note sample-sand">
              <span>Little things</span>
              <div>
                <Check size={15} />
                <div className="ink-line" />
              </div>
              <div>
                <Check size={15} />
                <div className="ink-line short" />
              </div>
              <div>
                <span className="empty-check" />
                <div className="ink-line" />
              </div>
            </div>
          </div>
          <div className="welcome-features">
            {[LockKeyhole, NotebookPen, CloudOff].map((Icon, index) => (
              <div key={index}>
                <Icon size={19} />
                <div>
                  <h3>{t(`connect.feature${index + 1}`)}</h3>
                  <p>{t(`connect.detail${index + 1}`)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="welcome-panel">
          <ConnectForm />
          {cached.length > 0 && (
            <div className="cached-connections">
              <h3>{t('connect.cached')}</h3>
              <p>{t('connect.cacheHelp')}</p>
              {cached.map((connection) => (
                <button
                  className="cached-connection"
                  key={connection.scopeId}
                  onClick={() => void session.openOffline(connection).catch(() => setError(true))}
                >
                  <NotebookPen size={16} />
                  <span>
                    {connection.owner}/{connection.repo}
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
              {error && <p role="alert">{t('error.storage')}</p>}
            </div>
          )}
        </section>
      </main>
      <footer className="welcome-footer">
        <span>{t('tagline')}</span>
        <a href="https://github.com/scarletkc/Tebikae" target="_blank" rel="noopener noreferrer">
          GitHub <ArrowUpRight size={13} />
        </a>
      </footer>
    </div>
  );
}
