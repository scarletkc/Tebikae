# UI 截图

## 运行与查看

在完成[本地依赖安装](development.md#本地环境)后执行：

```sh
pnpm exec playwright install chromium
pnpm screenshots
pnpm exec playwright show-report .artifacts/screenshots/latest/report
```

`pnpm screenshots` 自动启动当前工作区的开发服务（端口 4177），用无头 Chromium 操作页面并截图，结束后关闭服务。端口已被占用时会报错，先停止占用服务再重试。截图使用模拟 GitHub 数据和测试凭证，不需要真实账号。

每个场景独立运行，覆盖桌面（1280×900）／窄屏（390×844）、浅色／深色、英文／简体中文的八种组合。PNG 保存在 `.artifacts/screenshots/latest/results/` 的独立用例目录中；HTML 报告包含截图及场景、浏览器、尺寸、主题和语言标注。截图禁用动画、隐藏输入光标并等待字体加载；测试中的当前时间固定，避免示例日期随运行时间变化。

## 只运行相关场景

无需每次运行全部组合。先用 `--list` 查看场景，再根据改动选择文件、场景和项目：

```sh
pnpm screenshots --list
# 只截编辑器相关场景，并选两个组合。
pnpm screenshots --grep 'editor' --project=desktop-light-en --project=mobile-dark-zh-CN
# 精确选择一个场景；--grep 匹配包含项目、文件名和场景名的完整测试标题。
pnpm screenshots --grep ' card-menu$' --project=desktop-light-en
# 运行指定文件内的场景。
pnpm screenshots tests/screenshots/empty.spec.ts --project=mobile-dark-zh-CN
```

项目名格式为 `<desktop|mobile>-<light|dark>-<en|zh-CN>`。可用 `--headed` 查看自动操作过程。场景清单以 `pnpm screenshots --list` 和 `tests/screenshots/` 中的代码为准。

## 保留修改前后截图

同名运行的结果会被后一次替换，包括只运行部分场景的情况。需要比较修改前后时，分别设置运行名称，例如 PowerShell：

```powershell
# 在修改前的代码上执行；修改后将 before 换为 after 再运行。
$env:TEBIKAE_SCREENSHOT_RUN = 'before'
pnpm screenshots --grep 'editor' --project=desktop-light-en
Remove-Item Env:TEBIKAE_SCREENSHOT_RUN
pnpm exec playwright show-report .artifacts/screenshots/before/report
```

运行名称只接受以字母或数字开头的字母、数字、下划线和连字符。比较时使用相同场景、模拟数据和项目组合。

## 覆盖新的改动

**现有场景不足以覆盖改动时，可以并应当修改或增加截图脚本。** 按实际变更补充页面、交互状态和模拟数据；不要把跑通已有场景当作新界面已验证。共用方法不能表达所需状态时，也可以调整 `tests/screenshots/fixtures.ts` 或 `playwright.screenshots.config.ts`，保持变更与本次验证需求相关。

在 `tests/screenshots/` 添加 `.spec.ts`，从 `./fixtures` 引入 `test`、`expect`。例如仓库中的 [empty.spec.ts](../tests/screenshots/empty.spec.ts) 用空数据验证空列表：

```ts
import { expect, test } from './fixtures';

test('empty-notes', async ({ page, openApp, capture }) => {
  await openApp({ issues: [] });
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await capture();
});
```

| 方法                            | 用途                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| `openApp()`                     | 用默认示例笔记连接应用，应用当前项目的主题与语言。                        |
| `openApp({ connected: false })` | 打开未连接页面。                                                          |
| `openApp({ issues: [...] })`    | 用当前场景的模拟笔记替代默认数据；空数组表示空仓库。                      |
| `openEditor()`                  | 连接默认数据，打开 `Editor table demo` 并等待编辑器就绪，返回正文定位器。 |
| `text(英文, 中文)`              | 根据当前项目语言选择控件名称，用于 `getByRole` 等定位。                   |
| `capture()`                     | 截取当前视口，写入独立用例目录，并附到报告中。                            |
| `capture('dialog-open')`        | 给截图指定名称；同一测试截多个状态时使用不同名称。                        |

自定义数据可从 `../e2e/fixtures` 引入 `mockIssue`、`mockLabels`；例如 `openApp({ issues: [mockIssue(1, 'Long note', '正文'.repeat(500))] })`。长标题、表格、多条笔记、标签等用合成数据表达。验证自定义笔记的编辑器时，用 `page` 打开那条笔记；`openEditor()` 专用于默认示例。

`page`、`context` 是常规 Playwright 对象，可以用它们补充点击、键盘、滚动和请求拦截。需要加载中或请求失败画面时，复用 E2E 测试已有的拦截方式；需要新的尺寸、主题或语言组合时，修改项目配置或用 `test.use()` 为场景设置选项。操作后先断言目标状态已出现，再调用 `capture()`，避免用固定延时猜测加载完成。同一测试需要多张截图时使用不同名称，例如 `capture('dialog-open')` 和 `capture('dialog-error')`；同名截图会覆盖。

新增场景后，先按文件及相关组合运行，打开报告检查实际画面；共用方法或配置的修改需要验证受影响的现有场景。后续提交改变界面时，重新生成相应截图。

截图套件按需运行，与常规 E2E／PWA 检查分开。它生成供人工核对的截图，不执行像素基准比较；窄屏视口也不替代真实手机的软键盘、触摸及系统剪贴板验证。常规 E2E 中的截图仍用于各自测试的诊断。PR 中的截图上传及视觉核对要求见[贡献指南](../CONTRIBUTING.md#required-screenshots-for-ui-changes)。
