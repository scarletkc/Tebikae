import { createContext, useContext } from 'react';

export const PwaUpdateContext = createContext({
  available: false,
  update: async () => {},
  forceUpdate: async () => {},
});
export const usePwaUpdate = () => useContext(PwaUpdateContext);

/** Cache Storage only holds precached app assets; IndexedDB sessions, notes and preferences stay. */
export async function clearAppCaches(): Promise<void> {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
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
