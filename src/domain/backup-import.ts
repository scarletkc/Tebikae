import { z } from 'zod';
import { DocumentValidationError, safeJsonClone, validateDocument } from './codec';
import type { NoteDocument } from './types';

export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_MAX_NOTES = 2000;
export type ImportErrorCode =
  'read' | 'size' | 'json' | 'format' | 'version' | 'count' | 'selection' | 'readonly';
export class BackupImportError extends Error {
  constructor(public readonly code: ImportErrorCode) {
    super(code);
  }
}
export interface BackupNote {
  index: number;
  document: NoteDocument;
  labelNames: string[];
  unknownLabelIds: number[];
}
export interface InvalidBackupNote {
  index: number;
  title: string;
  reason: 'title' | 'markdown' | 'meta' | 'labels' | 'document';
}
export interface ParsedBackup {
  repository?: string;
  notes: BackupNote[];
  invalid: InvalidBackupNote[];
}
const record = z.record(z.string(), z.unknown());
const envelope = z.object({
  format: z.literal('issue-notes-export'),
  schemaVersion: z.literal(1),
  notes: z.array(z.unknown()),
  labels: z.array(z.object({ id: z.number().int().positive(), name: z.string().min(1).max(100) })).max(10000),
  source: z.object({ repository: z.string().max(300).optional() }).optional(),
});
const documentShape = z.object({
  title: z.string(),
  markdown: z.string(),
  archived: z.boolean(),
  labelIds: z.array(z.number().int().positive()).max(1000),
  meta: record,
});

/** Read only canonical notes; exported drafts/conflicts are aliases, not extra copies. */
export function parseBackup(text: string): ParsedBackup {
  if (new TextEncoder().encode(text).byteLength > IMPORT_MAX_BYTES) throw new BackupImportError('size');
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/u, '')) as unknown;
  } catch {
    throw new BackupImportError('json');
  }
  const root = record.safeParse(raw);
  if (!root.success || root.data.format !== 'issue-notes-export') throw new BackupImportError('format');
  if (root.data.schemaVersion !== 1) throw new BackupImportError('version');
  const result = envelope.safeParse(raw);
  if (!result.success) throw new BackupImportError('format');
  if (result.data.notes.length > IMPORT_MAX_NOTES) throw new BackupImportError('count');
  const names = new Map<number, string>();
  for (const label of result.data.labels) {
    if (names.has(label.id) && names.get(label.id) !== label.name) throw new BackupImportError('format');
    names.set(label.id, label.name);
  }
  const notes: BackupNote[] = [],
    invalid: InvalidBackupNote[] = [];
  result.data.notes.forEach((value, index) => {
    const row = z.object({ current: z.unknown() }).safeParse(value);
    const parsed = documentShape.safeParse(row.success ? row.data.current : null);
    let title = '';
    if (row.success && typeof row.data.current === 'object' && row.data.current !== null) {
      const candidate = (row.data.current as Record<string, unknown>).title;
      if (typeof candidate === 'string') title = [...candidate].slice(0, 120).join('');
    }
    if (!parsed.success) {
      invalid.push({ index, title, reason: 'document' });
      return;
    }
    const document = safeJsonClone({
      ...parsed.data,
      meta: (row.success ? (row.data.current as Record<string, unknown>) : {}).meta,
    }) as NoteDocument;
    try {
      validateDocument(document);
    } catch (error) {
      invalid.push({
        index,
        title,
        reason: error instanceof DocumentValidationError ? error.field : 'document',
      });
      return;
    }
    const ids = [...new Set(document.labelIds)];
    notes.push({
      index,
      document,
      labelNames: ids.flatMap((id) => (names.has(id) ? [names.get(id)!] : [])),
      unknownLabelIds: ids.filter((id) => !names.has(id)),
    });
  });
  return { repository: result.data.source?.repository, notes, invalid };
}

/** Stable serialization also preserves prototype-named metadata extension keys. */
function canonicalJSON(value: unknown): string {
  const cloned = safeJsonClone(value);
  const pending: unknown[] = [cloned];
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const object = current as Record<string, unknown>;
    const entries = Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const key of Object.keys(object)) delete object[key];
    for (const [key, item] of entries) {
      object[key] = item;
      pending.push(item);
    }
  }
  return JSON.stringify(cloned);
}

export async function backupNoteFingerprint(note: BackupNote): Promise<string> {
  const { labelIds: _labelIds, ...document } = note.document;
  const content = canonicalJSON({
    document,
    labels: [...note.labelNames].sort(),
    unknown: [...note.unknownLabelIds].sort((a, b) => a - b),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
