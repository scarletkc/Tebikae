import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { browserPlan, planForEvent } from '../../scripts/ci-browser-plan.mjs';

const full = () => browserPlan([], true);
const project = (paths, browser) => browserPlan(paths).include.find((entry) => entry.browser === browser);

test('logic and mixed documentation/logic changes keep full Chromium plus WebKit smoke', () => {
  for (const path of ['src/sync/engine.ts', 'src/domain/merge.ts', 'src/adapters/github/client.ts']) {
    assert.deepEqual(browserPlan(['README.md', path]).include, [
      { browser: 'chromium', grep: '.', pwa: true },
      { browser: 'webkit', grep: '@smoke', pwa: false },
    ]);
  }
});

test('editor changes include engine-specific editor flows and production lazy loading', () => {
  const selected = project(['src/features/editor/MarkdownEditor.tsx'], 'firefox');
  assert.match('editor.spec.ts opening the editor', new RegExp(selected.grep));
  assert.match('reliability.spec.ts storage failure', new RegExp(selected.grep));
  assert.doesNotMatch('markdown-export.spec.ts export', new RegExp(selected.grep));
  assert.equal(selected.pwa, true);
});

test('storage, credentials, PWA and browser locks exercise cross-engine persistence', () => {
  for (const path of [
    'src/storage/db.ts',
    'src/security/saved-session.ts',
    'src/app/pwa.ts',
    'src/sync/lock.ts',
    'src/application/commands.ts',
    'src/application/backup-import.ts',
  ]) {
    const selected = project([path], 'firefox');
    assert.equal(selected.pwa, true);
    assert.match('session.spec.ts reconnect', new RegExp(selected.grep));
    assert.match('backup-import.spec.ts rollback', new RegExp(selected.grep));
  }
});

test('UI changes cover responsive layouts, editor controls and dialogs', () => {
  const selected = project(['src/styles/app.css'], 'webkit');
  for (const file of ['topbar-layout', 'note-layout', 'editor', 'markdown-export', 'backup-import'])
    assert.match(`${file}.spec.ts`, new RegExp(selected.grep));
  assert.match('another.spec.ts core @smoke', new RegExp(selected.grep));
});

test('changed browser specs run on all engines, with literal file names', () => {
  const selected = project(['tests/e2e/new+[flow].spec.ts'], 'firefox');
  assert.match('new+[flow].spec.ts', new RegExp(selected.grep));
  assert.doesNotMatch('newflow.spec.ts', new RegExp(selected.grep));
  assert.match('notes.spec.ts core @smoke', new RegExp(selected.grep));
});

test('assets, dependencies, build, workflow and unknown changes require full coverage', () => {
  for (const path of [
    'public/icon.svg',
    'package.json',
    'pnpm-lock.yaml',
    'vite.config.ts',
    'index.html',
    '.github/workflows/check.yml',
    'tests/e2e/fixtures.ts',
    'src/new-module.ts',
    'docs/example.js',
  ])
    assert.deepEqual(browserPlan(['README.md', path]), full(), path);
});

test('nightly and manual runs always exercise every engine and production suite', () => {
  for (const eventName of ['schedule', 'workflow_dispatch'])
    assert.deepEqual(
      planForEvent(eventName, {}, () => assert.fail('no diff needed')),
      full(),
    );
});

test('PR selection uses base/head merge-base; pushes use the complete before/after range', () => {
  const calls = [];
  const changed = (...args) => {
    calls.push(args);
    return ['src/domain/codec.ts'];
  };
  planForEvent('pull_request', { pull_request: { base: { sha: 'base' }, head: { sha: 'head' } } }, changed);
  planForEvent('push', { before: 'old', after: 'new' }, changed);
  assert.deepEqual(calls, [
    ['base', 'head', true],
    ['old', 'new', false],
  ]);
});

test('missing history and first pushes fall back to full coverage', () => {
  assert.deepEqual(
    planForEvent('push', { before: '000000', after: 'head' }, () => assert.fail()),
    full(),
  );
  assert.deepEqual(
    planForEvent('push', { before: 'old', after: 'new' }, () => {
      throw new Error('missing commit');
    }),
    full(),
  );
});

test('CLI handles renamed sensitive files and writes a parseable Actions output', () => {
  const root = mkdtempSync(join(tmpdir(), 'tebikae-ci-plan-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'CI test');
    mkdirSync(join(root, 'src/storage'), { recursive: true });
    mkdirSync(join(root, 'src/domain'), { recursive: true });
    writeFileSync(join(root, 'src/storage/cache.ts'), 'export const cache = 1;\n');
    git('add', '.');
    git('commit', '-m', 'base');
    const before = git('rev-parse', 'HEAD');
    git('mv', 'src/storage/cache.ts', 'src/domain/cache.ts');
    git('commit', '-m', 'move');
    const eventPath = join(root, 'event.json');
    const outputPath = join(root, 'output');
    writeFileSync(eventPath, JSON.stringify({ before, after: git('rev-parse', 'HEAD') }));
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/ci-browser-plan.mjs', import.meta.url))],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'push',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
        },
        encoding: 'utf8',
      },
    );
    const matrix = JSON.parse(output);
    assert.equal(matrix.include.find((entry) => entry.browser === 'firefox').pwa, true);
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8').trim().slice('matrix='.length)), matrix);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('tebikae-ci-plan-'));
    rmSync(root, { recursive: true, force: true });
  }
});
