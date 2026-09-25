import { GitBranch } from 'lucide-react';
import { useWorkspace } from './useWorkspaceController';

/** GitHub issues in the repository that are not Tebikae notes (reached from Settings). */
export default function IssuesView() {
  const { t, issues, visibleIssues, limit, layout, setIssue } = useWorkspace();
  return (
    <div className={`notes-grid ${layout.effectiveLayout === 'list' ? 'notes-list' : ''}`}>
      {visibleIssues.slice(0, limit).map((row) => (
        <article key={row.issueId} className="note-card">
          <button className="note-open" onClick={() => setIssue(row)}>
            <span className="issue-number">#{row.snapshot.number}</span>
            <h3>{row.snapshot.title}</h3>
            <p className="card-preview">{row.snapshot.body.slice(0, 220)}</p>
            {row.status !== 'unmanaged' && <p className="danger">{t(`home.${row.status}`)}</p>}
          </button>
        </article>
      ))}
      {!issues.length && (
        <div className="empty-state">
          <GitBranch size={35} />
          <h2>{t('home.noResults')}</h2>
          <p>{t('home.issuesDescription')}</p>
        </div>
      )}
    </div>
  );
}
