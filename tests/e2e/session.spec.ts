import { expect, test, type Page } from '@playwright/test';
import { connect, mockGitHub } from './fixtures';

async function savedRecords(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tebikae-session');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = database.transaction('sessions').objectStore('sessions').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

test('reopening a tab restores the encrypted connection and sends only reads', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  expect(await savedRecords(page)).toBe(1);
  const encrypted = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('tebikae-session');
      request.onsuccess = () => resolve(request.result);
    });
    const record = await new Promise<{
      key: CryptoKey;
      iv: Uint8Array;
      ciphertext: ArrayBuffer;
    }>((resolve) => {
      const request = database.transaction('sessions').objectStore('sessions').get('active');
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    let exportable = false;
    try {
      await crypto.subtle.exportKey('raw', record.key);
      exportable = true;
    } catch {
      /* Non-extractable browser key. */
    }
    return {
      exportable,
      extractable: record.key.extractable,
      algorithm: record.key.algorithm,
      ivLength: record.iv.byteLength,
      stored: JSON.stringify(record) + new TextDecoder().decode(record.ciphertext),
    };
  });
  expect(encrypted.exportable).toBe(false);
  expect(encrypted.extractable).toBe(false);
  expect(encrypted.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
  expect(encrypted.ivLength).toBe(12);
  expect(encrypted.stored).not.toContain('browser-test-token');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByLabel('Search your notes', { exact: true })).toBeVisible();
  await expect(reopened.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(reopened.locator('.note-card')).toHaveCount(2);
  expect(remote.requests.filter((request) => request.path === '/user')).toHaveLength(2);
  expect(remote.writes).toHaveLength(0);
});

test('leaving remember unchecked keeps credentials only in the current tab', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page, false);
  expect(await savedRecords(page)).toBe(0);
  await page.locator('a[href$="#/settings"]').click();
  await expect(page.getByText('This connection is not saved.', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  await expect(
    page.getByRole('checkbox', { name: 'Remember this connection in this browser' }),
  ).not.toBeChecked();
});

test('disconnect forgets the connection and keeps cached notes available', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  await page.locator('a[href$="#/settings"]').click();
  await page.getByRole('button', { name: 'Disconnect GitHub', exact: true }).click();
  await expect.poll(() => savedRecords(page)).toBe(0);
  await page.reload();
  await expect(page.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'scarletkc/Tebikae-dev', exact: true }).click();
  await page.locator('a[href$="#/notes"]').click();
  await expect(page.locator('.note-card')).toHaveCount(2);
});

test('expired credentials are forgotten while the notebook stays available', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await context.route('https://api.github.com/user', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Bad credentials"}' }),
  );
  await page.reload();
  await expect(page.locator('.workspace-status')).toHaveClass(/status-error/);
  await page.locator('.workspace-status').click();
  await expect(page.locator('.workspace-status-menu')).toContainText('Your token has expired or is invalid.');
  await expect.poll(() => savedRecords(page)).toBe(0);
  await expect(page.locator('.note-card')).toHaveCount(2);
  await page
    .locator('.workspace-status-entry.status-error')
    .getByRole('menuitem', { name: 'Connect repository', exact: true })
    .click();
  await expect(page.getByLabel('GitHub repository', { exact: true })).toHaveValue('scarletkc/Tebikae-dev');
  await expect(page.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  expect(remote.writes).toHaveLength(0);
});

test('a temporary network failure preserves the saved connection for automatic retry', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await context.route('https://api.github.com/user', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.locator('.workspace-status')).toHaveClass(/status-error/);
  await expect(page.locator('.note-card')).toHaveCount(2);
  expect(await savedRecords(page)).toBe(1);
  await context.unroute('https://api.github.com/user');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(page.locator('.workspace-status')).toHaveClass(/status-normal/);
  expect(remote.writes).toHaveLength(0);
});

test('disconnect during automatic validation cannot restore the forgotten session', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('https://api.github.com/user', async (route) => {
    await pending;
    await route.fallback();
  });
  await page.reload();
  await page.locator('a[href$="#/settings"]').click();
  await page.getByRole('button', { name: 'Disconnect GitHub', exact: true }).click();
  await expect.poll(() => savedRecords(page)).toBe(0);
  release();
  await expect(page.getByRole('button', { name: 'Connect repository', exact: true }).last()).toBeVisible();
  await context.unroute('https://api.github.com/user');
  await page.reload();
  await expect(page.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  expect(await savedRecords(page)).toBe(0);
  expect(remote.writes).toHaveLength(0);
});

test('encryption failure keeps the connection usable and explains that it was not saved', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    crypto.subtle.encrypt = () => Promise.reject(new Error('Encryption unavailable'));
  });
  await mockGitHub(context);
  await connect(page);
  await page.locator('.workspace-status').click();
  await expect(page.locator('.workspace-status-menu')).toContainText('couldn’t save the connection securely');
  expect(await savedRecords(page)).toBe(0);
  await page.reload();
  await expect(page.getByLabel('Personal access token', { exact: true })).toHaveValue('');
});

test('clearing device data also removes the saved credentials', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  await page.locator('a[href$="#/settings"]').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear this device’s data', exact: true }).click();
  await expect(page.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  expect(await savedRecords(page)).toBe(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'scarletkc/Tebikae-dev', exact: true })).toHaveCount(0);
});
