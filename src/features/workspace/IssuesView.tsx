import { GitBranch } from 'lucide-react';
import { EmptyState, StretchedButton, cn } from '../../ui';
import { notesGridClasses } from '../notes/NotesGrid';
import { useWorkspace } from './useWorkspaceController';

/** GitHub issues in the repository that are not Tebikae notes (reached from Settings). */
export default function IssuesView() {
  const { t, issues, visibleIssues, limit, layout, setIssue } = useWorkspace();
  const list = layout.effectiveLayout === 'list';
  return (
    <div className={notesGridClasses(list)}>
      {visibleIssues.slice(0, limit).map((row) => (
        <article
          key={row.issueId}
          className="note-card relative min-w-0 rounded-xl border border-line bg-card-default p-4 transition-shadow hover:shadow-card-hover focus-within:shadow-card-hover"
        >
          <span className="issue-number mb-2 block text-xs text-muted">#{row.snapshot.number}</span>
          <h3 className="mb-1 text-base font-semibold wrap-anywhere">
            <StretchedButton className="note-open" onClick={() => setIssue(row)}>
              {row.snapshot.title}
            </StretchedButton>
          </h3>
          <p
            className={cn(
              'card-preview mt-1 text-sm wrap-anywhere whitespace-pre-wrap',
              list ? 'line-clamp-3' : 'line-clamp-9',
            )}
          >
            {row.snapshot.body.slice(0, 220)}
          </p>
          {row.status !== 'unmanaged' && (
            <p className="mt-1 text-xs text-danger">{t(`home.${row.status}`)}</p>
          )}
        </article>
      ))}
      {!issues.length && (
        <EmptyState icon={GitBranch} title={t('home.noIssues')} description={t('home.issuesDescription')} />
      )}
    </div>
  );
}
