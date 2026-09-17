import { StrictMode } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import BackupImportDialog from '../src/features/settings/BackupImportDialog';
import { newMetadata } from '../src/domain/codec';
import english from '../src/i18n/locales/en.json';

const mocks = vi.hoisted(() => ({ importNotes: vi.fn(), preview: vi.fn(), flush: vi.fn() }));
vi.mock('../src/application/backup-import', () => ({
  importBackupNotes: mocks.importNotes,
  previewBackupImport: mocks.preview,
}));
vi.mock('../src/app/session', () => ({
  useSession: () => ({ connection: { scopeId: 'test' }, writable: true, engine: { flush: mocks.flush } }),
  flushAllDrafts: async () => {},
}));
const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: english } } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([false, true])(
  'stops using a dismissed import dialog when its pending operation settles (reject: %s)',
  async (reject) => {
    const document = {
      title: 'Imported note',
      markdown: 'Body',
      archived: false,
      labelIds: [],
      meta: newMetadata(),
    };
    mocks.preview.mockResolvedValue({
      scopeId: 'test',
      invalid: [],
      rows: [{ index: 0, document, duplicate: false, missingLabels: [], unknownLabelIds: [] }],
    });
    let resolve!: (result: { imported: number; skipped: number }) => void;
    let rejectPending!: (error: Error) => void;
    mocks.importNotes.mockReturnValue(
      new Promise<{ imported: number; skipped: number }>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        rejectPending = rejectPromise;
      }),
    );
    const view = render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <BackupImportDialog onClose={() => {}} />
        </I18nextProvider>
      </StrictMode>,
    );
    const file = new File([''], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: async () =>
        JSON.stringify({
          format: 'issue-notes-export',
          schemaVersion: 1,
          notes: [{ current: document }],
          labels: [],
        }),
    });
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Import selected (1)' }));
    expect(mocks.importNotes).toHaveBeenCalledOnce();
    const checkWritable = mocks.importNotes.mock.calls[0]![2] as () => void;
    expect(checkWritable).not.toThrow();
    view.unmount();
    expect(checkWritable).toThrow('readonly');
    await act(async () => {
      if (reject) rejectPending(new Error('Storage failure after navigation'));
      else resolve({ imported: 1, skipped: 0 });
    });
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);
