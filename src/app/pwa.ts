import { createContext, useContext } from 'react';

export const PwaUpdateContext = createContext({
  available: false,
  update: async () => {},
  forceUpdate: async () => {},
});
export const usePwaUpdate = () => useContext(PwaUpdateContext);

export function isTebikaeRegistration(
  registration: ServiceWorkerRegistration,
  appScope = new URL(import.meta.env.BASE_URL, location.href).href,
): boolean {
  const normAppScope = appScope.endsWith('/') ? appScope : `${appScope}/`;
  const normRegScope = registration.scope.endsWith('/') ? registration.scope : `${registration.scope}/`;
  if (normRegScope === normAppScope) return true;
  const scriptUrl =
    registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL;
  if (scriptUrl) {
    const expectedSw = new URL('sw.js', normAppScope).href;
    const expectedDevSw = new URL('dev-sw.js', normAppScope).href;
    if (scriptUrl === expectedSw || scriptUrl === expectedDevSw) return true;
  }
  return false;
}

export function isTebikaeCache(
  key: string,
  appScope = new URL(import.meta.env.BASE_URL, location.href).href,
): boolean {
  const normScope = appScope.endsWith('/') ? appScope : `${appScope}/`;
  const plainScope = normScope.slice(0, -1);
  if (key.startsWith('tebikae-')) {
    if (key.includes('://')) {
      return key.endsWith(normScope) || key.endsWith(plainScope);
    }
    return true;
  }
  if (key.startsWith('workbox-')) {
    return key.endsWith(normScope) || key.endsWith(plainScope);
  }
  return false;
}

/** Cache Storage only holds precached app assets; IndexedDB sessions, notes and preferences stay. */
export async function clearAppCaches(): Promise<void> {
  const appScope = new URL(import.meta.env.BASE_URL, location.href).href;
  if ('caches' in window) {
    const keys = await caches.keys();
    const toDelete = keys.filter((key) => isTebikaeCache(key, appScope));
    await Promise.all(toDelete.map((key) => caches.delete(key)));
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const toUnregister = registrations.filter((reg) => isTebikaeRegistration(reg, appScope));
    await Promise.all(toUnregister.map((registration) => registration.unregister()));
  }
}

/**
 * A unique query forces a fresh document even behind HTTP caches that ignore reload
 * revalidation; hash routes survive the navigation.
 */
export function reloadFresh(): void {
  const url = new URL(location.href);
  url.searchParams.set('v', Date.now().toString(36));
  location.replace(url.toString());
}
