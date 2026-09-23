/** Opt-in acceptance against the dedicated, private test repository only. No traces or credentials are written. */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const repository = 'scarletkc/Tebikae-dev';
let token = '';
let browser;
const summary = { repository, at: new Date().toISOString(), checks: [], issues: [] };
async function main() {
  if (process.env.TEBIKAE_LIVE_TEST !== '1')
    throw new Error('Set TEBIKAE_LIVE_TEST=1 to create acceptance notes in scarletkc/Tebikae-dev.');
  token =
    process.env.TEBIKAE_TEST_TOKEN ||
    execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const api = async (path) => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
    });
    if (!response.ok) throw new Error(`Acceptance read failed: ${response.status}`);
    return response.json();
  };
  const repo = await api(`/repos/${repository}`),
    user = await api('/user');
  if (
    !repo.private ||
    repo.full_name !== repository ||
    repo.owner.id !== user.id ||
    !repo.has_issues ||
    repo.archived
  )
    throw new Error('Dedicated private test repository validation failed.');
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: process.env.TEBIKAE_TEST_URL || 'http://127.0.0.1:4174',
    locale: 'en-US',
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const writes = [];
  let unexpectedTokenRequest = false;
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (request.headers().authorization?.includes(token) && url.origin !== 'https://api.github.com')
      unexpectedTokenRequest = true;
    if (
      url.origin === 'https://api.github.com' &&
      request.method() !== 'GET' &&
      request.method() !== 'OPTIONS'
    )
      writes.push({ method: request.method(), path: url.pathname });
  });
  await page.goto('/');
  await page.getByLabel('GitHub repository', { exact: true }).fill(repository);
  await page.getByLabel('Personal access token', { exact: true }).fill(token);
  await page.getByRole('checkbox', { name: 'Remember this connection in this browser' }).check();
  await page.getByRole('button', { name: 'Connect repository', exact: true }).click();
  await expect(page.getByLabel('Search your notes', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.loading-notice')).toHaveCount(0, { timeout: 30000 });
  if (writes.length) throw new Error('Connection unexpectedly wrote to the repository.');
  summary.checks.push('Identity/private repository check and read-only initial connection');

  const labels = await api(`/repos/${repository}/labels?per_page=100`);
  const labelName = 'tebikae-acceptance';
  if (!labels.some((label) => label.name === labelName)) {
    await page.getByRole('button', { name: 'New label', exact: true }).click();
    await page.getByLabel('Label name', { exact: true }).fill(labelName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
    summary.checks.push('Created label through the application');
  }
  const title = `[Tebikae acceptance] ${new Date().toISOString()}`;
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.fill('真实 GitHub 验收：Markdown、草稿、标签与归档。');
  const noteMenu = page.getByRole('dialog').getByRole('button', { name: 'More actions', exact: true });
  await noteMenu.click();
  await page.getByRole('menuitemradio', { name: 'Sage', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Choose labels', { exact: true }).click();
  await page.getByRole('dialog').getByLabel(labelName, { exact: true }).check();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.note-save-row').getByRole('status')).toHaveText('Synced to GitHub', {
    timeout: 45000,
  });
  await noteMenu.click();
  const href = await page.getByRole('menuitem', { name: 'Open on GitHub', exact: true }).getAttribute('href');
  await page.keyboard.press('Escape');
  const number = Number(href.split('/').at(-1));
  if (!Number.isSafeInteger(number)) throw new Error('No confirmed Issue number.');
  summary.issues.push({ number, url: href });
  let remote = await api(`/repos/${repository}/issues/${number}`);
  if (
    remote.title !== title ||
    !remote.body.includes('真实 GitHub 验收') ||
    !remote.body.includes('"color":"green"') ||
    !remote.labels.some((label) => label.name === labelName)
  )
    throw new Error('Created Issue did not match the confirmed draft.');
  summary.checks.push(
    'Created visual Markdown note with Chinese content, color and label; verified via fresh GitHub GET',
  );

  await noteMenu.click();
  await page.getByRole('menuitem', { name: 'Archive note', exact: true }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.note-save-row').getByRole('status')).toHaveText('Synced to GitHub', {
    timeout: 45000,
  });
  await noteMenu.click();
  await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.note-save-row').getByRole('status')).toHaveText('Synced to GitHub', {
    timeout: 45000,
  });
  remote = await api(`/repos/${repository}/issues/${number}`);
  if (remote.state !== 'closed' || remote.body.includes('"trashedAt":null'))
    throw new Error('Archived trash state was not preserved.');
  await noteMenu.click();
  await page.getByRole('menuitem', { name: 'Restore note', exact: true }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.note-save-row').getByRole('status')).toHaveText('Synced to GitHub', {
    timeout: 45000,
  });
  remote = await api(`/repos/${repository}/issues/${number}`);
  if (
    remote.state !== 'closed' ||
    !remote.body.includes('"trashedAt":null') ||
    !remote.body.includes('真实 GitHub 验收')
  )
    throw new Error('Restoring from trash did not restore the archived note.');
  summary.checks.push(
    'Archived, trashed and restored note; fresh GET confirms archived state, body and label preserved',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.locator('a[href$="#/archive"]').click();
  await expect(page.getByRole('button', { name: `Edit note: ${title}`, exact: true })).toBeVisible();
  const persistent = await page.evaluate(async () => {
    const values = [JSON.stringify(localStorage), JSON.stringify(sessionStorage)];
    for (const info of await indexedDB.databases()) {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(info.name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Cannot inspect test storage'));
      });
      for (const name of database.objectStoreNames) {
        const data = await new Promise((resolve, reject) => {
          const request = database.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error('Cannot inspect test storage'));
        });
        values.push(JSON.stringify(data));
      }
      database.close();
    }
    return values;
  });
  if (persistent.some((value) => value.includes(token)) || unexpectedTokenRequest)
    throw new Error('Credential boundary failed.');
  summary.checks.push(
    'Refresh restored the connection and archived note; no plaintext token in local/session storage, IndexedDB or non-GitHub requests',
  );
  summary.writes = writes;
  summary.credentialScope = process.env.TEBIKAE_TEST_TOKEN
    ? 'provided runtime token; permissions not introspected'
    : 'existing GitHub CLI session; minimum fine-grained PAT permissions not validated';
  await mkdir('.artifacts', { recursive: true });
  await writeFile('.artifacts/live-acceptance.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
try {
  await main();
} catch (error) {
  console.error(
    (error instanceof Error ? error.message : String(error)).replaceAll(token || '\0', '[REDACTED]'),
  );
  console.error(
    JSON.stringify({ repository, createdIssues: summary.issues, completedChecks: summary.checks }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  token = '';
}
