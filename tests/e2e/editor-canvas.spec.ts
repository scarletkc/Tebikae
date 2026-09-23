import { expect, test } from '@playwright/test';
import { closeDialog, connect, mockGitHub, mockIssue, mockLabels, noteAction, noteColor } from './fixtures';

test('selection tools format the selected text and preserve save, undo and source behavior', async ({
  page,
  context,
}) => {
  const state = await mockGitHub(context, [mockIssue(91, 'Quiet canvas', 'Select these words')]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Quiet canvas', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toHaveAttribute('role', 'textbox');
  await editor.locator('p').selectText();
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting', exact: true });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Bold (selection)', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('Select these words');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor.locator('strong')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('Select these words');
  await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  await expect(toolbar).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Markdown source body' })).toHaveValue(
    /^\*\*Select these words\*\*\n?$/,
  );
  await closeDialog(page);
  await expect.poll(() => state.issues[0]!.body).toContain('**Select these words**');
});

test('note menu, labels and color remain keyboard accessible on a small dark canvas', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const state = await mockGitHub(context, [
    mockIssue(
      92,
      'Small canvas',
      'A calm place to write.',
      { color: 'yellow' },
      { labels: [mockLabels[0]!] },
    ),
  ]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Small canvas', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const dialog = page.getByRole('dialog');
  const menu = dialog.getByRole('button', { name: 'More actions', exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Archive note', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(dialog).toBeVisible();
  await page.getByLabel('Choose labels', { exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Personal', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Choose labels', { exact: true })).toBeFocused();
  await expect(dialog).toBeVisible();
  await noteColor(page, 'Sky');
  await expect(dialog).toHaveClass(/note-blue/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await dialog.boundingBox();
  expect(box?.width).toBe(360);
  await noteAction(page, 'Archive note');
  await closeDialog(page);
  await expect.poll(() => state.issues[0]!.state).toBe('closed');
  expect(state.issues[0]!.labels.map((label) => label.name)).toContain('Personal');
  expect(state.issues[0]!.body).toContain('"color":"blue"');
});
