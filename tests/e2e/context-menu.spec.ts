import { expect, test } from '@playwright/test';
import { connect, mockGitHub, mockIssue, closeDialog } from './fixtures';

test('card menu, mixed bulk labels and filtered selection persist through sync', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  const cards = page.locator('.note-card');
  await cards.first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Pin note', exact: true })).toBeVisible();
  await page.screenshot({ path: '.artifacts/context-menu-desktop.png' });
  await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
  await cards.nth(1).locator('.note-open').click();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await cards.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Note labels', exact: true }).hover();
  const mixed = page.getByRole('menuitemcheckbox', { name: 'Personal', exact: true });
  await expect(mixed).toHaveAttribute('aria-checked', 'mixed');
  await mixed.click();
  await expect(mixed).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect
    .poll(() =>
      remote.issues.filter((n) => n.number <= 2).every((n) => n.labels.some((l) => l.name === 'Personal')),
    )
    .toBe(true);
  await expect(page.getByRole('toolbar', { name: 'Note selection' })).toHaveCount(0);
  await page.locator('.sidebar').getByRole('button', { name: 'Ideas 2', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Add or remove Personal from filters' }).click();
  await expect(cards).toHaveCount(2);
});

test('label rename and deletion affect labels, not notes', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page
    .locator('.sidebar .label-nav-row')
    .first()
    .getByRole('button')
    .first()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename label' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Work');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => remote.labels[0]?.name).toBe('Work');
  await page
    .locator('.sidebar .label-nav-row')
    .first()
    .getByRole('button')
    .first()
    .click({ button: 'right' });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('2 notes');
    await dialog.accept();
  });
  await page.getByRole('menuitem', { name: 'Delete label', exact: true }).click();
  await expect(page.locator('.sidebar .label-nav-row')).toHaveCount(1);
  await expect(page.locator('.note-card')).toHaveCount(2);
  expect(remote.issues.filter((n) => n.number <= 2).every((n) => !n.labels.some((l) => l.id === 11))).toBe(
    true,
  );
});

