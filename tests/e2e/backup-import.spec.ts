import { expect, test, type Page } from '@playwright/test';
import { connect, mockGitHub } from './fixtures';

test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });

async function capture(page: Page, name: string) {
  if (page.context().browser()?.browserType().name() === 'chromium')
    await page.screenshot({ path: `.artifacts/import-review/${name}.png`, scale: 'css' });
}

function backup() {
  const note = (number: number, title: string, patch: Record<string, unknown> = {}) => ({
    issueId: 9000 + number,
    issueNumber: 9000 + number,
    scopeId: 'foreign-account',
    current: {
      title,
      markdown: `Backup body ${number}. 原始正文。`,
      archived: false,
      labelIds: [71],
      meta: {
        schemaVersion: 1,
        id: `16f66da6-2d3a-4f05-a21b-${String(number).padStart(12, '0')}`,
        kind: 'markdown',
        color: 'blue',
        pinned: false,
        trashedAt: null as string | null,
      },
      ...patch,
    },
  });
  const trash = note(23, 'Recovered trash');
  trash.current.meta.trashedAt = '2026-09-01T00:00:00Z';
  return {
    format: 'issue-notes-export',
    schemaVersion: 1,
    source: { repository: 'example/backup-notes' },
    notes: [
      note(21, 'Recovered active'),
      note(22, 'Recovered archive', { archived: true }),
      trash,
      note(24, 'Invalid record', { markdown: null }),
      note(25, 'Unmatched label', { labelIds: [72] }),
    ],
    labels: [
      { id: 71, name: 'Ideas' },
      { id: 72, name: 'Old notebook label' },
    ],
    attempts: [{ kind: 'create', status: 'sending' }],
    credentials: 'untrusted-backup-token',
  };
}
async function openImport(page: Page) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Import JSON backup', exact: true }).click();
  return page.getByRole('dialog');
}
async function choose(page: Page, value: unknown = backup()) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'notebook-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByText(/available · .*invalid/)).toBeVisible();
}

