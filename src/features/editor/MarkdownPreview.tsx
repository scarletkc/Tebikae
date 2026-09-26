import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { safeHref } from '../../security/urls';
import { Checkbox, cn } from '../../ui';
import './editor.css';

export interface MarkdownPreviewProps {
  value: string;
  className?: string;
  compact?: boolean;
}

export function MarkdownPreview({ value, className = '', compact = false }: MarkdownPreviewProps) {
  const { t } = useTranslation();
  return (
    <div className={`markdown-preview ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => safeHref(url) ?? ''}
        components={{
          a: ({ href, children }) =>
            href && !compact ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="editor-image-placeholder" role="img" aria-label={alt || t('editor.image')}>
              ▧ {alt || t('editor.image')}
            </span>
          ),
          input: ({ checked }) =>
            compact ? (
              <PreviewCheckbox checked={!!checked} className="me-1.5 align-[-3px]" />
            ) : (
              <Checkbox checked={checked} readOnly disabled aria-label={t('editor.toggleTask')} />
            ),
        }}
      >
        {value}
      </Markdown>
    </div>
  );
}

export default MarkdownPreview;

/** Read-only task box for note cards: the same look as the editor's checked and unchecked tasks. */
export function PreviewCheckbox({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'preview-checkbox inline-flex size-4 shrink-0 items-center justify-center rounded border border-line-strong',
        checked && 'is-checked border-accent bg-accent text-accent-fg',
        className,
      )}
      aria-hidden="true"
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </span>
  );
}
