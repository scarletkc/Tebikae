// Must stay first: declares the cascade layer order for every stylesheet.
import './styles/layers.css';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './i18n';
import i18n from './i18n';
import { PreferencesProvider } from './app/preferences';
import { SessionProvider } from './app/session';
import { ToastProvider } from './app/toast';
import { ConfirmProvider } from './app/confirm';
import App from './app/App';
import './styles/app.css';
import { Button } from './ui';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not log notes or credentials. */
  }
  render() {
    return this.state.failed ? (
      <main className="fatal-error">
        <h1>Tebikae</h1>
        <p>{i18n.t('error.storage')}</p>
        <Button variant="primary" onClick={() => location.reload()}>
          {i18n.t('action.retry')}
        </Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <PreferencesProvider>
      <SessionProvider>
        <ToastProvider>
          <ConfirmProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </ConfirmProvider>
        </ToastProvider>
      </SessionProvider>
    </PreferencesProvider>
  </ErrorBoundary>,
);
