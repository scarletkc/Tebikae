import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { browserPlan, documentationOnlyForEvent, planForEvent } from '../../scripts/ci-browser-plan.mjs';
import { checksPassed } from '../../scripts/ci-check-result.mjs';

const full = () => browserPlan([], true);
const pr = { pull_request: { base: { sha: 'base' }, head: { sha: 'head' } } };
const project = (paths, browser = 'chromium') =>
  browserPlan(paths).include.find((entry) => entry.browser === browser);

test('tooling and unit tests keep Chromium smoke and PWA, with no unrelated engines', () => {
  for (const path of [
    'scripts/ci-browser-plan.mjs',
    'tests/ci/browser-plan.test.mjs',
    '.github/workflows/check.yml',
    'tests/domain.test.ts',
    'tests/setup.ts',
    'eslint.config.js',
    'playwright.screenshots.config.ts',
  ]) {
    assert.deepEqual(browserPlan([path]).include, [{ browser: 'chromium', grep: '@smoke', pwa: true }], path);
  }
});

test('shared components and styles select their consumers without full engine matrices', () => {
  for (const path of [
    'src/ui/Button.tsx',
    'src/app/ui.tsx',
    'src/styles/theme.css',
    'src/i18n/locales/en.json',
  ]) {
    const plan = browserPlan([path]);
    assert.equal(plan.include.length, 1);
    assert.notEqual(plan.include[0].grep, '.');
    for (const file of [
      'topbar-layout',
      'note-layout',
      'editor-canvas',
      'context-menu',
      'backup-import',
      'markdown-export',
    ])
      assert.match(`${file}.spec.ts test`, new RegExp(plan.include[0].grep), `${path}: ${file}`);
  }
});

test('editor changes select editing and save races across engines', () => {
  for (const path of [
    'src/features/editor/MarkdownEditor.tsx',
    'src/features/notes/NoteDialog.tsx',
    'src/domain/markdown.ts',
    'src/features/workspace/useGlobalShortcuts.ts',
  ]) {
    const plan = browserPlan([path]);
    assert.equal(plan.include.length, 3);
    for (const selected of plan.include) {
      assert.equal(selected.pwa, true);
      for (const file of ['editor', 'editor-canvas', 'editor-save-races', 'notes', 'reliability'])
        assert.match(`${file}.spec.ts test`, new RegExp(selected.grep));
      assert.doesNotMatch('markdown-export.spec.ts export', new RegExp(selected.grep));
    }
  }
});

test('persistence, authentication, sync and locks get related cross-engine coverage', () => {
  for (const path of [
    'src/storage/db.ts',
    'src/security/saved-session.ts',
    'src/sync/engine.ts',
    'src/sync/lock.ts',
    'src/adapters/github/client.ts',
    'src/app/session.tsx',
    'src/app/usePwaLifecycle.ts',
    'src/features/connect/Connect.tsx',
    'src/application/commands.ts',
    'src/domain/merge.ts',
    'src/domain/codec.ts',
    'src/domain/types.ts',
    'src/features/settings/BackupImportDialog.tsx',
    'tests/pwa/network.ts',
    'playwright.pwa.config.ts',
  ]) {
    for (const browser of ['chromium', 'webkit', 'firefox']) {
      const selected = project([path], browser);
      assert.equal(selected.pwa, true, path);
      for (const file of [
        'session',
        'notes',
        'reliability',
        'sync-retry',
        'backup-import',
        'workspace-status',
      ])
        assert.match(`${file}.spec.ts test`, new RegExp(selected.grep), path);
    }
  }
});

test('feature changes select related Chromium specs', () => {
  for (const [path, included, excluded] of [
    ['src/features/filters/Filters.tsx', 'pagination-search', 'backup-import'],
    ['src/features/labels/LabelBadge.tsx', 'labels', 'editor-save-races'],
    ['src/features/notes/NoteCard.tsx', 'note-layout', 'session'],
    ['src/features/workspace/Topbar.tsx', 'topbar-layout', 'backup-import'],
    ['src/features/settings/MarkdownExportDialog.tsx', 'markdown-export', 'backup-import'],
  ]) {
    const plan = browserPlan([path]);
    assert.equal(plan.include.length, 1);
    assert.match(`${included}.spec.ts test`, new RegExp(plan.include[0].grep));
    assert.doesNotMatch(`${excluded}.spec.ts test`, new RegExp(plan.include[0].grep));
  }
});

