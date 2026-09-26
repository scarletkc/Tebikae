import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { closeDialog, confirmPrompt, noteAction, connect, mockGitHub } from './fixtures';

test(
  'connect and unchanged reading keep existing Issues intact',
  { tag: '@smoke' },
  async ({ page, context }) => {
    const remote = await mockGitHub(context);
    await connect(page);
    await expect(page.locator('.note-card')).toHaveCount(2);
    await expect(page.getByText('Hidden pull request', { exact: true })).toHaveCount(0);
    expect(remote.writes).toHaveLength(0);
    const initialBody = remote.issues[0]!.body;
    await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
    await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
    await closeDialog(page);
    expect(remote.writes).toHaveLength(0);
    expect(remote.issues[0]!.body).toBe(initialBody);
  },
);

test(
  'a visual draft is saved locally, synced once, and available after automatic reconnection',
  { tag: '@smoke' },
  async ({ page, context }) => {
    const remote = await mockGitHub(context);
    await connect(page);
    await page.getByRole('button', { name: 'New note', exact: true }).first().click();
    await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('A fresh browser note');
    await page
      .locator('.ProseMirror[contenteditable="true"]')
      .fill('Written in the visual editor. 中文内容。');
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.locator('.note-save-row').getByRole('status')).toContainText('Synced to GitHub');
    expect(
      remote.writes.filter((request) => request.method === 'POST' && request.path.endsWith('/issues')),
    ).toHaveLength(1);
    expect(remote.issues.find((issue) => issue.title === 'A fresh browser note')?.body).toContain('中文内容');
    await closeDialog(page);
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Edit note: A fresh browser note', exact: true }),
    ).toBeVisible();
    const storage = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    );
    expect(storage).not.toContain('browser-test-token');
  },
);

test('editor debounce stays local until close, and close syncs only that note', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Edited on close');
  await page.waitForTimeout(2_300);
  expect(remote.writes.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  await closeDialog(page);
  await expect.poll(() => remote.issues[0]!.title).toBe('Edited on close');
  expect(remote.writes.filter((request) => request.method === 'PATCH')).toHaveLength(1);
});

test('Ctrl/Cmd+S immediately syncs the current editor', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Saved with shortcut');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+s`);
  await expect.poll(() => remote.issues[0]!.title).toBe('Saved with shortcut');
  expect(remote.writes.filter((request) => request.method === 'PATCH')).toHaveLength(1);
});

test(
  'offline input persists locally and reopens without entering a token',
  { tag: '@smoke' },
  async ({ page, context }) => {
    const remote = await mockGitHub(context);
    await connect(page);
    await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible();
    await context.setOffline(true);
    await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Edited while offline');
    await closeDialog(page);
    await expect(
      page.getByRole('button', { name: 'Edit note: Edited while offline', exact: true }),
    ).toBeVisible();
    expect(remote.issues[0]!.title).toBe('Weekend ideas');
    // Restore the saved connection when the dev shell can be loaded again.
    await context.setOffline(false);
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Edit note: Edited while offline', exact: true }),
    ).toBeVisible();
  },
);

test('trash then delete forever removes the Issue through GraphQL and does not resurrect on refresh', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  await noteAction(page, 'Move to trash');
  await closeDialog(page);
  await page.locator('a[href$="#/trash"]').click();
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  await noteAction(page, 'Delete forever');
  await confirmPrompt(page, false);
  await expect
    .poll(() => remote.writes.filter((write) => write.path === '/graphql').length, { timeout: 5_000 })
    .toBe(0);
  expect(remote.issues.find((issue) => issue.number === 1)).toBeDefined();
  await noteAction(page, 'Delete forever');
  await confirmPrompt(page, true, 'Delete forever');
  await expect
    .poll(() => remote.writes.filter((write) => write.path === '/graphql').length, { timeout: 10_000 })
    .toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.note-card')).toHaveCount(0);
  expect(remote.issues.find((issue) => issue.number === 1)).toBeUndefined();
  const deletes = remote.writes.filter((write) => write.path === '/graphql');
  expect(deletes).toHaveLength(1);
  expect(deletes[0]!.method).toBe('POST');
  expect(JSON.stringify(deletes[0]!.body)).toContain('deleteIssue');
  expect(remote.writes.some((write) => write.method === 'DELETE')).toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true })).toHaveCount(0);
  await expect(page.locator('.note-card')).toHaveCount(0);
});

test('a failed forever deletion keeps the note in the trash', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page.locator('a[href$="#/archive"]').click();
  await page.getByRole('button', { name: 'Edit note: A finished thought', exact: true }).click();
  await noteAction(page, 'Move to trash');
  await closeDialog(page);
  await page.locator('a[href$="#/trash"]').click();
  await page.getByRole('button', { name: 'Edit note: A finished thought', exact: true }).click();
  remote.failNextDeleteIssue = true;
  const dialog = page.getByRole('dialog');
  await noteAction(page, 'Delete forever');
  await confirmPrompt(page, true, 'Delete forever');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await closeDialog(page);
  await page.locator('a[href$="#/trash"]').click();
  await expect(
    page.getByRole('button', { name: 'Edit note: A finished thought', exact: true }),
  ).toBeVisible();
  expect(remote.issues.find((issue) => issue.number === 3)).toBeDefined();
});

