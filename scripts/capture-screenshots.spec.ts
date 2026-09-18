import { expect, test } from '@playwright/test';
import { connect, mockGitHub, mockIssue } from '../tests/e2e/fixtures';

const out = (name: string) => `screenshots/pr13/${name}.png`;

test('generate all required screenshots for PR 13', async ({ page, context }) => {
  test.setTimeout(90_000);
  // --- Scenario 1: Desktop 1280x720, Light Theme, English ---
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockGitHub(context, [
    mockIssue(
      1,
      'Weekend ideas',
      'A few thoughts for the weekend.',
      {},
      {
        labels: [{ id: 11, name: 'Ideas', color: 'b1c6b0', description: null }],
      },
    ),
    mockIssue(
      2,
      'Project plan',
      'Long term roadmap and details.',
      {},
      {
        labels: [{ id: 12, name: 'Personal', color: 'dec8a7', description: null }],
      },
    ),
    mockIssue(
      3,
      'Editor table demo',
      'Hello world text\n\n| Item | Status |\n| --- | --- |\n| Task A | Done |\n\n```typescript\nconst x = 1;\n```',
    ),
  ]);
  await connect(page);

  // 1. Desktop card menu
  const cards = page.locator('.note-card');
  await cards.first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Pin note', exact: true })).toBeVisible();
  await page.screenshot({ path: out('desktop-light-card-menu') });
  await page.keyboard.press('Escape');

  // 2. Desktop multi-selection toolbar
  await cards.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
  await cards.nth(1).locator('.note-open').click();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.screenshot({ path: out('desktop-light-multi-select') });

  // 3. Desktop blank area menu
  await page.getByRole('toolbar', { name: 'Note selection' }).getByRole('button', { name: 'Close' }).click();
  await page.locator('.main-content').click({ button: 'right', position: { x: 500, y: 350 } });
  await expect(page.getByRole('menuitem', { name: 'New note', exact: true })).toBeVisible();
  await page.screenshot({ path: out('desktop-light-blank-menu') });
  await page.keyboard.press('Escape');

  // 4. Desktop editor menu & table
  await page.getByRole('button', { name: 'Edit note: Editor table demo' }).click();
  const editor = page.locator('.ProseMirror');
  await editor.locator('p').first().selectText();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Format' })).toBeVisible();
  await page.screenshot({ path: out('desktop-light-editor-menu') });
  await page.keyboard.press('Escape');

  // 5. Desktop editor table menu
  await editor.locator('td').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Table' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Table' }).hover();
  await expect(page.getByRole('menuitem', { name: 'Add row below' })).toBeVisible();
  await page.screenshot({ path: out('desktop-light-editor-table') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();

  // 6. Desktop settings force update button
  await page.locator('.sidebar').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Update Tebikae', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Update Tebikae', exact: true })).toBeVisible();
  await page.screenshot({ path: out('desktop-light-settings-update') });

  // --- Scenario 2: Desktop 1280x720, Dark Theme, Simplified Chinese ---
  await page.evaluate(() => {
    localStorage.setItem('tebikae.language', 'zh-CN');
    localStorage.setItem('tebikae.theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'tebikae.language', newValue: 'zh-CN' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'tebikae.theme', newValue: 'dark' }));
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // 7. Desktop dark Chinese settings update button
  await page.getByRole('button', { name: '更新 Tebikae', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '更新 Tebikae', exact: true })).toBeVisible();
  await page.screenshot({ path: out('desktop-dark-zh-settings-update') });

  // 8. Desktop dark Chinese card menu
  await page.locator('.sidebar a[href$="#/notes"]').click();
  await cards.first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '置顶笔记', exact: true })).toBeVisible();
  await page.screenshot({ path: out('desktop-dark-zh-card-menu') });
  await page.keyboard.press('Escape');

  // 9. Desktop dark Chinese editor menu
  await page.getByRole('button', { name: '编辑笔记: Editor table demo' }).click();
  await editor.locator('p').first().selectText();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: '格式' })).toBeVisible();
  await page.screenshot({ path: out('desktop-dark-zh-editor-menu') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();

  // --- Scenario 3: Mobile 390x844, Dark Theme, Chinese ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-menu').click();
  const drawer = page.locator('.mobile-drawer');
  await expect(drawer).toBeVisible();
  await drawer.locator('.label-nav-row').first().getByRole('button').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '重命名标签' })).toBeVisible();
  await page.screenshot({ path: out('mobile-dark-zh-label-menu') });
  await page.keyboard.press('Escape');

  // 10. Mobile dark Chinese settings update
  await drawer.getByRole('link', { name: '设置' }).click();
  await page.getByRole('button', { name: '更新 Tebikae', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '更新 Tebikae', exact: true })).toBeVisible();
  await page.screenshot({ path: out('mobile-dark-zh-settings-update') });

  // --- Scenario 4: Mobile 390x844, Light Theme, English ---
  await page.evaluate(() => {
    localStorage.setItem('tebikae.language', 'en');
    localStorage.setItem('tebikae.theme', 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'tebikae.language', newValue: 'en' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'tebikae.theme', newValue: 'light' }));
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // 11. Mobile light English settings update
  await page.getByRole('button', { name: 'Update Tebikae', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Update Tebikae', exact: true })).toBeVisible();
  await page.screenshot({ path: out('mobile-light-en-settings-update') });

  // 12. Mobile light English multi-select toolbar
  await page.locator('.mobile-menu').click();
  await drawer.locator('a[href$="#/notes"]').click();
  await cards.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
  await cards.nth(1).locator('.note-open').click();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.screenshot({ path: out('mobile-light-en-multi-select') });
});
