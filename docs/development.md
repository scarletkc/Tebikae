# 开发与静态部署

## 本地环境

Node.js 24；pnpm 使用 `package.json` 的 `packageManager` 精确版本。项目锁定兼容的 TypeScript 5.9 与 typescript-eslint，Milkdown 相关包保持同一版本。pnpm 的依赖构建策略见 `pnpm-workspace.yaml`；MSW 的浏览器 Worker 安装脚本未启用，集成测试使用 Node 拦截。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

界面以 Dexie 为持久状态来源；所有笔记写入经过 Application 与 Sync Engine。不要在组件里直接调用 GitHub 写端点。模块边界及易错处见[协议实现入口](protocol.md)。

## 检查

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install
pnpm test:e2e
pnpm build
```

Vitest 使用真实 Markdown 解析、Milkdown、fake-indexeddb 与 MSW 模拟请求失败。Playwright 的普通测试使用拦截的 GitHub API，不写入 GitHub。本地命令默认覆盖 Chromium、Firefox、WebKit；CI 根据改动选择浏览器和用例，普通 PR 以 Chromium 全量和 WebKit 核心流程为基础，规则及完整检查方式见[浏览器测试分层](browser-testing.md)。两类测试覆盖范围和剩余手工项目见[验收记录](acceptance.md)。

品牌图标统一使用 `public/icon.svg` 的折角纸张与 T 图形。连接页、侧栏、手机导航和 favicon 直接引用这份 SVG；PWA 的 192px／512px 图标由它生成。不同主题保留品牌图标自身的配色，功能按钮继续使用各自的操作图标。

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

Tebikae 选择 GitHub Pages 托管，自定义域名为 `tebikae.fog.moe`，DNS 在 Cloudflare 管理。域名直接提供站点根路径，因此 `.github/workflows/pages.yml` 使用 `VITE_BASE_PATH: /`，不使用仓库名路径。

仓库包含手动触发的 `.github/workflows/pages.yml`。每次部署先调用 `Check`，完成静态检查、单测及三浏览器全量 E2E／PWA 验证；全部成功后进入原有环境审批，部署同一次运行中已验证的 `dist/` 产物。工作流只有 contents 读取、Pages 写入和 OIDC 权限，没有用户笔记 Token。启用仓库 Pages 的 GitHub Actions 来源，并在仓库 Pages 设置中绑定 `tebikae.fog.moe` 后，添加 Cloudflare DNS 记录：

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

脚本优先使用运行进程中的 `TEBIKAE_TEST_TOKEN`，否则读取现有 GitHub CLI 登录令牌；凭证不写文件、不启用浏览器 trace。它会创建带验收前缀的笔记及测试标签，经真实界面完成写入后将笔记留在归档，输出不含凭证的 `.artifacts/live-acceptance.json`。使用 CLI 已登录令牌通过，不能替代最小权限 fine-grained PAT 的单独验收。

## 发布和回滚

发布前保留上一份静态产物，记录应用版本、Git revision（含是否存在未提交修改）、协议版本、数据库版本与构建时间。升级编辑器后重跑源码往返、语言／主题、输入法缓冲和草稿恢复用例。旧版网页不应重写高版本元数据；回滚不能默认清空数据库。

实体中文输入法、手机软键盘、iOS 主屏幕安装、真实最小权限 PAT 以及目标托管站点的响应头与升级体验仍需要在对应设备／账号／站点执行。
