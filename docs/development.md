# 开发与静态部署

## 本地环境

Node.js 24；pnpm 使用 `package.json` 的 `packageManager` 精确版本。项目锁定兼容的 TypeScript 5.9 与 typescript-eslint，Milkdown 相关包保持同一版本。pnpm 的依赖构建策略见 `pnpm-workspace.yaml`；MSW 的浏览器 Worker 安装脚本未启用，集成测试使用 Node 拦截。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

界面以 Dexie 为持久状态来源；所有笔记写入经过 Application 与 Sync Engine。不要在组件里直接调用 GitHub 写端点。模块边界及易错处见[协议实现入口](protocol.md)。

## 检查

按改动选择本地命令。以下示例分别验证同步逻辑和笔记交互，可将测试文件替换为实际涉及的文件：

```sh
pnpm exec vitest run tests/sync.test.ts
pnpm exec playwright install chromium
pnpm test:e2e tests/e2e/notes.spec.ts --project=chromium
```

需要复现静态检查或扩大验证范围时，使用下列命令：

| 目的                   | 命令                              |
| ---------------------- | --------------------------------- |
| 类型检查               | `pnpm typecheck`                  |
| 代码规范与组件使用门禁 | `pnpm lint`                       |
| 格式检查               | `pnpm format:check`               |
| 完整应用单测           | `pnpm test`                       |
| CI 测试选择规则        | `node --test tests/ci/*.test.mjs` |
| 测试依赖的类名         | `pnpm check:hooks`                |
| 界面规范               | `pnpm check:ui`                   |
| 生产构建               | `pnpm build`                      |