test('changed specs are literal and bounded, with smoke retained for deleted specs', () => {
  const selected = project(['tests/e2e/new+[flow].spec.ts']);
  const pattern = new RegExp(selected.grep);
  assert.match('chromium tests/e2e/new+[flow].spec.ts title', pattern);
  assert.match('chromium tests\\e2e\\new+[flow].spec.ts title', pattern);
  assert.doesNotMatch('newflow.spec.ts title', pattern);
  assert.doesNotMatch('other-new+[flow].spec.ts title', pattern);
  assert.match('notes.spec.ts title @smoke', pattern);
  assert.equal(browserPlan(['tests/e2e/new+[flow].spec.ts']).include.length, 1);
});

test('unknown paths and shared infrastructure fall back to Chromium full with a reason', () => {
  for (const path of [
    'public/icon.svg',
    'package.json',
    'pnpm-lock.yaml',
    'vite.config.ts',
    'index.html',
    'playwright.config.ts',
    'tests/e2e/fixtures.ts',
    'src/new-module.ts',
    'docs/example.js',
    'src/content.md',
  ]) {
    const plan = browserPlan([path]);
    assert.deepEqual(plan.include, [{ browser: 'chromium', grep: '.', pwa: true }]);
    assert.ok(plan.reasons.some((reason) => reason.includes(path)));
  }
});

test('mixed changes union coverage without expanding unrelated engines to full', () => {
  const paths = [
    'README.md',
    'src/features/editor/engine.ts',
    'src/security/session.ts',
    'src/ui/Button.tsx',
    'unknown',
  ];
  assert.equal(project(paths).grep, '.');
  const firefox = new RegExp(project(paths, 'firefox').grep);
  assert.match('editor-save-races.spec.ts race', firefox);
  assert.match('backup-import.spec.ts import', firefox);
  assert.doesNotMatch('topbar-layout.spec.ts layout', firefox);
});

test('manual and deployment runs always retain all browsers and PWA', () => {
  assert.deepEqual(
    planForEvent('workflow_dispatch', {}, () => assert.fail()),
    full(),
  );
  for (const event of ['push', 'pull_request', 'workflow_call'])
    assert.deepEqual(
      planForEvent(event, pr, () => assert.fail(), true),
      full(),
    );
  assert.deepEqual(
    full().include.map((entry) => [entry.browser, entry.grep, entry.pwa]),
    [
      ['chromium', '.', true],
      ['webkit', '.', true],
      ['firefox', '.', true],
    ],
  );
});

test('main pushes never start browser jobs, including first pushes and unavailable history', () => {
  assert.deepEqual(planForEvent('push', {}, () => assert.fail()).include, []);
});

test('PRs use base/head and missing metadata or history increases Chromium coverage', () => {
  let args;
  planForEvent('pull_request', pr, (...values) => {
    args = values;
    return [];
  });
  assert.deepEqual(args, ['base', 'head']);
  for (const plan of [
    planForEvent('pull_request', {}, () => assert.fail()),
    planForEvent('pull_request', pr, () => {
      throw new Error('missing history');
    }),
  ]) {
    assert.equal(plan.include[0].grep, '.');
    assert.equal(plan.include.length, 1);
    assert.equal(plan.reasons.length, 1);
  }
});

test('only ordinary prose changes can skip required code validation', () => {
  const diff = (path, oldMode = '100644', newMode = '100644', status = 'M') =>
    `:${oldMode} ${newMode} abc123 def456 ${status}\0${path}\0`;
  const classify = (raw) => documentationOnlyForEvent('pull_request', pr, () => raw);
  assert.equal(classify(diff('README.md') + diff('docs/guide.md', '000000', '100644', 'A')), true);
  assert.equal(classify(diff('LICENSE', '100644', '000000', 'D')), true);
  for (const path of ['src/content.md', 'docs/example.js', '.github/workflows/check.yml'])
    assert.equal(classify(diff('README.md') + diff(path)), false);
  for (const mode of ['100755', '120000']) assert.equal(classify(diff('README.md', '100644', mode)), false);
  for (const raw of ['', 'malformed\0README.md\0', ':100644 100644 abc def R100\0old\0new\0'])
    assert.equal(classify(raw), false);
  assert.equal(
    documentationOnlyForEvent('pull_request', pr, () => diff('README.md'), true),
    false,
  );
  assert.equal(
    documentationOnlyForEvent('workflow_dispatch', pr, () => diff('README.md')),
    false,
  );
  assert.equal(
    documentationOnlyForEvent('pull_request', {}, () => diff('README.md')),
    false,
  );
  assert.equal(
    documentationOnlyForEvent('pull_request', pr, () => {
      throw new Error('missing history');
    }),
    false,
  );
});

