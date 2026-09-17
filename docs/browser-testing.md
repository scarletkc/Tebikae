# 浏览器测试分层

本文说明 CI 如何选择浏览器用例，以及如何在本地复现。贡献者提交前的验证要求见[贡献指南](../CONTRIBUTING.md#validation)。

## 运行时机

| 触发方式                              | 浏览器覆盖                                                             |
| ------------------------------------- | ---------------------------------------------------------------------- |
| 含代码改动的 PR 或 main 推送          | Chromium 全量 E2E／PWA，加 WebKit 核心流程；按下表增加相关跨浏览器测试 |
| 仅 Markdown／LICENSE 改动的 PR 或推送 | 不触发 `Check`                                                         |
| 手动运行 `Check`                      | 三浏览器全量 E2E／PWA                                                  |
| 运行 `Deploy Pages`                   | 部署前强制三浏览器全量 E2E／PWA，通过后才可发布                        |

`@smoke` 核心流程复用现有用例，覆盖连接与只读打开、可视化编辑后的本地保存和同步、刷新自动重连，以及离线编辑后的重开。E2E 验证开发服务器中的界面交互；PWA 用例验证生产构建的离线恢复、更新和部署路径。

## 根据改动增加覆盖

[选择脚本](../scripts/ci-browser-plan.mjs) 根据整个 PR 或一次 main 推送的文件变更增加覆盖。实现上，PR 使用共同祖先到 head 的差异，推送使用 before 到 after 的差异；删除和重命名前后的路径都参与选择，多种改动取并集。

| 改动                                                      | WebKit 和 Firefox 增加的检查                                |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| 编辑器、Markdown 处理                                     | 编辑器、笔记、笔记布局、可靠性，以及生产 PWA 测试           |
| 存储、写入命令、备份导入、凭证、连接恢复、PWA、浏览器锁   | 会话、笔记、可靠性、备份导入、工作区状态，以及生产 PWA 测试 |
| 界面组件、样式、翻译                                      | 布局、编辑器、笔记、会话、导入导出等相关 E2E                |
| 单个 E2E 测试文件                                         | 该文件的全部用例                                            |
| PWA 测试                                                  | 存储相关 E2E 和生产 PWA 测试                                |
| Markdown 导出逻辑                                         | 导出与笔记用例                                              |
| 入口、静态资源、依赖、配置、CI、共享 fixture 或未分类路径 | 三浏览器全量 E2E 和生产 PWA 测试                            |

未命中上述类别的领域、应用、同步和 GitHub adapter 逻辑，以及顶层单测文件改动，使用基础浏览器覆盖。应用单测始终完整运行；无法读取 Git 历史时，浏览器检查回退到三引擎全量。

文档与代码混合变更正常验证，`docs/` 下的脚本或资源也参与选择。新增用例或模块时，应检查选择脚本是否覆盖它；规则的回归测试位于 [tests/ci/browser-plan.test.mjs](../tests/ci/browser-plan.test.mjs)。

## 查看结果

浏览器任务分别安装所需引擎并行运行，复用同一次生产构建。失败截图、trace 和 HTML 报告按浏览器保存为 `browser-test-results-<browser>` artifact。诊断失败时，先查看对应浏览器任务的日志和报告。

汇总 `check` 只有在计划生成、静态检查／单测／构建及所有选中的浏览器任务成功后才通过。失败、取消或意外跳过均不会显示为通过。[Check 工作流](../.github/workflows/check.yml)定义任务依赖；Pages 的触发、审批和产物发布步骤见[部署说明](development.md#github-pages)。

## 本地复现

复现 CI 的基础 E2E 覆盖：

```sh
pnpm exec playwright install chromium webkit
pnpm test:e2e --project=chromium
pnpm test:e2e --project=webkit --grep @smoke
```

需要完整跨浏览器 E2E 时，安装全部引擎并运行默认命令：

```sh
pnpm exec playwright install
pnpm test:e2e
```

`pnpm test:e2e` 和 `pnpm test:pwa` 默认选择全部引擎。生产构建和 PWA 的运行方法见 [PWA 验收说明](testing-pwa.md)，定向测试与静态检查命令见[开发指南](development.md#检查)。

浏览器自动化不能替代真机软键盘、中文输入法、iOS 独立 PWA 和系统存储回收验证。PWA 验收记录中的结果对应其注明的日期，不代表当前分支已通过检查。
