import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { flushAllDrafts, useSession } from './session';
import { clearAppCaches, reloadFresh } from './pwa';

/** Registers the service worker and exposes offline/update state plus the update actions. */
export function usePwaLifecycle() {
  const session = useSession();
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const update = useRef<(reload?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    update.current = registerSW({
      onOfflineReady: () => setOfflineReady(true),
      onNeedRefresh: () => setUpdateReady(true),
    });
    if (import.meta.env.PROD && 'serviceWorker' in navigator && 'caches' in window) {
      void navigator.serviceWorker.ready
        .then(async () => {
          const base = new URL(import.meta.env.BASE_URL, location.href).pathname;
          const keys = await caches.keys();
          const requests = (
            await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()))
          ).flat();
          const paths = requests
            .map((request) => new URL(request.url).pathname)
            .filter((path) => path.startsWith(base));
          const cached =
            paths.includes(`${base}index.html`) &&
            paths.includes(`${base}theme.js`) &&
            paths.some((path) => path.includes('/assets/MarkdownEditor-') && path.endsWith('.js')) &&
            paths.some((path) => path.includes('/assets/index-') && path.endsWith('.js'));
          if (active && cached) setOfflineReady(true);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, []);
  const applyUpdate = async () => {
    await flushAllDrafts();
    session.engine?.stop();
    await update.current(true);
  };
  const forceUpdate = async () => {
    await flushAllDrafts();
    session.engine?.stop();
    await clearAppCaches();
    reloadFresh();
  };
  return {
    offlineReady,
    updateReady,
    dismissUpdate: () => setUpdateReady(false),
    applyUpdate,
    forceUpdate,
  };
}
