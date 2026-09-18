import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { TextContextMenu } from '../src/features/editor/TextContextMenu';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

async function renderWithI18n(ui: React.ReactNode) {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          context: {
            cut: 'Cut',
            copy: 'Copy',
            paste: 'Paste',
            allText: 'Select all',
            clipboardError: 'Clipboard error',
          },
          editor: {
            undo: 'Undo',
            redo: 'Redo',
          },
        },
      },
    },
  });
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('TextContextMenu delayed cut and paste safety', () => {
  let originalClipboard: Clipboard;
  let originalExecCommand: typeof document.execCommand;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;

    document.execCommand = vi.fn((command, _showUI, value = '') => {
      if (command === 'insertText') {
        const el = document.activeElement as HTMLInputElement;
        if (el && el.setRangeText) {
          el.setRangeText(value, el.selectionStart ?? 0, el.selectionEnd ?? 0, 'end');
          return true;
        }
      }
      return false;
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    document.execCommand = originalExecCommand;
  });

  it('cuts selected text when content is not edited while waiting for clipboard', async () => {
    let clipboardText = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(async (text: string) => {
          clipboardText = text;
        }),
      },
      configurable: true,
    });

    await renderWithI18n(
      <TextContextMenu>
        <input defaultValue="Hello world" aria-label="Title" />
      </TextContextMenu>,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 5); // Select "Hello"

    // Trigger context menu
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    const cutItem = await screen.findByRole('menuitem', { name: 'Cut' });

    await act(async () => {
      fireEvent.click(cutItem);
    });

    expect(clipboardText).toBe('Hello');
    expect(input.value).toBe(' world');
  });

  it('cancels deletion if content changes while clipboard write is pending', async () => {
    let clipboardText = '';
    let resolveWrite: () => void = () => {};
    const writePromise = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(() => {
          clipboardText = 'Hello';
          return writePromise;
        }),
      },
      configurable: true,
    });

    await renderWithI18n(
      <TextContextMenu>
        <input defaultValue="Hello world" aria-label="Title" />
      </TextContextMenu>,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 5); // Select "Hello"

    // Trigger context menu and click Cut (which starts async clipboard.writeText)
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    const cutItem = await screen.findByRole('menuitem', { name: 'Cut' });

    fireEvent.click(cutItem);

    // While clipboard write is still pending, user edits title and selects "Changed"
    input.value = 'Changed title';
    input.setSelectionRange(0, 7); // select "Changed"
    fireEvent.select(input);

    // Resolve the delayed writeText Promise
    await act(async () => {
      resolveWrite();
    });

    // The deletion must be canceled because input value changed!
    expect(clipboardText).toBe('Hello');
    expect(input.value).toBe('Changed title');
  });
});
