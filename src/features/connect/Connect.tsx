import { useState, type FormEvent } from 'react';
import { ArrowUpRight, ArrowRight, GitBranch, LockKeyhole, NotebookPen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Brand, PreferencesControls } from '../../app/ui';
import { useSession } from '../../app/session';
import { db } from '../../storage/db';
import { ApiError } from '../../adapters/github/client';
import { Banner, Button, Card, Checkbox, CheckboxLabel, Field, Input, Spinner } from '../../ui';

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
    <form onSubmit={(e) => void submit(e)} className="connect-form grid gap-5">
      <Field
        className="connect-field"
        label={t('connect.repository')}
        help={
          <>
            {t('connect.noRepository')}{' '}
            <a
              href="https://github.com/new?name=tebikae-notes&visibility=private&owner=%40me"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5"
            >
              {t('connect.createRepository')} <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </>
        }
      >
        {(id, describedBy) => (
          <Input
            id={id}
            aria-describedby={describedBy}
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
        )}
      </Field>
      <Field
        className="connect-field"
        label={t('connect.token')}
        help={
          <>
            {t('connect.tokenHelp')}{' '}
            <a
              href="https://github.com/settings/personal-access-tokens/new?name=Tebikae&issues=write&expires_in=90"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5"
            >
              {t('connect.createToken')} <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </>
        }
      >
        {(id, describedBy) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            placeholder={t('connect.tokenPlaceholder')}
            required
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        )}
      </Field>
      <div className="connect-actions grid gap-4">
        <CheckboxLabel>
          <Checkbox
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={busy}
            aria-describedby="connection-privacy"
          />
          {t('connect.remember')}
        </CheckboxLabel>
        {(error || session.notice) && (
          <Banner tone="danger" role="alert" className="error-box m-0">
            {t(`error.${error || session.notice}`)}
          </Banner>
        )}
        <Button variant="primary" size="lg" className="w-full" type="submit" disabled={busy}>
          {busy ? <Spinner size={18} /> : <GitBranch size={18} />}{' '}
          {t(busy ? 'action.connecting' : 'action.connect')} {!busy && <ArrowRight size={18} />}
        </Button>
      </div>
      <div className="privacy-note flex gap-2 text-xs leading-relaxed text-muted">
        <LockKeyhole size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
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
    <div className="welcome-page flex min-h-dvh flex-col bg-canvas md:bg-sidebar">
      <header className="welcome-header flex h-14 items-center justify-between gap-4 px-4 md:px-6">
        <Brand />
        <PreferencesControls />
      </header>
      <main className="welcome-main grid flex-1 place-items-center px-4 py-8">
        <div className="w-full max-w-sm md:max-w-104">
          <section className="md:rounded-2xl md:border md:border-line md:bg-surface md:p-8">
            <h1 className="text-xl font-semibold">{t('connect.formTitle')}</h1>
            <p className="welcome-description mt-2 text-sm text-muted">{t('connect.intro')}</p>
            <div className="mt-6">
              <ConnectForm />
            </div>
          </section>
          {cached.length > 0 && (
            <Card
              title={t('connect.cached')}
              description={t('connect.cacheHelp')}
              className="cached-connections mt-6"
            >
              <div className="grid gap-2">
                {cached.map((connection) => (
                  <Button
                    variant="ghost"
                    className="cached-connection w-full justify-between"
                    key={connection.scopeId}
                    onClick={() => void session.openOffline(connection).catch(() => setError(true))}
                  >
                    <NotebookPen size={16} aria-hidden="true" />
                    <span className="min-w-0 truncate">
                      {connection.owner}/{connection.repo}
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </Button>
                ))}
              </div>
              {error && (
                <Banner tone="danger" role="alert" className="mt-3">
                  {t('error.storage')}
                </Banner>
              )}
            </Card>
          )}
        </div>
      </main>
      <footer className="welcome-footer flex justify-center px-4 py-4 text-xs">
        <a
          href="https://github.com/scarletkc/Tebikae"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted"
        >
          GitHub <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
