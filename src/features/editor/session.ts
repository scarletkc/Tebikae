import { editorViewCtx, parserCtx, serializerCtx, type Editor } from '@milkdown/kit/core';

/** 保留原始 Markdown，只有真实修改才序列化；界面切换不成为文档写入。 */
export class MarkdownSession {
  value: string;
  editor?: Editor;
  onChange: (value: string) => void;
  private dirty = false;
  private sourceDirty = false;
  private suppress = false;
  private composing = false;
  private visualStale = false;
  private externalValue: string;
  private timer?: ReturnType<typeof setTimeout>;
  private compositionTimer?: ReturnType<typeof setTimeout>;
  private waiters: Array<() => void> = [];

  constructor(value: string, onChange: (value: string) => void) {
    this.value = value;
    this.externalValue = value;
    this.onChange = onChange;
  }

  changed = () => {
    // Milkdown 在 create() 完成、attach() 之前就已可编辑；这段时间的输入同样要记下。
    if (this.suppress) return;
    this.dirty = true;
    clearTimeout(this.timer);
    if (!this.composing) this.timer = setTimeout(() => this.serialize(), 100);
  };

  /** 编辑器实例可用后调用；立即发布它启动期间收到的输入。 */
  attach(editor: Editor | undefined) {
    const first = !this.editor && editor;
    this.editor = editor;
    if (first) this.serialize();
  }

  compositionStart = () => {
    this.composing = true;
    clearTimeout(this.timer);
    clearTimeout(this.compositionTimer);
  };

  compositionEnd = () => {
    // ProseMirror 在 compositionend 后另有 20 ms 收尾，关闭前也必须等它完成。
    this.composing = true;
    clearTimeout(this.compositionTimer);
    this.compositionTimer = setTimeout(() => {
      this.composing = false;
      this.serialize();
      for (const resolve of this.waiters.splice(0)) resolve();
    }, 25);
  };

  private serialize() {
    clearTimeout(this.timer);
    if (this.composing) return;
    if (this.sourceDirty) {
      this.sourceDirty = false;
      this.onChange(this.value);
    }
    if (!this.dirty || !this.editor) return;
    this.dirty = false;
    const next = this.editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
    if (next !== this.value) {
      this.value = next;
      this.onChange(next);
    }
  }

  flush = async (): Promise<void> => {
    if (this.composing) return new Promise((resolve) => this.waiters.push(resolve));
    this.serialize();
  };

  setSource(value: string) {
    if (value === this.value) return;
    this.value = value;
    this.visualStale = true;
    if (this.composing) this.sourceDirty = true;
    else this.onChange(value);
  }

  /** 调用者已明确接受的外部版本；回传同一份本地正文不替换文档。 */
  acceptValue(value: string): boolean {
    if (value === this.externalValue) return false;
    this.externalValue = value;
    if (value === this.value || this.composing || this.dirty || this.sourceDirty) return false;
    this.value = value;
    this.visualStale = true;
    return true;
  }

  loadVisual() {
    if (!this.editor || !this.visualStale || this.composing) return;
    this.suppress = true;
    try {
      this.editor.action((ctx) => {
        const document = ctx.get(parserCtx)(this.value);
        const view = ctx.get(editorViewCtx);
        if (document && !document.eq(view.state.doc)) {
          view.dispatch(
            view.state.tr
              .replaceWith(0, view.state.doc.content.size, document.content)
              .setMeta('tebikae-source', true),
          );
        }
      });
      this.visualStale = false;
    } finally {
      this.suppress = false;
    }
  }

  dispose() {
    this.serialize();
    clearTimeout(this.timer);
    clearTimeout(this.compositionTimer);
    for (const resolve of this.waiters.splice(0)) resolve();
    this.editor = undefined;
  }
}
