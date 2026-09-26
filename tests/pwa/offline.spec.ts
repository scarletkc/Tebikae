import { expect } from '@playwright/test';
import { test } from './fixtures';
import { connect, mockGitHub } from '../e2e/fixtures';
import en from '../../src/i18n/locales/en.json' with { type: 'json' };
import zh from '../../src/i18n/locales/zh-CN.json' with { type: 'json' };
import { blockGitHubAfterReload, disconnectNetwork } from './network';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { newMetadata } from '../../src/domain/codec';

for (const language of ['en', 'zh-CN'] as const) {
  test(`production shell and first editor use work after a fully offline reload (${language})`, async ({
    page,
    context,
    outageServer,
  }, info) => {
    const remote = await mockGitHub(context);
    await connect(page);
    await page.locator('a[href$="#/settings"]').click();
    await expect(page.getByText('Ready for offline use', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.locator('#theme-setting').click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await page.locator('#language-setting').click();
    await page
      .getByRole('menuitemradio', { name: language === 'en' ? 'English' : '简体中文', exact: true })
      .click();
    const copy = language === 'en' ? en : zh;
    await page.locator('a[href$="#/notes"]').click();
    const cached = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const urls: string[] = [];
      for (const key of await caches.keys())
        for (const request of await (await caches.open(key)).keys()) urls.push(request.url);
      return {
        urls,
        editorLoadedByPage: performance
          .getEntriesByType('resource')
          .some((entry) => /\/MarkdownEditor-[^/]+\.js/u.test(entry.name)),
      };
    });
    expect(cached.editorLoadedByPage).toBe(false);
    expect(cached.urls.some((url) => /\/MarkdownEditor-[^/]+\.js/u.test(url))).toBe(true);
    await context.unroute('https://api.github.com/**');
    await blockGitHubAfterReload(context);
    // A second navigation is controlled by the now activated worker.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await disconnectNetwork(context, page, outageServer, info);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel(copy.home.search, { exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('.note-card').filter({ hasText: 'Weekend ideas' }).locator('.note-open').click();
    // The editor chunk is lazy-loaded. Playwright's Windows WebKit can terminate a
    // Service Worker intercepted fetch when the origin sockets close at the same
    // moment, so allow the chunk time to resolve from the precache before failing.
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible({ timeout: 30_000 });
    await page
      .locator('.ProseMirror[contenteditable="true"]')
      .fill('First editor opened offline. 首次离线编辑。');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: copy.action.close, exact: true })
      .last()
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.note-card').filter({ hasText: 'Weekend ideas' }).locator('.note-open').click();
    await expect(page.locator('.ProseMirror')).toContainText('首次离线编辑');
    await expect(page.getByRole('button', { name: copy.action.save, exact: true })).toBeDisabled();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: copy.action.close, exact: true })
      .last()
      .click();
    await page.locator('a[href$="#/settings"]').click();
    await page.getByRole('button', { name: copy.markdownExport.title, exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: copy.markdownExport.download, exact: true }).click();
    const download = await downloaded;
    const files = unzipSync(await readFile((await download.path())!));
    expect(strFromU8(files['notes/Weekend ideas.md']!)).toContain('首次离线编辑');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: copy.backupImport.title, exact: true }).click();
    await page.getByLabel(copy.backupImport.file, { exact: true }).setInputFiles({
      name: 'offline-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'issue-notes-export',
          schemaVersion: 1,
          labels: [],
          notes: [
            {
              current: {
                title: 'Imported offline',
                markdown: '离线恢复的正文',
                archived: false,
                labelIds: [],
                meta: newMetadata(),
              },
            },
          ],
        }),
      ),
    });
    await page
      .getByRole('button', { name: copy.backupImport.import.replace('{{count}}', '1'), exact: true })
      .click();
    await expect(
      page.getByText(copy.backupImport.success.replace('{{imported}}', '1').replace('{{skipped}}', '0'), {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: copy.backupImport.done, exact: true }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('a[href$="#/notes"]').click();
    await expect(page.locator('.note-card').filter({ hasText: 'Imported offline' })).toContainText(
      '离线恢复的正文',
    );
    expect(remote.writes).toHaveLength(0);
  });
}

test('production caches contain shell files only and persistent storage contains no plaintext token', async ({
  page,
  context,
}) => {
  await mockGitHub(context);
  await connect(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const storage = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    const data: unknown[] = [];
    for (const databaseName of ['tebikae', 'tebikae-session']) {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const names = Array.from(database.objectStoreNames);
      const transaction = database.transaction(names, 'readonly');
      data.push(
        ...(await Promise.all(
          names.map(
            (name) =>
              new Promise<unknown>((resolve, reject) => {
                const request = transaction.objectStore(name).getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              }),
          ),
        )),
      );
      database.close();
    }
    return {
      urls,
      persistent: JSON.stringify({ data, local: { ...localStorage }, session: { ...sessionStorage } }),
    };
  });
  expect(storage.urls.length).toBeGreaterThan(5);
  expect(storage.urls.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(storage.urls.some((url) => url.includes('api.github.com'))).toBe(false);
  expect(storage.persistent).not.toContain('browser-test-token');
  expect(storage.persistent).not.toContain('Authorization');
  await context.unroute('https://api.github.com/**');
  await context.setOffline(true);
  const apiAvailableOffline = await page.evaluate(async () => {
    try {
      await fetch('https://api.github.com/repos/scarletkc/Tebikae-dev/issues?state=all');
      return true;
    } catch {
      return false;
    }
  });
  expect(apiAvailableOffline).toBe(false);
});