test('previews without writes, restores selected copies, preserves labels and archive, and skips reimport', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  const originals = structuredClone(remote.issues);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Your data', exact: true })
    .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await capture(page, 'settings-after-desktop-en');
  await page.getByRole('button', { name: 'Import JSON backup', exact: true }).click();
  await capture(page, 'import-empty-desktop-en');
  await choose(page);
  await expect(page.getByText('4 available · 0 already imported or repeated · 1 invalid')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Recovered trash', exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Import selected (3)', exact: true })).toBeDisabled();
  await page.getByText('Skipped invalid records (1)', { exact: true }).click();
  await capture(page, 'import-preview-desktop-en');
  await page.getByRole('button', { name: 'Import selected (3)', exact: true }).scrollIntoViewIfNeeded();
  await capture(page, 'import-preview-bottom-desktop-en');
  await page.getByRole('checkbox', { name: 'Unmatched label', exact: true }).uncheck();
  expect(remote.writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Import selected (2)', exact: true }).click();
  await expect(page.getByText('Saved 2 new local notes. Skipped 0 records already imported.')).toBeVisible();
  await capture(page, 'import-success-desktop-en');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  // A manual sync flushes the second imported note without waiting for background throttling.
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect
    .poll(() => remote.issues.find((issue) => issue.title === 'Recovered archive')?.state)
    .toBe('closed');
  await expect.poll(() => remote.issues.some((issue) => issue.title === 'Recovered active')).toBe(true);
  const active = remote.issues.find((issue) => issue.title === 'Recovered active')!;
  expect(active.labels.map((label) => label.id)).toEqual([11]);
  expect(
    remote.writes.filter((request) => request.method === 'POST' && request.path.endsWith('/issues')),
  ).toHaveLength(2);
  expect(remote.issues.slice(0, originals.length)).toEqual(originals);
  expect(JSON.stringify(remote.writes)).not.toContain('untrusted-backup-token');
  await openImport(page);
  await choose(page);
  await expect(page.getByRole('checkbox', { name: 'Recovered active', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Recovered archive', exact: true })).toBeDisabled();
});

test('malformed files show errors and a second file can be selected', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await openImport(page);
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
  await capture(page, 'import-error-desktop-en');
  await choose(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(remote.writes).toHaveLength(0);
});

test('offline import persists drafts and imports trash only with explicit selection', async ({
  page,
  context,
  browserName,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  if (browserName === 'webkit') {
    // Native offline emulation in Windows WebKit also breaks File/Blob reads.
    // Abort real network requests while leaving local file access available.
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      dispatchEvent(new Event('offline'));
    });
  } else await context.setOffline(true);
  expect(
    await page.evaluate(() =>
      fetch('/uncached-import-probe').then(
        () => true,
        () => false,
      ),
    ),
  ).toBe(false);
  await openImport(page);
  await choose(page);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Recovered trash', exact: true }).check();
  await page.getByRole('button', { name: 'Import selected (1)', exact: true }).click();
  await expect(page.getByText('Saved 1 new local notes. Skipped 0 records already imported.')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('link', { name: 'Trash', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit note: Recovered trash', exact: true })).toBeVisible();
  expect(remote.writes).toHaveLength(0);
});

test('missing labels require acknowledgement and importing does not create remote labels', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await openImport(page);
  await choose(page);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Unmatched label', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Import selected (1)' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Import without the unmatched labels', exact: true }).check();
  await page.getByRole('button', { name: 'Import selected (1)' }).click();
  await expect.poll(() => remote.issues.some((issue) => issue.title === 'Unmatched label')).toBe(true);
  expect(remote.issues.find((issue) => issue.title === 'Unmatched label')!.labels).toEqual([]);
  expect(remote.writes.some((request) => request.path.endsWith('/labels'))).toBe(false);
});

test('Chinese dark mobile preview remains scrollable and keyboard dismissal works', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await mockGitHub(context);
  await connect(page);
  await openImport(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#theme-setting').selectOption('dark');
  await page.locator('#language-setting').click();
  await page.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
  await page.getByRole('button', { name: '导入 JSON 备份', exact: true }).scrollIntoViewIfNeeded();
  await capture(page, 'settings-mobile-zh-dark-after');
  await page.getByRole('button', { name: '导入 JSON 备份', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: '备份.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup())),
  });
  await expect(page.getByText('4 篇可导入 · 0 篇已导入或重复 · 1 条无效记录')).toBeVisible();
  await capture(page, 'import-mobile-zh-dark-top');
  const button = page.getByRole('button', { name: '导入选中项（3）', exact: true });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  await capture(page, 'import-mobile-zh-dark-bottom');
  const dialog = await page.getByRole('dialog').boundingBox();
  expect(dialog!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('selection survives preview pagination and empty backups cannot be imported', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await openImport(page);
  await choose(page, { ...backup(), notes: [] });
  await expect(page.getByRole('button', { name: 'Import selected (0)', exact: true })).toBeDisabled();
  const source = backup();
  source.notes = Array.from({ length: 26 }, (_, index) => ({
    ...source.notes[0]!,
    current: { ...source.notes[0]!.current, title: `Paged note ${index + 1}` },
  }));
  await choose(page, source);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Paged note 1', exact: true }).check();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Paged note 26', exact: true }).check();
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Paged note 1', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Import selected (2)', exact: true })).toBeEnabled();
  expect(remote.writes).toHaveLength(0);
});

test('another tab cannot import while the notebook is locked for editing', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  const second = await context.newPage();
  await second.goto('/#/settings');
  await expect(second.getByRole('button', { name: 'Import JSON backup', exact: true })).toBeDisabled();
  await second.close();
});

test('a failed import rolls back every note and explains the outcome in Chinese', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await openImport(page);
  await choose(page);
  await page.getByRole('checkbox', { name: 'Unmatched label', exact: true }).uncheck();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'outbox') {
        IDBObjectStore.prototype.add = original;
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
    localStorage.setItem('tebikae.language', 'zh-CN');
    dispatchEvent(new StorageEvent('storage', { key: 'tebikae.language', newValue: 'zh-CN' }));
  });
  await page.getByRole('button', { name: '导入选中项（2）', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    '导入保存失败，本次未导入任何笔记。请释放设备存储空间后重试。',
  );
  await page.getByRole('alert').scrollIntoViewIfNeeded();
  await capture(page, 'import-storage-error-desktop-zh');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByRole('alert').scrollIntoViewIfNeeded();
  await capture(page, 'import-storage-error-mobile-zh');
  expect(remote.writes).toEqual([]);
  const localCount = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('tebikae');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('notes', 'readonly');
          const count = transaction.objectStore('notes').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
          transaction.oncomplete = () => database.close();
        };
      }),
  );
  expect(localCount).toBe(3);
});
