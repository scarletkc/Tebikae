# 浏览器测试分层

普通 PR 和 main 推送运行完整 Chromium E2E、Chromium 生产 PWA／部署路径测试，以及带 `@smoke` 标记的 WebKit 核心流程。核心流程复用现有用例，覆盖连接与只读打开、可视化编辑后的本地保存和同步、刷新自动重连，以及离线编辑后的重开。

Firefox 不再对每次逻辑改动重复全部 UI 用例。测试不会被删除，`pnpm test:e2e` 和 `pnpm test:pwa` 仍默认运行三个浏览器。

## 根据改动增加覆盖

[选择脚本](../scripts/ci-browser-plan.mjs) 读取整个 PR 的 merge-base 到 head，或一次 main 推送的 before 到 after。删除和重命名前后的路径均参与选择，多种改动取覆盖范围的并集。

| 改动                                                      | WebKit 和 Firefox 增加的检查                                |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| 编辑器、Markdown 处理                                     | 编辑器、笔记、笔记布局、可靠性，以及生产 PWA 测试           |
| 存储、写入命令、备份导入、凭证、连接恢复、PWA、浏览器锁   | 会话、笔记、可靠性、备份导入、工作区状态，以及生产 PWA 测试 |
| 界面组件、样式、翻译                                      | 布局、编辑器、笔记、会话、导入导出等相关 E2E                |
| 单个 E2E 测试文件                                         | 该文件的全部用例                                            |
| PWA 测试                                                  | 存储相关 E2E 和生产 PWA 测试                                |
| 入口、静态资源、依赖、配置、CI、共享 fixture 或未分类路径 | 三浏览器全量 E2E 和生产 PWA 测试                            |

Markdown 导出逻辑改动额外运行跨浏览器导出与笔记用例。其余纯领域、应用、同步或 GitHub adapter 逻辑改动保留 Chromium 全量和 WebKit 核心流程，不将每个错误分支重复放进所有浏览器。逻辑单测仍完整运行。无法读取 Git 历史时回退到全量检查。

纯 Markdown／LICENSE 变更不触发 PR／push 检查；文档与代码混合变更正常验证，`docs/` 下的脚本或资源也不会因为目录名被跳过。

## 部署前检查

`Deploy Pages` 在每次部署前调用可复用的 `Check` 工作流，强制运行三浏览器全量 E2E 和生产 PWA 检查。全部检查成功后，部署任务才会进入原有的 `github-pages` 环境审批，并发布同一次运行中已验证的根路径构建产物，不重新构建。任何必需检查失败都会阻止部署。

没有每日定时任务。如需独立验证，也可在 Actions 中手动运行 `Check`；手动运行始终选择全量。

浏览器任务分别安装所需引擎并行运行，复用一次生产构建。每个浏览器独立保留失败截图、trace 和报告；汇总 `check` 只有在计划生成、静态检查／单测／构建及所有选中的浏览器任务成功后才通过，失败、取消或意外跳过均不会显示为通过。

## 本地复现

```sh
# 与普通 PR 相同的 E2E 基础覆盖
pnpm exec playwright install chromium webkit
pnpm test:e2e --project=chromium
pnpm test:e2e --project=webkit --grep @smoke

# 手动运行完整跨浏览器 E2E
pnpm exec playwright install
pnpm test:e2e

# 检查路径选择和 Git 历史边界
node --test tests/ci/*.test.mjs
```

生产构建和 PWA 的运行方法见 [PWA 验收说明](testing-pwa.md)。以上测试仍不能替代真机软键盘、中文输入法、iOS 独立 PWA 和系统存储回收验证。