这些命令供按需运行，提交前的验证和截图要求见[贡献指南](../CONTRIBUTING.md#validation)。跨浏览器命令与 CI 选择规则集中在[浏览器测试分层](browser-testing.md)，生产离线场景的复现方法见 [PWA 验收说明](testing-pwa.md)。

Vitest 使用真实 Markdown 解析、Milkdown、fake-indexeddb 和 MSW 验证逻辑与请求失败场景。Playwright 用测试响应替代 GitHub API，不写入远端仓库。历史验证结果及剩余手工项目见[验收记录](acceptance.md)。

### 界面开发

颜色、字号、圆角、阴影和层级使用 `src/styles/theme.css` 中的令牌；按钮、图标按钮、对话框、菜单、表单控件和提示条使用 `src/ui` 中的组件。`pnpm dev` 后打开 `/#/__ui` 可以预览全部组件，这个页面不会进入生产构建。样式规范见 [UI 统一与界面改造方案](ui-overhaul-plan.md)。

### UI 截图

`pnpm screenshots` 自动启动本地应用并用模拟数据生成截图。按改动筛选场景、保存修改前后结果，以及修改或增加截图脚本的方法见 [UI 截图指南](screenshots.md)。现有场景不足时，应补充覆盖实际改动的页面和状态。

### 品牌图标

品牌图标统一使用 `public/icon.svg` 的折角图块与 T 图形。连接页、侧栏、手机导航和 favicon 直接引用这份 SVG；PWA 的 192px／512px 图标，以及白底留出安全区的 `icon-maskable-512.png`，都由它生成。不同主题保留品牌图标自身的配色，功能按钮继续使用各自的操作图标。

修改 SVG 后执行 `node scripts/generate-icons.mjs` 重新生成 PWA 图标，需要已安装 Playwright Chromium。

## 通用静态托管

`pnpm build` 先运行 TypeScript 检查，然后生成 `dist/`。生产环境不启动 Node，不需要 API Route、云函数、数据库或服务端 Token。`pnpm preview` 仅用于检查产物。

根路径默认 base `/`。仓库路径部署需要配置公开的 `VITE_BASE_PATH`，例如 PowerShell：

```powershell
$env:VITE_BASE_PATH = '/Tebikae/'
pnpm build
Remove-Item Env:VITE_BASE_PATH
```

该值同时用于构建资源、manifest 的 start_url/scope 与 Service Worker 导航回退。路由使用 `#/notes`、`#/archive` 等；私人搜索词、标签名称、笔记内容和 Token 不进入地址。

`public/_headers` 提供支持此约定的静态托管平台响应头模板；其他平台需设置相应响应头。HTML 含 meta CSP，无法通过 meta 实现的 `frame-ancestors` 要由响应头提供。开发时 CSP 允许同源 Vite 连接；生产连接目标为同源静态文件和 `https://api.github.com`。建议使用独立 origin。

### GitHub Pages

Tebikae 使用 GitHub Pages 托管，自定义域名为 `tebikae.fog.moe`，DNS 在 Cloudflare 管理。域名提供站点根路径，部署所用的 `dist/` 由 `Check` 以 `VITE_BASE_PATH: /` 构建。

获得部署授权后，在 Actions 中运行 `Deploy Pages` 并选择 `main`，或执行：

```sh
gh workflow run pages.yml --repo scarletkc/Tebikae --ref main
```

[Pages 工作流](../.github/workflows/pages.yml)先查找目标提交的已验证产物。只有同一仓库、同一 SHA 的成功手动 `Check` 或 `Deploy Pages` 运行，且保留了 `verified-browser-builds`，才会尝试复用。该产物由全量检查通过后的 `check` 任务生成，包含根路径和子路径构建及验证记录。

[ci-verified-build.mjs](../scripts/ci-verified-build.mjs) 的 `validateBuild()` 核对提交、运行编号、完整浏览器矩阵、构建路径和 `build-info.json`，并要求产物来自不晚于当前的重试。只重跑失败的部署任务时，沿用同一运行较早重试验证过的产物；同一运行内，产物只会被再次通过全量验证的重试替换。查找失败、产物缺失或过期、下载失败、记录不匹配时，工作流调用 `Check` 重新完成静态检查、单测及三浏览器全量 E2E／PWA 验证。复用时，任务摘要链接到原验证运行。

验证成功后，部署任务进入 `github-pages` 环境审批；批准后再次核对产物并发布已验证的 `dist/`，不重新构建。任何必需检查或发布产物校验失败都会阻止部署。部署完成后，核对线上 `build-info.json` 的 commit 是否与本次发布提交一致。产物保留时间由 [Check 工作流](../.github/workflows/check.yml) 的 `verified-browser-builds` 上传步骤定义。

工作流使用 contents 读取、Pages 写入和 OIDC 权限，以及查找和下载其他运行已验证产物所需的 actions 读取权限，不使用用户笔记 Token。首次设置时，启用仓库 Pages 的 GitHub Actions 来源，在 Pages 设置中绑定 `tebikae.fog.moe`，再添加 Cloudflare DNS 记录：

| 类型  | 名称      | 目标                  | 代理     |
| ----- | --------- | --------------------- | -------- |
| CNAME | `tebikae` | `scarletkc.github.io` | DNS only |

目标不包含 `/Tebikae`。GitHub Actions 发布以仓库的 Pages 自定义域名设置为准；`public/CNAME` 会随 Vite 复制到产物，用于记录目标域名及兼容分支发布，但不能替代 Pages 设置。DNS 就绪且 GitHub 证书签发后启用 Enforce HTTPS。配置步骤依据 [GitHub 自定义域名文档](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)。

域名配置、代码推送、运行部署工作流与线上验收是独立步骤；Pages 设置和 DNS 存在不表示当前本地实现已发布。

Pages 技术兼容性不等于平台对 PAT 编辑器用途的认可。正式选择托管服务前查看 [GitHub Pages 使用限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。

## PWA

Service Worker 只预缓存应用外壳、语言、图标和延迟加载的编辑器；没有 GitHub API runtime cache。笔记离线数据来自 IndexedDB。外壳成功缓存后才显示离线就绪，新版本仅提供更新入口；点击后先等待所有编辑器序列化并写入本地，再停止同步并更新。已发出但未确认的写入会在重启时进入待核对状态。

生产 PWA 与 `/Tebikae/` 路径使用独立测试配置。命令与实测边界见 [PWA 验收说明](testing-pwa.md)。

## 可选真实仓库验收

仅在维护者提供的专用私人仓库 `scarletkc/Tebikae-dev` 执行。脚本固定检查仓库、所有者、私密性与 Issues 状态，不接受替换为任意笔记仓库。

先构建并在另一个终端运行 `pnpm preview --port 4174`，再执行：

```powershell
$env:TEBIKAE_LIVE_TEST = '1'
node scripts/test-live.mjs
Remove-Item Env:TEBIKAE_LIVE_TEST
```

脚本优先使用运行进程中的 `TEBIKAE_TEST_TOKEN`，否则读取现有 GitHub CLI 登录令牌；凭证不写文件、不启用浏览器 trace。它会创建带验收前缀的笔记及测试标签，经真实界面完成写入后将笔记留在归档，输出不含凭证的 `.artifacts/live-acceptance.json`。使用 GitHub CLI 令牌验证成功，也不能替代最小权限 fine-grained PAT 的单独验收。

## 发布和回滚

发布前保留上一份静态产物，记录应用版本、Git revision（含是否存在未提交修改）、协议版本、数据库版本与构建时间。升级编辑器后重跑源码往返、语言／主题、输入法缓冲和草稿恢复用例。旧版网页不应重写高版本元数据；回滚不能默认清空数据库。

实体中文输入法、手机软键盘、iOS 主屏幕安装、真实最小权限 PAT 以及目标托管站点的响应头与升级体验仍需要在对应设备／账号／站点执行。
