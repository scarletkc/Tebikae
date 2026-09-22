import { expect, test } from '@playwright/test';
import { connect, mockGitHub, mockIssue } from './fixtures';

for (const width of [1280, 390, 320]) {
  test(`long label keeps count stable and enters selection mode at ${width}px`, async ({ page, context }) => {
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
      const nav = element.closest('.label-nav')!;
      return {
        row: element.getBoundingClientRect().toJSON(),
        name: name.getBoundingClientRect().toJSON(),
        count: count.getBoundingClientRect().toJSON(),
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
    await expect(row.locator('.label-filter-toggle')).toHaveCount(0);
    await row.getByRole('button').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
    await expect(row.locator('.label-filter-toggle')).toBeVisible();
    if (width === 1280 || width === 390)
      await page.screenshot({ path: `.artifacts/issue14-label-selection-${width}.png` });
    const selectionLayout = await row.evaluate((element) => {
      const name = element.querySelector<HTMLElement>('.label-name')!;
      const count = element.querySelector<HTMLElement>('.label-count')!;
      const toggle = element.querySelector<HTMLElement>('.label-filter-toggle')!;
      return {
        name: name.getBoundingClientRect().toJSON(),
        count: count.getBoundingClientRect().toJSON(),
        toggle: toggle.getBoundingClientRect().toJSON(),
        row: element.getBoundingClientRect().toJSON(),
        rowOverflow: element.scrollWidth > element.clientWidth,
        navOverflow: element.closest('.label-nav')!.scrollWidth > element.closest('.label-nav')!.clientWidth,
      };
    });
    expect(selectionLayout.rowOverflow).toBe(false);
    expect(selectionLayout.navOverflow).toBe(false);
    expect(selectionLayout.name.right).toBeLessThanOrEqual(selectionLayout.count.left);
    expect(selectionLayout.count.right).toBeLessThanOrEqual(selectionLayout.toggle.left);
    expect(selectionLayout.toggle.right).toBeLessThanOrEqual(selectionLayout.row.right + 1);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(row.locator('.label-filter-toggle')).toHaveCount(0);
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

test('workspace controls expose their issue menus and suppress undefined native menus', async ({
  page,
  context,
}) => {
  await mockGitHub(context);
  await connect(page);

  await page.getByRole('button', { name: 'New note', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'New note', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'New checklist', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  const search = page.getByRole('textbox', { name: 'Search your notes', exact: true });
  await search.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Cut', exact: true })).toHaveAttribute('data-disabled', '');
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: true })).toHaveAttribute(
    'data-disabled',
    '',
  );
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).not.toHaveAttribute(
    'data-disabled',
  );
  await expect(page.getByRole('menuitem', { name: 'Clear', exact: true })).toHaveAttribute(
    'data-disabled',
    '',
  );
  await page.screenshot({ path: '.artifacts/issue14-search-menu.png' });
  await page.keyboard.press('Escape');
  await search.fill('weekend');
  await search.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Clear', exact: true })).not.toHaveAttribute(
    'data-disabled',
  );
  await page.getByRole('menuitem', { name: 'Clear', exact: true }).click();
  await expect(search).toHaveValue('');

  await page.getByRole('button', { name: 'Grid view', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitemcheckbox', { name: 'Grid view', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemcheckbox', { name: 'List view', exact: true }).click();
  await expect(page.locator('.notes-list')).toBeVisible();

  await page.getByRole('button', { name: 'Language', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitemcheckbox', { name: 'English', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitemcheckbox', { name: '简体中文', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Follow system', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitemcheckbox', { name: 'Follow system', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Light', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Dark', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('.repository-pill').click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Switch / reconnect repository…', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open on GitHub', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  const prevented = await page.locator('.workspace-body').evaluate((element) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  const shiftAllowed = await page
    .locator('.note-card')
    .first()
    .evaluate((element) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(shiftAllowed).toBe(false);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('navigation context menus clear note selection state', async ({ page, context }) => {
  await mockGitHub(context);
  await connect(page);
  await page
    .locator('.note-card')
    .first()
    .locator('.note-open')
    .click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByRole('toolbar', { name: 'Note selection' })).toBeVisible();

  const openNavigation = async (href: string) => {
    const link = page.locator(`a[href$="${href}"]`);
    await link.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  };
  await openNavigation('#/archive');
  await expect(page).toHaveURL(/#\/archive$/u);
  await expect(page.getByRole('toolbar', { name: 'Note selection' })).toHaveCount(0);
  await openNavigation('#/notes');
  await expect(page).toHaveURL(/#\/notes$/u);
  await expect(page.getByRole('toolbar', { name: 'Note selection' })).toHaveCount(0);
  await page.locator('.note-card').first().locator('.note-open').click();
  await expect(page.getByRole('dialog')).toBeVisible();
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
  await page.waitForTimeout(100);
  const point = { x: box.x + 30, y: box.y + 20 };
  await title.evaluate((element, at) => {
    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: at.x,
        clientY: at.y,
      }),
    );
  }, point);
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
