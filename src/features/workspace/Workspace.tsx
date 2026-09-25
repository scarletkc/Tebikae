import { Plus, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { IconButton } from '../../app/ui';
import { Banner, Button, Dialog, Sheet, cn } from '../../ui';
import { ContextMenu } from '../../app/ContextMenu';
import { useIsMobile } from '../../app/useMediaQuery';
import { preventUndefinedContextMenu } from '../../app/useContextMenuGuard';
import { ConnectForm } from '../connect/Connect';
import { FiltersDialog } from '../filters/Filters';
import NoteDialog from '../notes/NoteDialog';
import Settings from '../settings/Settings';
import CreateLabelDialog from '../labels/CreateLabelDialog';
import IssueDialog from '../issues/IssueDialog';
import Sidebar from './Sidebar';
import Topbar, { NewNoteMenu, canCreateHere } from './Topbar';
import SelectionToolbar from './SelectionToolbar';
import NotesView from './NotesView';
import IssuesView from './IssuesView';
import { isNoteListRoute } from './routes';
import { WorkspaceContext, useWorkspace, useWorkspaceController } from './useWorkspaceController';

const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 56;

export default function Workspace({ offlineReady }: { offlineReady: boolean }) {
  const ctl = useWorkspaceController();
  return (
    <WorkspaceContext.Provider value={ctl}>
      <WorkspaceLayout offlineReady={offlineReady} />
    </WorkspaceContext.Provider>
  );
}

function WorkspaceLayout({ offlineReady }: { offlineReady: boolean }) {
  const ctl = useWorkspace();
  const { t, route, view, layout, multi, selection } = ctl;
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const noteList = isNoteListRoute(route);
  return (
    <div className="workspace" onContextMenu={preventUndefinedContextMenu}>
      <motion.aside
        className={cn(
          'sidebar fixed inset-y-0 start-0 z-10 flex h-dvh flex-col overflow-hidden border-e border-line bg-sidebar px-3 pb-4 select-none max-md:hidden',
          layout.sidebarCollapsed && 'sidebar-collapsed px-2.5',
        )}
        animate={{ width: layout.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
        initial={false}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 44 }}
      >
        <Sidebar collapsed={layout.sidebarCollapsed} />
      </motion.aside>
      <Sheet open={ctl.drawer} onOpenChange={ctl.setDrawer} title={t('nav.menu')} className="mobile-drawer">
        <IconButton
          label={t('nav.close')}
          className="drawer-close absolute end-2 top-2"
          onClick={() => ctl.setDrawer(false)}
        >
          <X size={20} />
        </IconButton>
        <Sidebar />
      </Sheet>
      <div
        className="workspace-body"
        style={{
          marginLeft: isMobile ? 0 : layout.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
        }}
      >
        <Topbar />
        <ContextMenu
          contextName="main"
          items={
            noteList
              ? [
                  {
                    label: t('action.new'),
                    icon: Plus,
                    disabled: !ctl.session.writable,
                    run: () => ctl.newNote(),
                  },
                ]
              : []
          }
          acceptTarget={(target) =>
            target instanceof Element &&
            !target.closest(
              '.context-card, button, a, input, textarea, [contenteditable], [role="menu"], .selection-toolbar',
            )
          }
        >
          <main
            ref={layout.notesAreaRef}
            className="main-content"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (
                (event.target as Element).closest('input, textarea, [contenteditable="true"], [role="menu"]')
              )
                return;
              if (event.key === 'Escape') multi.clear();
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && noteList) {
                event.preventDefault();
                multi.selectAll();
              }
            }}
          >
            <SelectionToolbar />
            {route === 'settings' ? (
              <Settings onConnect={() => ctl.setConnectOpen(true)} offlineReady={offlineReady} />
            ) : (
              <>
                <h1 className="sr-only">{t(`nav.${route}`)}</h1>
                {route === 'issues' ? <IssuesView /> : <NotesView />}
                {ctl.feed.loading && ctl.availableCount <= ctl.limit && (
                  <div
                    className="feed-skeletons grid grid-cols-3 gap-4 py-6"
                    role="status"
                    aria-label={t('home.loading')}
                  >
                    {[0, 1, 2].map((key) => (
                      <div className="feed-skeleton h-[90px] rounded-xl bg-hover opacity-50" key={key} />
                    ))}
                  </div>
                )}
                {ctl.feed.error && (
                  <Banner tone="danger" role="alert" className="mt-6">
                    {t(
                      ctl.feed.error.detail === 'SEARCH_RANGE_TOO_DENSE'
                        ? 'home.searchTooDense'
                        : `error.${ctl.feed.error.code}`,
                    )}
                  </Banner>
                )}
                {(ctl.availableCount > ctl.limit || ctl.feed.hasMore) && (
                  <Button
                    className="load-more mx-auto mt-8 flex"
                    disabled={ctl.feed.loading && ctl.availableCount <= ctl.limit}
                    onClick={() => {
                      if (ctl.availableCount > ctl.limit) ctl.setLimit((n) => n + 25);
                      else void ctl.feed.load?.();
                    }}
                  >
                    {t('action.more')}
                  </Button>
                )}
              </>
            )}
          </main>
        </ContextMenu>
        {layout.isCompactTopbar && canCreateHere(route, view) && <NewNoteMenu variant="fab" />}
      </div>
      {ctl.filtersOpen && (
        <FiltersDialog
          filters={ctl.activeFilters}
          setFilters={ctl.setFilters}
          labels={ctl.labels}
          onClose={() => ctl.setFiltersOpen(false)}
        />
      )}
      {ctl.connectOpen && (
        <Dialog
          title={t('action.connect')}
          onClose={() => ctl.setConnectOpen(false)}
          className="connect-dialog"
        >
          <ConnectForm onConnected={() => ctl.setConnectOpen(false)} />
        </Dialog>
      )}
      {ctl.labelOpen && (
        <CreateLabelDialog
          busy={ctl.busy}
          setBusy={ctl.setBusy}
          onClose={() => ctl.setLabelOpen(false)}
          report={ctl.report}
        />
      )}
      <AnimatePresence>
        {selection && (
          <motion.div
            key="editor-layer"
            className={cn(
              'editor-layer fixed inset-0 z-40 flex items-center justify-center',
              selection.id &&
                'editor-layer-dim bg-overlay backdrop-blur-[5px] [-webkit-backdrop-filter:blur(5px)]',
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.98 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
          >
            <NoteDialog
              key={selection.id || 'new'}
              initialNote={selection.initial}
              kind={selection.kind}
              labels={ctl.labels}
              initialLabelIds={selection.labelIds}
              onClose={() => ctl.setSelection(null)}
              onNavigate={ctl.navigateNote}
              canPrevious={!!selection.id && selection.ids.indexOf(selection.id) > 0}
              canNext={!!selection.id && selection.ids.indexOf(selection.id) < selection.ids.length - 1}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {ctl.issue && (
        <IssueDialog
          issue={ctl.issue}
          onClose={() => ctl.setIssue(null)}
          onConverted={(note) => {
            ctl.setIssue(null);
            ctl.setSelection({ id: note.localId, initial: note, ids: [] });
          }}
          report={ctl.report}
        />
      )}
    </div>
  );
}
