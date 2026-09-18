import { expect } from '@playwright/test';
import { test } from './fixtures';
import { connect, mockGitHub } from '../e2e/fixtures';
import { blockGitHubAfterReload } from './network';

test('update waiting preserves the open editor until the user saves and accepts it', async ({
  page,
  context,
  outageServer,
}) => {
  await mockGitHub(context);
  await connect(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.unroute('https://api.github.com/**');
  await blockGitHubAfterReload(context);
  await page.reload();
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible();
  await page.locator('.ProseMirror[contenteditable="true"]').fill('Keep this draft through an app update.');
  await page.evaluate(() => {
    (window as unknown as { updateTestMarker: string }).updateTestMarker = 'same-document';
  });
  outageServer!.workerRevision++;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await expect(page.getByRole('dialog').getByText('An update is ready', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(
    await page.evaluate(() => (window as unknown as { updateTestMarker?: string }).updateTestMarker),
  ).toBe('same-document');
  await expect(page.locator('.ProseMirror')).toContainText('Keep this draft through an app update.');
  await page
    .locator('.ProseMirror[contenteditable="true"]')
    .fill('A final edit immediately before accepting the update.');
  await page.getByRole('dialog').getByRole('button', { name: 'Save drafts and update', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText(
    'A final edit immediately before accepting the update.',
  );
  expect(
    await page.evaluate(() => (window as unknown as { updateTestMarker?: string }).updateTestMarker),
  ).toBeUndefined();
});

test('the settings force-update button clears caches, reloads and keeps the saved session', async ({
  page,
}) => {
  await mockGitHub(page.context());
  await connect(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.locator('.sidebar').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Update TebiKae', exact: true }).click();
  await page.waitForURL(/v=/, { timeout: 30_000 });
  // The remembered session restores the workspace without the connect form.
  await expect(page.getByRole('textbox', { name: 'Search your notes' })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => page.evaluate(() => caches.keys().then((keys) => keys.length)), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(
      async () => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((all) => all.length)),
      { timeout: 30_000 },
    )
    .toBe(1);
});
