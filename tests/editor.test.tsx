import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { editorViewCtx, parserCtx, serializerCtx, type Editor } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { redo, undo } from '@milkdown/kit/prose/history';
import { createMarkdownEditor } from '../src/features/editor/engine';
import { MarkdownSession } from '../src/features/editor/session';
import { convertList } from '../src/features/editor/list-commands';
import { MarkdownEditor } from '../src/features/editor/MarkdownEditor';
import { MarkdownPreview } from '../src/features/editor/MarkdownPreview';
import english from '../src/i18n/editor-en.json';
import chinese from '../src/i18n/editor-zh-CN.json';

const editors: Editor[] = [];
beforeAll(() => {
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(async () => {
  cleanup();
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function realEditor(markdown: string) {
  const onChange = vi.fn();
  const session = new MarkdownSession(markdown, onChange);
  const root = document.createElement('div');
  document.body.append(root);
  const editor = await createMarkdownEditor(root, markdown, {
    changed: session.changed,
    compositionStart: session.compositionStart,
    compositionEnd: session.compositionEnd,
    readOnly: () => false,
    label: (key) => key,
  }).create();
  session.editor = editor;
  editors.push(editor);
  return { editor, session, root, onChange };
}

async function translations() {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: { editor: english } }, 'zh-CN': { translation: { editor: chinese } } },
  });
  return i18n;
}

describe('real Milkdown Markdown engine', () => {
  it('round trips Chinese, links, code, lists, tasks, tables, images and text semantics', async () => {
    const markdown =
      '# 中文标题 ✨\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n\n**粗体** *斜体* ~~删除~~ `code <tag>` [链接](https://example.com/a?q=1 "标题")\n\n> 引用\n\n---\n\n1. 有序\n2. 第二行\n\n- 无序\n  - 嵌套\n\n- [x] 已完成\n- [ ] 未完成\n\n```typescript\nconst x = "中文 & <script>";\n```\n\n| 标题 | 状态 |\n| --- | --- |\n| a\\|b | 保留 |\n\n![保留图片](https://example.com/image.png "图像")\n';
    const { editor, session, root, onChange } = await realEditor(markdown);
    editor.action((ctx) => {
      const document = ctx.get(editorViewCtx).state.doc;
      const serialized = ctx.get(serializerCtx)(document);
      const reparsed = ctx.get(parserCtx)(serialized);
      expect(reparsed?.toJSON()).toEqual(ctx.get(parserCtx)(markdown)?.toJSON());
      expect(serialized).toContain('typescript');
      expect(serialized).toContain('https://example.com/a?q=1');
      expect(serialized).toContain('https://example.com/image.png');
    });
    expect(root.querySelectorAll('img[src]')).toHaveLength(0);
    expect(root.querySelectorAll('input[type=checkbox]:not([hidden])')).toHaveLength(2);
    await session.flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(session.value).toBe(markdown);
  });

  it('publishes only real edits and keeps undo/redo history', async () => {
    const { editor, session, onChange } = await realEditor('original');
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
      view.focus();
    });
    await session.flush();
    expect(onChange).not.toHaveBeenCalled();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText('新', 1));
    });
    await session.flush();
    expect(session.value).toContain('新original');
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      undo(view.state, view.dispatch);
    });
    await session.flush();
    expect(session.value.trim()).toBe('original');
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      redo(view.state, view.dispatch);
    });
    await session.flush();
    expect(session.value).toContain('新original');
  });

  it('buffers real transactions until composition completes, including a pending close flush', async () => {
    const { editor, session, onChange } = await realEditor('输入');
    session.compositionStart();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText('中文', 1));
    });
    const flushed = vi.fn();
    const pending = session.flush().then(flushed);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(onChange).not.toHaveBeenCalled();
    expect(flushed).not.toHaveBeenCalled();
    session.compositionEnd();
    await pending;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(session.value).toContain('中文输入');
  });

  it('changes a task checkbox in the document and preserves adjacent Markdown', async () => {
    const { session, root } = await realEditor('- [ ] task\n- [x] done\n\nKeep [link](https://example.com).');
    const checkbox = root.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    checkbox.click();
    await session.flush();
    expect(session.value).toContain('[x] task');
    expect(session.value).toContain('[x] done');
    expect(session.value).toContain('[link](https://example.com)');
  });

  it('renders unsafe links without executable hrefs and never creates remote images', async () => {
    const { root } = await realEditor(
      '[x](javascript:alert%281%29)\n\n![x](https://remote.example/track.png)',
    );
    expect(root.querySelector('a')?.getAttribute('href')).toBeNull();
    expect(root.querySelector('img[src]')).toBeNull();
    expect(root.textContent).toContain('x');
  });

  it('does not reset a cursor when the parent echoes an edited Markdown value', async () => {
    const { editor, session } = await realEditor('abc');
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const tr = view.state.tr.insertText('中', 2);
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 3)));
    });
    await session.flush();
    const before = editor.action((ctx) => ctx.get(editorViewCtx).state.selection.from);
    expect(session.acceptValue(session.value)).toBe(false);
    session.loadVisual();
    expect(editor.action((ctx) => ctx.get(editorViewCtx).state.selection.from)).toBe(before);
  });

  it('handles a long code paste as one buffered document edit', async () => {
    const { editor, session, onChange } = await realEditor('```text\nstart\n```');
    const pasted = '中文 paste <tag> & * code\n'.repeat(1000);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText(pasted, 1));
    });
    await session.flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(session.value).toContain(pasted);
  });

  it('preserves reference-style links and images when visually serialized', async () => {
    const { editor } = await realEditor(
      '[Example][target]\n\n![Image][picture]\n\n[target]: https://example.com/path "Title"\n[picture]: https://example.com/image.png "Caption"',
    );
    const serialized = editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
    expect(serialized).toContain('https://example.com/path');
    expect(serialized).toContain('https://example.com/image.png');
    expect(serialized).toContain('Title');
    expect(serialized).toContain('Caption');
  });

  it('creates the next checklist entry as unchecked when Enter follows a completed task', async () => {
    const { editor, session, root } = await realEditor('- [x] Complete');
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 11)));
    });
    fireEvent.keyDown(root.querySelector('.ProseMirror')!, { key: 'Enter', code: 'Enter' });
    await session.flush();
    expect(root.querySelectorAll('input[type=checkbox]:not([hidden])')).toHaveLength(2);
    expect(session.value).toContain('[x] Complete');
    expect(session.value).toMatch(/\[ \]/);
  });

  it('converts between list kinds in place instead of toggling off', async () => {
    const { editor, session } = await realEditor('- alpha\n- beta');
    const convert = (ordered: boolean) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        convertList(ordered, true)(view.state, view.dispatch, view);
      });
    convert(true);
    await session.flush();
    expect(session.value).toContain('1. alpha');
    convert(false);
    await session.flush();
    const restored = editor.action((ctx) => ctx.get(parserCtx)('- alpha\n- beta')?.toJSON());
    expect(editor.action((ctx) => ctx.get(editorViewCtx).state.doc.toJSON())).toEqual(restored);
  });

  it('accepts arbitrary fenced languages through the shared cleaned picker contract', async () => {
    const { root, session } = await realEditor('```text\nstart\n```');
    const language = root.querySelector<HTMLInputElement>('.code-block-header input')!;
    expect(language.getAttribute('list')).toBeTruthy();
    const suggestions = Array.from(root.querySelectorAll('datalist option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(suggestions).toContain('python');
    for (const [value, expected] of [
      ['gdscript', 'gdscript'],
      ['  jsx ', 'jsx'],
      ['c#', 'c#'],
      ['obj\nect', 'object'],
      ['te`xt', 'text'],
    ]) {
      language.value = value;
      language.dispatchEvent(new Event('change'));
      await session.flush();
      expect(session.value).toContain(`\`\`\`${expected}`);
    }
  });
});

