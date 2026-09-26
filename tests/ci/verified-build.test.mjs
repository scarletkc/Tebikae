import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { findVerifiedBuild, validateBuild, verification } from '../../scripts/ci-verified-build.mjs';

const identity = { sha: 'a'.repeat(40), runId: '12', runAttempt: '2' };
const repository = 'owner/repo';
const now = Date.parse('2026-09-26T00:00:00Z');
const run = {
  id: 12,
  run_attempt: 2,
  head_sha: identity.sha,
  status: 'completed',
  conclusion: 'success',
  event: 'workflow_dispatch',
  path: '.github/workflows/check.yml',
  repository: { full_name: repository },
};
const artifact = {
  id: 34,
  name: 'verified-browser-builds',
  expired: false,
  expires_at: '2026-10-01T00:00:00Z',
  workflow_run: { head_sha: identity.sha },
};
const find = (runs = [run], artifacts = [artifact]) =>
  findVerifiedBuild({
    repository,
    sha: identity.sha,
    now,
    request: async (path) => (path.includes('/artifacts?') ? { artifacts } : { workflow_runs: runs }),
  });

test('only successful manual Check or Pages runs for the same commit can supply builds', async () => {
  const expected = { runId: '12', runAttempt: '2', artifactId: '34' };
  assert.deepEqual(await find(), expected);
  assert.deepEqual(await find([{ ...run, path: '.github/workflows/pages.yml' }]), expected);
  for (const patch of [
    { head_sha: 'b'.repeat(40) },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { event: 'pull_request' },
    { event: 'push' },
    { path: '.github/workflows/other.yml' },
    { repository: { full_name: 'fork/repo' } },
  ])
    assert.equal(await find([{ ...run, ...patch }]), null);
});

test('unverified, missing, expired and wrong-commit artifacts require new verification', async () => {
  assert.equal(await find([], []), null);
  assert.equal(await find([run], []), null);
  for (const patch of [
    { name: 'browser-builds' },
    { expired: true },
    { expires_at: '2026-09-25T00:00:00Z' },
    { expires_at: 'invalid' },
    { workflow_run: { head_sha: 'b'.repeat(40) } },
  ])
    assert.equal(await find([run], [{ ...artifact, ...patch }]), null);
});

test('a newer unsuitable run does not hide an earlier full verification', async () => {
  const calls = [];
  const result = await findVerifiedBuild({
    repository,
    sha: identity.sha,
    now,
    request: async (path) => {
      calls.push(path);
      if (!path.includes('/artifacts?')) return { workflow_runs: [{ ...run, id: 99 }, run] };
      return { artifacts: path.includes('/99/') ? [] : [artifact] };
    },
  });
  assert.equal(result.runId, '12');
  assert.equal(calls.length, 3);
  assert.ok(calls[0].includes(`head_sha=${identity.sha}`));
});

test('API errors propagate to the CLI fallback instead of producing a reusable result', async () => {
  await assert.rejects(
    findVerifiedBuild({
      repository,
      sha: identity.sha,
      request: async () => {
        throw new Error('API unavailable');
      },
    }),
    /API unavailable/,
  );
});

test('manifest, build metadata and CLI distinguish reusable and unusable artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'tebikae-ci-build-'));
  const manifest = join(root, 'browser-verification.json');
  const writeManifest = (value = verification(identity)) => writeFileSync(manifest, JSON.stringify(value));
  const script = fileURLToPath(new URL('../../scripts/ci-verified-build.mjs', import.meta.url));
  const output = join(root, 'outputs');
  const cli = (command, overrides = {}) => {
    writeFileSync(output, '');
    return spawnSync(process.execPath, [script, command], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: identity.sha,
        GITHUB_RUN_ID: identity.runId,
        GITHUB_RUN_ATTEMPT: identity.runAttempt,
        VERIFIED_RUN_ID: '',
        VERIFIED_RUN_ATTEMPT: '',
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: join(root, 'summary'),
        ...overrides,
      },
    });
  };
  try {
    for (const path of ['dist', '.artifacts/pages-dist']) {
      mkdirSync(join(root, path), { recursive: true });
      writeFileSync(join(root, path, 'index.html'), '<html></html>');
      writeFileSync(
        join(root, path, 'build-info.json'),
        JSON.stringify({ commit: identity.sha, dirty: false }),
      );
    }
    assert.equal(cli('record').status, 0);
    const unavailable = cli('find', { GITHUB_API_URL: 'http://127.0.0.1:1', GITHUB_REPOSITORY: repository });
    assert.equal(unavailable.status, 0);
    assert.match(unavailable.stdout, /lookup unavailable/);
    assert.equal(readFileSync(output, 'utf8'), '');
    assert.doesNotThrow(() => validateBuild(root, identity));
    assert.equal(cli('probe').status, 0);
    assert.match(readFileSync(output, 'utf8'), /reused=true/);
    // Re-running only the deploy job of a self-verified run raises the attempt past the record.
    writeManifest(verification({ ...identity, runAttempt: '1' }));
    assert.equal(validateBuild(root, identity).runAttempt, '1');
    const retried = cli('validate');
    assert.equal(retried.status, 0);
    assert.match(retried.stdout, /runs\/12\/attempts\/1/);
    for (const patch of [
      { schemaVersion: 0 },
      { sha: 'b'.repeat(40) },
      { runId: '13' },
      { runAttempt: '3' },
      { runAttempt: '0' },
      { runAttempt: 1 },
      { workflow: '.github/workflows/other.yml' },
      { builds: { '/': 'dist' } },
      { browsers: [{ browser: 'chromium', grep: '.', pwa: true }] },
      { browsers: verification(identity).browsers.map((entry) => ({ ...entry, grep: '@smoke' })) },
    ]) {
      writeManifest({ ...verification(identity), ...patch });
      assert.throws(() => validateBuild(root, identity), /does not match/);
    }
    assert.equal(cli('probe').status, 0);
    assert.match(readFileSync(output, 'utf8'), /reused=false/);
    assert.notEqual(cli('validate').status, 0);
    writeFileSync(manifest, 'invalid JSON');
    assert.equal(cli('probe').status, 0);
    assert.match(readFileSync(output, 'utf8'), /reused=false/);
    writeManifest();
    for (const path of ['dist', '.artifacts/pages-dist']) {
      for (const info of [
        { commit: 'b'.repeat(40), dirty: false },
        { commit: identity.sha, dirty: true },
      ]) {
        writeFileSync(join(root, path, 'build-info.json'), JSON.stringify(info));
        assert.throws(() => validateBuild(root, identity), /metadata/);
      }
      writeFileSync(
        join(root, path, 'build-info.json'),
        JSON.stringify({ commit: identity.sha, dirty: false }),
      );
    }
    rmSync(join(root, 'dist/index.html'));
    assert.throws(() => validateBuild(root, identity), /entrypoint/);
    rmSync(manifest);
    assert.equal(cli('probe').status, 0);
    assert.match(readFileSync(output, 'utf8'), /reused=false/);
    assert.notEqual(cli('validate').status, 0);
    for (const patch of [{ sha: undefined }, { runId: '' }, { runAttempt: '' }])
      assert.throws(() => verification({ ...identity, ...patch }), /identity/);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('tebikae-ci-build-'));
    rmSync(root, { recursive: true, force: true });
  }
});
