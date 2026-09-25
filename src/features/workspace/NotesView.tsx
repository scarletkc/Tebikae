import { NotebookPen, Plus } from 'lucide-react';
import type { LocalNote } from '../../domain/types';
import NoteCard from '../notes/NoteCard';
import NotesGrid from '../notes/NotesGrid';
import { FilterChips } from '../filters/Filters';
import { useWorkspace } from './useWorkspaceController';
import { Button } from '../../ui';

function Cards({ items }: { items: LocalNote[] }) {
  const ctl = useWorkspace();
  const { multi, session, labels, filters } = ctl;
  return (
    <NotesGrid list={ctl.layout.effectiveLayout === 'list'}>
      {items.map((note) => (
        <NoteCard
          key={note.localId}
          note={note}
          labels={labels}
          query={filters.query}
          writable={session.writable}
          canPurge={ctl.canPurge}
          onPurge={() => void ctl.purge(note)}
          onOpen={() => ctl.openNote(note)}
          onChange={(action) => void ctl.change(note, action)}
          menuItems={ctl.menuFor(note)}
          selected={multi.isSelected(note.localId)}
          onSelect={(event) => {
            if (event.shiftKey) {
              multi.selectRange(note.localId);
              return true;
            }
            if (event.ctrlKey || event.metaKey || multi.selectedCount) {
              multi.toggle(note.localId);
              return true;
            }
            return false;
          }}
          onRemoveLabel={(id) =>
            void ctl.mutateNotes([note], (d) => {
              d.labelIds = d.labelIds.filter((value) => value !== id);
            })
          }
        />
      ))}
    </NotesGrid>
  );
}

/** Pinned and other notes for the current view, or the empty state. */
export default function NotesView() {
  const { t, view, activeFilters, setFilters, labels, notes, result, feed, limit, session, newNote } =
    useWorkspace();
  const empty = !result.notes.length;
  const resultNotes = result.notes.slice(0, limit);
  const pinned = view === 'notes' ? resultNotes.filter((n) => n.current.meta.pinned) : [];
  const others = view === 'notes' ? resultNotes.filter((n) => !n.current.meta.pinned) : resultNotes;
  return (
    <>
      <FilterChips filters={activeFilters} setFilters={setFilters} labels={labels} />
      {empty && !feed.loading && !feed.hasMore ? (
        <div className="empty-state">
          <div className="empty-illustration">
            <NotebookPen size={38} strokeWidth={1.3} />
          </div>
          <h2>{t(notes.length ? 'home.noResults' : 'home.empty')}</h2>
          <p>{t(notes.length ? 'home.noResultsDescription' : 'home.emptyDescription')}</p>
          {!notes.length && view === 'notes' && (
            <Button className="mt-6" disabled={!session.writable} onClick={() => newNote()}>
              <Plus size={17} />
              {t('action.new')}
            </Button>
          )}
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="note-group">
              <h2>{t('home.pinned')}</h2>
              <Cards items={pinned} />
            </section>
          )}
          {others.length > 0 && (
            <section className="note-group">
              {pinned.length > 0 && <h2>{t('home.other')}</h2>}
              <Cards items={others} />
            </section>
          )}
        </>
      )}
    </>
  );
}