describe('editor lifecycle and safe preview', () => {
  it('starts a new checklist with a visual unchecked item without emitting an empty draft', async () => {
    const i18n = await translations();
    const onChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <MarkdownEditor value="" initialKind="checklist" onChange={onChange} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.queryByText(english.loading)).toBeNull());
    expect(screen.getByRole('checkbox', { name: english.toggleTask })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: english.showSource }));
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: english.sourceBody }) as HTMLTextAreaElement).value).toBe(
        '',
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
  it('preserves the same editor and original source across language, theme and unedited mode changes', async () => {
    const i18n = await translations();
    const original = '*  Preserve   spaces\n\n[link](https://example.com)\n';
    const onChange = vi.fn();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MarkdownEditor value={original} onChange={onChange} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.queryByText(english.loading)).toBeNull());
    const originalDOM = container.querySelector('.ProseMirror');
    expect(originalDOM).not.toBeNull();
    fireEvent.focus(originalDOM!);
    fireEvent.click(screen.getByRole('button', { name: english.showSource }));
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: english.sourceBody }) as HTMLTextAreaElement).value).toBe(
        original,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: english.showVisual }));
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy());
    await act(() => i18n.changeLanguage('zh-CN'));
    document.documentElement.dataset.theme = 'dark';
    expect(screen.getByRole('button', { name: chinese.bold })).toBeTruthy();
    expect(container.querySelector('.ProseMirror')).toBe(originalDOM);
    expect(onChange).not.toHaveBeenCalled();
    delete document.documentElement.dataset.theme;
  });

  it('keeps unsupported HTML in editable source and refuses destructive visual conversion', async () => {
    const i18n = await translations();
    const original = '<details><summary>private</summary>content</details>\n<script>alert(1)</script>';
    const onChange = vi.fn();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MarkdownEditor value={original} onChange={onChange} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.queryByText(english.loading)).toBeNull());
    const source = screen.getByRole('textbox', { name: english.sourceBody }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: english.showVisual }));
    await waitFor(() => expect(screen.getByText(english.unsupported)).toBeTruthy());
    expect(source.value).toBe(original);
    expect(container.querySelector('script')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(source, { target: { value: '# Now supported' } });
    fireEvent.click(screen.getByRole('button', { name: english.showVisual }));
    await waitFor(() =>
      expect(container.querySelector('.ProseMirror h1')?.textContent).toBe('Now supported'),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('# Now supported');
  });

  it('applies toolbar heading and table operations to real visual documents', async () => {
    const i18n = await translations();
    const onChange = vi.fn();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MarkdownEditor value="Start" onChange={onChange} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.queryByText(english.loading)).toBeNull());
    fireEvent.change(screen.getByRole('combobox', { name: english.heading }), { target: { value: '3' } });
    expect(container.querySelector('.ProseMirror h3')?.textContent).toBe('Start');
    fireEvent.click(screen.getByRole('button', { name: english.table }));
    expect(container.querySelectorAll('.ProseMirror tr')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: english.addRow }));
    expect(container.querySelectorAll('.ProseMirror tr')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: english.addColumn }));
    expect(container.querySelector('.ProseMirror tr')?.children).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: english.deleteRow }));
    expect(container.querySelectorAll('.ProseMirror tr')).toHaveLength(3);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).not.toContain('<br');
  });

  it('shows safe preview links, image placeholders and literal code without executing HTML', async () => {
    const i18n = await translations();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MarkdownPreview
          value={
            '<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) [safe](https://example.com)\n\n![secret](https://remote.example/private.png)\n\n```mermaid\n<script>literal</script>\n```'
          }
        />
      </I18nextProvider>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.querySelector('code')?.textContent).toContain('<script>literal</script>');
    expect(screen.getByRole('img', { name: 'secret' })).toBeTruthy();
  });

  it('creates a validated link, retains its destination, and supports removal', async () => {
    const i18n = await translations();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MarkdownEditor value="" onChange={vi.fn()} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.queryByText(english.loading)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: english.link }));
    fireEvent.change(screen.getByLabelText(english.linkUrl), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: english.applyLink }));
    expect(screen.getByRole('alert').textContent).toBe(english.invalidUrl);
    expect(container.querySelector('.ProseMirror a')).toBeNull();
    fireEvent.change(screen.getByLabelText(english.linkUrl), {
      target: { value: 'https://example.com/path?one=two' },
    });
    fireEvent.change(screen.getByLabelText(english.linkText), { target: { value: 'Example' } });
    fireEvent.click(screen.getByRole('button', { name: english.applyLink }));
    expect(container.querySelector('.ProseMirror a')?.getAttribute('href')).toBe(
      'https://example.com/path?one=two',
    );
    fireEvent.click(screen.getByRole('button', { name: english.link }));
    fireEvent.click(screen.getByRole('button', { name: english.removeLink }));
    expect(container.querySelector('.ProseMirror a')).toBeNull();
    expect(container.querySelector('.ProseMirror')?.textContent).toContain('Example');
  });

  it('uses real task/list conversion, source serialization and code language editing', async () => {
    const i18n = await translations();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MarkdownEditor value="Task" onChange={vi.fn()} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.queryByText(english.loading)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: english.taskList }));
    expect(container.querySelector('li[data-item-type=task]')?.textContent).toBe('Task');
    fireEvent.click(screen.getByRole('checkbox', { name: english.toggleTask }));
    fireEvent.click(screen.getByRole('button', { name: english.showSource }));
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: english.sourceBody }) as HTMLTextAreaElement).value,
      ).toContain('[x] Task'),
    );
    fireEvent.change(screen.getByRole('textbox', { name: english.sourceBody }), {
      target: { value: 'const text = "中文";' },
    });
    fireEvent.click(screen.getByRole('button', { name: english.showVisual }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: english.sourceBody })).toBeNull());
    fireEvent.change(screen.getByRole('combobox', { name: english.codeLanguage }), {
      target: { value: 'typescript' },
    });
    fireEvent.click(screen.getByRole('button', { name: english.codeBlock }));
    expect(container.querySelector('pre')?.dataset.language).toBe('typescript');
    expect(container.querySelector('pre code')?.textContent).toBe('const text = "中文";');
  });

  it('preserves source edits through composition and makes read-only task toggles inert', async () => {
    const i18n = await translations();
    const onChange = vi.fn();
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <MarkdownEditor value="<details>text</details>" onChange={onChange} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.queryByText(english.loading)).toBeNull());
    const source = screen.getByRole('textbox', { name: english.sourceBody });
    fireEvent.compositionStart(source);
    fireEvent.change(source, { target: { value: '组合' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(source);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('组合'));
    rerender(
      <I18nextProvider i18n={i18n}>
        <MarkdownEditor value="- [ ] Task" onChange={onChange} readOnly />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: english.showVisual }));
    await waitFor(() =>
      expect((screen.getByRole('checkbox', { name: english.toggleTask }) as HTMLInputElement).disabled).toBe(
        true,
      ),
    );
    const before = onChange.mock.calls.length;
    fireEvent.click(screen.getByRole('checkbox', { name: english.toggleTask }));
    expect(onChange).toHaveBeenCalledTimes(before);
  });
});
