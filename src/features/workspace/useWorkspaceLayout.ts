import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePreferences } from '../../app/preferences';

// The masonry grid uses minmax(232px, 1fr) columns with an 18px gap. Below this
// content width two columns no longer fit, so the notes area is forced into
// list layout and the grid/list toggle is hidden.
const MIN_GRID_CARD_WIDTH = 232;
const GRID_GAP = 18;
const MIN_TWO_COLUMN_WIDTH = MIN_GRID_CARD_WIDTH * 2 + GRID_GAP;
const MIN_WIDE_TOPBAR_WIDTH = 720;

/** Container-aware layout: measures the topbar and notes area instead of the viewport. */
export function useWorkspaceLayout() {
  const prefs = usePreferences();
  const topbarRef = useRef<HTMLElement>(null);
  const notesAreaRef = useRef<HTMLElement>(null);
  const [topbarWidth, setTopbarWidth] = useState<number | null>(null);
  // Track the notes area's own width so the grid/list layout reacts to the
  // panel width (sidebar collapse, window resize) instead of the viewport.
  const [notesAreaWidth, setNotesAreaWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const topbar = topbarRef.current;
    const area = notesAreaRef.current;
    if (typeof ResizeObserver === 'undefined') return;
    const updateTopbar = () => {
      if (topbar) setTopbarWidth(topbar.clientWidth);
    };
    const updateArea = () => {
      if (!area) return;
      const styles = getComputedStyle(area);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      setNotesAreaWidth(area.clientWidth - paddingX);
    };
    updateTopbar();
    updateArea();
    const observer = new ResizeObserver(() => {
      updateTopbar();
      updateArea();
    });
    if (topbar) observer.observe(topbar);
    if (area) observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('tebikae.sidebarCollapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('tebikae.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      /* Preferences are optional. */
    }
  }, [sidebarCollapsed]);
  const isCompactTopbar = topbarWidth !== null && topbarWidth < MIN_WIDE_TOPBAR_WIDTH;
  // Narrow panels cannot fit two grid columns: hide the view toggle and force list.
  const singleColumnOnly = notesAreaWidth !== null && notesAreaWidth < MIN_TWO_COLUMN_WIDTH;
  const effectiveLayout = singleColumnOnly ? 'list' : prefs.layout;
  return {
    topbarRef,
    notesAreaRef,
    isCompactTopbar,
    singleColumnOnly,
    effectiveLayout,
    sidebarCollapsed,
    setSidebarCollapsed,
  } as const;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
