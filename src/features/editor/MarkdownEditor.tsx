import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
}

function ToolButton({ label, children, onClick, disabled }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="editor-tool"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
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

  useEffect(() => {
    if (loading) return;
    session.editor = get();
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

  const run = (callback: (ctx: Ctx) => void) => {
    if (loading || readOnly) return;
    get()?.action((ctx) => {
      callback(ctx);
      ctx.get(editorViewCtx).focus();
    });
  };
  const command = (factory: (ctx: Ctx) => Command) =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      factory(ctx)(view.state, view.dispatch, view);
    });
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
  const removeTableRows = () =>
    command(() => (state, dispatch) => {
      if (!isInTable(state)) return false;
      const { table, tableStart, top, bottom } = selectedRect(state);
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
      dispatch?.(state.tr.replaceWith(tableStart - 1, tableStart - 1 + table.nodeSize, replacement));
      return true;
    });
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
    <div className="markdown-editor" ref={container}>
      <div className="editor-modebar">
        <span>{t(mode === 'visual' ? 'editor.visual' : 'editor.source')}</span>
        <button
          type="button"
          className="editor-mode-toggle"
          onClick={() => void switchMode()}
          disabled={loading || loadFailed}
        >
          {t(mode === 'visual' ? 'editor.showSource' : 'editor.showVisual')}
        </button>
      </div>
      {unsupported && mode === 'source' && (
        <p className="editor-notice" role="status">
          {t('editor.unsupported')}
        </p>
      )}
      {loadFailed && (
        <p className="editor-notice" role="status">
          {t('editor.loadFailed')}
        </p>
      )}
      {mode === 'visual' && !readOnly && (
        <>
          <div className="editor-toolbar" role="toolbar" aria-label={t('editor.toolbar')}>
            <select
              aria-label={t('editor.heading')}
              disabled={loading}
              defaultValue=""
              onChange={(event) => {
                const level = Number(event.target.value);
                command((ctx) =>
                  setBlockType(
                    ctx.get(editorViewCtx).state.schema.nodes[level ? 'heading' : 'paragraph']!,
                    level ? { level } : undefined,
                  ),
                );
                event.target.value = '';
              }}
            >
              <option value="" disabled>
                {t('editor.heading')}
              </option>
              <option value="0">{t('editor.paragraph')}</option>
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <option key={level} value={level}>
                  {t('editor.headingLevel', { level })}
                </option>
              ))}
            </select>
            {tool('bold', <Bold />, () => mark('strong'))}
            {tool('italic', <Italic />, () => mark('emphasis'))}
            {tool('strike', <Strikethrough />, () => mark('strike_through'))}
            {tool('inlineCode', <Code />, () => mark('inlineCode'))}
            {tool('link', <Link />, openLink)}
            <span className="editor-toolbar-divider" />
            {tool('bulletList', <List />, () => list(false))}
            {tool('orderedList', <ListOrdered />, () => list(true))}
            {tool('taskList', <CheckSquare />, task)}
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
            <span className="editor-toolbar-divider" />
            {tool('table', <Table />, insertTable)}
            {tool('addRow', <Rows3 />, () => run((ctx) => ctx.get(commandsCtx).call(addRowAfterCommand.key)))}
            {tool('addColumn', <Columns3 />, () => command(() => addColumnAfter))}
            <details className="editor-table-actions">
              <summary aria-label={t('editor.tableActions')} title={t('editor.tableActions')}>
                {t('editor.tableMenu')}
              </summary>
              <div>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={removeTableRows}
                >
                  {t('editor.deleteRow')}
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => command(() => deleteColumn)}
                >
                  {t('editor.deleteColumn')}
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => command(() => deleteTable)}
                >
                  <Trash2 size={14} />
                  {t('editor.deleteTable')}
                </button>
              </div>
            </details>
            <span className="editor-toolbar-divider" />
            {tool('undo', <Undo2 />, () => command(() => undo))}
            {tool('redo', <Redo2 />, () => command(() => redo))}
          </div>
          <div className="editor-codebar">
            {tool('codeBlock', <CodeXml />, () =>
              command((ctx) =>
                setBlockType(ctx.get(editorViewCtx).state.schema.nodes.code_block!, {
                  language: codeLanguage.trim(),
                }),
              ),
            )}
            <input
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
            <span>{t('editor.codeHint')}</span>
          </div>
          {linkOpen && (
            <form
              className="editor-link-form"
              onSubmit={(event) => {
                event.preventDefault();
                applyLink();
              }}
            >
              <label>
                {t('editor.linkText')}
                <input value={linkText} onChange={(event) => setLinkText(event.target.value)} />
              </label>
              <label>
                {t('editor.linkUrl')}
                <input
                  autoFocus
                  value={linkUrl}
                  placeholder="https://"
                  onChange={(event) => {
                    setLinkUrl(event.target.value);
                    setLinkError(false);
                  }}
                  aria-invalid={linkError}
                />
              </label>
              {linkError && <span role="alert">{t('editor.invalidUrl')}</span>}
              <div>
                <button type="submit">{t('editor.applyLink')}</button>
                <button type="button" onClick={() => applyLink(true)}>
                  {t('editor.removeLink')}
                </button>
                <button type="button" onClick={() => setLinkOpen(false)}>
                  {t('editor.cancel')}
                </button>
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
      {clipboardError && <p role="alert">{t('context.clipboardError')}</p>}
      {mode === 'source' && (
        <TextContextMenu markdown readOnly={readOnly}>
          <textarea
            className="editor-source"
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
        <p role="status" className="editor-loading">
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