test('editor source formatting and code language keep document content', async ({ page, context }) => {
  await mockGitHub(context, [
    mockIssue(31, 'Menu editing', 'Hello world\n\n```javascript\nconst x = 1;\n```'),
  ]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Menu editing' }).click();
  const language = page.locator('.code-block-header input');
  await expect(language).toHaveValue('javascript');
  await expect(language).toHaveAttribute('list', /.+/);
  await language.fill('gdscript');
  await language.press('Tab');
  await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Markdown source body' });
  await expect(source).toHaveValue(/```gdscript/);
  await source.focus();
  await source.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));
  await source.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Format' }).hover();
  await page.getByRole('menuitem', { name: 'Bold', exact: true }).click();
  await expect(source).toHaveValue(/^\*\*Hello\*\* world/);
  await closeDialog(page);
});

test('touch long press cancels on motion and opens a touch-sized menu without editing', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGitHub(context);
  await connect(page);
  const card = page.locator('.note-card').first();
  await card.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 60, clientY: 200 });
  await card.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 60, clientY: 220 });
  await page.waitForTimeout(600);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await card.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 60, clientY: 200 });
  await page.waitForTimeout(600);
  await expect(page.getByRole('menuitem', { name: 'Select', exact: true })).toBeVisible();
  await card.dispatchEvent('pointerup', { pointerType: 'touch' });
  await card.dispatchEvent('click');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: '.artifacts/context-menu-mobile.png' });
});

test('keyboard selection stays out of text fields and trash menus expose only recovery actions', async ({
  page,
  context,
}) => {
  await mockGitHub(context, [
    mockIssue(1, 'One'),
    mockIssue(2, 'Two'),
    mockIssue(3, 'Trash', 'Deleted', { trashedAt: '2026-09-17T00:00:00Z' }),
  ]);
  await connect(page);
  const cards = page.locator('.note-card');
  await cards
    .first()
    .locator('.note-open')
    .click({ modifiers: ['ControlOrMeta'] });
  await cards
    .nth(1)
    .locator('.note-open')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.note-card.is-selected')).toHaveCount(2);
  await page.screenshot({ path: '.artifacts/context-selection-desktop.png' });
  await page.getByLabel('Search your notes', { exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A');
  await expect(page.locator('.note-card.is-selected')).toHaveCount(2);
  await page.locator('.sidebar').getByRole('link', { name: 'Trash', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible();
  const trashCard = page.locator('.note-card', { hasText: 'Trash' });
  await expect(trashCard).toBeVisible();
  await trashCard.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Restore note', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Pin note', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Restore note', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(0);
});

test('visual selection, title and table menus operate on the correct context', async ({ page, context }) => {
  await mockGitHub(context, [
    mockIssue(1, 'Context editor', 'Hello world\n\n| A | B |\n| --- | --- |\n| C | D |'),
  ]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Context editor' }).click();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.focus();
  await title.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Select all text' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Bold' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const editor = page.locator('.ProseMirror');
  await editor.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  // ProseMirror flushes DOM selection changes on the next frame; typed keys can outrun it.
  await editor.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Format' }).hover();
  await page.getByRole('menuitem', { name: 'Bold', exact: true }).click();
  await expect(editor.locator('strong')).toContainText('Hello world');
  await editor.locator('td').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Table' })).toBeVisible();
  await page.screenshot({ path: '.artifacts/context-editor-table.png' });
  await page.getByRole('menuitem', { name: 'Table' }).hover();
  await page.getByRole('menuitem', { name: 'Add row below' }).click();
  await expect(editor.locator('tr')).toHaveCount(3);
});

test('Chinese dark menus fit narrow screens and mobile filter toggles retain the drawer', async ({
  page,
  context,
}) => {
  await mockGitHub(context);
  await connect(page);
  await page.evaluate(() => {
    for (const [key, value] of [
      ['tebikae.language', 'zh-CN'],
      ['tebikae.theme', 'dark'],
    ]) {
      localStorage.setItem(key!, value!);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    }
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.note-card').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '选择', exact: true })).toBeVisible();
  await page.screenshot({ path: '.artifacts/context-menu-desktop-dark-zh.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-menu').click();
  const drawer = page.locator('.mobile-drawer');
  await drawer.getByRole('button', { name: '将「Ideas」加入或移出组合筛选' }).click();
  await drawer.getByRole('button', { name: '将「Personal」加入或移出组合筛选' }).click();
  await expect(drawer).toBeVisible();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await drawer.locator('.label-nav-row').first().getByRole('button').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '重命名标签' })).toBeVisible();
  await page.screenshot({ path: '.artifacts/context-label-mobile-dark-zh.png' });
  const menu = await page.getByRole('menu').boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
});

test('nested task list reads and toggles innermost task state', async ({ page, context }) => {
  await mockGitHub(context, [
    mockIssue(
      32,
      'Nested tasks',
      '- [ ] Parent task\n  - [x] Child task\n\n- Normal list parent\n  - [ ] Child task 2\n\n- [x] Task parent 2\n  - Normal child',
    ),
  ]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Nested tasks' }).click();
  const editor = page.locator('.ProseMirror');

  // Case 1: Child task is checked [x], but parent is unchecked [ ]
  const child = editor.getByText('Child task', { exact: true });
  await child.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paragraph' }).hover();
  const incompleteItem = page.getByRole('menuitem', { name: 'Mark incomplete' });
  await expect(incompleteItem).toBeVisible();
  await incompleteItem.click();
  await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Markdown source body' });
  await expect(source).toHaveValue(/[*+-] \[ \] Parent task\s+[*+-] \[ \] Child task/);
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();

  // Case 2: Normal list parent with unchecked child task [ ]
  const child2 = editor.getByText('Child task 2', { exact: true });
  await child2.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paragraph' }).hover();
  const completeItem = page.getByRole('menuitem', { name: 'Mark complete' });
  await expect(completeItem).toBeVisible();
  await completeItem.click();
  await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  await expect(source).toHaveValue(/[*+-] Normal list parent\s+[*+-] \[x\] Child task 2/);
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();

  // Case 3: Task parent with normal child
  const normalChild = editor.getByText('Normal child', { exact: true });
  await normalChild.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paragraph' }).hover();
  await expect(page.getByRole('menuitem', { name: 'Mark complete' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Mark incomplete' })).toHaveCount(0);
  await editor.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await closeDialog(page);
});
