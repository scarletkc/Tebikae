import { CheckSquare, Grid2X2, List, Menu, Pencil, Plus, SlidersHorizontal, X } from 'lucide-react';
import { defaultFilters } from '../../domain/filters';
import { usePreferences } from '../../app/preferences';
import { SortControl } from '../../app/ui';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';
import WorkspaceStatus from '../../app/WorkspaceStatus';
import { useIsMobile } from '../../app/useMediaQuery';
import { TextContextMenu } from '../editor/TextContextMenu';
import { filterCount } from '../filters/Filters';
import { hasSearch, isNoteListRoute } from './routes';
import { useWorkspace } from './useWorkspaceController';
import { Button, IconButton, Input, SegmentedControl, cn } from '../../ui';

export function WorkspaceStatusControl() {
  const { notices, route, visibleIssues, result } = useWorkspace();
  return (
    <WorkspaceStatus
      notices={notices}
      count={
        route === 'settings' ? undefined : route === 'issues' ? visibleIssues.length : result.notes.length
      }
    />
  );
}

/** Grid/list switch: a single toggling icon in the compact topbar, two buttons otherwise. */
export function ViewToggle({ mode }: { mode: 'icon' | 'segmented' }) {
  const { t, layout } = useWorkspace();
  const prefs = usePreferences();
  const items: MenuAction[] = [
    {
      label: t('action.grid'),
      icon: Grid2X2,
      checked: layout.effectiveLayout === 'grid',
      keepOpen: false,
      run: () => prefs.setLayout('grid'),
    },
    {
      label: t('action.list'),
      icon: List,
      checked: layout.effectiveLayout === 'list',
      keepOpen: false,
      run: () => prefs.setLayout('list'),
    },
  ];
  if (mode === 'icon')
    return (
      <ContextMenu contextName="view" items={items}>
        <IconButton
          size="sm"
          className={`view-toggle-button ${prefs.layout === 'grid' ? 'is-grid' : 'is-list'}`}
          label={t(`action.${prefs.layout}`)}
          onClick={() => prefs.setLayout(prefs.layout === 'grid' ? 'list' : 'grid')}
        >
          {prefs.layout === 'grid' ? <Grid2X2 size={17} /> : <List size={18} />}
        </IconButton>
      </ContextMenu>
    );
  return (
    <ContextMenu contextName="view" className="view-toggle" items={items}>
      <SegmentedControl
        value={prefs.layout}
        onChange={(layout) => prefs.setLayout(layout)}
        options={[
          { value: 'grid', label: t('action.grid'), icon: <Grid2X2 size={17} /> },
          { value: 'list', label: t('action.list'), icon: <List size={18} /> },
        ]}
      />
    </ContextMenu>
  );
}

/** Primary "new note" action: a labelled topbar button or a floating action button. */
export function NewNoteMenu({ variant }: { variant: 'button' | 'fab' }) {
  const { t, session, newNote } = useWorkspace();
  const items: MenuAction[] = [
    { label: t('action.new'), icon: Plus, disabled: !session.writable, run: () => newNote() },
    {
      label: t('action.newChecklist'),
      icon: CheckSquare,
      separator: true,
      disabled: !session.writable,
      run: () => newNote('checklist'),
    },
  ];
  if (variant === 'fab')
    return (
      <ContextMenu contextName="new-note-fab" items={items}>
        <Button
          variant="primary"
          className="new-note-button fab-new-note fixed right-7 bottom-7 z-30 size-14 rounded-full p-0 shadow-popover max-md:right-4 max-md:bottom-[calc(56px+16px+env(safe-area-inset-bottom))] [&_svg]:size-5.5"
          aria-label={t('action.new')}
          title={t('action.new')}
          disabled={!session.writable}
          onClick={() => newNote()}
        >
          <Pencil />
        </Button>
      </ContextMenu>
    );
  return (
    <ContextMenu contextName="new-note" items={items}>
      <Button
        variant="primary"
        className="new-note-button"
        disabled={!session.writable}
        onClick={() => newNote()}
      >
        <Plus size={18} />
        {t('action.new')}
      </Button>
    </ContextMenu>
  );
}

/** True where the list can create notes (not in the trash or archive views). */
export function canCreateHere(route: string, view: string) {
  return isNoteListRoute(route) && route !== 'trash' && view !== 'archive';
}

