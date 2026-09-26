import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const editorTests = ['editor', 'editor-canvas', 'editor-save-races', 'notes', 'reliability', 'context-menu'];
const storageTests = ['session', 'notes', 'reliability', 'sync-retry', 'backup-import', 'workspace-status'];
const layoutTests = ['note-layout', 'topbar-layout', 'sidebar-controls', 'labels', 'context-interactions'];
const sharedUiTests = [
  ...layoutTests,
  'notes',
  'editor-canvas',
  'context-menu',
  'backup-import',
  'markdown-export',
];
const documentation = (path) =>
  path === 'LICENSE' || (path.endsWith('.md') && (!path.includes('/') || path.startsWith('docs/')));

const grep = (tests) =>
  [
    '@smoke',
    ...[...tests]
      .sort()
      .map((name) => `(?:^|[\\\\/\\s])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.spec\\.ts(?:\\s|$)`),
  ].join('|');

export function browserPlan(paths, full = false) {
  if (full)
    return {
      include: ['chromium', 'webkit', 'firefox'].map((browser) => ({ browser, grep: '.', pwa: true })),
      reasons: ['Full verification requested.'],
    };
  const affected = new Set();
  const crossBrowser = new Set();
  const reasons = new Set();
  let chromiumFull = false;
  let crossBrowserPwa = false;
  const add = (tests, cross = false, pwa = false) => {
    tests.forEach((name) => affected.add(name));
    if (cross) tests.forEach((name) => crossBrowser.add(name));
    crossBrowserPwa ||= pwa;
  };
  for (const path of paths) {
    if (documentation(path)) continue;
    if (
      path.startsWith('src/features/editor/') ||
      [
        'src/domain/markdown.ts',
        'src/features/notes/NoteDialog.tsx',
        'src/features/workspace/useGlobalShortcuts.ts',
      ].includes(path)
    ) {
      add(editorTests, true, true);
    } else if (
      ['src/storage/', 'src/security/', 'src/sync/', 'src/adapters/', 'src/features/connect/'].some(
        (prefix) => path.startsWith(prefix),
      ) ||
      [
        'src/app/session.tsx',
        'src/app/pwa.ts',
        'src/app/usePwaLifecycle.ts',
        'src/application/commands.ts',
        'src/application/backup-import.ts',
        'src/domain/codec.ts',
        'src/domain/merge.ts',
        'src/domain/types.ts',
        'src/domain/backup-import.ts',
        'src/features/settings/BackupImportDialog.tsx',
        'src/features/notes/actions.ts',
      ].includes(path)
    ) {
      add(storageTests, true, true);
    } else if (
      ['src/application/markdown-export.ts', 'src/features/settings/MarkdownExportDialog.tsx'].includes(path)
    ) {
      add(['markdown-export', 'notes']);
    } else if (
      path.startsWith('src/ui/') ||
      path === 'src/app/ui.tsx' ||
      path.startsWith('src/styles/') ||
      path.startsWith('src/i18n/')
    ) {
      add(sharedUiTests);
    } else if (path.startsWith('src/features/labels/')) {
      add(['labels', 'sidebar-controls', 'context-menu', 'context-interactions']);
    } else if (path.startsWith('src/features/filters/') || path === 'src/domain/filters.ts') {
      add(['topbar-layout', 'notes', 'pagination-search']);
    } else if (path.startsWith('src/features/workspace/')) {
      add([...layoutTests, 'notes', 'pagination-search', 'workspace-status']);
    } else if (path.startsWith('src/features/notes/')) {
      add(['notes', 'note-layout', 'pagination-search', 'context-menu']);
    } else if (path.startsWith('src/features/settings/')) {
      add(['session', 'backup-import', 'markdown-export']);
    } else if (path.startsWith('src/features/issues/')) {
      add(['notes', 'pagination-search']);
    } else if (path.startsWith('src/app/')) {
      add(sharedUiTests);
    } else if (path.startsWith('tests/e2e/') && path.endsWith('.spec.ts')) {
      add([path.slice('tests/e2e/'.length, -'.spec.ts'.length)]);
    } else if (path.startsWith('tests/pwa/') || path === 'playwright.pwa.config.ts') {
      add(storageTests, true, true);
    } else if (
      path.startsWith('tests/e2e/') ||
      path === 'playwright.config.ts' ||
      [
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'vite.config.ts',
        'index.html',
        'src/main.tsx',
      ].includes(path) ||
      path.startsWith('public/')
    ) {
      chromiumFull = true;
      reasons.add(`Chromium full: shared browser infrastructure or build input (${path}).`);
    } else if (
      path.startsWith('tests/ci/') ||
      path.startsWith('.github/') ||
      path.startsWith('scripts/') ||
      path.startsWith('tests/screenshots/') ||
      path === 'playwright.screenshots.config.ts' ||
      /^tests\/[^/]+\.test\.tsx?$/.test(path) ||
      [
        'tests/setup.ts',
        'tsconfig.json',
        'eslint.config.js',
        '.prettierrc.json',
        '.prettierignore',
        '.gitattributes',
        '.gitignore',
      ].includes(path)
    ) {
      // Static checks cover tooling; smoke and Chromium PWA still exercise the pipeline.
    } else {
      chromiumFull = true;
      reasons.add(`Chromium full: unclassified path (${path}).`);
    }
  }
  const include = [{ browser: 'chromium', grep: chromiumFull ? '.' : grep(affected), pwa: true }];
  if (crossBrowser.size || crossBrowserPwa) {
    for (const browser of ['webkit', 'firefox'])
      include.push({ browser, grep: grep(crossBrowser), pwa: crossBrowserPwa });
  }
  return { include, reasons: [...reasons] };
}

