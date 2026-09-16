import { expect, test } from '@playwright/test';
import { connect, mockGitHub } from './fixtures';

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
