import { expect, test } from '@playwright/test';
import { connect, mockGitHub, mockIssue, noteColor } from './fixtures';

test('an open editor preserves a remotely merged body through subsequent property edits', async ({
  page,
  context,
}) => {
  const state = await mockGitHub(context, [mockIssue(71, 'Concurrent editing', 'Original body')]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Concurrent editing', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  state.issues[0]!.body = state.issues[0]!.body.replace('Original body', 'New body from GitHub');
  state.issues[0]!.updated_at = new Date().toISOString();
  await noteColor(page, 'Sage');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.note-save-row').getByRole('status')).toHaveText('Synced to GitHub');
  await expect(page.getByRole('button', { name: 'Load the latest version', exact: true })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Changed title');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(() => state.issues[0]!.title).toBe('Changed title');
  expect(state.issues[0]!.body).toContain('New body from GitHub');
  await page.locator('.ProseMirror').fill('Editing my older text');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByText('Two versions need your attention', { exact: true })).toBeVisible();
  expect(state.issues[0]!.body).toContain('New body from GitHub');
});

test('a remote trash change makes the already-open editor read-only after merge', async ({
  page,
  context,
}) => {
  const state = await mockGitHub(context, [mockIssue(72, 'Moved remotely', 'Keep this text')]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Moved remotely', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  state.issues[0]!.body = state.issues[0]!.body.replace(
    '"trashedAt":null',
    '"trashedAt":"2026-09-16T01:00:00.000Z"',
  );
  await noteColor(page, 'Sky');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.note-save-row').getByRole('status')).toHaveText('Synced to GitHub');
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
  await page.getByRole('dialog').getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Restore note', exact: true })).toBeEnabled();
  expect(state.issues[0]!.body).toContain('Keep this text');
});

test('a failed IndexedDB write keeps text in the editor and offers an emergency export', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'notes' && (window as unknown as { failLocalSave?: boolean }).failLocalSave)
        throw new DOMException('Storage full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  const state = await mockGitHub(context, [mockIssue(73, 'Storage failure', 'Before failure')]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Storage failure', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { failLocalSave: boolean }).failLocalSave = true;
  });
  await page.locator('.ProseMirror').fill('Only copy of this new text 中文');
  await expect(page.getByRole('alert')).toContainText('Couldn’t save on this device.');
  await expect(page.locator('.note-save-row').getByRole('status')).not.toHaveText('Synced to GitHub');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.ProseMirror')).toContainText('Only copy of this new text 中文');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download unsaved text', exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString('utf8')).toContain('Only copy of this new text 中文');
  expect(state.writes).toEqual([]);
});