test('combined filters and preview navigation share the same result set', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ideas', { exact: true }).check();
  await dialog.getByLabel('Personal', { exact: true }).check();
  await closeDialog(page);
  await expect(page.locator('.note-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Previous note', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next note', exact: true })).toBeDisabled();
  await closeDialog(page);
  await page.locator('.search-box .search-clear-button').click();
  await expect(page.locator('.note-card')).toHaveCount(2);
  await page.getByLabel('Search your notes', { exact: true }).fill('tea');
  await page.getByLabel('Search your notes', { exact: true }).press('Enter');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Edit note: A little checklist', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.note-card mark')).toHaveText(['tea']);
});

test('archive survives trash and restore, and JSON export contains no credentials', async ({
  page,
  context,
}) => {
  await mockGitHub(context);
  await connect(page);
  await page.locator('a[href$="#/archive"]').click();
  await expect(page.locator('.app-topbar .new-note-button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit note: A finished thought', exact: true }).click();
  await noteAction(page, 'Move to trash');
  await closeDialog(page);
  await expect(page.locator('.note-card')).toHaveCount(0);
  await page.locator('a[href$="#/trash"]').click();
  await page.getByRole('button', { name: 'Edit note: A finished thought', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveAttribute('readonly', '');
  // The editor is open here; scope to it because the card behind keeps its own
  // restore control in the accessibility tree.
  await noteAction(page, 'Restore note');
  await closeDialog(page);
  await page.locator('a[href$="#/archive"]').click();
  await expect(
    page.getByRole('button', { name: 'Edit note: A finished thought', exact: true }),
  ).toBeVisible();
  await page.locator('a[href$="#/settings"]').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const file = await (await downloaded).path();
  expect(file).not.toBeNull();
  const exported = await readFile(file!, 'utf8');
  expect(exported).toContain('A finished thought');
  expect(exported).toContain('coverage');
  expect(exported).not.toContain('browser-test-token');
  expect(exported).not.toContain('Authorization');
});

test('a second tab is read-only while the first owns this repository', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  const second = await context.newPage();
  await second.goto('/');
  await expect(
    second.getByText('This repository is open for editing in another tab. This tab is read-only.', {
      exact: true,
    }),
  ).toBeVisible();
  await second.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  await expect(second.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  expect(remote.writes).toHaveLength(0);
  await closeDialog(second);
  await second.close();
});

test('explicit conversion preserves an existing Issue and label changes use incremental requests', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('.settings-page').getByRole('link', { name: 'Existing Issues', exact: true }).click();
  await page.locator('.note-card').filter({ hasText: 'An ordinary Issue' }).getByRole('button').click();
  await page.getByRole('button', { name: 'Turn into a note', exact: true }).click();
  await expect(page.locator('.note-save-row').getByRole('status')).toContainText('Synced to GitHub');
  const converted = remote.issues.find((issue) => issue.number === 4)!;
  expect(converted.body).toMatch(/^<!-- issue-notes/u);
  expect(converted.body.endsWith('This stays untouched.')).toBe(true);
  expect(converted.title).toBe('An ordinary Issue');
  expect(converted.state).toBe('open');
  await page.getByLabel('Choose labels', { exact: true }).click();
  await page.getByRole('dialog').getByLabel('Personal', { exact: true }).check();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect
    .poll(() =>
      remote.writes.some((request) => request.method === 'POST' && request.path.endsWith('/4/labels')),
    )
    .toBe(true);
  await expect(page.locator('.note-save-row').getByRole('status')).toContainText('Synced to GitHub');
  expect(
    remote.writes
      .filter((request) => request.method === 'PATCH')
      .every((request) => !Object.hasOwn(request.body ?? {}, 'labels')),
  ).toBe(true);
});

test('an acknowledged create with a lost response is recovered by UUID without creating again', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  remote.dropNextCreateResponse = true;
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Created once');
  await page
    .locator('.ProseMirror[contenteditable="true"]')
    .fill('The response can be lost; my note should not be duplicated.');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.note-save-row').getByRole('status')).toContainText('Awaiting confirmation');
  expect(remote.issues.filter((issue) => issue.title === 'Created once')).toHaveLength(1);
  await page.getByRole('button', { name: 'Check GitHub again', exact: true }).click();
  await expect(page.locator('.note-save-row').getByRole('status')).toContainText('Synced to GitHub');
  expect(
    remote.writes.filter((request) => request.method === 'POST' && request.path.endsWith('/issues')),
  ).toHaveLength(1);
});