test('the required gate rejects every unexpected failure, cancellation or skip', () => {
  const cases = [
    {
      plan: 'success',
      validate: 'success',
      browsers: 'success',
      documentationOnly: 'false',
      runBrowsers: 'true',
    },
    {
      plan: 'success',
      validate: 'success',
      browsers: 'skipped',
      documentationOnly: 'false',
      runBrowsers: 'false',
    },
    {
      plan: 'success',
      validate: 'skipped',
      browsers: 'skipped',
      documentationOnly: 'true',
      runBrowsers: 'false',
    },
  ];
  for (const valid of cases) {
    assert.equal(checksPassed(valid), true);
    for (const key of ['plan', 'validate', 'browsers'])
      for (const state of ['failure', 'cancelled', 'skipped', 'success', undefined])
        if (state !== valid[key]) assert.equal(checksPassed({ ...valid, [key]: state }), false);
    for (const key of ['documentationOnly', 'runBrowsers'])
      assert.equal(checksPassed({ ...valid, [key]: undefined }), false);
  }
});

test('CLI handles renames, documentation, main and full verification outputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'tebikae-ci-plan-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const script = fileURLToPath(new URL('../../scripts/ci-browser-plan.mjs', import.meta.url));
  const run = (eventName, event, full = false) => {
    const eventPath = join(root, 'event.json'),
      outputPath = join(root, 'outputs'),
      summary = join(root, 'summary');
    writeFileSync(eventPath, JSON.stringify(event));
    writeFileSync(outputPath, '');
    const result = JSON.parse(
      execFileSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: eventName,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
          GITHUB_STEP_SUMMARY: summary,
          FULL_BROWSER_SUITE: String(full),
        },
      }),
    );
    const outputs = Object.fromEntries(
      readFileSync(outputPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    assert.deepEqual(JSON.parse(outputs.matrix), { include: result.include });
    assert.ok(readFileSync(summary, 'utf8').includes('Browser coverage'));
    return outputs;
  };
  try {
    git('init');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'CI test');
    mkdirSync(join(root, 'src/storage'), { recursive: true });
    writeFileSync(join(root, 'src/storage/db.ts'), 'export const value = 1;\n');
    git('add', '.');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    git('mv', 'src/storage/db.ts', 'src/renamed.ts');
    git('commit', '-m', 'rename');
    const event = { pull_request: { base: { sha: base }, head: { sha: git('rev-parse', 'HEAD') } } };
    const result = run('pull_request', event);
    assert.equal(result.run_browsers, 'true');
    assert.equal(JSON.parse(result.matrix).include.length, 3);
    assert.equal(result.full, 'false');
    assert.equal(run('push', {}).run_browsers, 'false');
    assert.equal(run('push', {}, true).full, 'true');
    assert.equal(run('workflow_dispatch', {}).full, 'true');
    const docBase = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'README.md'), 'Documentation\n');
    git('add', 'README.md');
    git('commit', '-m', 'docs');
    const docs = { pull_request: { base: { sha: docBase }, head: { sha: git('rev-parse', 'HEAD') } } };
    assert.equal(run('pull_request', docs).documentation_only, 'true');
    assert.equal(run('pull_request', docs).run_browsers, 'false');
    assert.equal(run('pull_request', docs, true).documentation_only, 'false');
    git('update-index', '--chmod=+x', 'README.md');
    git('commit', '-m', 'executable markdown');
    docs.pull_request.head.sha = git('rev-parse', 'HEAD');
    assert.equal(run('pull_request', docs).documentation_only, 'false');
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('tebikae-ci-plan-'));
    rmSync(root, { recursive: true, force: true });
  }
});
