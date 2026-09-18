import { expect, test as base, type Locator } from '@playwright/test';
import { connect, mockGitHub, mockIssue, mockLabels, type MockIssue } from '../e2e/fixtures';

export type ScreenshotOptions = {
  theme: 'light' | 'dark';
  language: 'en' | 'zh-CN';
};

type ScreenshotFixtures = {
  openApp: (options?: { connected?: boolean; issues?: MockIssue[] }) => Promise<void>;
  openEditor: () => Promise<Locator>;
  capture: (name?: string) => Promise<void>;
  text: (english: string, chinese: string) => string;
};

export const test = base.extend<ScreenshotOptions & ScreenshotFixtures>({
  theme: ['light', { option: true }],
  language: ['en', { option: true }],
  text: async ({ language }, use) => {
    await use((english, chinese) => (language === 'en' ? english : chinese));
  },
  openApp: async ({ page, context, theme, language }, use) => {
    await page.clock.setFixedTime(new Date('2026-09-17T12:00:00Z'));
    const defaultIssues = [
      mockIssue(
        1,
        'Weekend ideas',
        'Visit the bookshop.\n\nKeep a slow Sunday.',
        { color: 'yellow' },
        { labels: [mockLabels[0]!] },
      ),
      mockIssue(
        2,
        'Project plan',
        '- [ ] Read a chapter\n- [x] Make some tea',
        { color: 'green' },
        { labels: [mockLabels[1]!] },
      ),
      mockIssue(
        3,
        'Editor table demo',
        'Hello world text\n\n| Item | Status |\n| --- | --- |\n| Task A | Done |\n\n```typescript\nconst x = 1;\n```',
      ),
    ];
    await use(async ({ connected = true, issues = defaultIssues } = {}) => {
      await mockGitHub(context, issues);
      // 共用的连接流程使用英文控件，完成后再切换截图语言。
      if (connected) await connect(page, false);
      else {
        await page.goto('/');
        await expect(page.getByLabel('GitHub repository', { exact: true })).toBeVisible();
      }
      await page.evaluate(
        ({ theme, language }) => {
          for (const [key, value] of [
            ['tebikae.theme', theme],
            ['tebikae.language', language],
          ]) {
            localStorage.setItem(key!, value!);
            window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
          }
        },
        { theme, language },
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
    });
  },
  openEditor: async ({ page, openApp, text }, use) => {
    await use(async () => {
      await openApp();
      await page
        .getByRole('button', {
          name: text('Edit note: Editor table demo', '编辑笔记: Editor table demo'),
          exact: true,
        })
        .click();
      // DOM 出现时 Milkdown 可能还在初始化；就绪后才操作选区。
      await expect(page.locator('.editor-mode-toggle')).toBeEnabled();
      const editor = page.locator('.ProseMirror');
      await expect(editor).toHaveAttribute('role', 'textbox');
      await expect(editor.locator('table')).toBeVisible();
      return editor;
    });
  },
  capture: async ({ page, browserName, theme, language }, use, info) => {
    await use(async (name = info.title) => {
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const path = info.outputPath(`${name}.png`);
      await page.screenshot({ path, animations: 'disabled', caret: 'hide', scale: 'css' });
      const viewport = page.viewportSize()!;
      await info.attach(
        `${name} · ${browserName} · ${viewport.width}x${viewport.height} · ${theme} · ${language}`,
        {
          path,
          contentType: 'image/png',
        },
      );
    });
  },
});

export { expect } from '@playwright/test';
