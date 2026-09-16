import { expect, test } from '@playwright/test';
import { closeDialog, connect, mockGitHub } from './fixtures';

for (const code of [401, 429]) {
  test(`workspace reports a ${code} write failure even when reads succeed`, async ({
    page,
    context,
  }, info) => {
    const remote = await mockGitHub(context);
    await connect(page);
    let writes = 0;
    await context.route('https://api.github.com/repos/scarletkc/Tebikae-dev/issues/1', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      writes++;
      await route.fulfill({
        status: code,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'retry-after',
          'retry-after': '120',
        },
        contentType: 'application/json',
        body: JSON.stringify({ message: code === 401 ? 'Bad credentials' : 'Rate limit exceeded' }),
      });
    });
    await page.locator('.note-card').filter({ hasText: 'Weekend ideas' }).locator('.note-open').click();
    await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Unsynced write');
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await closeDialog(page);
    const status = page.locator('.workspace-status');
    await expect(status).toHaveClass(code === 401 ? /status-error/ : /status-warning/);
    await expect(status).toHaveAccessibleName(/1 notifications/);
    await status.click();
    const menu = page.locator('.workspace-status-menu');
    await expect(menu).toContainText(
      code === 401 ? '1 notes: Connection expired' : '1 notes: Waiting for GitHub',
    );
    await expect(menu).not.toContainText('Everything is up to date');
    await page.screenshot({ path: info.outputPath(`write-${code}.png`) });
    if (code === 401) {
      await menu.getByRole('menuitem', { name: 'Connect repository', exact: true }).click();
      await expect(
        page.getByRole('dialog').getByLabel('Personal access token', { exact: true }),
      ).toBeVisible();
    } else {
      await expect(menu).toContainText('Retry after');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(status).toHaveClass(/status-warning/);
      expect(writes).toBe(1);
      await status.click();
      await menu.getByRole('menuitem', { name: 'Review notes', exact: true }).click();
      await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue(
        'Unsynced write',
      );
    }
    expect(remote.issues.find((issue) => issue.number === 1)?.title).toBe('Weekend ideas');
  });
}

test('workspace reports a local-only draft and opens it for syncing', async ({ page, context }, info) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page.evaluate(async () => {
    const commandsPath = '/src/application/commands.ts';
    const storagePath = '/src/storage/db.ts';
    const { createNote } = await import(commandsPath);
    const { db } = await import(storagePath);
    const existing = await db.notes.toCollection().first();
    const document = structuredClone(existing.current);
    document.title = 'Local-only draft';
    document.meta.id = crypto.randomUUID();
    await createNote(existing.scopeId, document);
  });
  const status = page.locator('.workspace-status');
  await expect(status).toHaveClass(/status-info/);
  await expect(status).toHaveAccessibleName(/1 notifications/);
  await status.click();
  const menu = page.locator('.workspace-status-menu');
  await expect(menu).toContainText('1 notes: Saved to this device');
  await page.screenshot({ path: info.outputPath('local-draft.png') });
  await menu.getByRole('menuitem', { name: 'Review notes', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue('Local-only draft');
  expect(remote.writes).toHaveLength(0);
});

test('status button combines counts, loading, warnings and errors outside the note list', async ({
  page,
  context,
}, testInfo) => {
  await mockGitHub(context);
  await connect(page);
  const status = page.locator('.workspace-status');
  await expect(status).toHaveClass(/status-normal/);
  await expect(status).toContainText('0');
  await expect(page.locator('.view-toggle + .workspace-status')).toHaveCount(1);
  await expect(
    page.locator('.main-content .loading-notice, .results-toolbar, .main-content .banner'),
  ).toHaveCount(0);
  await status.click();
  await expect(page.locator('.workspace-status-menu')).toContainText('2 notes');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await context.setOffline(true);
  await expect(status).toHaveClass(/status-warning/);
  await status.click();
  await expect(page.locator('.workspace-status-menu')).toContainText('You’re offline');
  await page.screenshot({ path: testInfo.outputPath('status-warning.png') });
  await page.keyboard.press('Escape');
  await context.setOffline(false);
  await expect(status).toHaveClass(/status-normal/);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('https://api.github.com/**/issues?*', async (route) => {
    await gate;
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(status).toHaveAttribute('data-loading', 'true');
  await expect(status).toHaveClass(/status-progress/);
  await status.click();
  await expect(page.locator('.workspace-status-menu')).toContainText('Loading Issues');
  release();
  await page.keyboard.press('Escape');
  await expect(status).toHaveAttribute('data-loading', 'false');
  await context.route('https://api.github.com/**/issues?*', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Bad credentials' }),
    }),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(status).toHaveClass(/status-error/);
  await context.setOffline(true);
  await status.click();
  await expect(page.locator('.workspace-status-entry').first()).toHaveClass(/status-error/);
  await expect(page.locator('.workspace-status-menu')).toContainText('You’re offline');
  await page.screenshot({ path: testInfo.outputPath('status-error.png') });
  await context.setOffline(false);
});
