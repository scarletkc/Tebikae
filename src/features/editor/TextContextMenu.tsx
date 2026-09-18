import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';

/** Uses native text editing so selection, IME and browser undo remain intact. */
export function TextContextMenu({
  children,
  markdown = false,
  readOnly = false,
}: {
  children: ReactNode;
  markdown?: boolean;
  readOnly?: boolean;
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
    ...(hasSelection
      ? [
          { label: t('context.cut'), disabled: readOnly, run: () => void copy(true) },
          { label: t('context.copy'), run: () => void copy() },
        ]
      : []),
    {
      label: t('context.paste'),
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
    ...(!hasSelection
      ? [
          {
            label: t('context.allText'),
            run: () => {
              restore()?.select();
            },
          },
        ]
      : []),
    ...(markdown && hasSelection
      ? [
          {
            label: t('editor.formatMenu'),
            separator: true,
            disabled: readOnly,
            children: [
              { label: t('editor.bold'), run: () => wrap('**') },
              { label: t('editor.italic'), run: () => wrap('*') },
              { label: t('editor.strike'), run: () => wrap('~~') },
              { label: t('editor.inlineCode'), run: () => wrap('`') },
              { label: t('editor.link'), run: () => wrap('[', '](https://)') },
            ],
          },
        ]
      : []),
    {
      label: t('editor.undo'),
      disabled: readOnly,
      separator: true,
      run: () => {
        restore();
        document.execCommand('undo');
      },
    },
    {
      label: t('editor.redo'),
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
