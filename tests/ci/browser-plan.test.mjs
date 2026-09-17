import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { browserPlan, planForEvent, successCacheKey } from '../../scripts/ci-browser-plan.mjs';

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
    'src/content.md',
  ])
    assert.deepEqual(browserPlan(['README.md', path]), full(), path);
});

test('manual runs always exercise every engine and production suite', () => {
  assert.deepEqual(
    planForEvent('workflow_dispatch', {}, () => assert.fail('no diff needed')),
    full(),
  );
});

test('deployment overrides the caller event and changed paths with full coverage', () => {
  assert.deepEqual(
    planForEvent('push', { before: 'old', after: 'new' }, () => ['src/domain/codec.ts'], true),
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

test('CLI handles renames, Actions outputs, documentation reuse and deployment overrides', () => {
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
          FULL_BROWSER_SUITE: 'false',
        },
        encoding: 'utf8',
      },
    );
    const matrix = JSON.parse(output);
    assert.equal(matrix.include.find((entry) => entry.browser === 'firefox').pwa, true);
    const outputs = Object.fromEntries(
      readFileSync(outputPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    assert.deepEqual(JSON.parse(outputs.matrix), matrix);
    assert.equal(outputs.reuse_allowed, 'false');
    const deployment = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/ci-browser-plan.mjs', import.meta.url))],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'push',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: join(root, 'deployment-output'),
          FULL_BROWSER_SUITE: 'true',
        },
        encoding: 'utf8',
      },
    );
    assert.deepEqual(JSON.parse(deployment), full());
    const prOutput = join(root, 'pr-output');
    const runPR = (overrides = {}) => {
      writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { base: { sha: before }, head: { sha: git('rev-parse', 'HEAD') } } }),
      );
      writeFileSync(prOutput, '');
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL('../../scripts/ci-browser-plan.mjs', import.meta.url))],
        {
          cwd: root,
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: 'pull_request',
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_OUTPUT: prOutput,
            GITHUB_REF: 'refs/pull/12/merge',
            GITHUB_WORKFLOW: 'Check',
            ImageOS: 'ubuntu24',
            ImageVersion: '20260917',
            FULL_BROWSER_SUITE: 'false',
            ...overrides,
          },
          encoding: 'utf8',
        },
      );
      return Object.fromEntries(
        readFileSync(prOutput, 'utf8')
          .trim()
          .split('\n')
          .map((line) => {
            const separator = line.indexOf('=');
            return [line.slice(0, separator), line.slice(separator + 1)];
          }),
      );
    };
    const initial = runPR();
    assert.equal(initial.reuse_allowed, 'true');
    writeFileSync(join(root, 'README.md'), 'Documentation update\n');
    git('add', 'README.md');
    git('commit', '-m', 'docs');
    assert.equal(runPR().cache_key, initial.cache_key);
    writeFileSync(join(root, 'src/domain/cache.ts'), 'export const cache = 2;\n');
    git('add', 'src/domain/cache.ts');
    git('commit', '-m', 'code');
    assert.notEqual(runPR().cache_key, initial.cache_key);
    assert.equal(runPR({ FULL_BROWSER_SUITE: 'true' }).reuse_allowed, 'false');
    assert.equal(runPR({ ImageVersion: '' }).reuse_allowed, 'false');
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('tebikae-ci-plan-'));
    rmSync(root, { recursive: true, force: true });
  }
});

const entry = (path, hash = 'a', mode = '100644') => `${mode} blob ${hash.repeat(40)}\t${path}\0`;
const identity = {
  tree: entry('src/app/App.tsx') + entry('pnpm-lock.yaml') + entry('README.md'),
  matrix: browserPlan(['src/app/App.tsx']),
  base: 'base-sha',
  scope: 'Check:refs/pull/12/merge',
  runtime: ['v24', 'linux', 'x64', 'ubuntu24', '20260917'],
};

test('prose-only changes reuse the same code result identity', () => {
  assert.equal(
    successCacheKey(identity),
    successCacheKey({
      ...identity,
      tree:
        entry('src/app/App.tsx') +
        entry('pnpm-lock.yaml') +
        entry('README.md', 'b') +
        entry('docs/new-guide.md'),
    }),
  );
});

test('code, dependencies, workflows, tests and runtime Markdown invalidate a cached result', () => {
  for (const path of [
    'src/app/App.tsx',
    'pnpm-lock.yaml',
    '.github/workflows/check.yml',
    'tests/e2e/notes.spec.ts',
    'src/content.md',
  ]) {
    const before = { ...identity, tree: entry(path) };
    assert.notEqual(successCacheKey(before), successCacheKey({ ...before, tree: entry(path, 'b') }), path);
  }
  assert.notEqual(successCacheKey(identity), successCacheKey({ ...identity, tree: entry('pnpm-lock.yaml') }));
});

test('base updates, another PR, runner changes and wider coverage invalidate reuse', () => {
  for (const change of [
    { base: 'new-main' },
    { scope: 'Check:refs/pull/13/merge' },
    { runtime: ['v24', 'linux', 'x64', 'ubuntu24', '20260918'] },
    { matrix: full() },
  ])
    assert.notEqual(successCacheKey(identity), successCacheKey({ ...identity, ...change }));
});

test('executable Markdown, symlinks and missing provenance are not reusable prose', () => {
  for (const mode of ['100755', '120000']) {
    const before = { ...identity, tree: entry('README.md', 'a', mode) };
    assert.notEqual(
      successCacheKey(before),
      successCacheKey({ ...before, tree: entry('README.md', 'b', mode) }),
    );
  }
  assert.throws(() => successCacheKey({ ...identity, base: '' }), /Missing cache identity/);
  assert.throws(() => successCacheKey({ ...identity, tree: 'invalid entry' }), /Invalid Git tree/);
});
