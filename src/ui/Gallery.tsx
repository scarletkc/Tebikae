/**
 * Development-only preview of the UI kit (open /#/__ui with `pnpm dev`). Not included in
 * production builds. English only on purpose: it is a tool for contributors, not a user screen.
 */
import {
  Archive,
  Bold,
  Check,
  Grid2X2,
  Info,
  Italic,
  List,
  Monitor,
  Moon,
  NotebookPen,
  Pin,
  Plus,
  Redo2,
  Sun,
  Tag,
  Tags,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { usePreferences } from '../app/preferences';
import { confirmDialog } from '../app/confirm';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  CheckboxLabel,
  Chip,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  NavItem,
  SegmentedControl,
  Select,
  SettingRow,
  Spinner,
  StretchedButton,
  Textarea,
  Toolbar,
  ToolbarDivider,
  cn,
} from '.';

const COLORS = [
  'canvas',
  'sidebar',
  'surface',
  'hover',
  'active',
  'line',
  'line-strong',
  'fg',
  'muted',
  'accent',
  'accent-soft',
  'danger',
  'danger-soft',
  'warning',
  'warning-soft',
  'mark',
] as const;
const SWATCH: Record<(typeof COLORS)[number], string> = {
  canvas: 'bg-canvas',
  sidebar: 'bg-sidebar',
  surface: 'bg-surface',
  hover: 'bg-hover',
  active: 'bg-active',
  line: 'bg-line',
  'line-strong': 'bg-line-strong',
  fg: 'bg-fg',
  muted: 'bg-muted',
  accent: 'bg-accent',
  'accent-soft': 'bg-accent-soft',
  danger: 'bg-danger',
  'danger-soft': 'bg-danger-soft',
  warning: 'bg-warning',
  'warning-soft': 'bg-warning-soft',
  mark: 'bg-mark',
};
const CARDS = {
  default: 'bg-card-default',
  yellow: 'bg-card-yellow',
  green: 'bg-card-green',
  blue: 'bg-card-blue',
  purple: 'bg-card-purple',
  red: 'bg-card-red',
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export default function Gallery() {
  const prefs = usePreferences();
  const [dialog, setDialog] = useState(false);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState('updated');
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [checked, setChecked] = useState(true);
  return (
    <div className="h-dvh overflow-y-auto bg-canvas text-fg">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-canvas px-6">
        <h1 className="text-base font-semibold">Tebikae UI kit</h1>
        <IconButton
          label="Toggle theme"
          onClick={() => prefs.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')}
        >
          {prefs.theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
        </IconButton>
      </header>
      <main className="mx-auto max-w-4xl space-y-10 px-6 py-8">
        <Section title="Color tokens">
          {COLORS.map((name) => (
            <div key={name} className="w-24 text-xs">
              <div className={cn('h-10 rounded-lg border border-line', SWATCH[name])} />
              <p className="mt-1 text-muted">{name}</p>
            </div>
          ))}
          {Object.entries(CARDS).map(([name, cls]) => (
            <div key={name} className="w-24 text-xs">
              <div className={cn('h-10 rounded-lg border border-line', cls)} />
              <p className="mt-1 text-muted">card-{name}</p>
            </div>
          ))}
        </Section>

        <Section title="Typography">
          <div className="space-y-1">
            <p className="text-3xl font-semibold">Note title 3xl</p>
            <p className="text-lg font-semibold">Page title lg</p>
            <p className="text-base font-semibold">Card / dialog title base</p>
            <p className="text-sm">Interface text sm — the default size</p>
            <p className="text-xs text-muted">Meta text xs — dates, counts, help</p>
          </div>
        </Section>

        <Section title="Buttons">
          <Button variant="primary">
            <Plus /> Primary
          </Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="danger-outline">
            <Trash2 /> Danger outline
          </Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
          <Button disabled>Disabled</Button>
          <Button>
            <Spinner /> Working
          </Button>
        </Section>

        <Section title="Icon buttons">
          <IconButton label="Pin">
            <Pin size={16} />
          </IconButton>
          <IconButton label="Archive" pressed>
            <Archive size={16} />
          </IconButton>
          <IconButton label="Small" size="sm">
            <Pin size={16} />
          </IconButton>
          <IconButton label="Extra small" size="xs">
            <Pin size={14} />
          </IconButton>
          <IconButton label="Secondary" variant="secondary">
            <Plus size={16} />
          </IconButton>
          <IconButton label="Disabled" disabled>
            <Trash2 size={16} />
          </IconButton>
          <SegmentedControl<'grid' | 'list'>
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'grid', label: 'Grid', icon: <Grid2X2 size={16} /> },
              { value: 'list', label: 'List', icon: <List size={16} /> },
            ]}
          />
          <Toolbar aria-label="Formatting">
            <IconButton label="Bold" size="sm">
              <Bold size={16} />
            </IconButton>
            <IconButton label="Italic" size="sm">
              <Italic size={16} />
            </IconButton>
            <ToolbarDivider />
            <IconButton label="Undo" size="sm">
              <Undo2 size={16} />
            </IconButton>
            <IconButton label="Redo" size="sm">
              <Redo2 size={16} />
            </IconButton>
          </Toolbar>
        </Section>

        <Section title="Navigation rows and cards">
          <nav
            aria-label="Sidebar sample"
            className="w-60 space-y-0.5 rounded-xl border border-line bg-sidebar p-2"
          >
            <NavItem aria-current="page">
              <NotebookPen size={19} /> Notes
              <span className="ms-auto text-xs text-muted tabular-nums">12</span>
            </NavItem>
            <NavItem>
              <Archive size={19} /> Archive
            </NavItem>
            <NavItem size="sm" aria-pressed>
              <Tags size={16} /> All labels
            </NavItem>
            <NavItem size="sm" aria-pressed={false}>
              <Tag size={15} /> Unlabeled
            </NavItem>
            <NavItem variant="tile" className="mt-3">
              <span className="size-2 shrink-0 rounded-full bg-accent ring-3 ring-accent-soft" />
              <span className="flex min-w-0 flex-col">
                <strong className="truncate text-xs font-medium">notes</strong>
                <small className="mt-0.5 text-xs text-muted">owner</small>
              </span>
            </NavItem>
          </nav>
          <article className="relative w-60 self-start rounded-xl border border-line bg-card-yellow p-4 transition-shadow hover:shadow-card-hover">
            <h3 className="mb-2 text-base font-semibold">
              <StretchedButton>Whole card opens</StretchedButton>
            </h3>
            <p className="text-sm text-muted">The title covers the card; controls with z-2 stay on top.</p>
            <IconButton size="xs" label="Pin" className="relative z-2 mt-2">
              <Pin size={14} />
            </IconButton>
          </article>
        </Section>

        <Section title="Form controls">
          <div className="grid w-full max-w-md gap-4">
            <Field label="Repository" help="owner/repository or a GitHub URL">
              {(id, describedBy) => <Input id={id} aria-describedby={describedBy} placeholder="owner/repo" />}
            </Field>
            <Field label="Token" error="The token cannot access this repository.">
              {(id, describedBy) => <Input id={id} aria-describedby={describedBy} type="password" />}
            </Field>
            <Field label="Labels">
              {(id) => (
                <Select<'all' | 'any'>
                  id={id}
                  label="Labels"
                  className="w-full"
                  value={match}
                  onChange={setMatch}
                  options={[
                    { value: 'all', label: 'All selected labels' },
                    { value: 'any', label: 'Any selected label' },
                  ]}
                />
              )}
            </Field>
            <Field label="Comment">{(id) => <Textarea id={id} placeholder="Multi-line text" />}</Field>
            <Input variant="bare" className="text-2xl font-semibold" placeholder="Bare input (note title)" />
            <CheckboxLabel>
              <Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)} />
              Remember this connection
            </CheckboxLabel>
          </div>
        </Section>

        <Section title="Banners">
          <div className="grid w-full gap-2">
            <Banner>
              <Info /> <span className="flex-1">A new version is ready.</span>
              <Button size="sm">Update</Button>
            </Banner>
            <Banner tone="warning">
              <TriangleAlert /> This note changed on GitHub.
            </Banner>
            <Banner tone="danger" role="alert">
              <TriangleAlert /> Could not save locally.
            </Banner>
            <Banner tone="success">
              <Check /> Synced to GitHub.
            </Banner>
          </div>
        </Section>

        <Section title="Chips">
          <Chip onRemove={() => {}} removeLabel="Remove filter: Yellow">
            Yellow
          </Chip>
          <Chip>Read only</Chip>
        </Section>

        <Section title="Menus">
          {/* Right-click menus with multi-select (checkbox) items come from src/app/ContextMenu.tsx. */}
          <Menu>
            <MenuTrigger>
              <Button>Open menu</Button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem>
                <Pin /> Pin
              </MenuItem>
              <MenuItem>
                <Archive /> Archive
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>Sort</MenuLabel>
              <MenuRadioGroup value={sort} onValueChange={setSort}>
                {['updated', 'created', 'title'].map((value) => (
                  <MenuRadioItem key={value} value={value}>
                    {value}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuItem danger>
                <Trash2 /> Delete forever
              </MenuItem>
            </MenuContent>
          </Menu>
          <Select
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'updated', label: 'Last updated' },
              { value: 'created', label: 'Date created' },
              { value: 'title', label: 'Title' },
            ]}
          />
          <Select
            label="Sort"
            size="sm"
            icon={<List size={16} />}
            value={sort}
            onChange={setSort}
            options={[
              { value: 'updated', label: 'Last updated' },
              { value: 'created', label: 'Date created' },
              { value: 'title', label: 'Title' },
            ]}
          />
        </Section>

        <Section title="Dialogs">
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Button
            variant="danger-outline"
            onClick={() =>
              void confirmDialog({
                title: 'Delete this note forever?',
                description: 'This cannot be undone.',
                confirmLabel: 'Delete forever',
                danger: true,
              })
            }
          >
            Open confirm
          </Button>
          {dialog && (
            <Dialog
              title="Filter"
              onClose={() => setDialog(false)}
              footer={
                <>
                  <Button onClick={() => setDialog(false)}>Cancel</Button>
                  <Button variant="primary" onClick={() => setDialog(false)}>
                    Apply
                  </Button>
                </>
              }
            >
              <p className="text-sm text-muted">Dialog body scrolls; the footer stays pinned.</p>
            </Dialog>
          )}
        </Section>

        <Section title="Card and setting rows">
          <Card title="Appearance" className="w-full max-w-2xl">
            <SettingRow title="Theme" description="Follows the system unless you choose one.">
              <Select
                label="Theme"
                className="min-w-32"
                value={prefs.theme}
                onChange={prefs.setTheme}
                options={[
                  { value: 'system', label: 'Follow system', icon: Monitor },
                  { value: 'light', label: 'Light', icon: Sun },
                  { value: 'dark', label: 'Dark', icon: Moon },
                ]}
              />
            </SettingRow>
            <SettingRow title="Export" description="Download every note as JSON.">
              <Button>Export JSON</Button>
            </SettingRow>
            <SettingRow title="Clear this device" description="Removes local drafts and cache.">
              <Button variant="danger-outline">
                <Trash2 /> Clear
              </Button>
            </SettingRow>
          </Card>
        </Section>

        <Section title="Empty state">
          <div className="w-full rounded-xl border border-dashed border-line">
            <EmptyState
              icon={NotebookPen}
              title="No notes yet"
              action={
                <Button>
                  <Plus /> New note
                </Button>
              }
            />
          </div>
        </Section>
      </main>
    </div>
  );
}
