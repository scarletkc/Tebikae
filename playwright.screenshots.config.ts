import { defineConfig } from '@playwright/test';
import type { ScreenshotOptions } from './tests/screenshots/fixtures';

const run = process.env.TEBIKAE_SCREENSHOT_RUN || 'latest';
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(run))
  throw new Error('TEBIKAE_SCREENSHOT_RUN 只能包含字母、数字、下划线和连字符，且须以字母或数字开头。');
const output = `.artifacts/screenshots/${run}`;

export default defineConfig<ScreenshotOptions>({
  testDir: './tests/screenshots',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  outputDir: `${output}/results`,
  reporter: [['list'], ['html', { outputFolder: `${output}/report`, open: 'never' }]],
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:4177',
    locale: 'en-US',
    timezoneId: 'UTC',
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: (['desktop', 'mobile'] as const).flatMap((size) =>
    (['light', 'dark'] as const).flatMap((theme) =>
      (['en', 'zh-CN'] as const).map((language) => ({
        name: `${size}-${theme}-${language}`,
        use: {
          theme,
          language,
          colorScheme: theme,
          viewport: size === 'desktop' ? { width: 1280, height: 900 } : { width: 390, height: 844 },
        },
      })),
    ),
  ),
  webServer: {
    command: 'pnpm dev --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177',
    // 使用当前工作区启动服务，避免误截其他分支留下的页面。
    reuseExistingServer: false,
    env: { VITE_BASE_PATH: '/' },
  },
});
