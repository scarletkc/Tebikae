import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core';
import {
  commonmark,
  imageSchema,
  linkSchema,
  remarkPreserveEmptyLinePlugin,
} from '@milkdown/kit/preset/commonmark';
import { extendListItemSchemaForTask, gfm, tableSchema } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { Plugin } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import { splitListItem } from '@milkdown/kit/prose/schema-list';
import { $prose } from '@milkdown/kit/utils';
import { safeHref } from '../../security/urls';

export interface EditorEvents {
  changed: () => void;
  compositionStart: () => void;
  compositionEnd: () => void;
  readOnly: () => boolean;
  label: (key: string) => string;
}

/** 图片地址只留在文档模型里，任何 DOM 序列化路径都不创建 img。 */
const placeholderImage = imageSchema.extendSchema((previous) => (ctx) => ({
  ...previous(ctx),
  toDOM: (node) => [
    'span',
    { class: 'editor-image-placeholder', role: 'img', 'aria-label': node.attrs.alt || node.attrs.src },
    `▧ ${node.attrs.alt || node.attrs.src}`,
  ],
}));

const safeLink = linkSchema.extendSchema((previous) => (ctx) => ({
  ...previous(ctx),
  toDOM: (mark) => [
    'a',
    {
      href: safeHref(String(mark.attrs.href)),
      title: mark.attrs.title,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  ],
}));

const gfmTable = tableSchema.extendSchema((previous) => (ctx) => ({
  ...previous(ctx),
  // GFM 允许只有表头的表格；删到最后一行也不能凭空补回内容行。
  content: 'table_header_row table_row*',
}));

const emptyTaskItems = extendListItemSchemaForTask.extendSchema((previous) => (ctx) => {
  const schema = previous(ctx);
  return {
    ...schema,
    toMarkdown: {
      ...schema.toMarkdown,
      runner: (state, node) => {
        if (node.attrs.checked != null && node.childCount === 1 && node.firstChild?.content.size === 0) {
          // GFM 的空任务项需要一个字符引用空格，否则会退化成普通列表并丢失 checked。
          state
            .openNode('listItem', undefined, { ...node.attrs })
            .openNode('paragraph')
            .addNode('text', undefined, ' ')
            .closeNode()
            .closeNode();
        } else schema.toMarkdown.runner(state, node);
      },
    },
  };
});

function taskItemView(
  initial: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
  events: EditorEvents,
): NodeView {
  let node = initial;
  const dom = document.createElement('li');
  const contentDOM = document.createElement('div');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.contentEditable = 'false';
  checkbox.dataset.taskToggle = 'true';
  dom.append(checkbox, contentDOM);
  const update = () => {
    const isTask = node.attrs.checked != null;
    checkbox.hidden = !isTask;
    checkbox.checked = node.attrs.checked === true;
    checkbox.disabled = events.readOnly();
    checkbox.setAttribute('aria-label', events.label('toggleTask'));
    dom.dataset.itemType = isTask ? 'task' : 'list';
    dom.dataset.checked = String(node.attrs.checked);
    dom.dataset.listType = String(node.attrs.listType);
  };
  update();
  checkbox.addEventListener('change', () => {
    const pos = getPos();
    if (events.readOnly() || pos === undefined) return update();
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: checkbox.checked }));
  });
  return {
    dom,
    contentDOM,
    update: (next) => {
      if (next.type !== node.type) return false;
      node = next;
      update();
      return true;
    },
    stopEvent: (event) => event.target === checkbox,
    ignoreMutation: (mutation) =>
      mutation.type !== 'selection' && (mutation.target === checkbox || mutation.target === dom),
  };
}

