import { ArrowUpRight, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { download } from '../../app/ui';
import { Banner, Button, Dialog } from '../../ui';
import { useSession } from '../../app/session';
import MarkdownPreview from '../editor/MarkdownPreview';
import { convertIssue } from '../../application/commands';
import { safeHref } from '../../security/urls';
import type { LocalNote, UnmanagedIssue } from '../../domain/types';

/** Read-only view of an unmanaged GitHub issue, with conversion into a Tebikae note. */
export default function IssueDialog({
  issue,
  onClose,
  onConverted,
  report,
}: {
  issue: UnmanagedIssue;
  onClose(): void;
  onConverted(note: LocalNote): void;
  report(error: unknown): void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const connection = session.connection!;
  return (
    <Dialog title={t('home.readIssue')} onClose={onClose} size="lg" className="issue-dialog">
      <div className="issue-content">
        <h2 className="mb-5 text-[25px]">{issue.snapshot.title}</h2>
        {issue.status !== 'unmanaged' && (
          <Banner tone="warning" className="banner warning mb-4">
            {t(`home.${issue.status}`)}
          </Banner>
        )}
        <MarkdownPreview value={issue.snapshot.body} />
        <div className="button-row mt-6 flex flex-wrap items-center gap-2.5">
          {issue.status === 'unmanaged' && (
            <Button
              variant="primary"
              disabled={!session.client || !session.writable}
              onClick={() =>
                void convertIssue(connection, issue.issueId, session.client!)
                  .then((note) => {
                    onConverted(note);
                    void session.engine?.flush(true);
                  })
                  .catch(report)
              }
            >
              {t('action.convert')}
            </Button>
          )}
          <Button
            onClick={() => download(`${issue.snapshot.title}.md`, issue.snapshot.body, 'text/markdown')}
          >
            <FileText size={15} />
            {t('action.exportNote')}
          </Button>
          {safeHref(issue.snapshot.url) && (
            <Button asChild>
              <a href={safeHref(issue.snapshot.url)} target="_blank" rel="noopener noreferrer">
                {t('action.openGithub')}
                <ArrowUpRight size={15} />
              </a>
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
