import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { safeHref } from '../../security/urls';
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
              <span className={`preview-checkbox ${checked ? 'is-checked' : ''}`} aria-hidden="true">
                {checked ? '✓' : ''}
              </span>
            ) : (
              <input type="checkbox" checked={checked} disabled aria-label={t('editor.toggleTask')} />
            ),
        }}
      >
        {value}
      </Markdown>
    </div>
  );
}

export default MarkdownPreview;
