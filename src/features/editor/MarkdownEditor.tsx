import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Command } from '@milkdown/kit/prose/state';
import { AllSelection, Selection } from '@milkdown/kit/prose/state';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';
import { TextContextMenu } from './TextContextMenu';
import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands';
import { liftListItem, sinkListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
import { redo, undo } from '@milkdown/kit/prose/history';
import {
  addColumnAfter,
  deleteColumn,
  deleteTable,
  isInTable,
  selectedRect,
} from '@milkdown/kit/prose/tables';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { addRowAfterCommand, insertTableCommand } from '@milkdown/kit/preset/gfm';
import {
  Bold,
  CheckSquare,
  ChevronDown,
  ClipboardPaste,
  Code,
  CodeXml,
  Columns3,
  Copy,
  CornerDownLeft,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  Languages,
  Minus,
  MoreHorizontal,
  Plus,
  Quote,
  Redo2,
  Rows3,
  Scissors,
  Strikethrough,
  Table,
  Type,
  Trash2,
  Unlink,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { checkVisualSupport } from '../../domain/markdown';
import { safeHref } from '../../security/urls';
import { createMarkdownEditor } from './engine';
import { MarkdownSession } from './session';
import { cleanCodeLanguage, codeLanguages, openCodeLanguagePicker } from './code-language';
import { convertList } from './list-commands';
import {
  Banner,
  Button,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Textarea,
  Toolbar,
  ToolbarDivider,
  cn,
} from '../../ui';
import './editor.css';

export interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
  initialKind?: 'markdown' | 'checklist';
  onReady?: (flush: () => Promise<void>) => void;
}

interface ToolbarButtonProps {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

function ToolButton({ label, children, onClick, disabled, className }: ToolbarButtonProps) {
  return (
    <IconButton
      size="sm"
      label={label}
      disabled={disabled}
      // 32px wide so the whole toolbar fits a phone, 44px tall for touch.
      className={cn('editor-tool max-md:h-11 [&_svg]:size-4', className)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}

function EditorBody({
  value,
  onChange,
  readOnly = false,
  initialKind = 'markdown',
  onReady,
}: MarkdownEditorProps) {
  const { t, i18n } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const readOnlyRef = useRef(readOnly);
  const translateRef = useRef(t);
  readOnlyRef.current = readOnly;
  translateRef.current = t;
  const [session] = useState(() => new MarkdownSession(value, onChange));
  session.onChange = onChange;
  const initial = useRef(checkVisualSupport(value).supported ? value : '');
  const initialChecklist = useRef(initialKind === 'checklist' && !value);
  const [mode, setMode] = useState<'visual' | 'source'>(() =>
    checkVisualSupport(value).supported ? 'visual' : 'source',
  );
  const [source, setSource] = useState(value);
  const [unsupported, setUnsupported] = useState(() => !checkVisualSupport(value).supported);
  const [loadFailed, setLoadFailed] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState('');
  const languageListId = useId();
  const expandedToolsId = useId();
  const [toolsOpen, setToolsOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null);
  const [context, setContext] = useState({
    selected: false,
    table: false,
    list: false,
    task: false,
    checked: false,
    code: false,
    quote: false,
    link: '',
  });
  const [clipboardError, setClipboardError] = useState(false);
  const { loading, get } = useEditor(
    (root) =>
      createMarkdownEditor(
        root,
        initial.current,
        {
          changed: session.changed,
          compositionStart: session.compositionStart,
          compositionEnd: session.compositionEnd,
          readOnly: () => readOnlyRef.current,
          label: (key) => translateRef.current(`editor.${key}`),
        },
        initialChecklist.current,
      ),
    [],
  );

  // Observe native selection without replacing Milkdown's selection, focus, or IME handling.
  useEffect(() => {
    if (mode !== 'visual' || readOnly || loading) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        const root = container.current;
        const body = root?.querySelector('.ProseMirror');
        if (
          !root ||
          !body ||
          !selection?.rangeCount ||
          selection.isCollapsed ||
          !body.contains(selection.anchorNode) ||
          !body.contains(selection.focusNode) ||
          document.querySelector('[role="menu"]')
        ) {
          setSelectionPosition(null);
          return;
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        const scrollBounds = root.closest('.note-dialog-scroll')?.getBoundingClientRect();
        if (
          !rect.width ||
          (scrollBounds && (rect.bottom < scrollBounds.top + 56 || rect.top > scrollBounds.bottom))
        ) {
          setSelectionPosition(null);
          return;
        }
        const toolsBottom =
          root.querySelector('.editor-toolbar')?.getBoundingClientRect().bottom ?? bounds.top;
        const above = rect.top - 56;
        let top = above < toolsBottom + 4 ? rect.bottom + 8 : above;
        if (scrollBounds) top = Math.min(top, scrollBounds.bottom - 56);
        setSelectionPosition({
          x: Math.max(0, Math.min(rect.left + rect.width / 2 - bounds.left - 112, bounds.width - 224)),
          y: Math.max(0, top - bounds.top),
        });
      });
    };
    const hide = () => {
      cancelAnimationFrame(frame);
      setSelectionPosition(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        container.current?.contains(document.activeElement) &&
        !document.querySelector('[role="menu"]')
      ) {
        const toolbar = container.current?.querySelector('.editor-selection-toolbar');
        if (toolbar) {
          event.preventDefault();
          hide();
        }
      }
    };
    document.addEventListener('selectionchange', update);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    container.current?.addEventListener('contextmenu', hide);
    container.current?.addEventListener('compositionstart', hide);
    document.addEventListener('keydown', onKey);
    const root = container.current;
    return () => {
      cancelAnimationFrame(frame);
      setSelectionPosition(null);
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      root?.removeEventListener('contextmenu', hide);
      root?.removeEventListener('compositionstart', hide);
      document.removeEventListener('keydown', onKey);
    };
  }, [mode, readOnly, loading]);

  useEffect(() => {
    if (loading) return;
    session.attach(get());
    if (!session.editor) {
      setLoadFailed(true);
      setSource(session.value);
      setMode('source');
    }
    onReady?.(session.flush);
  }, [loading, get, onReady, session]);

  useEffect(() => {
    if (session.acceptValue(value)) {
      setSource(value);
      const support = checkVisualSupport(value).supported;
      setUnsupported(!support);
      if (!support) setMode('source');
    }
    if (mode === 'visual' && !loading && checkVisualSupport(session.value).supported) session.loadVisual();
  }, [value, loading, mode, session]);

  useEffect(() => {
    if (loading) return;
    get()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.setProps({
        editable: () => !readOnly,
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': t('editor.body'),
          spellcheck: 'true',
        },
      });
    });
    for (const checkbox of container.current?.querySelectorAll<HTMLInputElement>('[data-task-toggle]') ??
      []) {
      checkbox.disabled = readOnly;
      checkbox.setAttribute('aria-label', t('editor.toggleTask'));
    }
  }, [get, loading, readOnly, t, i18n.resolvedLanguage]);

  useEffect(() => () => session.dispose(), [session]);

  /** Runs an editor change, then moves focus back into the document unless `focus` is false. */
  const run = (callback: (ctx: Ctx) => void, focus = true) => {
    if (loading || readOnly) return;
    get()?.action((ctx) => {
      callback(ctx);
      if (focus) ctx.get(editorViewCtx).focus();
    });
  };
  const command = (factory: (ctx: Ctx) => Command, focus = true) =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      factory(ctx)(view.state, view.dispatch, view);
    }, focus);
  const mark = (name: string) =>
    command((ctx) => toggleMark(ctx.get(editorViewCtx).state.schema.marks[name]!));
  const list = (ordered: boolean, convert = false) => command(() => convertList(ordered, convert));
  const task = () =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      let { $from } = view.state.selection;
      if (
        !Array.from({ length: $from.depth }, (_, index) => $from.node(index + 1)).some(
          (node) => node.type.name === 'list_item',
        )
      ) {
        wrapInList(view.state.schema.nodes.bullet_list!)(view.state, view.dispatch, view);
        $from = view.state.selection.$from;
      }
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === 'list_item') {
          view.dispatch(
            view.state.tr.setNodeMarkup($from.before(depth), undefined, {
              ...node.attrs,
              checked: node.attrs.checked == null ? false : null,
            }),
          );
          break;
        }
      }
    });
  const insertTable = () =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const from = view.state.selection.from;
      ctx.get(commandsCtx).call(insertTableCommand.key, { row: 3, col: 3 });
      let insertedPosition: number | undefined;
      view.state.doc.descendants((node, position) => {
        if (insertedPosition !== undefined) return false;
        if (node.type.name === 'table' && position >= from - 1) {
          insertedPosition = position;
          return false;
        }
        return true;
      });
      if (insertedPosition !== undefined) {
        const selection = Selection.findFrom(view.state.doc.resolve(insertedPosition + 1), 1, true);
        if (selection) view.dispatch(view.state.tr.setSelection(selection));
      }
    });
  /** Deletes the selected rows, keeps a header row, and deletes the table when no row is left. */
  const deleteRows: Command = (state, dispatch) => {
    if (!isInTable(state)) return false;
    const { table, tableStart, top, bottom, left } = selectedRect(state);
    const rows: ProseNode[] = [];
    table.forEach((row, _offset, index) => {
      if (index < top || index >= bottom) rows.push(row);
    });
    if (!rows.length) return deleteTable(state, dispatch);
    if (rows[0]!.type.name !== 'table_header_row') {
      const cells: ProseNode[] = [];
      rows[0]!.forEach((cell) =>
        cells.push(state.schema.nodes.table_header!.create(cell.attrs, cell.content)),
      );
      rows[0] = state.schema.nodes.table_header_row!.create(null, cells);
    }
    const replacement = table.type.create(table.attrs, rows);
    if (!dispatch) return true;
    const tr = state.tr.replaceWith(tableStart - 1, tableStart - 1 + table.nodeSize, replacement);
    // Keep the cursor in the same column of the row that moved up, so the next delete still
    // applies to this table. Replacing the whole table maps the cursor to its end, which puts it
    // in the next paragraph when one follows the table.
    const rowIndex = Math.min(top, rows.length - 1);
    let pos = tableStart + 1;
    for (let index = 0; index < rowIndex; index++) pos += rows[index]!.nodeSize;
    const row = rows[rowIndex]!;
    for (let index = 0; index < Math.min(left, row.childCount - 1); index++) pos += row.child(index).nodeSize;
    dispatch(tr.setSelection(Selection.near(tr.doc.resolve(pos + 1))));
    return true;
  };
  const removeTableRows = () => command(() => deleteRows);
  const switchMode = async () => {
    await session.flush();
    if (mode === 'visual') {
      setSource(session.value);
      setMode('source');
      return;
    }
    const supported = checkVisualSupport(session.value).supported;
    setUnsupported(!supported);
    if (!supported) return;
    session.loadVisual();
    setMode('visual');
  };

  const openLink = () => {
    get()?.action((ctx) => {
      const { selection, doc, schema } = ctx.get(editorViewCtx).state;
      const link = schema.marks.link?.isInSet(selection.$from.marks());
      setLinkUrl(link?.attrs.href ? String(link.attrs.href) : '');
      setLinkText(doc.textBetween(selection.from, selection.to));
    });
    setLinkError(false);
    setLinkOpen(true);
  };

  const applyLink = (remove = false) => {
    const href = safeHref(linkUrl);
    if (!remove && !href) {
      setLinkError(true);
      return;
    }
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const type = state.schema.marks.link!;
      let { from, to } = state.selection;
      const { $from } = state.selection;
      if (from === to) {
        const active = type.isInSet($from.marks());
        if (active) {
          let offset = $from.start();
          const ranges: Array<{ from: number; to: number }> = [];
          let range: { from: number; to: number } | undefined;
          $from.parent.forEach((child) => {
            if (active.isInSet(child.marks)) {
              if (!range) {
                range = { from: offset, to: offset };
                ranges.push(range);
              }
              range.to = offset + child.nodeSize;
            } else range = undefined;
            offset += child.nodeSize;
          });
          const selected = ranges.find((candidate) => candidate.from <= from && candidate.to >= from);
          if (selected) {
            from = selected.from;
            to = selected.to;
          }
        }
      }
      let tr = state.tr;
      if (remove) tr = tr.removeMark(from, to, type).removeStoredMark(type);
      else if (from === to) {
        const text = linkText.trim() || href!;
        tr = tr.insertText(text, from, to).addMark(from, from + text.length, type.create({ href }));
      } else tr = tr.removeMark(from, to, type).addMark(from, to, type.create({ href }));
      view.dispatch(tr);
    });
    setLinkOpen(false);
  };

  const tool = (key: string, icon: ReactNode, action: () => void) => (
    <ToolButton key={key} label={t(`editor.${key}`)} disabled={readOnly || loading} onClick={action}>
      {icon}
    </ToolButton>
  );
  const prepareMenu = ({
    x,
    y,
    preserveSelection,
  }: {
    x: number;
    y: number;
    preserveSelection?: boolean;
  }) => {
    get()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const hit = preserveSelection ? null : view.posAtCoords({ left: x, top: y });
      if (
        hit &&
        (view.state.selection.empty ||
          hit.pos < view.state.selection.from ||
          hit.pos > view.state.selection.to)
      )
        view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(hit.pos))));
      const { selection, schema } = view.state;
      let item: ReturnType<typeof selection.$from.node> | undefined;
      for (let d = selection.$from.depth; d > 0; d--) {
        const node = selection.$from.node(d);
        if (node.type.name === 'list_item') {
          item = node;
          break;
        }
      }
      const nodes = Array.from({ length: selection.$from.depth }, (_, i) => selection.$from.node(i + 1));
      setContext({
        selected: !selection.empty,
        table: isInTable(view.state),
        list: !!item,
        task: item?.attrs.checked != null,
        checked: item?.attrs.checked === true,
        code: nodes.some((n) => n.type.name === 'code_block'),
        quote: nodes.some((n) => n.type.name === 'blockquote'),
        link: String(schema.marks.link?.isInSet(selection.$from.marks())?.attrs.href ?? ''),
      });
    });
  };
  const copyText = (cut = false, code = false) => {
    get()?.action((ctx) => {
      const view = ctx.get(editorViewCtx),
        { state } = view;
      const selection = state.selection;
      const text = code
        ? selection.$from.parent.textContent
        : state.doc.textBetween(selection.from, selection.to, '\n');
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          if (cut && !readOnly && view.state.doc.eq(state.doc))
            view.dispatch(view.state.tr.deleteRange(selection.from, selection.to));
        })
        .catch(() => setClipboardError(true));
    });
  };
  const block = (name: string, attrs?: Record<string, unknown>) =>
    command((ctx) => setBlockType(ctx.get(editorViewCtx).state.schema.nodes[name]!, attrs));
  const editorIcons: Record<string, LucideIcon> = {
    paragraph: Type,
    bulletList: List,
    orderedList: ListOrdered,
    taskList: CheckSquare,
    quote: Quote,
    codeBlock: CodeXml,
    indent: IndentIncrease,
    outdent: IndentDecrease,
    outdentBlock: IndentDecrease,
    bold: Bold,
    italic: Italic,
    strike: Strikethrough,
    inlineCode: Code,
    link: Link,
    editLink: Link,
    removeLink: Unlink,
    table: Table,
    addRow: Rows3,
    addColumn: Columns3,
    deleteRow: Rows3,
    deleteColumn: Columns3,
    deleteTable: Trash2,
    rule: Minus,
    undo: Undo2,
    redo: Redo2,
  };
  const item = (key: string, run: () => void): MenuAction => ({
    label: t(`editor.menu.${key}`, { defaultValue: t(`editor.${key}`) }),
    icon: editorIcons[key],
    run,
    disabled: readOnly || loading,
  });
  const insertRule = () =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.hr!.create()));
    });
  const toggleQuote = () =>
    command((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { $from } = view.state.selection;
      const inQuote = Array.from({ length: $from.depth }, (_, depth) => $from.node(depth + 1)).some(
        (node) => node.type.name === 'blockquote',
      );
      return inQuote ? lift : wrapIn(view.state.schema.nodes.blockquote!);
    });
  const indentation: MenuAction[] = context.list
    ? [
        item('indent', () =>
          command((ctx) => sinkListItem(ctx.get(editorViewCtx).state.schema.nodes.list_item!)),
        ),
        item('outdent', () =>
          command((ctx) => liftListItem(ctx.get(editorViewCtx).state.schema.nodes.list_item!)),
        ),
      ]
    : context.quote
      ? [item('outdentBlock', () => command(() => lift))]
      : [];
  const taskToggle: MenuAction[] = context.task
    ? [
        {
          label: t(context.checked ? 'context.incomplete' : 'context.complete'),
          icon: CheckSquare,
          disabled: readOnly,
          run: () =>
            run((ctx) => {
              const view = ctx.get(editorViewCtx),
                { $from } = view.state.selection;
              for (let d = $from.depth; d > 0; d--)
                if ($from.node(d).type.name === 'list_item') {
                  view.dispatch(
                    view.state.tr.setNodeMarkup($from.before(d), undefined, {
                      ...$from.node(d).attrs,
                      checked: !context.checked,
                    }),
                  );
                  break;
                }
            }),
        },
      ]
    : [];
  const conversions: MenuAction[] = [
    item('paragraph', () => block('paragraph')),
    ...[1, 2, 3].map((level) => ({
      label: t('editor.headingLevel', { level }),
      icon: Type,
      disabled: readOnly,
      run: () => block('heading', { level }),
    })),
    item('bulletList', () => list(false, true)),
    item('orderedList', () => list(true, true)),
    item('taskList', task),
    item('quote', toggleQuote),
    item('codeBlock', () => block('code_block', { language: codeLanguage })),
    ...indentation,
    ...taskToggle,
  ];
  const editorItems: MenuAction[] = [
    ...(context.selected
      ? [
          { label: t('context.cut'), icon: Scissors, disabled: readOnly, run: () => copyText(true) },
          { label: t('context.copy'), icon: Copy, run: () => copyText() },
        ]
      : []),
    {
      label: t('context.paste'),
      icon: ClipboardPaste,
      disabled: readOnly,
      run: () => {
        void navigator.clipboard
          .readText()
          .then((text) =>
            run((ctx) => {
              const view = ctx.get(editorViewCtx);
              view.pasteText(text);
            }),
          )
          .catch(() => setClipboardError(true));
      },
    },
    ...(!context.selected
      ? [
          {
            label: t('context.allText'),
            icon: List,
            run: () =>
              get()?.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
                view.focus();
              }),
          },
        ]
      : []),
    ...(context.selected || context.link
      ? [
          {
            label: t('editor.formatMenu'),
            icon: Type,
            separator: true,
            children: [
              ...(!context.code
                ? [
                    item('bold', () => mark('strong')),
                    item('italic', () => mark('emphasis')),
                    item('strike', () => mark('strike_through')),
                    item('inlineCode', () => mark('inlineCode')),
                    item(context.link ? 'editLink' : 'link', openLink),
                  ]
                : []),
              ...(context.link
                ? [
                    {
                      label: t('context.copyLink'),
                      icon: Copy,
                      run: () => {
                        void navigator.clipboard.writeText(context.link).catch(() => setClipboardError(true));
                      },
                    },
                    item('removeLink', () => applyLink(true)),
                  ]
                : []),
            ],
            disabled: context.code,
          },
        ]
      : []),
    {
      label: t('editor.paragraphMenu'),
      icon: Type,
      separator: !context.selected && !context.link,
      disabled: readOnly || loading,
      children: conversions,
    },
    ...(!context.selected && !context.code
      ? [
          {
            label: t('editor.insertMenu'),
            icon: Plus,
            disabled: readOnly || loading,
            children: [
              item('link', openLink),
              item('rule', insertRule),
              item('codeBlock', () => block('code_block', { language: codeLanguage })),
              { ...item('table', insertTable), disabled: readOnly || loading || context.table },
            ],
          },
        ]
      : []),
    ...(context.table
      ? [
          {
            label: t('editor.tableMenu'),
            icon: Table,
            children: [
              item('addRow', () => run((ctx) => ctx.get(commandsCtx).call(addRowAfterCommand.key))),
              item('addColumn', () => command(() => addColumnAfter)),
              item('deleteRow', removeTableRows),
              item('deleteColumn', () => command(() => deleteColumn)),
              { ...item('deleteTable', () => command(() => deleteTable)), danger: true },
            ],
          },
        ]
      : []),
    ...(context.code
      ? [
          {
            label: t('editor.codeMenu'),
            icon: Code,
            children: [
              {
                label: t('context.language'),
                icon: Languages,
                disabled: readOnly,
                run: () => {
                  get()?.action((ctx) => {
                    const view = ctx.get(editorViewCtx);
                    const dom = view.domAtPos(view.state.selection.from).node;
                    const el = dom instanceof Element ? dom : dom.parentElement;
                    openCodeLanguagePicker(
                      el?.closest('.editor-code-block')?.querySelector<HTMLInputElement>('input') ?? null,
                    );
                  });
                },
              },
              { label: t('context.copyCode'), icon: Copy, run: () => copyText(false, true) },
              item('paragraph', () => block('paragraph')),
              {
                label: t('context.deleteCode'),
                icon: Trash2,
                disabled: readOnly,
                danger: true,
                run: () =>
                  run((ctx) => {
                    const view = ctx.get(editorViewCtx);
                    const { $from } = view.state.selection;
                    view.dispatch(view.state.tr.delete($from.before(), $from.after()));
                  }),
              },
            ],
          },
        ]
      : []),
    { ...item('undo', () => command(() => undo)), separator: true },
    item('redo', () => command(() => redo)),
  ];
  return (
    <div className="markdown-editor relative min-w-0 text-fg" ref={container}>
      <div className="editor-modebar flex min-h-9 items-center gap-2">
        {mode === 'visual' && !readOnly && (
          <Toolbar
            className="editor-toolbar max-md:min-w-0 max-md:flex-nowrap max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:*:shrink-0"
            aria-label={t('editor.toolbar')}
          >
            <Menu modal={false}>
              <MenuTrigger disabled={loading}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="editor-heading gap-1 px-2 font-normal text-muted hover:text-fg data-[state=open]:text-fg max-md:h-11"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {t('editor.heading')}
                  <ChevronDown aria-hidden="true" />
                </Button>
              </MenuTrigger>
              <MenuContent
                align="start"
                loop
                // run() moves focus back into the document after the command.
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                {[0, 1, 2, 3, 4, 5, 6].map((level) => (
                  <MenuItem
                    key={level}
                    onSelect={() =>
                      command((ctx) =>
                        setBlockType(
                          ctx.get(editorViewCtx).state.schema.nodes[level ? 'heading' : 'paragraph']!,
                          level ? { level } : undefined,
                        ),
                      )
                    }
                  >
                    {level ? t('editor.headingLevel', { level }) : t('editor.paragraph')}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            {tool('bold', <Bold />, () => mark('strong'))}
            {tool('italic', <Italic />, () => mark('emphasis'))}
            {tool('taskList', <CheckSquare />, task)}
            {tool('undo', <Undo2 />, () => command(() => undo))}
            {tool('redo', <Redo2 />, () => command(() => redo))}
            <IconButton
              size="sm"
              className="editor-tool max-md:h-11 [&_svg]:size-4"
              label={t('editor.moreTools')}
              aria-expanded={toolsOpen}
              aria-controls={expandedToolsId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setToolsOpen((open) => !open)}
            >
              <MoreHorizontal />
            </IconButton>
          </Toolbar>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="editor-mode-toggle ms-auto gap-1.5 px-2.5 font-normal text-muted hover:text-fg max-md:size-11 max-md:px-0"
          title={t(mode === 'visual' ? 'editor.showSource' : 'editor.showVisual')}
          onClick={() => void switchMode()}
          disabled={loading || loadFailed}
        >
          {mode === 'visual' ? <CodeXml aria-hidden="true" /> : <Type aria-hidden="true" />}
          <span className="editor-mode-label max-md:sr-only">
            {t(mode === 'visual' ? 'editor.showSource' : 'editor.showVisual')}
          </span>
        </Button>
      </div>
      {unsupported && mode === 'source' && (
        <Banner role="status" className="editor-notice my-3">
          {t('editor.unsupported')}
        </Banner>
      )}
      {loadFailed && (
        <Banner role="status" className="editor-notice my-3">
          {t('editor.loadFailed')}
        </Banner>
      )}
      {mode === 'visual' && !readOnly && (
        <>
          <AnimatePresence initial={false}>
            {toolsOpen && (
              <motion.div
                id={expandedToolsId}
                className="editor-expanded-tools mt-2 rounded-lg border border-line bg-surface p-0.5"
                initial={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.12 }}
              >
                <Toolbar className="editor-toolbar w-full border-0 p-0" aria-label={t('editor.moreTools')}>
                  {tool('strike', <Strikethrough />, () => mark('strike_through'))}
                  {tool('inlineCode', <Code />, () => mark('inlineCode'))}
                  {tool('link', <Link />, openLink)}
                  {tool('bulletList', <List />, () => list(false))}
                  {tool('orderedList', <ListOrdered />, () => list(true))}
                  {tool('indent', <IndentIncrease />, () =>
                    command((ctx) => sinkListItem(ctx.get(editorViewCtx).state.schema.nodes.list_item!)),
                  )}
                  {tool('outdent', <IndentDecrease />, () =>
                    command((ctx) => liftListItem(ctx.get(editorViewCtx).state.schema.nodes.list_item!)),
                  )}
                  {tool('quote', <Quote />, toggleQuote)}
                  {tool('rule', <Minus />, insertRule)}
                  {tool('lineBreak', <CornerDownLeft />, () =>
                    run((ctx) => {
                      const view = ctx.get(editorViewCtx);
                      view.dispatch(
                        view.state.tr.replaceSelectionWith(view.state.schema.nodes.hardbreak!.create()),
                      );
                    }),
                  )}
                  {/* On phones the table group starts its own row, so no divider is left at a row start. */}
                  <ToolbarDivider className="max-md:hidden" />
                  <div className="editor-table-tools flex items-center gap-0.5 max-md:basis-full">
                    {tool('table', <Table />, insertTable)}
                    {tool('addRow', <Rows3 />, () =>
                      run((ctx) => ctx.get(commandsCtx).call(addRowAfterCommand.key)),
                    )}
                    {tool('addColumn', <Columns3 />, () => command(() => addColumnAfter))}
                    <Menu modal={false}>
                      <MenuTrigger disabled={readOnly || loading}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="editor-table-actions gap-1 px-2 font-normal text-muted hover:text-fg data-[state=open]:text-fg max-md:h-11"
                          aria-label={t('editor.tableActions')}
                          title={t('editor.tableActions')}
                          onMouseDown={(event) => event.preventDefault()}
                        >
                          {t('editor.tableMenu')}
                          <ChevronDown aria-hidden="true" />
                        </Button>
                      </MenuTrigger>
                      <MenuContent
                        align="end"
                        loop
                        className="editor-table-menu"
                        onCloseAutoFocus={(event) => {
                          // Back to the document rather than the trigger, unless a click outside the
                          // menu already focused another control. The editor may be gone by now.
                          event.preventDefault();
                          const active = document.activeElement;
                          if (active && active !== document.body && !active.closest('[role="menu"]')) return;
                          container.current
                            ?.querySelector<HTMLElement>('.ProseMirror')
                            ?.focus({ preventScroll: true });
                        }}
                      >
                        {/* Row and column deletes keep the menu open and focused, so several can be removed in a row. */}
                        <MenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            command(() => deleteRows, false);
                          }}
                        >
                          <Rows3 aria-hidden="true" />
                          {t('editor.deleteRow')}
                        </MenuItem>
                        <MenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            command(() => deleteColumn, false);
                          }}
                        >
                          <Columns3 aria-hidden="true" />
                          {t('editor.deleteColumn')}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem danger onSelect={() => command(() => deleteTable)}>
                          <Trash2 aria-hidden="true" />
                          {t('editor.deleteTable')}
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </div>
                </Toolbar>
                <div className="editor-codebar flex flex-wrap items-center gap-2 px-1 py-1">
                  {tool('codeBlock', <CodeXml />, () =>
                    command((ctx) =>
                      setBlockType(ctx.get(editorViewCtx).state.schema.nodes.code_block!, {
                        language: codeLanguage.trim(),
                      }),
                    ),
                  )}
                  <Input
                    className="h-8 w-36"
                    aria-label={t('editor.codeLanguage')}
                    placeholder={t('editor.plainText')}
                    value={codeLanguage}
                    list={languageListId}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={40}
                    onChange={(event) => setCodeLanguage(cleanCodeLanguage(event.target.value))}
                  />
                  <datalist id={languageListId}>
                    {codeLanguages.map((language) => (
                      <option key={language} value={language} />
                    ))}
                  </datalist>
                  <span className="text-xs text-muted max-md:hidden">{t('editor.codeHint')}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {linkOpen && (
            <form
              className="editor-link-form mt-3 grid gap-3 rounded-lg border border-line bg-surface p-3"
              onSubmit={(event) => {
                event.preventDefault();
                applyLink();
              }}
            >
              <Field label={t('editor.linkText')}>
                {(id) => (
                  <Input id={id} value={linkText} onChange={(event) => setLinkText(event.target.value)} />
                )}
              </Field>
              <Field label={t('editor.linkUrl')} error={linkError ? t('editor.invalidUrl') : undefined}>
                {(id, describedBy) => (
                  <Input
                    id={id}
                    autoFocus
                    value={linkUrl}
                    placeholder="https://"
                    aria-describedby={describedBy}
                    aria-invalid={linkError}
                    onChange={(event) => {
                      setLinkUrl(event.target.value);
                      setLinkError(false);
                    }}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" size="sm">
                  {t('editor.applyLink')}
                </Button>
                <Button size="sm" onClick={() => applyLink(true)}>
                  {t('editor.removeLink')}
                </Button>
                <Button size="sm" onClick={() => setLinkOpen(false)}>
                  {t('editor.cancel')}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      <div hidden={mode !== 'visual'} className="editor-visual">
        <ContextMenu
          allowText
          acceptTarget={(target) =>
            target instanceof Element &&
            !!target.closest('.ProseMirror') &&
            !target.closest('input, button, [contenteditable="false"]')
          }
          items={editorItems}
          onPrepare={prepareMenu}
        >
          <Milkdown />
        </ContextMenu>
      </div>
      {mode === 'visual' && !readOnly && (
        <AnimatePresence>
          {selectionPosition && mode === 'visual' && !readOnly && !linkOpen && (
            <motion.div
              className="editor-selection-toolbar absolute z-20 flex w-56 items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-popover"
              role="toolbar"
              aria-label={t('editor.selectionToolbar')}
              style={{ left: selectionPosition.x, top: selectionPosition.y }}
              initial={{ opacity: 0, y: reducedMotion ? 0 : 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.12 }}
            >
              {[
                { key: 'bold', icon: <Bold />, run: () => mark('strong') },
                { key: 'italic', icon: <Italic />, run: () => mark('emphasis') },
                { key: 'strike', icon: <Strikethrough />, run: () => mark('strike_through') },
                { key: 'inlineCode', icon: <Code />, run: () => mark('inlineCode') },
                { key: 'link', icon: <Link />, run: openLink },
              ].map(({ key, icon, run }) => (
                <ToolButton
                  key={key}
                  className="h-9 flex-1 max-md:h-11"
                  label={t('editor.selectionAction', { action: t(`editor.${key}`) })}
                  onClick={run}
                >
                  {icon}
                </ToolButton>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {clipboardError && (
        <Banner tone="danger" role="alert" className="my-3">
          {t('context.clipboardError')}
        </Banner>
      )}
      {mode === 'source' && (
        <TextContextMenu markdown readOnly={readOnly}>
          <Textarea
            variant="bare"
            className="editor-source block min-h-75 resize-y rounded-none pt-7 pb-10 font-mono text-base/7 caret-accent md:text-sm/6 supports-[field-sizing:content]:resize-none supports-[field-sizing:content]:field-sizing-content"
            aria-label={t('editor.sourceBody')}
            value={source}
            readOnly={readOnly}
            spellCheck={false}
            onCompositionStart={session.compositionStart}
            onCompositionEnd={session.compositionEnd}
            onChange={(event) => {
              setSource(event.target.value);
              session.setSource(event.target.value);
            }}
          />
        </TextContextMenu>
      )}
      {loading && (
        <p role="status" className="editor-loading px-4 py-3 text-sm text-muted">
          {t('editor.loading')}
        </p>
      )}
    </div>
  );
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <MilkdownProvider>
      <EditorBody {...props} />
    </MilkdownProvider>
  );
}

export default MarkdownEditor;
