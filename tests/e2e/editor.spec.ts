import { expect, test } from '@playwright/test';
import { closeDialog, connect, mockGitHub, mockIssue } from './fixtures';

test('opening, focusing and switching Markdown modes preserves the original body without a write', async ({
  page,
  context,
}) => {
  const markdown = '*  Keep   this spacing\n\n[Link](https://example.com/path)\n';
  const state = await mockGitHub(context, [mockIssue(31, 'Original Markdown', markdown)]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Original Markdown', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown source body' })).toHaveValue(markdown);
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await closeDialog(page);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect(state.writes).toEqual([]);
});

test('language and theme updates keep the visual editor and undo history alive', async ({
  page,
  context,
}) => {
  await mockGitHub(context, [mockIssue(32, 'Keep the cursor', 'Original')]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Keep the cursor', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.evaluate((element) => element.setAttribute('data-session-marker', 'same-editor'));
  await editor.click();
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially(' plus 中文');
  await expect(editor).toContainText('Original plus 中文');
  const preferencesPage = await context.newPage();
  await preferencesPage.goto('/#/settings');
  await preferencesPage.locator('#language-setting').click();
  await preferencesPage.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
  await expect(preferencesPage.locator('#language-setting')).toHaveText('简体中文');
  await preferencesPage.evaluate(() => {
    localStorage.setItem('tebikae.theme', 'dark');
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '粗体', exact: true })).toBeVisible();
  await expect(editor).toHaveAttribute('data-session-marker', 'same-editor');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).toHaveText('Original');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(editor).toContainText('Original plus 中文');
  await page.getByRole('button', { name: '编辑 Markdown', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown 源码正文' })).toHaveValue(/Original plus 中文/);
  await preferencesPage.close();
});

test('task, code, link and table tools modify real Milkdown documents', async ({ page, context }) => {
  await mockGitHub(context, [mockIssue(33, 'Editing tools', 'A task')]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Editing tools', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle task list', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Mark task complete', exact: true }).check();
  await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Markdown source body' });
  await expect(source).toHaveValue(/\[x\] A task/);
  await source.fill('const message = "中文";');
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await page.getByRole('button', { name: 'More formatting options', exact: true }).click();
  // The searchable language input carries a datalist, so Chromium exposes it as a combobox.
  await page.getByRole('combobox', { name: 'Code language', exact: true }).fill('typescript');
  await page.getByRole('button', { name: 'Insert code block or update its language', exact: true }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveAttribute('data-language', 'typescript');
  await expect(page.locator('.ProseMirror pre')).toContainText('const message = "中文";');
  await page.getByRole('button', { name: 'Text style', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Paragraph', exact: true }).click();
  await page.getByRole('button', { name: 'Insert table', exact: true }).click();
  await expect(page.locator('.ProseMirror tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Add row below', exact: true }).click();
  await expect(page.locator('.ProseMirror tr')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add column after', exact: true }).click();
  await expect(page.locator('.ProseMirror tr').first().locator('th,td')).toHaveCount(4);
  await page.getByRole('button', { name: 'More table actions', exact: true }).click();
  // Row and column deletes keep the table menu open; deleting the table closes it.
  await page.getByRole('menuitem', { name: 'Delete current column', exact: true }).click();
  await expect(page.locator('.ProseMirror tr').first().locator('th,td')).toHaveCount(3);
  await page.getByRole('menuitem', { name: 'Delete current row', exact: true }).click();
  await expect(page.locator('.ProseMirror tr')).toHaveCount(3);
  await page.getByRole('menuitem', { name: 'Delete table', exact: true }).click();
  await expect(page.locator('.ProseMirror table')).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  // Closing the menu returns focus to the document, unless a click outside focused another control.
  const tableActions = page.getByRole('button', { name: 'More table actions', exact: true });
  await tableActions.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await tableActions.click();
  const title = page.getByRole('dialog').getByLabel('Title', { exact: true });
  await title.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(title).toBeFocused();
  await page.getByRole('button', { name: 'Insert or edit link', exact: true }).click();
  await page.getByLabel('Link address', { exact: true }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Apply link', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter an http, https, or mailto address.');
  await page.getByLabel('Link address', { exact: true }).fill('https://example.com/kept');
  await page.getByLabel('Link text (for new links)', { exact: true }).fill('Safe link');
  await page.getByRole('button', { name: 'Apply link', exact: true }).click();
  await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://example.com/kept');
});

test('on phones the table tools start their own row in the more formatting panel', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGitHub(context, [mockIssue(34, 'Phone tools', 'Body')]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Phone tools', exact: true }).click();
  await page.getByRole('button', { name: 'More formatting options', exact: true }).click();
  const panel = page.locator('.editor-expanded-tools .editor-toolbar');
  const first = (await panel.getByRole('button', { name: 'Strikethrough', exact: true }).boundingBox())!;
  const table = (await panel.locator('.editor-table-tools').boundingBox())!;
  // A new row that starts at the left edge, so no divider is left at the start of a row.
  expect(table.y).toBeGreaterThanOrEqual(first.y + first.height);
  expect(Math.abs(table.x - first.x)).toBeLessThanOrEqual(1);
  const panelBox = (await panel.boundingBox())!;
  expect(table.x + table.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
});

test('HTML stays in source and images never fetch external URLs', async ({ page, context }) => {
  const html =
    '<details><summary>Keep HTML</summary>Original contents</details>\n<script>window.executed = true</script>';
  const state = await mockGitHub(context, [
    mockIssue(34, 'Source preserved', html),
    mockIssue(
      35,
      'Private images',
      '![Private image](https://images.invalid/secret.png)\n\n```mermaid\n<script>literal</script>\n```',
    ),
  ]);
  const imageRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://images.invalid')) imageRequests.push(request.url());
  });
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Source preserved', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Markdown source body' });
  await expect(source).toHaveValue(html);
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await expect(source).toBeVisible();
  await expect(source).toHaveValue(html);
  await closeDialog(page);
  expect(state.writes).toEqual([]);
  await page.getByRole('button', { name: 'Edit note: Private images', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.editor-image-placeholder')).toContainText('Private image');
  await expect(page.locator('.ProseMirror img[src]')).toHaveCount(0);
  await expect(page.locator('.ProseMirror pre')).toContainText('<script>literal</script>');
  expect(await page.evaluate(() => Object.hasOwn(window, 'executed'))).toBe(false);
  expect(imageRequests).toEqual([]);
});

test('a 360px viewport keeps code, tables and the editing controls inside the screen', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await mockGitHub(context, [
    mockIssue(
      36,
      'A small screen',
      '| first | second | third |\n| --- | --- | --- |\n| one | two | three |\n\n```text\n' +
        'a long line '.repeat(50) +
        '\n```',
    ),
  ]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: A small screen', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown source body' })).toBeVisible();
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await closeDialog(page);
});