function codeBlockView(
  initial: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
  events: EditorEvents,
): NodeView {
  let node = initial;
  const dom = document.createElement('div');
  dom.className = 'editor-code-block';
  const bar = document.createElement('div');
  bar.className = 'code-block-header';
  bar.contentEditable = 'false';
  const language = document.createElement('input');
  language.setAttribute('aria-label', events.label('codeLanguage'));
  language.placeholder = 'Plain Text';
  language.maxLength = 40;
  const list = document.createElement('datalist');
  list.id = `languages-${crypto.randomUUID()}`;
  language.setAttribute('list', list.id);
  for (const value of [
    'javascript',
    'typescript',
    'python',
    'rust',
    'c',
    'cpp',
    'json',
    'bash',
    'tsx',
    'toml',
    'nginx',
  ]) {
    const option = document.createElement('option');
    option.value = value;
    list.append(option);
  }
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = events.label('copyCode');
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(node.textContent).catch(() => {
      status.textContent = events.label('clipboardError');
    });
  });
  const pre = document.createElement('pre'),
    contentDOM = document.createElement('code');
  pre.append(contentDOM);
  const update = () => {
    language.value = String(node.attrs.language ?? '');
    pre.dataset.language = language.value;
    language.disabled = events.readOnly();
  };
  language.addEventListener('change', () => {
    const pos = getPos();
    if (events.readOnly() || pos === undefined) return update();
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        language: language.value.replace(/[\r\n`]/g, '').trim(),
      }),
    );
  });
  bar.append(language, list, copy, status);
  dom.append(bar, pre);
  update();
  return {
    dom,
    contentDOM,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      update();
      return true;
    },
    stopEvent: (event) => event.target instanceof globalThis.Node && bar.contains(event.target),
    ignoreMutation: (mutation) =>
      mutation.type !== 'selection' && (bar.contains(mutation.target) || mutation.target === dom),
  };
}

export function createMarkdownEditor(
  root: HTMLElement,
  markdown: string,
  events: EditorEvents,
  emptyChecklist = false,
): Editor {
  const changes = $prose(
    () =>
      new Plugin({
        props: {
          handleDOMEvents: {
            compositionstart: () => {
              events.compositionStart();
              return false;
            },
            compositionend: () => {
              events.compositionEnd();
              return false;
            },
          },
          handleClick: (_view, _position, event) => {
            // 点击链接时保留光标；打开外链由只读预览负责。
            if ((event.target as Element)?.closest?.('a')) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
        view: () => ({
          update: (view, previous) => {
            if (!view.state.doc.eq(previous.doc)) events.changed();
          },
        }),
      }),
  );
  return (
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(
          defaultValueCtx,
          emptyChecklist
            ? {
                type: 'json',
                value: {
                  type: 'doc',
                  content: [
                    {
                      type: 'bullet_list',
                      content: [
                        {
                          type: 'list_item',
                          attrs: { checked: false, listType: 'bullet' },
                          content: [{ type: 'paragraph' }],
                        },
                      ],
                    },
                  ],
                },
              }
            : markdown,
        );
        ctx.update(editorViewOptionsCtx, (previous) => ({
          ...previous,
          editable: () => !events.readOnly(),
          handleKeyDown: (view, event) => {
            if (
              event.key !== 'Enter' ||
              event.shiftKey ||
              event.ctrlKey ||
              event.metaKey ||
              view.composing ||
              events.readOnly()
            )
              return false;
            const { $from } = view.state.selection;
            if (
              $from.depth < 2 ||
              $from.node(-1).type.name !== 'list_item' ||
              $from.node(-1).attrs.checked == null
            )
              return false;
            return splitListItem(view.state.schema.nodes.list_item!)(
              view.state,
              (tr) => {
                const cursor = tr.selection.$from;
                if (cursor.depth >= 2 && cursor.node(-1).type.name === 'list_item')
                  tr.setNodeMarkup(cursor.before(-1), undefined, {
                    ...cursor.node(-1).attrs,
                    checked: false,
                  });
                view.dispatch(tr);
              },
              view,
            );
          },
          attributes: {
            role: 'textbox',
            'aria-multiline': 'true',
            'aria-label': events.label('body'),
            spellcheck: 'true',
          },
          nodeViews: {
            ...previous.nodeViews,
            list_item: (node, view, getPos) => taskItemView(node, view, getPos, events),
            code_block: (node, view, getPos) => codeBlockView(node, view, getPos, events),
          },
        }));
      })
      // Markdown 本身会规范化空段落。不要把空单元格序列化成原始 HTML <br />。
      .use(
        commonmark.filter(
          (plugin) => !(remarkPreserveEmptyLinePlugin as readonly unknown[]).includes(plugin),
        ),
      )
      .use(gfm)
      .use(gfmTable)
      .use(emptyTaskItems)
      .use(placeholderImage)
      .use(safeLink)
      .use(history)
      .use(clipboard)
      .use(changes)
  );
}