test('cleared title stays empty through body autosave and sync until close uses Untitled note', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByLabel('Title', { exact: true });
  const status = dialog.locator('.note-save-row').getByRole('status');
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  let writeStarted = false;
  await context.route('https://api.github.com/repos/scarletkc/Tebikae-dev/issues/1', async (route) => {
    if (route.request().method() === 'PATCH') {
      writeStarted = true;
      await writeGate;
    }
    await route.fallback();
  });
  await title.fill('');
  await page.locator('.ProseMirror[contenteditable="true"]').fill('Updated body with an empty title.');
  await expect(status).toHaveText(/Saved to this device|Waiting to sync|Synced to GitHub/);
  await expect(title).toHaveValue('');
  await expect(page.locator('.note-card').filter({ hasText: 'Weekend ideas' })).toHaveCount(1);
  await expect(page.locator('.note-card').filter({ hasText: 'Untitled note' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Sync now', exact: true }).click();
  try {
    await expect.poll(() => writeStarted).toBe(true);
    expect(remote.issues[0]!.body).not.toContain('Updated body with an empty title.');
    await expect(status).not.toContainText('Synced to GitHub');
  } finally {
    releaseWrite();
  }
  // A previous revision can still say "Synced" when a new save starts.
  // Wait for this edit at the remote before checking the final UI state.
  await expect.poll(() => remote.issues[0]!.body).toContain('Updated body with an empty title.');
  await expect(status).toContainText('Synced to GitHub');
  await expect(title).toHaveValue('');
  expect(remote.issues[0]!.title).toBe('Weekend ideas');
  await closeDialog(page);
  await expect(page.getByRole('button', { name: 'Edit note: Untitled note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => remote.issues[0]!.title).toBe('Untitled note');
  await page.getByRole('button', { name: 'Edit note: Untitled note', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue('Untitled note');
});

test('closing with only the title cleared persists Untitled note', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('');
  await closeDialog(page);
  await expect(page.getByRole('button', { name: 'Edit note: Untitled note', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true })).toHaveCount(0);
  await expect.poll(() => remote.issues[0]!.title).toBe('Untitled note');
});

test('Ctrl/Cmd+N flushes pending draft before opening a new note', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByLabel('Title', { exact: true });
  await title.fill('Weekend ideas edited');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+n`);
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('');
  await closeDialog(page);
  await expect(
    page.getByRole('button', { name: 'Edit note: Weekend ideas edited', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true })).toHaveCount(0);
});

test('clearing an existing title before Ctrl/Cmd+N persists Untitled note', async ({ page, context }) => {
  const remote = await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByLabel('Title', { exact: true });
  await title.fill('');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+n`);
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('');
  await closeDialog(page);
  await expect(page.getByRole('button', { name: 'Edit note: Untitled note', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true })).toHaveCount(0);
  await expect.poll(() => remote.issues[0]!.title).toBe('Untitled note');
});

test('Ctrl/Cmd+N keeps current editor open if draft persistence fails', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByLabel('Title', { exact: true });
  const invalidTitle = 'a'.repeat(125);
  await title.fill(invalidTitle);
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+n`);
  await expect(dialog).toBeVisible();
  await expect(title).toHaveValue(invalidTitle);
  await expect(dialog.locator('.note-save-row').getByRole('status')).toHaveClass(/danger/);
});

test('standalone confirmation dialog traps Tab/Shift+Tab and restores focus upon dismissal', async ({
  page,
  context,
}) => {
  await mockGitHub(context);
  await connect(page);
  await page.locator('a[href$="#/settings"]').click();
  const clearButton = page.getByRole('button', { name: 'Clear this device’s data', exact: true });
  await clearButton.focus();
  await page.keyboard.press('Enter');

  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  const confirmBtn = confirmDialog.getByRole('button', { name: 'Clear this device’s data', exact: true });
  const cancelBtn = confirmDialog.getByRole('button', { name: 'Cancel', exact: true });

  await expect(confirmBtn).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancelBtn).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirmBtn).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancelBtn).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(confirmDialog).toHaveCount(0);
  await expect(clearButton).toBeFocused();
});

test('nested confirmation dialog in note editor traps Tab/Shift+Tab and restores focus without leaking to editor', async ({
  page,
  context,
}) => {
  await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await noteAction(page, 'Move to trash');
  await closeDialog(page);

  await page.locator('a[href$="#/trash"]').click();
  await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
  const moreButton = page.getByRole('dialog').getByRole('button', { name: 'More actions', exact: true });
  await moreButton.click();
  const deleteBtn = page.getByRole('menuitem', { name: 'Delete forever', exact: true });
  await deleteBtn.focus();
  await page.keyboard.press('Enter');

  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  const confirmBtn = confirmDialog.getByRole('button', { name: 'Delete forever', exact: true });
  const cancelBtn = confirmDialog.getByRole('button', { name: 'Cancel', exact: true });

  await expect(confirmBtn).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancelBtn).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirmBtn).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancelBtn).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(confirmDialog).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(moreButton).toBeFocused();
});
