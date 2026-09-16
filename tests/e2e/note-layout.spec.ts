import { expect, test } from '@playwright/test';
import { closeDialog, connect, mockGitHub, mockIssue } from './fixtures';

const bodies = [
  '慢慢记录，随时回看。',
  '这是一段比较长的笔记，用来检查正文截断与卡片排列。\n\n'.repeat(10),
  '| 名称 | 状态 | 日期 |\n| --- | --- | --- |\n| 设计 | 完成 | 周一 |\n| 开发 | 进行中 | 周二 |',
  '- [x] 整理桌面\n- [ ] 读一章书\n- [ ] 散步\n- [ ] 买茶',
  '```typescript\nconst note = { title: "随手记录" };\nconsole.log(note);\n```',
  '[链接](https://example.com)\n\n![封面](https://example.com/private.png)\n\n<script>alert(1)</script>\n\n- [x] 附带任务',
];
for (const width of [390, 1280]) {
  test(`mixed note previews and masonry at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const remote = await mockGitHub(
      page.context(),
      Array.from({ length: 12 }, (_, i) =>
        mockIssue(i + 1, `${String(i + 1).padStart(2, '0')} · 日常记录`, bodies[i % bodies.length], {
          color: i % 3 === 0 ? 'yellow' : 'default',
        }),
      ),
    );
    await connect(page);
    await page.locator('.topbar-note-actions select').selectOption('title');
    const cards = page.locator('.note-card');
    await expect(cards).toHaveCount(12);
    await expect(cards.locator('.note-open a, .note-open input')).toHaveCount(0);
    await expect(cards.locator('img, script')).toHaveCount(0);
    await expect(cards.locator('table')).toHaveCount(2);
    await expect(cards.locator('pre')).toHaveCount(2);
    await expect(page.locator('.card-checklist')).toHaveCount(2);
    await expect(page.locator('.card-checklist input')).toHaveCount(0);
    await expect(page.locator('.checklist-count')).toHaveCount(2);
    await expect(page.locator('.checklist-count').first()).toHaveText('1 of 4 complete');
    await expect(cards.locator('.preview-checkbox')).toHaveCount(10);
    for (const table of await cards.locator('table').all()) {
      await expect(table).toHaveCSS('display', 'table');
      await expect(table).toHaveCSS('overflow-x', 'hidden');
    }
    await expect(cards.locator('a')).toHaveCount(0);
    await expect
      .poll(() => page.locator('.masonry-item').first().getAttribute('style'))
      .toContain('grid-row-end');
    const titles = await cards.locator('h3').allTextContents();
    expect(titles).toEqual([...titles].sort());
    const boxes = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      for (const other of boxes.slice(i + 1)) {
        const overlaps =
          box.x < other!.x + other!.width &&
          box.x + box.width > other!.x &&
          box.y < other!.y + other!.height &&
          box.y + box.height > other!.y;
        expect(overlaps).toBe(false);
      }
    }
    if (width > 760) {
      const short = boxes[0]!;
      const next = boxes.slice(1).find((box) => Math.abs(box!.x - short.x) < 1)!;
      expect(next!.y - short.y - short.height).toBeLessThan(21);
    }
    await page.screenshot({ path: testInfo.outputPath('notes-light.png'), fullPage: true });
    await page.evaluate(() => {
      localStorage.setItem('tebikae.theme', 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: 'tebikae.theme', newValue: 'dark' }));
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: testInfo.outputPath('notes-dark.png'), fullPage: true });
    await cards.first().click({ position: { x: 30, y: 60 } });
    await expect(page.getByRole('dialog')).toBeVisible();
    await closeDialog(page);
    const firstCheck = page.locator('.card-checklist .preview-checkbox').first();
    await firstCheck.scrollIntoViewIfNeeded();
    const checkBox = (await firstCheck.boundingBox())!;
    await page.mouse.click(checkBox.x + checkBox.width / 2, checkBox.y + checkBox.height / 2);
    await expect(page.getByRole('dialog')).toBeVisible();
    await closeDialog(page);
    await expect(page.locator('.checklist-count').first()).toHaveText('1 of 4 complete');
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await expect(page.locator('.notes-list .note-card')).toHaveCount(12);
    await expect(page.locator('.masonry-item')).toHaveCount(0);
    await expect(cards.first()).toHaveCSS('display', 'block');
    const listBoxes = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
    expect(new Set(listBoxes.map((box) => box!.x)).size).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('notes-list.png'), fullPage: true });
    expect(remote.writes).toHaveLength(0);
  });
}
