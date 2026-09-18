import { expect, test, type Page } from '@playwright/test';
import { closeDialog, connect, mockGitHub, mockIssue } from './fixtures';

test('sidebar labels select exclusively with All and Unlabeled shortcuts', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  const ideas = page.locator('.sidebar .label-nav').getByRole('button', { name: /^Ideas/ });
  const personal = page.locator('.sidebar .label-nav').getByRole('button', { name: /^Personal/ });
  const all = page.locator('.sidebar .label-nav').getByRole('button', { name: 'All' });
  const unlabeled = page.locator('.sidebar .label-nav').getByRole('button', { name: 'Unlabeled' });
  const chips = page.locator('.filter-chips .chip-label');
  await ideas.click();
  await expect(ideas).toHaveAttribute('aria-pressed', 'true');
  await personal.click();
  await expect(ideas).toHaveAttribute('aria-pressed', 'false');
  await expect(personal).toHaveAttribute('aria-pressed', 'true');
  await expect(chips).toHaveCount(1);
  await unlabeled.click();
  await expect(personal).toHaveAttribute('aria-pressed', 'false');
  await expect(unlabeled).toHaveAttribute('aria-pressed', 'true');
  await expect(chips).toHaveCount(0);
  await expect(page.locator('.filter-chips .chip')).toHaveCount(1);
  await personal.click();
  await expect(unlabeled).toHaveAttribute('aria-pressed', 'false');
  await expect(chips).toHaveCount(1);
  await ideas.click();
  await expect(ideas).toHaveAttribute('aria-pressed', 'true');
  await all.click();
  await expect(ideas).toHaveAttribute('aria-pressed', 'false');
  await expect(chips).toHaveCount(0);
  await all.click();
  await expect(page.locator('.filter-chips .chip')).toHaveCount(0);
});

test('sidebar shows only labels used by non-trashed notes', async ({ page, context }) => {
  await mockGitHub(
    context,
    [
      mockIssue(
        1,
        'Labeled note',
        'A note that uses Ideas.',
        {},
        { labels: [{ id: 11, name: 'Ideas', color: 'b1c6b0', description: null }] },
      ),
      mockIssue(
        2,
        'Trashed note',
        'Only this trashed note uses Personal.',
        { trashedAt: '2026-09-15T00:00:00Z' },
        { labels: [{ id: 12, name: 'Personal', color: 'dec8a7', description: null }] },
      ),
    ],
    [
      { id: 201, name: 'bug', color: 'd73a4a', description: null },
      { id: 202, name: 'enhancement', color: 'a2eeef', description: null },
    ],
  );
  await connect(page);
  const nav = page.locator('.sidebar .label-nav');
  await expect(nav.getByRole('button', { name: /^Ideas/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^Personal/ })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /^bug/ })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /^enhancement/ })).toHaveCount(0);
  await expect(nav.locator('.label-nav-row')).toHaveCount(1);
  await expect(nav.getByRole('button')).toHaveCount(4);
});

