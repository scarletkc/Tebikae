import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { connect, mockGitHub, mockIssue, standardIssues } from './fixtures';

async function openExport(page: Page) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Export Markdown ZIP', exact: true }).click();
  return page.getByRole('dialog');
}
async function downloadArchive(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^Tebikae-Tebikae-dev-.*\.zip$/u);
  const files = unzipSync(await readFile((await download.path())!));
  return Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, strFromU8(bytes)]));
}

test('preview and ZIP include notes and archive, exclude trash and ordinary Issues, and never call GitHub', async ({
  page,
  context,
}) => {
  const remote = await mockGitHub(context, [
    ...standardIssues(),
    mockIssue(6, 'Discarded note', 'Trash body', { trashedAt: '2026-09-15T00:00:00Z' }),
  ]);
  await connect(page);
  const requestsBefore = remote.requests.length;
  const dialog = await openExport(page);
  await expect(dialog.getByLabel('Include notes in trash')).not.toBeChecked();
  await expect(dialog.locator('dl > div').filter({ hasText: 'Total files' }).locator('dd')).toHaveText('3');
  const files = await downloadArchive(page);
  expect(Object.keys(files).sort()).toEqual([
    'archive/A finished thought.md',
    'manifest.json',
    'notes/A little checklist.md',
    'notes/Weekend ideas.md',
  ]);
  expect(files['notes/Weekend ideas.md']).toContain('Labels: Ideas, Personal');
  expect(files['notes/Weekend ideas.md']).toContain(
    'Source: https://github.com/scarletkc/Tebikae-dev/issues/1',
  );
  expect(JSON.stringify(files)).not.toContain('browser-test-token');
  expect(JSON.stringify(files)).not.toContain('This stays untouched');
  expect(remote.requests).toHaveLength(requestsBefore);
  expect(remote.writes).toHaveLength(0);
});

test('trash opt-in, duplicate filenames, and the preview work on a narrow screen', async ({
  page,
  context,
}, info) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await mockGitHub(context, [
    mockIssue(1, 'Same'),
    mockIssue(2, 'same'),
    mockIssue(3, 'Trash', 'Discarded', { trashedAt: '2026-09-15T00:00:00Z' }),
  ]);
  await connect(page);
  const dialog = await openExport(page);
  await dialog.getByLabel('Include notes in trash').check();
  await expect(dialog.locator('dl > div').filter({ hasText: 'Total files' }).locator('dd')).toHaveText('3');
  await dialog.getByRole('button', { name: 'Download ZIP' }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Download ZIP' })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('markdown-export-mobile.png') });
  const files = await downloadArchive(page);
  expect(files['trash/Trash.md']).toContain('Discarded');
  expect(Object.keys(files).filter((path) => path.startsWith('notes/'))).toHaveLength(2);
  expect(JSON.parse(files['manifest.json']!).coverage.includesTrash).toBe(true);
});

test('empty notebooks disable download and allow closing the preview', async ({ page, context }) => {
  await mockGitHub(context, []);
  await connect(page);
  const dialog = await openExport(page);
  await expect(dialog.getByRole('button', { name: 'Download ZIP' })).toBeDisabled();
  await expect(dialog.getByRole('status')).toHaveText('No notes to export with these options.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('failed downloads retain the preview and can be retried', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  const dialog = await openExport(page);
  await page.evaluate(() => {
    const create = URL.createObjectURL;
    URL.createObjectURL = () => {
      URL.createObjectURL = create;
      throw new Error('Simulated download failure');
    };
  });
  await dialog.getByRole('button', { name: 'Download ZIP' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not prepare the Markdown export');
  const files = await downloadArchive(page);
  expect(files['notes/Weekend ideas.md']).toContain('Visit the bookshop');
  await expect(dialog).toHaveCount(0);
});
