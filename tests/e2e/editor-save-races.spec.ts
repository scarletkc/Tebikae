import { expect, test } from '@playwright/test';
import { closeDialog, connect, mockGitHub, mockIssue } from './fixtures';

for (const mode of ['title', 'markdown', 'invalid-title'] as const) {
  const invalid = mode === 'invalid-title';
  test(`navigation preserves ${mode} input during a delayed save`, async ({ page, context }) => {
    const remote = await mockGitHub(context, [
      mockIssue(1, 'A first'),
      mockIssue(2, 'B second'),
      mockIssue(3, 'C third'),
    ]);
    let release!: () => void;
    let started = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route('https://api.github.com/repos/scarletkc/Tebikae-dev/issues/1', async (route) => {
      if (route.request().method() === 'PATCH' && !started) {
        started = true;
        await gate;
      }
      await route.fallback();
    });
    try {
      await connect(page);
      await page.locator('select[aria-label]').first().selectOption('title');
      await page.getByRole('button', { name: 'Edit note: A first', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Title', { exact: true }).fill('A first saved');
      const next = dialog.getByRole('button', { name: 'Next note', exact: true });
      await next.click();
      await expect.poll(() => started).toBe(true);
      await next.click();
      const latestTitle = invalid ? 'a'.repeat(125) : 'A latest edit';
      if (mode === 'markdown') await dialog.locator('.ProseMirror').fill('Latest buffered Markdown');
      else await dialog.getByLabel('Title', { exact: true }).fill(latestTitle);
      release();
      if (invalid) {
        await expect(dialog.locator('.note-save-row').getByRole('status')).toHaveClass(/danger/);
        await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(latestTitle);
        expect(remote.issues[0]!.title).toBe('A first saved');
        await dialog.getByLabel('Title', { exact: true }).fill('A recovered edit');
        await next.click();
        await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('B second');
        await expect.poll(() => remote.issues[0]!.title).toBe('A recovered edit');
      } else {
        await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('B second');
        await closeDialog(page);
        if (mode === 'markdown') {
          await expect.poll(() => remote.issues[0]!.body).toContain('Latest buffered Markdown');
          await page.getByRole('button', { name: 'Edit note: A first saved', exact: true }).click();
          await expect(page.getByRole('dialog').locator('.ProseMirror')).toContainText(
            'Latest buffered Markdown',
          );
        } else {
          await expect(
            page.getByRole('button', { name: 'Edit note: A latest edit', exact: true }),
          ).toBeVisible();
          await expect.poll(() => remote.issues[0]!.title).toBe('A latest edit');
        }
        expect(
          remote.writes.filter((write) => write.method === 'PATCH' && !write.path.endsWith('/1')),
        ).toHaveLength(0);
      }
    } finally {
      release();
    }
  });
}

test('a delayed navigation cannot replace a new editor opened by Ctrl/Cmd+N', async ({ page, context }) => {
  const remote = await mockGitHub(context, [mockIssue(1, 'A first'), mockIssue(2, 'B second')]);
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('https://api.github.com/repos/scarletkc/Tebikae-dev/issues/1', async (route) => {
    if (route.request().method() === 'PATCH' && !started) {
      started = true;
      await gate;
    }
    await route.fallback();
  });
  try {
    await connect(page);
    await page.locator('select[aria-label]').first().selectOption('title');
    await page.getByRole('button', { name: 'Edit note: A first', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title', { exact: true }).fill('A edited');
    await dialog.getByRole('button', { name: 'Next note', exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n');
    await expect(dialog).toHaveAccessibleName('New note');
    await dialog.getByLabel('Title', { exact: true }).fill('New draft kept open');
    release();
    await expect.poll(() => remote.issues[0]!.title).toBe('A edited');
    // Let the pending close finish before checking that it did not replace the new editor.
    await page.waitForTimeout(250);
    await expect(dialog).toHaveAccessibleName('New note');
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('New draft kept open');
    await closeDialog(page);
    await expect(
      page.getByRole('button', { name: 'Edit note: New draft kept open', exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});
