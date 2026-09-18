import { classify } from './codec';
import type { Label, LocalNote, NoteFilters } from './types';

export const defaultFilters: NoteFilters = {
  view: 'notes',
  query: '',
  labelIds: [],
  labelMatch: 'all',
  unlabeledOnly: false,
  colors: [],
  kinds: [],
  pinned: 'all',
  unsyncedOnly: false,
  sort: 'updated-desc',
};
export function displayedUpdatedAt(note: LocalNote): string {
  return note.syncStatus === 'synced' && note.base ? note.base.updatedAt : note.localModifiedAt;
}
export function displayedCreatedAt(note: LocalNote): string {
  return note.base?.createdAt ?? note.localCreatedAt;
}

export class FiltersValidationError extends Error {
  constructor() {
    super('Invalid date range');
    this.name = 'FiltersValidationError';
  }
}
function dateBoundary(value: string | undefined, end = false): number | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new FiltersValidationError();
  const year = Number(match[1]),
    month = Number(match[2]) - 1,
    day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day)
    throw new FiltersValidationError();
  if (end) date.setDate(date.getDate() + 1);
  return date.getTime();
}
export function filterNotes(notes: LocalNote[], filters: NoteFilters, labels: Label[] = []): LocalNote[] {
  const fromCreated = dateBoundary(filters.createdFrom),
    toCreated = dateBoundary(filters.createdTo, true);
  const fromUpdated = dateBoundary(filters.updatedFrom),
    toUpdated = dateBoundary(filters.updatedTo, true);
  if (
    (fromCreated !== undefined && toCreated !== undefined && fromCreated >= toCreated) ||
    (fromUpdated !== undefined && toUpdated !== undefined && fromUpdated >= toUpdated)
  )
    throw new FiltersValidationError();
  const names = new Map(labels.map((label) => [label.id, label.name]));
  const terms = filters.query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  const results = notes.filter((note) => {
    const doc = note.current,
      view = classify(doc);
    if (filters.view === 'all' ? view === 'trash' : view !== filters.view) return false;
    if (
      filters.unlabeledOnly
        ? doc.labelIds.length > 0
        : filters.labelIds.length > 0 &&
          !(filters.labelMatch === 'all'
            ? filters.labelIds.every((id) => doc.labelIds.includes(id))
            : filters.labelIds.some((id) => doc.labelIds.includes(id)))
    )
      return false;
    if (filters.colors.length && !filters.colors.includes(doc.meta.color)) return false;
    if (filters.kinds.length && !filters.kinds.includes(doc.meta.kind)) return false;
    if (filters.pinned !== 'all' && doc.meta.pinned !== (filters.pinned === 'pinned')) return false;
    if (filters.unsyncedOnly && note.syncStatus === 'synced') return false;
    const created = Date.parse(displayedCreatedAt(note)),
      updated = Date.parse(displayedUpdatedAt(note));
    if (
      (fromCreated !== undefined && created < fromCreated) ||
      (toCreated !== undefined && created >= toCreated) ||
      (fromUpdated !== undefined && updated < fromUpdated) ||
      (toUpdated !== undefined && updated >= toUpdated)
    )
      return false;
    const searchable = [
      doc.title,
      doc.markdown,
      ...doc.labelIds.map(
        (id) => names.get(id) ?? note.base?.labels.find((label) => label.id === id)?.name ?? '',
      ),
    ]
      .join('\n')
      .toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
  return results.sort((a, b) => {
    if (filters.view === 'notes' && a.current.meta.pinned !== b.current.meta.pinned)
      return a.current.meta.pinned ? -1 : 1;
    const difference =
      filters.sort === 'title'
        ? a.current.title.localeCompare(b.current.title)
        : filters.sort === 'created-desc'
          ? Date.parse(displayedCreatedAt(b)) - Date.parse(displayedCreatedAt(a))
          : (Date.parse(displayedUpdatedAt(b)) - Date.parse(displayedUpdatedAt(a))) *
            (filters.sort === 'updated-asc' ? -1 : 1);
    return difference || (b.issueNumber ?? 0) - (a.issueNumber ?? 0) || a.localId.localeCompare(b.localId);
  });
}

export function labelCounts(
  notes: LocalNote[],
  filters: NoteFilters,
  labels: Label[] = [],
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const label of labels) counts[label.id] = 0;
  for (const note of filterNotes(notes, { ...filters, labelIds: [], unlabeledOnly: false }, labels)) {
    for (const id of new Set(note.current.labelIds)) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
export function sidebarLabels(notes: LocalNote[], labels: Label[]): Label[] {
  const used = new Set<number>();
  for (const note of notes) {
    if (note.current.meta.trashedAt) continue;
    for (const id of note.current.labelIds) used.add(id);
  }
  return labels.filter((label) => used.has(label.id));
}
