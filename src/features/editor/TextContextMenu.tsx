import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bold,
  ClipboardPaste,
  Code,
  Copy,
  Eraser,
  Italic,
  Link,
  List,
  Redo2,
  Scissors,
  Strikethrough,
  Type,
  Undo2,
} from 'lucide-react';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';

/** Uses native text editing so selection, IME and browser undo remain intact. */
export function TextContextMenu({
  children,
  markdown = false,
  readOnly = false,
  clearLabel,
  clearDisabled = false,
  onClear,
}: {
  children: ReactNode;
  markdown?: boolean;
  readOnly?: boolean;
  clearLabel?: string;
  clearDisabled?: boolean;
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const range = useRef({ start: 0, end: 0 });
  const [hasSelection, setHasSelection] = useState(false);
  const [error, setError] = useState(false);
  const input = () => root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  const restore = () => {
    const el = input();
    el?.focus();
    el?.setSelectionRange(range.current.start, range.current.end);
    return el;
  };
  const restoreRange = (el: HTMLInputElement | HTMLTextAreaElement, sel: { start: number; end: number }) => {
    el.focus();
    el.setSelectionRange(sel.start, sel.end);
    return el;
  };
  const copy = async (cut = false) => {
    const el = input();
    if (!el) return;
    const initialTarget = el;
    const initialValue = el.value;
    const initialRange = { ...range.current };
    const textToCopy = initialValue.slice(initialRange.start, initialRange.end);
    try {
      await navigator.clipboard.writeText(textToCopy);
      if (cut) {
        if (readOnly) return;
        const currentEl = input();
        // Only delete if the target element is unchanged and its content was not edited while waiting
        if (currentEl === initialTarget && currentEl.value === initialValue) {
          restoreRange(currentEl, initialRange);
          document.execCommand('insertText', false, '');
        }
      }
    } catch {
      setError(true);
    }
  };
  const wrap = (left: string, right = left) => {
    if (readOnly) return;
    const el = input();
    if (!el) return;
    const initialRange = { ...range.current };
    restoreRange(el, initialRange);
    const text = el.value.slice(initialRange.start, initialRange.end);
    document.execCommand('insertText', false, `${left}${text}${right}`);
  };
  const items: MenuAction[] = [
    {
      label: t('context.cut'),
      icon: Scissors,
      disabled: readOnly || !hasSelection,
      run: () => void copy(true),
    },
    { label: t('context.copy'), icon: Copy, disabled: !hasSelection, run: () => void copy() },
    {
      label: t('context.paste'),
      icon: ClipboardPaste,
      disabled: readOnly,
      run: () => {
        if (readOnly) return;
        const el = input();
        if (!el) return;
        const initialTarget = el;
        const initialValue = el.value;
        const initialRange = { ...range.current };
        void navigator.clipboard
          .readText()
          .then((text) => {
            const currentEl = input();
            if (currentEl === initialTarget && currentEl.value === initialValue) {
              restoreRange(currentEl, initialRange);
              document.execCommand('insertText', false, text);
            }
          })
          .catch(() => setError(true));
      },
    },
    {
      label: t('context.allText'),
      icon: List,
      separator: true,
      run: () => {
        restore()?.select();
      },
    },
    ...(onClear
      ? [
          {
            label: clearLabel ?? t('context.clear'),
            icon: Eraser,
            disabled: clearDisabled,
            run: onClear,
          },
        ]
      : []),
    ...(markdown && hasSelection
      ? [
          {
            label: t('editor.formatMenu'),
            icon: Type,
            separator: true,
            disabled: readOnly,
            children: [
              { label: t('editor.bold'), icon: Bold, run: () => wrap('**') },
              { label: t('editor.italic'), icon: Italic, run: () => wrap('*') },
              { label: t('editor.strike'), icon: Strikethrough, run: () => wrap('~~') },
              { label: t('editor.inlineCode'), icon: Code, run: () => wrap('`') },
              {
                label: t('editor.menu.link', { defaultValue: t('editor.link') }),
                icon: Link,
                run: () => wrap('[', '](https://)'),
              },
            ],
          },
        ]
      : []),
    {
      label: t('editor.undo'),
      icon: Undo2,
      disabled: readOnly,
      separator: true,
      run: () => {
        restore();
        document.execCommand('undo');
      },
    },
    {
      label: t('editor.redo'),
      icon: Redo2,
      disabled: readOnly,
      run: () => {
        restore();
        document.execCommand('redo');
      },
    },
  ];
  return (
    <div
      ref={root}
      className="text-context-target"
      onSelect={() => {
        const el = input();
        if (document.activeElement !== el) return;
        range.current = { start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 };
        const selected = range.current.start !== range.current.end;
        setHasSelection(selected);
      }}
    >
      <ContextMenu
        allowText
        items={items}
        onPrepare={() => {
          const el = input();
          range.current = { start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 };
          setHasSelection(range.current.start !== range.current.end);
          setError(false);
        }}
      >
        {children}
      </ContextMenu>
      {error && <p role="alert">{t('context.clipboardError')}</p>}
    </div>
  );
}
