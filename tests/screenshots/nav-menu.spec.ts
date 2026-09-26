import { expect, test } from './fixtures';
import { mockIssue } from '../e2e/fixtures';

// The bottom nav renders only at phone width (<=760px); desktop runs still cover
// checked marks via the label submenu below.
const issues = () => [
  mockIssue(1, 'Weekend ideas', 'Visit the bookshop.', { color: 'yellow' }),
  mockIssue(9, 'Old draft', 'Let it go.', { trashedAt: '2026-09-15T08:00:00Z' }),
];

test('bottom-nav-notes-menu', async ({ page, openApp, text, capture }) => {
  const phone = page.viewportSize()!.width <= 760;
  test.skip(!phone, 'Bottom nav renders only at phone width');
  await openApp({ issues: issues() });
  const nav = page.locator('.bottom-nav');
  await expect(nav).toBeVisible();
  await nav
    .getByRole('link', { name: text('Notes', '笔记'), exact: true })
    .click({ button: 'right' });
  await capture();
  await expect(
    page.getByRole('menuitem', { name: text('New note', '新建笔记'), exact: true }),
  ).toBeVisible();
});

test('bottom-nav-trash-menu', async ({ page, openApp, text, capture }) => {
  const phone = page.viewportSize()!.width <= 760;
  test.skip(!phone, 'Bottom nav renders only at phone width');
  await openApp({ issues: issues() });
  const nav = page.locator('.bottom-nav');
  await expect(nav).toBeVisible();
  await nav
    .getByRole('link', { name: text('Trash', '回收站'), exact: true })
    .click({ button: 'right' });
  await capture();
  await expect(
    page.getByRole('menuitem', { name: text('Empty trash', '清空回收站'), exact: true }),
  ).toBeEnabled();
});

test('checked-item-marks', async ({ page, openApp, text, capture }) => {
  await openApp();
  await page
    .locator('.note-card')
    .filter({ hasText: 'Weekend ideas' })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: text('Labels', '标签'), exact: true }).hover();
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Personal', exact: true }),
  ).toBeVisible();
  await capture();
});
