import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useSession } from './session';
import { PwaUpdateContext } from './pwa';
import { usePwaLifecycle } from './usePwaLifecycle';
import { useContextMenuGuard } from './useContextMenuGuard';
import ConnectPage from '../features/connect/Connect';
import Workspace from '../features/workspace/Workspace';
import { Button, IconButton } from '../ui';

// Development-only UI kit preview at /#/__ui; removed from production builds.
const Gallery = import.meta.env.DEV ? lazy(() => import('../ui/Gallery')) : null;

export default function App() {
  const session = useSession();
  const { t } = useTranslation();
  const pwa = usePwaLifecycle();
  useContextMenuGuard();
  const { pathname } = useLocation();
  if (Gallery && pathname === '/__ui')
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  return (
    <PwaUpdateContext.Provider
      value={{ available: pwa.updateReady, update: pwa.applyUpdate, forceUpdate: pwa.forceUpdate }}
    >
      {session.restoring ? (
        <main
          className="loading-notice grid min-h-dvh place-items-center px-4 text-sm text-muted"
          role="status"
        >
          {t('connect.restoring')}
        </main>
      ) : session.connection ? (
        <Workspace key={session.connection.scopeId} offlineReady={pwa.offlineReady} />
      ) : (
        <ConnectPage />
      )}
      {pwa.updateReady && (
        <div
          className="update-toast fixed right-4 bottom-4 z-70 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-popover max-md:bottom-[calc(56px+16px+env(safe-area-inset-bottom))]"
          role="status"
        >
          <span>{t('settings.update')}</span>
          <Button variant="primary" onClick={() => void pwa.applyUpdate().catch(() => {})}>
            {t('settings.updateAction')}
          </Button>
          <IconButton label={t('action.close')} onClick={pwa.dismissUpdate}>
            <X size={16} />
          </IconButton>
        </div>
      )}
    </PwaUpdateContext.Provider>
  );
}
