import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const editorTests = ['editor', 'notes', 'note-layout', 'reliability'];
const storageTests = ['session', 'notes', 'reliability', 'backup-import', 'workspace-status'];
const layoutTests = ['note-layout', 'topbar-layout', 'sidebar-controls', 'labels', 'notes'];
const documentation = (path) => path.endsWith('.md') || path === 'LICENSE';

/** Select extra engine coverage without repeating pure logic tests in every browser. */
export function browserPlan(paths, full = false) {
  const affected = new Set();
  let crossBrowserPwa = full;
  const add = (tests) => tests.forEach((test) => affected.add(test));
  for (const path of paths) {
    if (documentation(path)) continue;
    if (path.startsWith('src/features/editor/') || path === 'src/domain/markdown.ts') {
      add(editorTests);
      crossBrowserPwa = true;
    } else if (
      path.startsWith('src/storage/') ||
      path.startsWith('src/security/') ||
      [
        'src/app/session.tsx',
        'src/app/pwa.ts',
        'src/sync/lock.ts',
        'src/application/commands.ts',
        'src/application/backup-import.ts',
      ].includes(path)
    ) {
      add(storageTests);
      crossBrowserPwa = true;
    } else if (path === 'src/application/markdown-export.ts') {
      add(['markdown-export', 'notes']);
    } else if (
      path.startsWith('src/styles/') ||
      path.startsWith('src/i18n/') ||
      path.startsWith('src/app/') ||
      path.startsWith('src/features/')
    ) {
      // Shared UI can affect editor controls, import/export dialogs, and connection forms.
      add([...layoutTests, ...editorTests, ...storageTests, 'markdown-export']);
    } else if (path.startsWith('tests/e2e/') && path.endsWith('.spec.ts')) {
      affected.add(path.slice('tests/e2e/'.length, -'.spec.ts'.length));
    } else if (path.startsWith('tests/pwa/')) {
      add(storageTests);
      crossBrowserPwa = true;
    } else if (
      path.startsWith('src/domain/') ||
      path.startsWith('src/application/') ||
      path.startsWith('src/sync/') ||
      path.startsWith('src/adapters/') ||
      /^tests\/[^/]+\.test\.tsx?$/.test(path)
    ) {
      // Chromium still exercises the complete UI integration for these changes.
    } else {
      // Assets, entrypoints, dependencies, configuration, shared fixtures and unknown
      // paths fail open to coverage, including production/offline checks.
      full = true;
      crossBrowserPwa = true;
    }
  }
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Playwright grep includes the test file name as well as its title and tags.
  const related = [...affected]
    .sort()
    .map((name) => `${escape(name)}\\.spec\\.ts`)
    .join('|');
  const include = [
    { browser: 'chromium', grep: '.', pwa: true },
    {
      browser: 'webkit',
      grep: full ? '.' : ['@smoke', related].filter(Boolean).join('|'),
      pwa: crossBrowserPwa,
    },
  ];
  if (full || related || crossBrowserPwa)
    include.push({
      browser: 'firefox',
      // Keep a runnable core even when the changed spec was deleted or renamed.
      grep: full ? '.' : ['@smoke', related].filter(Boolean).join('|'),
      pwa: crossBrowserPwa,
    });
  return { include };
}

export function planForEvent(eventName, event, changedPaths) {
  if (['schedule', 'workflow_dispatch'].includes(eventName)) return browserPlan([], true);
  const base = eventName === 'pull_request' ? event.pull_request?.base.sha : event.before;
  const head = eventName === 'pull_request' ? event.pull_request?.head.sha : event.after;
  if (!base || !head || /^0+$/.test(base)) return browserPlan([], true);
  try {
    return browserPlan(changedPaths(base, head, eventName === 'pull_request'));
  } catch {
    // A missing history object must increase coverage, never silently omit a browser.
    return browserPlan([], true);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const matrix = planForEvent(process.env.GITHUB_EVENT_NAME, event, (base, head, mergeBase) =>
    execFileSync(
      'git',
      ['diff', '--name-only', '-z', '--no-renames', `${base}${mergeBase ? '...' : '..'}${head}`, '--'],
      {
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean),
  );
  const output = JSON.stringify(matrix);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${output}\n`);
  console.log(output);
}
