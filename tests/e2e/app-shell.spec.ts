import { expect, test } from '@playwright/test';
import { connect, mockGitHub } from './fixtures';

for (const width of [390, 1280]) {
  test(`app shell keeps page fixed and editor responsive at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockGitHub(context);
    await connect(page);

    const scrollState = await page.evaluate(() => ({
      windowY: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      mainHeight: document.querySelector('.main-content')?.clientHeight,
      mainScrollHeight: document.querySelector('.main-content')?.scrollHeight,
    }));
    expect(scrollState.windowY).toBe(0);
    expect(scrollState.documentHeight).toBeLessThanOrEqual(scrollState.viewportHeight);
    expect(scrollState.mainScrollHeight).toBeGreaterThanOrEqual(scrollState.mainHeight!);

    const cards = page.locator('.note-card');
    await expect(cards).toHaveCount(2);
    if (width < 500) {
      const boxes = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
      expect(boxes[0]!.x).not.toBe(boxes[1]!.x);
    } else {
      await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
      await expect(page.locator('.sidebar')).toHaveAttribute('data-collapsed', 'true');
    }

    await cards
      .first()
      .getByRole('button', { name: /Edit note/ })
      .click();
    const editor = page.locator('.note-dialog');
    await expect(editor).toBeVisible();
    const editorBox = await editor.boundingBox();
    expect(editorBox).not.toBeNull();
    if (width < 500) {
      expect(editorBox!.width).toBeGreaterThan(width - 3);
      expect(editorBox!.height).toBeGreaterThan(841);
    } else {
      expect(editorBox!.width).toBeLessThan(width);
      expect(editorBox!.height).toBeLessThan(844);
    }
    await page.goBack();
    await expect(editor).toHaveCount(0);

    await page.keyboard.press('Control+KeyK');
    await expect(page.locator('.ui-command-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+KeyN');
    await expect(page.locator('.note-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.note-dialog')).toHaveCount(0);
  });
}
