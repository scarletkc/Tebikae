import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { useIssueFeed } from '../notes/useIssueFeed';

/**
 * Loads more remote results and reveals more cached cards as the notes area scrolls.
 * Revealing waits for a fresh user scroll gesture so one fling cannot reveal everything.
 */
export function useInfiniteReveal({
  areaRef,
  route,
  query,
  feed,
  feedCacheReady,
  availableCount,
  limit,
  setLimit,
}: {
  areaRef: RefObject<HTMLElement | null>;
  route: string;
  query: string;
  feed: ReturnType<typeof useIssueFeed>;
  feedCacheReady: boolean;
  availableCount: number;
  limit: number;
  setLimit: Dispatch<SetStateAction<number>>;
}) {
  const autoRevealPending = useRef(false);
  useEffect(() => {
    const area = areaRef.current;
    if (!area || route === 'settings') return;
    let frame = 0;
    const check = () => {
      const { scrollTop, scrollHeight, clientHeight } = area;
      const remaining = scrollHeight - scrollTop - clientHeight;
      const approaching =
        scrollTop > 0 &&
        (remaining <= clientHeight * 2.5 || (scrollTop + clientHeight) / scrollHeight >= 0.65);
      const needsMatches = !!query && feed.started && feedCacheReady && availableCount < 25;
      if (
        (approaching || needsMatches) &&
        availableCount - limit <= 100 &&
        feed.hasMore &&
        !feed.loading &&
        !feed.error
      )
        void feed.load?.();
      if (
        scrollTop > 0 &&
        remaining <= clientHeight &&
        availableCount > limit &&
        !autoRevealPending.current
      ) {
        autoRevealPending.current = true;
        setLimit((count) => Math.min(count + 25, availableCount));
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    const onScroll = () => {
      schedule();
    };
    const unlockReveal = () => {
      autoRevealPending.current = false;
    };
    area.addEventListener('scroll', onScroll, { passive: true });
    area.addEventListener('wheel', unlockReveal, { passive: true });
    area.addEventListener('touchmove', unlockReveal, { passive: true });
    area.addEventListener('keydown', unlockReveal);
    schedule();
    return () => {
      area.removeEventListener('scroll', onScroll);
      area.removeEventListener('wheel', unlockReveal);
      area.removeEventListener('touchmove', unlockReveal);
      area.removeEventListener('keydown', unlockReveal);
      cancelAnimationFrame(frame);
    };
  }, [
    areaRef,
    availableCount,
    limit,
    setLimit,
    feed.started,
    feedCacheReady,
    feed.hasMore,
    feed.loading,
    feed.error,
    feed.load,
    query,
    route,
  ]);
}