export function planForEvent(eventName, event, changedPaths, forceFull = false) {
  if (forceFull || eventName === 'workflow_dispatch') return browserPlan([], true);
  if (eventName === 'push')
    return { include: [], reasons: ['Main push: static checks, unit tests and build only.'] };
  const base = event.pull_request?.base.sha;
  const head = event.pull_request?.head.sha;
  if (eventName !== 'pull_request' || !base || !head)
    return {
      ...browserPlan(['unknown-event']),
      reasons: ['Chromium full: missing PR comparison metadata.'],
    };
  try {
    return browserPlan(changedPaths(base, head));
  } catch {
    return { ...browserPlan(['unknown-history']), reasons: ['Chromium full: unable to read changed paths.'] };
  }
}

export function documentationOnlyForEvent(eventName, event, rawDiff, forceFull = false) {
  if (forceFull || eventName !== 'pull_request') return false;
  const base = event.pull_request?.base.sha;
  const head = event.pull_request?.head.sha;
  if (!base || !head) return false;
  try {
    const records = rawDiff(base, head).split('\0');
    if (records.pop() !== '' || records.length === 0 || records.length % 2 !== 0) return false;
    for (let index = 0; index < records.length; index += 2) {
      const header = records[index].match(/^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ [AMD]$/);
      if (
        !header ||
        ![header[1], header[2]].every((mode) => ['000000', '100644'].includes(mode)) ||
        !documentation(records[index + 1])
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const full =
    process.env.FULL_BROWSER_SUITE === 'true' || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const docs = documentationOnlyForEvent(
    process.env.GITHUB_EVENT_NAME,
    event,
    (base, head) =>
      execFileSync('git', ['diff', '--raw', '-z', '--no-renames', `${base}...${head}`, '--'], {
        encoding: 'utf8',
      }),
    full,
  );
  const plan = docs
    ? { include: [], reasons: ['Documentation-only PR: no code checks required.'] }
    : planForEvent(
        process.env.GITHUB_EVENT_NAME,
        event,
        (base, head) =>
          execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', `${base}...${head}`, '--'], {
            encoding: 'utf8',
          })
            .split('\0')
            .filter(Boolean),
        full,
      );
  const matrix = JSON.stringify({ include: plan.include });
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `matrix=${matrix}\ndocumentation_only=${docs}\nrun_browsers=${plan.include.length > 0}\nfull=${full}\n`,
    );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Browser coverage\n\n${plan.reasons.map((reason) => `- ${reason}`).join('\n')}\n\n\`\`\`json\n${JSON.stringify(plan.include, null, 2)}\n\`\`\`\n`,
    );
  console.log(JSON.stringify(plan));
}
