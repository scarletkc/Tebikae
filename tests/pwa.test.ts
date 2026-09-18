import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTebikaeRegistration, isTebikaeCache, clearAppCaches } from '../src/app/pwa';

describe('PWA cache and registration scope isolation', () => {
  const appScope = 'https://scarletkc.github.io/Tebikae/';

  describe('isTebikaeRegistration', () => {
    it('matches registration with matching scope', () => {
      const reg = {
        scope: 'https://scarletkc.github.io/Tebikae/',
        active: { scriptURL: 'https://scarletkc.github.io/Tebikae/sw.js' },
      } as unknown as ServiceWorkerRegistration;
      expect(isTebikaeRegistration(reg, appScope)).toBe(true);
    });

    it('matches registration without trailing slash in scope', () => {
      const reg = {
        scope: 'https://scarletkc.github.io/Tebikae',
        active: { scriptURL: 'https://scarletkc.github.io/Tebikae/sw.js' },
      } as unknown as ServiceWorkerRegistration;
      expect(isTebikaeRegistration(reg, appScope)).toBe(true);
    });

    it('does NOT match registration from another app on same origin', () => {
      const otherReg = {
        scope: 'https://scarletkc.github.io/review-other-app/',
        active: { scriptURL: 'https://scarletkc.github.io/review-other-app/sw.js' },
      } as unknown as ServiceWorkerRegistration;
      expect(isTebikaeRegistration(otherReg, appScope)).toBe(false);
    });

    it('does NOT match another app when current app is at root /', () => {
      const rootScope = 'https://scarletkc.github.io/';
      const otherReg = {
        scope: 'https://scarletkc.github.io/review-other-app/',
        active: { scriptURL: 'https://scarletkc.github.io/review-other-app/sw.js' },
      } as unknown as ServiceWorkerRegistration;
      expect(isTebikaeRegistration(otherReg, rootScope)).toBe(false);
    });
  });

  describe('isTebikaeCache', () => {
    it('matches tebikae-prefixed cache with matching scope', () => {
      expect(isTebikaeCache('tebikae-precache-v2-https://scarletkc.github.io/Tebikae/', appScope)).toBe(true);
    });

    it('matches legacy workbox cache with matching scope', () => {
      expect(isTebikaeCache('workbox-precache-v2-https://scarletkc.github.io/Tebikae/', appScope)).toBe(true);
    });

    it('matches tebikae-prefixed cache without scope URL', () => {
      expect(isTebikaeCache('tebikae-user-data', appScope)).toBe(true);
    });

    it('preserves unrelated cache on the same origin', () => {
      expect(isTebikaeCache('another-app-user-content', appScope)).toBe(false);
    });

    it('preserves another app workbox cache on the same origin', () => {
      expect(
        isTebikaeCache('workbox-precache-v2-https://scarletkc.github.io/review-other-app/', appScope),
      ).toBe(false);
    });
  });

  describe('clearAppCaches', () => {
    let originalCaches: CacheStorage | undefined;
    let originalNavigatorSw: ServiceWorkerContainer | undefined;

    beforeEach(() => {
      originalCaches = window.caches;
      originalNavigatorSw = navigator.serviceWorker;
    });

    afterEach(() => {
      if (originalCaches)
        Object.defineProperty(window, 'caches', { value: originalCaches, configurable: true });
      if (originalNavigatorSw)
        Object.defineProperty(navigator, 'serviceWorker', { value: originalNavigatorSw, configurable: true });
    });

    it('only deletes Tebikae caches and unregisters Tebikae service workers', async () => {
      const deletedCaches: string[] = [];
      const fakeCaches = {
        keys: vi
          .fn()
          .mockResolvedValue([
            'tebikae-precache-v2-http://localhost:3000/',
            'another-app-user-content',
            'workbox-precache-v2-http://localhost:3000/review-other-app/',
          ]),
        delete: vi.fn().mockImplementation(async (key: string) => {
          deletedCaches.push(key);
          return true;
        }),
      };
      Object.defineProperty(window, 'caches', { value: fakeCaches, configurable: true });

      const tebikaeUnregister = vi.fn().mockResolvedValue(true);
      const otherUnregister = vi.fn().mockResolvedValue(true);

      const fakeRegistrations = [
        {
          scope: 'http://localhost:3000/',
          active: { scriptURL: 'http://localhost:3000/sw.js' },
          unregister: tebikaeUnregister,
        },
        {
          scope: 'http://localhost:3000/review-other-app/',
          active: { scriptURL: 'http://localhost:3000/review-other-app/sw.js' },
          unregister: otherUnregister,
        },
      ];

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistrations: vi.fn().mockResolvedValue(fakeRegistrations),
        },
        configurable: true,
      });

      await clearAppCaches();

      expect(deletedCaches).toEqual(['tebikae-precache-v2-http://localhost:3000/']);
      expect(tebikaeUnregister).toHaveBeenCalledTimes(1);
      expect(otherUnregister).not.toHaveBeenCalled();
    });
  });
});