function FilterButton() {
  const { t, filters, setFiltersOpen } = useWorkspace();
  const active = filterCount(filters) > 0;
  return (
    <IconButton
      size="sm"
      variant={active ? 'accent' : 'ghost'}
      label={t('action.filter')}
      className={cn('filter-open-button', active && 'is-active')}
      onClick={() => setFiltersOpen(true)}
    >
      <SlidersHorizontal size={16} />
    </IconButton>
  );
}

/** Opens the mobile drawer, or collapses and expands the desktop sidebar. */
function NavToggle() {
  const { t, layout, setDrawer } = useWorkspace();
  const isMobile = useIsMobile();
  return (
    <IconButton
      size="sm"
      className={isMobile ? 'mobile-menu nav-toggle-btn' : 'sidebar-toggle nav-toggle-btn'}
      label={isMobile ? t('nav.menu') : layout.sidebarCollapsed ? t('nav.menu') : t('nav.close')}
      onClick={() => {
        if (isMobile) setDrawer(true);
        else layout.setSidebarCollapsed((value) => !value);
      }}
    >
      <Menu size={18} />
    </IconButton>
  );
}

const topbarClass =
  'app-topbar sticky top-0 z-20 flex min-h-14 flex-nowrap items-center gap-2 border-b border-line bg-canvas px-4 pt-[env(safe-area-inset-top)] select-none';

export default function Topbar() {
  const ctl = useWorkspace();
  const { t, route, view, filters, setFilters, searchInput, setSearchInput, layout } = ctl;
  const noteList = isNoteListRoute(route);
  // Settings has nothing to search: the bar shows the page title instead of the note search.
  if (!hasSearch(route))
    return (
      <header ref={layout.topbarRef} className={topbarClass}>
        <NavToggle />
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{t(`nav.${route}`)}</h1>
        <WorkspaceStatusControl />
      </header>
    );
  return (
    <header ref={layout.topbarRef} className={topbarClass}>
      <div className="search-box flex h-10 min-w-0 flex-1 items-center gap-1 rounded-lg border border-transparent bg-hover px-1 focus-within:border-line-strong focus-within:bg-surface">
        <NavToggle />
        <TextContextMenu
          className="flex min-w-0 flex-1 self-stretch"
          clearLabel={t('context.clearSearch')}
          clearDisabled={!searchInput}
          onClear={() => setFilters({ ...filters, query: '' })}
        >
          <Input
            variant="bare"
            ref={ctl.searchRef}
            className="flex-1"
            aria-label={t('home.search')}
            placeholder={`${t('home.search')} (Ctrl+K)`}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={(e) => {
              const query = e.currentTarget.value.trim();
              setSearchInput(query);
              if (query !== filters.query) setFilters({ ...filters, query });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
            }}
          />
        </TextContextMenu>
        {(searchInput || filters.query || filterCount(filters) > 0) && (
          <IconButton
            size="sm"
            label={t('action.clearSearchFilters')}
            className="search-clear-button"
            onClick={() => {
              setSearchInput('');
              setFilters({ ...defaultFilters, view, sort: filters.sort });
            }}
          >
            <X size={15} />
          </IconButton>
        )}
        {layout.isCompactTopbar ? (
          noteList ? (
            <div className="topbar-note-actions search-actions ml-auto flex min-w-0 shrink-0 flex-nowrap items-center gap-1">
              <WorkspaceStatusControl />
              <SortControl
                value={filters.sort}
                onChange={(sort) => setFilters({ ...filters, sort })}
                mode="icon"
              />
              {!layout.singleColumnOnly && <ViewToggle mode="icon" />}
              <FilterButton />
            </div>
          ) : (
            <WorkspaceStatusControl />
          )
        ) : (
          noteList && <FilterButton />
        )}
      </div>
      {!layout.isCompactTopbar && noteList && (
        <div className="topbar-note-actions flex min-w-0 max-w-full shrink-0 flex-nowrap items-center gap-3 max-md:gap-2">
          <SortControl
            value={filters.sort}
            onChange={(sort) => setFilters({ ...filters, sort })}
            mode="text"
          />
          {!layout.singleColumnOnly && <ViewToggle mode="segmented" />}
          <WorkspaceStatusControl />
          {route !== 'trash' && view !== 'archive' && <NewNoteMenu variant="button" />}
        </div>
      )}
      {!layout.isCompactTopbar && !noteList && <WorkspaceStatusControl />}
    </header>
  );
}
