import { useEffect, useRef, type RefObject } from 'react';
import { flushAllDrafts } from '../../app/session';
import { isConfirmDialogOpen } from '../../app/confirm';
import { isNoteListRoute } from './routes';

/** Cmd/Ctrl+K focuses search (where there is one); Cmd/Ctrl+N saves the open draft and starts a new note. */
export function useGlobalShortcuts(options: {
  searchRef: RefObject<HTMLInputElement | null>;
  route: string;
  writable: boolean;
  /** True while another dialog owns the keyboard. */
  dialogOpen: boolean;
  flushEngine(): void;
  newNote(): void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const creating = useRef(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const { searchRef, route, writable, dialogOpen, flushEngine, newNote } = latest.current;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        // Settings has no search field; leave the key to the browser there.
        if (!searchRef.current) return;
        event.preventDefault();
        searchRef.current.focus();
        searchRef.current.select();
      } else if (key === 'n' && isNoteListRoute(route)) {
        if (!writable) return;
        if (dialogOpen || isConfirmDialogOpen()) return;
        if (window.document.querySelector('.confirm-overlay, .confirm-dialog, [role="alertdialog"]')) return;
        if (creating.current) return;
        event.preventDefault();
        creating.current = true;
        void (async () => {
          try {
            await flushAllDrafts({ finalizeEmptyTitle: true });
            flushEngine();
            newNote();
          } catch {
            /* Keep active editor open on save failure */
          } finally {
            creating.current = false;
          }
        })();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
