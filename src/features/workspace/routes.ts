import type { NoteFilters, UnmanagedIssue } from '../../domain/types';

/** Hash route without the leading slash, e.g. `notes`, `archive`, `settings`, `issues`. */
export function parseRoute(pathname: string) {
  const route = pathname.slice(1) || 'notes';
  const view = (
    ['notes', 'all', 'archive', 'trash'].includes(route) ? route : 'notes'
  ) as NoteFilters['view'];
  return { route, view };
}

/** Routes that show the note list together with its sort, view, filter and new-note controls. */
export const isNoteListRoute = (route: string) => route !== 'settings' && route !== 'issues';

/** Unmanaged issues whose title, body or label names contain the query (case-insensitive). */
export function filterIssues(issues: UnmanagedIssue[], query: string) {
  const needle = query.toLowerCase();
  return issues.filter((row) =>
    `${row.snapshot.title}\n${row.snapshot.body}\n${row.snapshot.labels.map((label) => label.name).join(' ')}`
      .toLowerCase()
      .includes(needle),
  );
}
