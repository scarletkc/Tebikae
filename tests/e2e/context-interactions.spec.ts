import { expect, test } from '@playwright/test';
import { connect, mockGitHub, mockIssue } from './fixtures';

for (const width of [1280, 390, 320]) {
  test(`long label keeps count and toggle visible at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    const remote = await mockGitHub(context);
    remote.labels[0]!.name = '非常长的标签名称用于验证单行省略和固定侧栏宽度'.repeat(3);
    await connect(page);
    if (width < 600) await page.locator('.mobile-menu').click();
    const sidebar = page.locator(width < 600 ? '.mobile-drawer' : '.sidebar');
    const row = sidebar.locator('.label-nav-row').first();
    await expect(row).toBeVisible();
    const layout = await row.evaluate((element) => {
      const name = element.querySelector<HTMLElement>('.label-name')!;
      const count = element.querySelector<HTMLElement>('.label-count')!;
      const toggle = element.querySelector<HTMLElement>('.label-filter-toggle')!;
      const nav = element.closest('.label-nav')!;
      return {
        row: element.getBoundingClientRect().toJSON(),
        name: name.getBoundingClientRect().toJSON(),
        count: count.getBoundingClientRect().toJSON(),
        toggle: toggle.getBoundingClientRect().toJSON(),
        truncated: name.scrollWidth > name.clientWidth,
        ellipsis: getComputedStyle(name).textOverflow,
        rowOverflow: element.scrollWidth > element.clientWidth,
        navOverflow: nav.scrollWidth > nav.clientWidth,
      };
    });
    expect(layout.truncated).toBe(true);
    expect(layout.ellipsis).toBe('ellipsis');
    expect(layout.rowOverflow).toBe(false);
    expect(layout.navOverflow).toBe(false);
    expect(layout.name.right).toBeLessThanOrEqual(layout.count.left);
    expect(layout.count.right).toBeLessThanOrEqual(layout.toggle.left);
    expect(layout.toggle.right).toBeLessThanOrEqual(layout.row.right + 1);
    expect(layout.row.right - layout.toggle.right).toBeLessThanOrEqual(1);
    await expect(page.locator('.context-more')).toHaveCount(0);
  });
}

test('blank list offers new note but card context never bubbles into it', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  await page.locator('.main-content').click({ button: 'right', position: { x: 10, y: 10 } });
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  await page.getByRole('menuitem', { name: 'New note', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.locator('.note-card').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Select', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'New note', exact: true })).toHaveCount(0);
});

test('touch cancellation handles up cancel scrolling and motion outside target', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGitHub(context);
  await connect(page);
  const card = page.locator('.note-card').first();
  for (const cancellation of ['pointerup', 'pointercancel', 'scroll', 'pointermove']) {
    await card.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 80,
      clientY: 250,
    });
    await page
      .locator('body')
      .dispatchEvent(cancellation, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 250 });
    await page.waitForTimeout(550);
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  const main = page.locator('.main-content');
  await main.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 40, clientY: 300 });
  await page.waitForTimeout(550);
  await expect(page.getByRole('menuitem', { name: 'New note', exact: true })).toBeVisible();
  await main.dispatchEvent('pointerup', { pointerType: 'touch' });
});

test('modal context is viewport anchored and clamped after scroll and zoom', async ({ page, context }) => {
  await mockGitHub(context, [
    mockIssue(1, 'Position test', 'First paragraph\n\n' + 'Another paragraph\n\n'.repeat(30)),
  ]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Position test' }).click();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  const box = (await title.boundingBox())!;
  const point = { x: box.x + 30, y: box.y + 20 };
  await page.mouse.click(point.x, point.y, { button: 'right' });
  let menu = (await page.getByRole('menu').boundingBox())!;
  expect(Math.abs(menu.x - point.x)).toBeLessThan(3);
  expect(Math.abs(menu.y - point.y)).toBeLessThan(3);
  await page.keyboard.press('Escape');
  await page.locator('.note-dialog-scroll').evaluate((el) => {
    el.scrollTop = 150;
  });
  await page.locator('.note-dialog').evaluate((el: HTMLElement) => {
    el.style.zoom = '0.9';
  });
  const editor = page.locator('.ProseMirror');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const open = (at: { x: number; y: number }) =>
    editor.evaluate((el, point) => {
      el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
        }),
      );
    }, at);
  const spot = await editor.evaluate((el) => {
    const box = Array.from(el.querySelectorAll('p'))
      .map((p) => p.getBoundingClientRect())
      .find((box) => box.top > 240 && box.bottom < 500 && box.width > 0);
    return box ? { x: Math.round(box.left + 20), y: Math.round(box.top + 5) } : null;
  });
  expect(spot).not.toBeNull();
  expect(errors).toEqual([]);
  await open(spot!);
  menu = (await page.getByRole('menu').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(menu.x - spot!.x)).toBeLessThan(3);
  expect(menu.x).toBeGreaterThanOrEqual(8);
  expect(menu.y).toBeGreaterThanOrEqual(8);
  expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(menu.y + menu.height).toBeLessThanOrEqual(viewport.height - 8);
  await page.keyboard.press('Escape');
});

test('touch on editable root or text does not intercept native selection', async ({ page, context }) => {
  await mockGitHub(context, [mockIssue(1, 'Native selection', 'Select these words')]);
  await connect(page);
  await page.getByRole('button', { name: 'Edit note: Native selection' }).click();
  for (const target of [
    page.locator('.ProseMirror'),
    page.locator('.ProseMirror p'),
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ]) {
    await target.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 250 });
    await page.waitForTimeout(550);
    const prevented = await target.evaluate((el) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await target.dispatchEvent('pointerup', { pointerType: 'touch' });
  }
});
