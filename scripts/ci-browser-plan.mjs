import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const editorTests = ['editor', 'notes', 'note-layout', 'reliability', 'context-menu'];
const storageTests = ['session', 'notes', 'reliability', 'backup-import', 'workspace-status'];
const layoutTests = ['note-layout', 'topbar-layout', 'sidebar-controls', 'labels', 'notes'];
const documentation = (path) =>
  path === 'LICENSE' || (path.endsWith('.md') && (!path.includes('/') || path.startsWith('docs/')));

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

export function planForEvent(eventName, event, changedPaths, forceFull = false) {
  if (forceFull || eventName === 'workflow_dispatch') return browserPlan([], true);
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

/** A pass is reusable only for the same tested tree, base, coverage and runner. */
export function successCacheKey({ tree, matrix, base, scope, runtime }) {
  if (!base || !scope || !runtime) throw new Error('Missing cache identity');
  const code = tree
    .split('\0')
    .filter(Boolean)
    .filter((entry) => {
      const separator = entry.indexOf('\t');
      if (separator < 0) throw new Error('Invalid Git tree entry');
      const path = entry.slice(separator + 1);
      // Executable files and symlinks are never treated as documentation.
      const prose = documentation(path);
      return !entry.startsWith('100644 blob ') || !prose;
    })
    .sort();
  return `ci-success-v1-${createHash('sha256').update(JSON.stringify({ code, matrix, base, scope, runtime })).digest('hex')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const matrix = planForEvent(
    process.env.GITHUB_EVENT_NAME,
    event,
    (base, head, mergeBase) =>
      execFileSync(
        'git',
        ['diff', '--name-only', '-z', '--no-renames', `${base}${mergeBase ? '...' : '..'}${head}`, '--'],
        {
          encoding: 'utf8',
        },
      )
        .split('\0')
        .filter(Boolean),
    process.env.FULL_BROWSER_SUITE === 'true',
  );
  const output = JSON.stringify(matrix);
  const documentationOnly = documentationOnlyForEvent(
    process.env.GITHUB_EVENT_NAME,
    event,
    (base, head) =>
      execFileSync('git', ['diff', '--raw', '-z', '--no-renames', `${base}...${head}`, '--'], {
        encoding: 'utf8',
      }),
    process.env.FULL_BROWSER_SUITE === 'true',
  );
  let cacheKey = '';
  if (
    !documentationOnly &&
    process.env.GITHUB_EVENT_NAME === 'pull_request' &&
    process.env.FULL_BROWSER_SUITE !== 'true' &&
    process.env.GITHUB_REF &&
    process.env.GITHUB_WORKFLOW &&
    process.env.ImageOS &&
    process.env.ImageVersion
  ) {
    try {
      cacheKey = successCacheKey({
        tree: execFileSync('git', ['ls-tree', '-rz', '--full-tree', 'HEAD'], { encoding: 'utf8' }),
        matrix,
        base: event.pull_request?.base.sha,
        scope: `${process.env.GITHUB_WORKFLOW}:${process.env.GITHUB_REF}`,
        runtime: [
          process.version,
          process.platform,
          process.arch,
          process.env.ImageOS,
          process.env.ImageVersion,
        ],
      });
    } catch {
      // If provenance cannot be established, run the checks instead of reusing a pass.
    }
  }
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `matrix=${output}\ncache_key=${cacheKey}\nreuse_allowed=${Boolean(cacheKey)}\ndocumentation_only=${documentationOnly}\n`,
    );
  console.log(output);
}
