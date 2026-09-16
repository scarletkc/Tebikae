import { classify } from '../domain/codec';
import { displayedCreatedAt, displayedUpdatedAt } from '../domain/filters';
import type { Label, LocalNote } from '../domain/types';
import { db, type TebikaeDB } from '../storage/db';
import { exportMarkdown } from './commands';

export interface MarkdownExportSnapshot {
  exportedAt: string;
  repository?: string;
  notes: LocalNote[];
  labels: Label[];
}

/** Capture the preview and download from one consistent, repository-scoped snapshot. */
export async function prepareMarkdownExport(
  scopeId: string,
  database: TebikaeDB = db,
): Promise<MarkdownExportSnapshot> {
  return database.transaction('r', database.notes, database.labels, database.connections, async () => {
    const [connection, notes, labels] = await Promise.all([
      database.connections.get(scopeId),
      database.notes.where('scopeId').equals(scopeId).toArray(),
      database.labels.where('scopeId').equals(scopeId).toArray(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      repository: connection ? `${connection.owner}/${connection.repo}` : undefined,
      notes,
      labels,
    };
  });
}

export function summarizeMarkdownExport(snapshot: MarkdownExportSnapshot, includeTrash: boolean) {
  const counts = { notes: 0, archive: 0, trash: 0, unsynced: 0, total: 0 };
  for (const note of snapshot.notes) {
    const folder = classify(note.current);
    if (folder === 'trash' && !includeTrash) continue;
    counts[folder]++;
    counts.total++;
    if (note.syncStatus !== 'synced') counts.unsynced++;
  }
  return counts;
}

/** Portable path component, bounded by UTF-8 bytes without splitting Unicode characters. */
function safeStem(title: string): string {
  const cleaned = Array.from(title.normalize('NFC'), (character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || /[<>:"/\\|?*]/u.test(character)
      ? '_'
      : character,
  ).join('');
  let stem = '';
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of cleaned) {
    bytes += encoder.encode(character).length;
    if (bytes > 180) break;
    stem += character;
  }
  stem = stem.replace(/^[. ]+|[. ]+$/gu, '') || 'note';
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(stem)) stem = `_${stem}`;
  return stem;
}

function collisionKey(path: string): string {
  // Conservatively merge Unicode case variants (sigma, sharp S, ligatures, etc.).
  // Lowercase first handles capital sharp S; uppercase expands multi-character pairs.
  // NFD also compares canonically equivalent combining sequences after case conversion.
  return path.normalize('NFD').toLowerCase().toUpperCase().normalize('NFD');
}

export async function createMarkdownArchive(snapshot: MarkdownExportSnapshot, includeTrash = false) {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  const used = new Set<string>();
  // Local identity, not note UUID, remains unique even for duplicate/conflicted notes.
  const notes = [...snapshot.notes].sort((a, b) =>
    a.localId < b.localId ? -1 : a.localId > b.localId ? 1 : 0,
  );
  const entries = [];
  for (const note of notes) {
    const folder = classify(note.current);
    if (folder === 'trash' && !includeTrash) continue;
    const stem = safeStem(note.current.title);
    let path = `${folder}/${stem}.md`;
    let suffix = 2;
    while (used.has(collisionKey(path))) path = `${folder}/${stem} (${suffix++}).md`;
    used.add(collisionKey(path));
    // Retain cached label names when the repository label listing is unavailable.
    const labels = note.current.labelIds.map((id) => {
      const label =
        snapshot.labels.find((candidate) => candidate.id === id) ??
        note.base?.labels.find((candidate) => candidate.id === id) ??
        note.lastSeenRemote?.labels.find((candidate) => candidate.id === id);
      return { id, name: label?.name ?? String(id) };
    });
    files[path] = strToU8(exportMarkdown(note, labels).content);
    entries.push({
      path,
      localId: note.localId,
      noteId: note.current.meta.id,
      title: note.current.title,
      source: note.base?.url ?? note.lastSeenRemote?.url,
      createdAt: displayedCreatedAt(note),
      updatedAt: displayedUpdatedAt(note),
      syncStatus: note.syncStatus,
      archived: note.current.archived,
      metadata: note.current.meta,
      labels,
    });
  }
  const manifest = {
    format: 'tebikae-markdown-export',
    schemaVersion: 1,
    exportedAt: snapshot.exportedAt,
    repository: snapshot.repository,
    coverage: {
      loadedNotesOnly: true,
      includesTrash: includeTrash,
      includesOrdinaryIssues: false,
      includesComments: false,
      includesAttachmentBytes: false,
      includesRecoveryCopies: false,
    },
    notes: entries,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  // Stored ZIP entries avoid expensive compression on the UI thread for large notebooks.
  const bytes = zipSync(files, { level: 0 });
  return {
    filename: `Tebikae-${safeStem(snapshot.repository?.split('/').at(-1) ?? 'notes')}-${snapshot.exportedAt.slice(0, 10)}.zip`,
    blob: new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }),
  };
}