async function storedNoteLabels(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tebikae');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number[][]>((resolve, reject) => {
        const request = database.transaction('notes').objectStore('notes').getAll();
        request.onsuccess = () =>
          resolve(request.result.map((note: { current: { labelIds: number[] } }) => note.current.labelIds));
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

for (const entry of ['topbar', 'empty']) {
  for (const unlabeledOnly of [false, true]) {
    test(`${entry} new note inherits only valid labels, unlabeledOnly=${unlabeledOnly}, and blank drafts are discarded`, async ({
      page,
      context,
    }) => {
      const remote = await mockGitHub(context, []);
      await connect(page);
      await page.locator('a[href$="#/notes"]').click();
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      const filtersDialog = page.getByRole('dialog');
      await filtersDialog.getByLabel('Ideas', { exact: true }).check();
      await filtersDialog.getByLabel('Personal', { exact: true }).check();
      await closeDialog(page);
      await page.evaluate((unlabeledOnly) => {
        const key = Object.keys(sessionStorage).find((key) => key.startsWith('tebikae.filters.'))!;
        const filters = JSON.parse(sessionStorage.getItem(key)!);
        sessionStorage.setItem(
          key,
          JSON.stringify({ ...filters, labelIds: [...filters.labelIds, 999, 11], unlabeledOnly }),
        );
      }, unlabeledOnly);
      await page.reload();
      // Labels used by no note stay out of the sidebar, but the active filters survive intact.
      await expect(page.locator('.sidebar .label-nav .label-nav-row')).toHaveCount(0);
      await expect(page.locator('.sidebar .label-nav button')).toHaveCount(2);
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      const restored = page.getByRole('dialog');
      await expect(restored.getByLabel('Ideas', { exact: true })).toBeChecked();
      await expect(restored.getByLabel('Personal', { exact: true })).toBeChecked();
      await closeDialog(page);
      const create = page
        .locator(entry === 'topbar' ? '.app-topbar' : '.empty-state')
        .getByRole('button', { name: 'New note', exact: true });
      const dialog = page.getByRole('dialog');
      await create.click();
      await expect(dialog.getByLabel('Ideas', { exact: true })).toBeChecked({ checked: !unlabeledOnly });
      await expect(dialog.getByLabel('Personal', { exact: true })).toBeChecked({ checked: !unlabeledOnly });
      await closeDialog(page);
      expect(await storedNoteLabels(page)).toEqual([]);
      expect(remote.writes).toHaveLength(0);
      await create.click();
      await dialog.getByLabel('Title', { exact: true }).fill(`Inherited ${entry}`);
      await dialog.getByRole('button', { name: 'Sync now', exact: true }).click();
      await expect(dialog.locator('.note-save-row').getByRole('status')).toContainText('Synced to GitHub');
      expect(await storedNoteLabels(page)).toEqual([unlabeledOnly ? [] : [11, 12]]);
      expect(remote.issues[0]!.labels.map((label) => label.id)).toEqual(unlabeledOnly ? [] : [11, 12]);
      expect(
        remote.writes.filter((write) => write.method === 'POST' && write.path.endsWith('/issues')),
      ).toHaveLength(1);
      await closeDialog(page);
    });
  }
}

test('creating a label preserves the selected color through GitHub and Dexie', async ({ page, context }) => {
  const state = await mockGitHub(context);
  await connect(page);
  await page.getByRole('button', { name: 'New label', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input:not([type="color"])').fill('Colored label');
  await dialog.locator('input[type="color"]').fill('#e12345');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    state.writes.find((write) => write.path.endsWith('/labels') && write.method === 'POST')?.body,
  ).toMatchObject({ name: 'Colored label', color: 'e12345' });
  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tebikae');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ name: string; color: string } | undefined>((resolve, reject) => {
        const request = database.transaction('labels').objectStore('labels').getAll();
        request.onsuccess = () =>
          resolve(
            (request.result as { name: string; color: string }[]).find(
              (label) => label.name === 'Colored label',
            ),
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
  expect(stored?.color).toBe('e12345');
});

for (const theme of ['light', 'dark'] as const) {
  test(`label options, filter chips and note selection show colors in ${theme} theme`, async ({
    page,
    context,
  }) => {
    await mockGitHub(context);
    await connect(page);
    await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), theme);
    await page.locator('.filter-open-button').click();
    const dialog = page.getByRole('dialog');
    const badge = dialog.locator('.label-badge').filter({ hasText: 'Ideas' });
    await expect(badge.locator('.label-dot')).toHaveCSS('background-color', 'rgb(177, 198, 176)');
    const textColor = await page.evaluate(() => getComputedStyle(document.documentElement).color);
    await expect(badge).toHaveCSS('color', textColor);
    await expect(badge).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await dialog.getByRole('checkbox', { name: 'Ideas', exact: true }).check();
    await closeDialog(page);
    const chip = page.locator('.filter-chips .chip-label');
    await expect(chip).toContainText('Ideas');
    await expect(chip.locator('.label-dot')).toHaveCSS('background-color', 'rgb(177, 198, 176)');
    await expect(chip).toHaveCSS('color', textColor);
    await page.getByRole('button', { name: 'Edit note: Weekend ideas', exact: true }).click();
    const noteBadge = page.locator('.note-properties .label-badge').filter({ hasText: 'Ideas' });
    await expect(noteBadge.locator('.label-dot')).toHaveCSS('background-color', 'rgb(177, 198, 176)');
    await expect(noteBadge).toHaveCSS('color', textColor);
    await expect(
      page.getByRole('dialog').getByRole('checkbox', { name: 'Ideas', exact: true }),
    ).toBeChecked();
    await closeDialog(page);
    await chip.click();
    await expect(page.locator('.filter-chips .chip-label')).toHaveCount(0);
  });
}
