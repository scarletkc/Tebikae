# UI 统一与界面改造方案

本文是一份**可直接执行的改造手册**，分为三部分：

1. 改造前的问题和目标（第 1–2 节）。
2. **已经落地的界面规范**：令牌、组件、文件分工、写法（第 3 节）。写任何界面代码都照这一节做。
3. 剩余工作的逐步说明、验证方法和常见陷阱（第 4–8 节）。

第 9 节评估了“迁移到 Next.js”，**结论是本轮不迁移**。

> 基线版本：`72ea73b`（2026-09-25）。第 1 节描述的是基线时的状态。其余章节以当前代码为准，行号可能变化，请按函数名、类名定位。

---

## 进度（2026-09-25 更新）

| 阶段 | 内容                                                          | 状态    |
| ---- | ------------------------------------------------------------- | ------- |
| 0    | 安全网：测试钩子检查、基线截图                                | ✅ 完成 |
| 1a   | CSS 分层：旧样式放入 `legacy` 层                              | ✅ 完成 |
| 1b   | 令牌与白色配色、状态栏颜色、去掉衬线字体和小于 12px 的字号    | ✅ 完成 |
| 2    | 拆分 `App.tsx`（1568 行 → 55 行）                             | ✅ 完成 |
| 3    | 组件库 `src/ui/` 与开发预览页 `/#/__ui`                       | ✅ 完成 |
| 4a   | 按钮统一（`<Button>`、`<IconButton>`）                        | ✅ 完成 |
| 4b   | 菜单统一（5 套样式合并为 1 套）                               | ✅ 完成 |
| 4c   | 对话框统一（`Dialog`、`Sheet`、确认框改用 Radix AlertDialog） | ✅ 完成 |
| 5\*  | 规范检查脚本 `pnpm check:ui` 并接入 CI                        | ✅ 完成 |
| 4j   | 欢迎页与连接表单（去装饰）                                    | ✅ 完成 |
| 4i   | 设置页                                                        | ✅ 完成 |
| 4e   | 提示条、Toast、空状态                                         | ✅ 完成 |
| 4d   | 表单控件                                                      | ✅ 完成 |
| 4g   | 笔记卡片与列表                                                | ✅ 完成 |
| 4h   | 编辑器外框                                                    | ✅ 完成 |
| 4f   | 应用外壳（侧栏、顶栏、底部导航，App 化）                      | ✅ 完成 |
| 5    | 收尾：清空旧 CSS                                              | ✅ 完成 |

待做阶段**按表中从上到下的顺序**进行：先做风险低、用户感受最明显的，最后做测试最敏感的应用外壳。

完成阶段的验证结果：`pnpm typecheck`、`pnpm lint`、`pnpm check:hooks`、`pnpm check:ui` 通过；单元测试 322/322；chromium E2E 124/124（`--workers=4`）；PWA（`pwa-chromium`、`pages-chromium`）6/6；截图已逐张检查。

完成阶段顺带修复的问题：

- 确认框的危险按钮原来写成 `button danger primary`，但 CSS 从来没有定义 `.button.danger`，所以“永久删除”一直显示为绿色主按钮。现在显示为红色。
- 确认框原来手写了约 60 行 Tab 焦点陷阱和 Esc 处理，现已改用 Radix AlertDialog。
- 次要文字对比度提升到 WCAG AA 标准；所有小于 12px 的字号都已提高到 12px。

基线时已存在、与本改造无关的问题（不要当成自己引入的回归）：

- 截图场景 `label-menu` 在两个手机项目中失败。
- 全量 E2E 在并发较高时，下面几条偶尔会超时，单独重跑都能通过：`backup-import.spec.ts` 中的几条、`context-interactions.spec.ts:157`、`context-interactions.spec.ts:273`、`notes.spec.ts:293`。遇到时先单独重跑确认。

---

## 0. 执行者必读规则

这些规则适用于每一个 PR。**违反任何一条都视为该 PR 未完成。**

1. **一个 PR 只做一个阶段**（例如“4j 欢迎页”）。不要合并多个阶段，也不要顺手重构无关代码。
2. **不许改动这些目录**：`src/domain/`、`src/application/`、`src/sync/`、`src/storage/`、`src/security/`、`src/adapters/`。换行符变化也不行，见规则 11。
3. **不许删除或改名 JSX 中已有的 `className`**，除非这个元素本身被删除（第 4 节的装饰元素）。E2E 测试通过约 70 个类名定位元素，这些类名要作为“钩子”保留，写法是 `className={cn('note-card', '…新的 Tailwind 类…')}`。每个 PR 都要运行 `pnpm check:hooks`。
4. **不许为了让测试通过而修改测试的预期行为。** 只有阶段说明中明确写了“允许修改测试”时才可以改，并且只能按说明的方式改。
5. **用户可见文案**必须同时修改 `src/i18n/locales/en.json` 和 `src/i18n/locales/zh-CN.json`（编辑器文案在 `src/i18n/editor-*.json`）。删除 key 前，先在 `src/` 中搜索，确认没有其他引用。
6. **颜色只能用令牌**（第 3.3 节）。TSX 和 CSS 中不许出现 `#xxxxxx`、`rgb()`，`pnpm check:ui` 会拦截。
7. **不要拼接 Tailwind 类名**，例如 `` `bg-${color}` ``。需要按值切换时，写一个映射对象，列出完整类名。
8. **CSP 不能放宽**：不加内联 `<script>`，不从外部加载字体、脚本或样式。
9. **不许新增 CSS 文件，也不许往 `legacy.css` 里加规则**，`pnpm check:ui` 会拦截。新样式一律用 Tailwind 类或 `src/ui` 组件。每删掉一批旧规则，就把 `scripts/check-ui-rules.mjs` 中的 `LEGACY_MAX_LINES` 调低到新的行数；删掉一个 CSS 文件，就把它从 `ALLOWED_CSS` 中移除。
10. **UI 改动必须附修改前后的截图**，见 [CONTRIBUTING.md](../CONTRIBUTING.md#required-screenshots-for-ui-changes)。每个 PR 的最低验证清单见第 7 节。
11. **不要对整个目录运行 `prettier --write`**（例如 `prettier --write src`）。本地检出里有些文件是 LF 换行，整目录格式化会把它们（包括规则 2 中的业务文件）全部改成 CRLF。只格式化自己改过的文件。万一已经发生，用 `git diff --ignore-cr-at-eol --stat` 找出只有换行符变化的文件，再用 `git checkout -- <文件>` 还原。
12. 遇到本文没有覆盖的设计问题，**先照搬最相近组件的做法**。仍然无法决定时，在 PR 描述中写明，交给维护者决定。

---

## 1. 改造前的问题（基线 `72ea73b`）

**样式层**：

- `app.css` 有 2584 行，另有 5 个零散的 CSS 文件。
- Tailwind 已安装，但只有一行 `@import`，没有用到任何 utility 类。
- 同一选择器在多个文件中重复定义：`.sort-menu-trigger` 定义了 3 次，`.note-card` 出现在 3 个文件中。
- 约 50 个硬编码颜色，25 种圆角，36 种字号，其中 9–11px 的小字出现 50 次，z-index 有 18 个不同的值。
- 衬线与无衬线字体混用。

**组件层**：

- 没有 Button 组件，按钮靠字符串类名拼接，危险按钮有 3 种写法。
- 下拉菜单有 5 套样式，对话框有 4 种实现。
- `✓`、`＋`、`×`、`›` 这类字符与 lucide 图标混用。
- Toast 的无障碍文案是硬编码的英文。

**结构层**：

- `App.tsx` 有 1568 行，其中 `Workspace` 函数约 1400 行、包含 20 多个 `useState`。
- 同一段路由判断重复了 8 次；Issues 过滤、视图切换、新建菜单各有两份实现。

**视觉层**：

- 暖米色背景配暖白卡片，再加大面积阴影，整体发灰。
- 元信息文字只有 10–11px，控件高度不统一。
- 欢迎页有营销文案、伪造的插画和功能卖点。
- 次要文字对比度约 3.9:1，不达标。

**必须保留的约束**：

- 纯静态、无后端（[产品架构](github-issues-notes-product-architecture.md) 第 2 节）。
- 严格 CSP（`script-src 'self'`、`font-src 'self'`）。
- HashRouter。
- PWA 离线：`src/app/usePwaLifecycle.ts` 与 `tests/pwa/offline.spec.ts` 依赖 `assets/MarkdownEditor-*.js` 这种 chunk 命名。
- E2E 测试依赖类名。
- 手机端输入框字号不小于 16px（否则 iOS 聚焦时会放大页面）。

## 2. 目标与非目标

**目标**：

1. 一套令牌加一套组件，所有界面都用它们搭建。
2. 白色为主的专业笔记软件配色，深色模式同样完整。
3. 删除纯装饰内容（第 4 节）。
4. App 化与响应式（第 5 节）。
5. 结构清晰。
6. 所有测试继续通过。

**非目标**：

- 不迁移 Next.js。
- 不改 Logo。
- 不改数据协议、同步行为和快捷键。
- 不换编辑器。
- 不做原生 App 打包。

---

## 3. 界面规范（已落地）

### 3.1 技术选型（已定）

| 事项       | 决定                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| 样式       | Tailwind v4 utility 类 + CSS 变量令牌                                        |
| 组件变体   | `class-variance-authority` + `clsx` + `tailwind-merge`，统一通过 `cn()` 合并 |
| 无障碍原语 | Radix（dialog、alert-dialog、dropdown-menu、slot）                           |
| 组件库     | 不引入 MUI、Mantine、Chakra 等                                               |
| 字体       | 系统字体栈（CSP 不允许外部字体；中文字体体积太大）                           |
| 深色模式   | `<html data-theme="dark">`；令牌自动切换，组件里基本不需要写 `dark:`         |
| 动效       | 对话框、菜单使用 CSS 动画；toast、编辑器浮层、侧栏宽度仍使用 `motion`        |

### 3.2 文件分工

| 文件                                         | 作用                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/styles/layers.css`                      | 只声明 CSS 层顺序：`properties, theme, base, legacy, components, utilities`。`main.tsx` 的第一行导入它，**必须保持第一行**                                                      |
| `src/styles/theme.css`                       | **全部令牌**：颜色（浅色和深色）、字体、断点、阴影、动画关键帧，以及 `html`、`mark` 的基础样式。唯一允许出现原始颜色的样式文件                                                  |
| `src/styles/app.css`                         | 入口：`@import 'tailwindcss'`、`theme.css`，再以 `layer(legacy)` 导入 `legacy.css`                                                                                              |
| `src/styles/legacy.css`                      | 待迁移的旧样式，只许删减。它位于 `legacy` 层，**任何 Tailwind utility 都能覆盖它**                                                                                              |
| `src/features/editor/editor.css`             | ProseMirror 正文排版（允许长期保留，但只能使用令牌）                                                                                                                            |
| `src/features/notes/notes.css`、`labels.css` | 待迁移的旧样式，已包在 `@layer legacy { … }` 中                                                                                                                                 |
| `src/ui/`                                    | 组件库，见 3.5。统一从 `src/ui/index.ts` 导入                                                                                                                                   |
| `src/ui/Gallery.tsx`                         | 仅开发环境可见的组件预览页，地址 `/#/__ui`。新增组件或变体时要同步加进去                                                                                                        |
| `src/features/workspace/`                    | 工作区。**状态和操作都放在 `useWorkspaceController.ts`**，组件通过 `useWorkspace()` 读取；路由判断用 `routes.ts` 的 `isNoteListRoute()`；布局测量逻辑在 `useWorkspaceLayout.ts` |
| `scripts/check-test-hooks.mjs`               | 检查测试依赖的类名是否仍存在于 `src/`（`pnpm check:hooks`）                                                                                                                     |
| `scripts/check-ui-rules.mjs`                 | 检查本节规范（`pnpm check:ui`）：原始颜色、旧按钮类名、小于 12px 的字号、新增 CSS 文件、`legacy.css` 行数上限、行内 z-index                                                     |

### 3.3 颜色令牌

白色画布、浅灰侧栏、单一强调色（品牌绿，只用于主按钮、选中态和链接）。表中文字与背景的组合都已计算对比度，全部 ≥ 4.5:1。

| Tailwind 类名（`bg-*`、`text-*`、`border-*`）                                       | 原始变量           | 用途                   | 浅色                | 深色                |
| ----------------------------------------------------------------------------------- | ------------------ | ---------------------- | ------------------- | ------------------- |
| `canvas`                                                                            | `--bg`             | 主画布、编辑器         | `#ffffff`           | `#191919`           |
| `sidebar`                                                                           | `--sidebar`        | 侧栏、抽屉、底部导航   | `#f7f7f5`           | `#202020`           |
| `surface`                                                                           | `--surface`        | 卡片、弹出层、对话框   | `#ffffff`           | `#222222`           |
| `hover`                                                                             | `--surface-hover`  | 悬停、输入框填充       | `#f1f1ef`           | `#2a2a2a`           |
| `active`                                                                            | `--surface-active` | 按下、当前选中         | `#e9e9e6`           | `#333333`           |
| `line`                                                                              | `--border`         | 分隔线、卡片边框       | `#e6e6e3`           | `#303030`           |
| `line-strong`                                                                       | `--border-strong`  | 输入框边框             | `#d0d0cc`           | `#3d3d3d`           |
| `fg`                                                                                | `--text`           | 正文                   | `#1f2328`（15.8:1） | `#e8e8e6`（14.3:1） |
| `muted`                                                                             | `--muted`          | 次要文字、图标、元信息 | `#5f6368`（6.1:1）  | `#a3a3a0`（7.0:1）  |
| `accent`                                                                            | `--accent`         | 主按钮、链接、选中     | `#2f6f4f`（6.0:1）  | `#6fbf8f`（8.0:1）  |
| `accent-hover`、`accent-soft`、`accent-fg`                                          |                    | 悬停 / 浅底 / 按钮文字 |                     |                     |
| `danger`、`danger-soft`、`danger-fg`                                                |                    | 危险操作、错误         | `#b42318`（6.6:1）  | `#f08b7e`（7.3:1）  |
| `warning`、`warning-soft`                                                           |                    | 警告                   | `#8a5a00`（5.9:1）  | `#e3b341`（9.0:1）  |
| `mark`                                                                              | `--mark`           | 搜索高亮               | `#fff1a8`           | `#5c4b00`           |
| `overlay`                                                                           | `--overlay`        | 遮罩                   | 半透明黑            | 半透明黑            |
| `card-default`、`card-yellow`、`card-green`、`card-blue`、`card-purple`、`card-red` | `--card-*`         | 笔记颜色               | 见 theme.css        | 见 theme.css        |

- 写法示例：`bg-surface text-fg border border-line hover:bg-hover`，`text-muted`，`bg-accent text-accent-fg`。
- `theme.css` 用 `--color-*: initial` **清空了 Tailwind 默认调色板**，所以 `bg-gray-100`、`text-white` 这类类名不存在，写了也不会生效。
- 旧 CSS 使用的是同名原始变量（`var(--surface)` 等），会自动跟随新配色。
- 状态栏颜色：`public/theme.js` 在首帧前设置，`src/app/preferences.tsx` 在切换主题时从 `--bg` 读取，二者都跟随 `--bg`。调整 `--bg` 时，`theme.js` 中的两个值也要一起改。

### 3.4 字号、圆角、间距、尺寸、阴影、层级、断点

**字号**：只使用下表中的档位，**不允许小于 12px**。

| 类               | 大小    | 用途                                 |
| ---------------- | ------- | ------------------------------------ |
| `text-xs`        | 12px    | 日期、计数、徽标、帮助说明           |
| `text-sm`        | 14px    | **界面默认**：按钮、菜单、侧栏、表单 |
| `text-base`      | 16px    | 卡片标题、对话框标题、手机端输入框   |
| `text-lg`        | 18px    | 页面标题                             |
| `text-xl`        | 20px    | 欢迎页标题                           |
| `text-2xl`/`3xl` | 24/30px | 编辑器中的笔记标题（手机 / 桌面）    |

- 输入框统一写成 `text-base md:text-sm`（`src/ui/Field.tsx` 已内置）。
- 字重：正文 400；标题和按钮 500（`font-medium`）；笔记标题 600。

**圆角**：`rounded-md`（6px，菜单项、徽标）、`rounded-lg`（8px，按钮、输入框、侧栏项、提示条）、`rounded-xl`（12px，卡片、弹出菜单、分组）、`rounded-2xl`（16px，对话框）、`rounded-full`（FAB、圆点）。

**间距**：只使用 Tailwind 的 4px 档位（`1`、`2`、`3`、`4`、`5`、`6`、`8`），安全区计算除外。

**控件尺寸**（已写进组件）：

| 控件                            | 尺寸                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `Button` `sm` / `md` / `lg`     | 高 32 / 36 / 44px                                                   |
| `IconButton` `xs` / `sm` / `md` | 28 / 32 / 36px。卡片操作按钮用 `xs`，搜索栏内用 `sm`，其他默认 `md` |
| 菜单项                          | 32px；触屏（`pointer-coarse`）或屏宽 ≤600px 时为 44px               |
| 输入框                          | 36px                                                                |
| 顶栏 / 底部导航（阶段 4f）      | 56px                                                                |
| FAB                             | 56px                                                                |

按钮在触屏上**不会**自动变大。触屏上的主要操作请直接用 `size="lg"`，不要在组件里全局加 `pointer-coarse`，否则紧凑顶栏会放不下。

**阴影**：`shadow-card-hover`（卡片悬停）、`shadow-popover`（菜单）、`shadow-dialog`（对话框、编辑器）。卡片默认不加阴影，只用边框。旧 CSS 中用 `var(--shadow-card-hover)` 等同名变量。

**层级（z-index）**：`z-10` 吸顶；`z-20` 侧栏、顶栏；`z-30` FAB、底部导航；`z-40` 编辑器浮层；`z-50` 对话框；`z-55` 确认框；`z-60` 菜单；`z-70` Toast。菜单必须高于对话框。

**动效**：`animate-fade-in`（遮罩）、`animate-pop-in`（菜单、居中对话框）、`animate-sheet-in`（底部面板）、`animate-drawer-in`（左侧抽屉），都已带 `motion-reduce:animate-none`。

**断点**：`md:` = 761px（与 `useIsMobile()` 的 `max-width: 760px` 正好互补，**不要改这个阈值**）；`lg:` = 1100px；`xl:` = 1500px。需要“小于某宽度”时用 `max-md:` 等写法。

### 3.5 组件用法速查

所有组件都从 `src/ui` 导入：`import { Button, IconButton, Dialog, … } from '../../ui';`。它们的实际样式可以在 `pnpm dev` 后打开 `/#/__ui` 查看。

```tsx
// 按钮：variant = primary | secondary(默认) | ghost | danger | danger-outline | link；size = sm | md(默认) | lg
<Button variant="primary" onClick={save}><Plus /> {t('action.new')}</Button>
<Button type="submit" variant="primary">…</Button>          // 表单提交按钮必须显式写 type="submit"
<Button asChild><Link to="/issues">…</Link></Button>          // 链接外观做成按钮
<Button variant="danger-outline" className="load-more">…</Button>  // 保留钩子类

// 图标按钮：必须提供 label（会同时写入 title 和 aria-label）；pressed 表示开关状态
<IconButton label={t('action.pin')} size="xs" onClick={pin}><Pin size={16} /></IconButton>

// 对话框：挂载即打开，卸载或 onClose 即关闭；手机端为底部面板，≥761px 居中
<Dialog title={t('label.new')} size="sm" onClose={close} footer={<Button …/>}>…</Dialog>

// 确认框：继续使用 Promise 接口
if (await confirmDialog({ title, confirmLabel, danger: true })) …

// 左侧抽屉
<Sheet open={open} onOpenChange={setOpen} title={t('nav.menu')} className="mobile-drawer">…</Sheet>

// 表单
<Field label={t('label.name')} help={…} error={…}>
  {(id, describedBy) => <Input id={id} aria-describedby={describedBy} />}
</Field>
<CheckboxLabel><Checkbox checked={v} onChange={…} /> {t('…')}</CheckboxLabel>

// 提示条：tone = info | warning | danger | success
<Banner tone="warning" className="banner warning"><TriangleAlert /> …</Banner>

// 其他
<EmptyState icon={NotebookPen} title={…} description={…} action={<Button>…</Button>} />
<Card title={t('settings.appearance')}><SettingRow title=… description=…><Button size="sm">…</Button></SettingRow></Card>
<Chip onRemove={clear} removeLabel={t('filter.remove', { name })}>{name}</Chip>
<SegmentedControl value={layout} onChange={setLayout} options={[…]} />
<Spinner />
```

**菜单**：菜单不做成组件，直接在 Radix 各部件上使用 `src/ui/menu.ts` 中的类名常量：

```tsx
<DropdownMenu.Content className={cn('my-hook', menuContent)}>
  <DropdownMenu.Item className={menuItem}>
    <Pin /> …
  </DropdownMenu.Item>
  <DropdownMenu.Item className={cn(menuItem, menuItemDanger)}>
    <Trash2 /> …
  </DropdownMenu.Item>
  <DropdownMenu.Separator className={menuSeparator} />
  <DropdownMenu.Label className={menuLabel}>…</DropdownMenu.Label>
  {/* 单选列表（排序、语言）：右侧勾号 */}
  <DropdownMenu.RadioItem className={menuRadioItem}>
    …{' '}
    <DropdownMenu.ItemIndicator className={menuIndicator}>
      <Check />
    </DropdownMenu.ItemIndicator>
  </DropdownMenu.RadioItem>
</DropdownMenu.Content>
```

- **可多选项**（CheckboxItem，例如右键菜单里的标签和颜色）：选中时加粗并加下划线，部分选中时用虚线下划线，**不显示勾号**。这是 [右键菜单设计](context-menus.md) 的约定，E2E 测试会断言。
- **单选项**（RadioItem）：选中时显示右侧勾号。
- 像菜单一样的信息面板（例如同步状态面板）使用 `menuSurface`，再自行设置宽度和内边距。
- 右键菜单统一通过 `src/app/ContextMenu.tsx`，传入 `MenuAction[]` 即可，不要自己拼菜单。

### 3.6 迁移旧标记的标准做法

1. JSX 中改用组件或 Tailwind 类，**保留钩子类名**。
2. 在所有 CSS 文件中搜索这个类名，**包括组合选择器和 `@media` 中的规则**（`grep -rn "\.类名" src --include=*.css`），把需要的样式移植成 Tailwind 类，然后删除旧规则。**这一步不能省略**：旧规则虽然优先级低，但凡是 utility 没有覆盖到的属性仍会生效。例如迁移对话框时，旧的 `.dialog { top: 50%; transform: … }` 就把手机端的底部面板推到了屏幕外。
3. 旧的全局元素规则（`input`、`select`、`label > input`、`button { font-size: max(16px, 1em) }` 等）在阶段 5 删除之前一直有效。`src/ui` 的控件已经显式写了 `m-0 py-0` 和字号来抵消它们；自己写原生控件时也要注意。
4. `ContextMenu` 的外层是 `display: contents`（`contents` 类）。调用方需要其他布局时，通过 `className` 传入，例如 `className="context-card relative block"`、`className="view-toggle flex"`。
5. 新增自定义尺寸类名（例如新阴影 `shadow-xxx`）时，要在 `src/ui/cn.ts` 的 `extendTailwindMerge` 中登记，否则 `cn()` 可能把它误判为颜色并错误合并。
6. 删除规则后，把 `scripts/check-ui-rules.mjs` 中的 `LEGACY_MAX_LINES` 改为 `wc -l src/styles/legacy.css` 的新结果。

---

## 4. 删除纯装饰内容（待做，分散在 4e、4f、4h、4i、4j）

判断标准：**一个元素如果不能帮助用户写笔记、找笔记、管理笔记、连接仓库或理解数据去向，就删除或压缩它。** 隐私说明、同步状态、错误、版本号、开源链接这类功能性信息要保留；AGPL 要求提供源码入口，“查看源代码”链接必须保留。

| #   | 阶段 | 位置                                          | 元素                                  | 处理                                                                                                                                                                                                      |
| --- | ---- | --------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 4j   | `Connect.tsx` `ConnectPage`                   | 眉标 `.eyebrow`、`.tiny-line`         | 删除元素和 key `connect.eyebrow`                                                                                                                                                                          |
| D2  | 4j   | 同上                                          | 衬线双行大标题 `connect.title`        | 删除元素和 key                                                                                                                                                                                            |
| D3  | 4j   | 同上                                          | `connect.intro` 营销文案              | 改写为：“Notes are saved as Issues in your own private GitHub repository.” / “笔记以 Issue 形式保存在你自己的私有 GitHub 仓库中。”                                                                        |
| D4  | 4j   | 同上                                          | `.sample-notes` 伪造插画              | 删除元素与 `legacy.css` 中的 `.sample-*`、`.ink-line*`、`.empty-check` 规则                                                                                                                               |
| D5  | 4j   | 同上                                          | `.welcome-features` 三条卖点          | 删除元素和 keys `connect.feature1–3`、`connect.detail1–3`                                                                                                                                                 |
| D6  | 4j   | 欢迎页页脚                                    | 标语 `tagline`                        | 删除文字，只保留 GitHub 源码链接                                                                                                                                                                          |
| D7  | 4j   | `ConnectForm`                                 | `.form-symbol` 图标方块               | 删除                                                                                                                                                                                                      |
| D8  | 4j   | `ConnectForm`                                 | `connect-form-header`                 | 从表单中移除（弹窗已有 Dialog 标题）。欢迎页自己渲染 `<h1>`，复用 key `connect.formTitle`，文案改为 “Connect a GitHub repository” / “连接 GitHub 仓库”；删除 `connect.formIntro`                          |
| D9  | 4i   | `Settings.tsx`                                | 眉标 “TEBIKAE”                        | 删除                                                                                                                                                                                                      |
| D10 | 4i   | 同上                                          | 标题 `settings.title`                 | 改用 `nav.settings`，删除 `settings.title`                                                                                                                                                                |
| D11 | 4i   | 设置页“关于”                                  | 标语 `tagline`                        | 删除。D6 和 D11 都完成后，删除 key `tagline`                                                                                                                                                              |
| D12 | 4e   | `src/features/workspace/NotesView.tsx` 空状态 | `.empty-illustration` 方框            | 改用 `EmptyState`（32px `text-muted` 图标）                                                                                                                                                               |
| D13 | 4e   | 同上                                          | `home.empty`、`home.emptyDescription` | 改为 “No notes yet” / “还没有笔记”，删除描述。`home.noResults` 改为 “No matching notes” / “没有匹配的笔记”，`home.noResultsDescription` 保留                                                              |
| D14 | 4f   | 侧栏 `Brand`                                  | 43px Logo 加大号字                    | 改为 24px Logo 加 `text-sm font-semibold`，高度与顶栏一致（56px）                                                                                                                                         |
| D15 | 4f   | 侧栏 `.repository-pill`                       | 右侧 `ArrowUpRight` 图标              | 删除（这个按钮打开的是连接对话框，箭头有误导性）                                                                                                                                                          |
| D16 | 4h   | `MarkdownEditor.tsx` `.editor-modebar`        | 模式说明文字                          | 只保留切换按钮 `.editor-mode-toggle`                                                                                                                                                                      |
| D17 | 4g   | 卡片                                          | 卡片阴影                              | 卡片不加阴影，悬停时使用 `shadow-card-hover`                                                                                                                                                              |
| D18 | ✅   | 全局                                          | 衬线字体                              | 已删除                                                                                                                                                                                                    |
| D19 | 部分 | 全局                                          | 字符 `✓`、`＋`、`×`、`›`              | 侧栏、菜单、多选工具栏、颜色选择中的已替换为 lucide 图标。剩余：`NoteCard.tsx` 的 `note-selected-mark`、清单预览中的 `preview-checkbox`（4g）；`labels.css` 中 `.label-badge-remove::before` 的 `×`（4g） |

**允许修改测试**：删除上述元素时，如果有测试断言了这些文字或元素，可以删除这条断言，并在 PR 中逐条说明。截至目前，经过搜索，没有测试引用这些文案。

---

## 5. App 化与响应式规格（待做，主要在阶段 4f）

### 5.1 三档布局

```
手机 (<761px)                 平板/窄桌面 (761–1099px)          桌面 (≥1100px)
┌───────────────────┐        ┌────┬───────────────────┐        ┌──────────┬──────────────────────────┐
│≡  搜索…      ⓘ ⇅ ⚙│ 顶栏    │ ▣  │ 搜索…   ⇅ ▦ ⓘ [+新建]│        │ Tebikae  │ 搜索…     ⇅ ▦▤ ⓘ  [+ 新建] │
├───────────────────┤        │ ✎  ├───────────────────┤        │ 笔记   3 ├──────────────────────────┤
│ ┌───────────────┐ │        │ ▤  │ ┌─────┐ ┌─────┐   │        │ 归档     │ ┌─────┐ ┌─────┐ ┌─────┐  │
│ │ 卡片（单列）  │ │        │ 🗑 │ │     │ │     │   │        │ 回收站   │ │     │ │     │ │     │  │
│ └───────────────┘ │        │    │ └─────┘ └─────┘   │        │ 标签  +  │ └─────┘ └─────┘ └─────┘  │
│              (✎) │ FAB    │ 侧栏│  （2 列瀑布流）    │        │ ● Ideas  │   （3–4 列瀑布流）        │
├───────────────────┤        │ 可收│                   │        │ ⟳ 文 ☀ ⚙ │                          │
│ 笔记 归档 回收站 设置│ 底部导航│ 起  │                   │        │ [仓库]   │                          │
└───────────────────┘        └────┴───────────────────┘        └──────────┴──────────────────────────┘
```

| 项目       | 手机（`<761`）                                              | 平板（`761–1099`）                   | 桌面（`≥1100`）      |
| ---------- | ----------------------------------------------------------- | ------------------------------------ | -------------------- |
| 侧栏       | 隐藏；通过 `≡` 打开左侧 `Sheet`（已完成），里面放标签和仓库 | 保留现有的折叠、展开和记忆逻辑       | 展开，宽 240px       |
| 主导航     | **新增底部导航**：笔记、归档、回收站、设置                  | 侧栏                                 | 侧栏                 |
| 新建笔记   | FAB，位于底部导航上方                                       | 顶栏按钮（紧凑时改为 FAB，逻辑不变） | 顶栏按钮             |
| 笔记列表   | 单列（现有 `singleColumnOnly` 逻辑不变）                    | 瀑布流                               | 瀑布流               |
| 编辑器     | 全屏页面，左上角为返回箭头（已有）                          | 居中浮层 `max-w-3xl`                 | 居中浮层 `max-w-3xl` |
| 普通对话框 | 底部面板（已完成）                                          | 居中                                 | 居中                 |

侧栏宽度：展开 238px → 240px，收起 62px → 56px。这两个值是 `src/features/workspace/Workspace.tsx` 顶部的常量 `SIDEBAR_WIDTH` 和 `SIDEBAR_COLLAPSED_WIDTH`。

### 5.2 App 化清单

1. ✅ `index.html` 的 viewport 已加 `viewport-fit=cover`；状态栏颜色随主题切换；manifest 颜色已改为白色。
2. ⬜ **固定外壳，只有内容区滚动**：`.workspace` 用 `h-dvh overflow-hidden`，`.main-content` 用 `overflow-y-auto overscroll-contain`。无限滚动监听的是 `.main-content`（`useInfiniteReveal.ts`），不要改成监听 window。
3. ⬜ **安全区**：手机顶栏加 `pt-[env(safe-area-inset-top)]`；底部导航加 `pb-[env(safe-area-inset-bottom)]`；侧栏加 `ps-[env(safe-area-inset-left)]`（抽屉 `Sheet` 已处理）。
4. ⬜ **界面控件不可选中文字**：侧栏、顶栏、底部导航加 `select-none`；笔记内容、编辑器、输入框不加。**不要**在全局设置 `user-select: none`（[右键菜单设计](context-menus.md)的要求）。
5. ⬜ **按下反馈**：侧栏项和底部导航项加 `active:bg-active`，不要做缩放动画（Button 和 IconButton 已内置）。
6. ⬜ **底部导航**：新建 `src/features/workspace/BottomNav.tsx`，挂在 `Workspace.tsx` 中：
   ```tsx
   <nav
     className="bottom-nav fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-sidebar pb-[env(safe-area-inset-bottom)] select-none md:hidden"
     aria-label={t('nav.menu')}
   >
     {/* NavLink ×4：notes / archive / trash / settings */}
     {/* 每项："flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted active:bg-active aria-[current=page]:text-accent" */}
     {/* 图标 22px，与侧栏一致：NotebookPen、Archive、Trash2、Settings；点击时调用 ctl.resetNavigationState() */}
   </nav>
   ```
   - 手机端 `.main-content` 底部留白：`max-md:pb-[calc(56px+80px+env(safe-area-inset-bottom))]`。
   - FAB（`Topbar.tsx` 的 `NewNoteMenu variant="fab"`）在手机端的位置改为 `max-md:bottom-[calc(56px+16px+env(safe-area-inset-bottom))] max-md:right-4`。
   - Toast 在手机端的位置也要移到底部导航上方。
   - **允许修改测试**：如果手机端测试的 `getByRole('link', { name })` 因为同名链接变多而触发 strict mode 报错，只允许把定位范围收窄到原来的容器（例如 `page.locator('.mobile-drawer').getByRole(…)`），不得修改断言内容。

---

## 6. 实施阶段

### 6.1 已完成阶段的记录

| 阶段 | 做了什么                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 新增 `scripts/check-test-hooks.mjs`（`pnpm check:hooks`，已接入 CI）；拍摄基线截图                                                                                                                                                                                                                                                                 |
| 1a   | 旧 `app.css` 的内容移到 `legacy.css`，以 `layer(legacy)` 导入；另外 5 个 CSS 文件包进 `@layer legacy`；新建 `layers.css` 声明层顺序。像素对比确认零视觉变化                                                                                                                                                                                        |
| 1b   | 新建 `theme.css`；删除旧令牌块；约 25 处硬编码颜色改为令牌；删除衬线字体；小于 12px 的字号改为 12px；侧栏和抽屉背景改为 `--sidebar`；更新 theme-color、manifest 颜色，加上 `viewport-fit=cover`                                                                                                                                                    |
| 2    | `App.tsx` 拆分为 `src/app/usePwaLifecycle.ts`、`useContextMenuGuard.ts`，以及 `src/features/workspace/*`（控制器、Sidebar、Topbar、NotesView、IssuesView、SelectionToolbar 等），另有 `labels/CreateLabelDialog.tsx`、`issues/IssueDialog.tsx`。视图切换和新建菜单的重复实现各合并为一个组件；Issues 过滤合并为 `filterIssues()`。E2E 未做任何修改 |
| 3    | `src/ui/`：`cn`、`Button`、`IconButton`、`Dialog`/`Sheet`、`Field` 系列、`Banner`、`Display.tsx`（Chip、EmptyState、Spinner、Card、SettingRow、SegmentedControl）、`menu.ts`、`Gallery.tsx`；新增截图场景 `tests/screenshots/ui-kit.spec.ts`                                                                                                       |
| 4a   | 全部 `className="button …"`、`text-button`、`danger-button` 改为 `<Button>`；`app/ui.tsx` 的 `IconButton` 改为 re-export；FAB 改用 Button 加定位类；删除旧按钮 CSS                                                                                                                                                                                 |
| 4b   | `ContextMenu`、排序、语言、同步状态、笔记操作菜单统一使用 `menu.ts`；删除 `menus.css`、`workspace-status.css`（其中非菜单的规则移到 `legacy.css` 顶部）                                                                                                                                                                                            |
| 4c   | 所有 `Modal` 改为 `Dialog`（并按内容选择尺寸）；`confirm.tsx` 改用 Radix AlertDialog；移动抽屉改为 `Sheet`；删除旧对话框 CSS 以及对话框内容区的重复内边距                                                                                                                                                                                          |
| 5\*  | 新增 `scripts/check-ui-rules.mjs`（`pnpm check:ui`，已接入 CI）                                                                                                                                                                                                                                                                                    |

### 6.2 剩余阶段

每个阶段都要按 3.6 的“标准做法”操作，并跑完第 7 节的验证清单。

#### 4j 欢迎页与连接表单

文件：`src/features/connect/Connect.tsx`、`legacy.css` 中 `.welcome-*`、`.connect-*`、`.privacy-note`、`.cached-*`、`.sample-*`、`.ink-line*`、`.eyebrow`、`.tiny-line`、`.form-symbol` 等规则，以及 i18n。

1. 完成 D1–D8。
2. 布局：`min-h-dvh flex flex-col bg-canvas`。顶部一行 `flex h-14 items-center justify-between px-4 md:px-6` 放 `Brand` 和 `PreferencesControls`；中间 `flex-1 grid place-items-center px-4 py-8`；内容宽度 `w-full max-w-sm`。
3. 表单上方：`<h1 className="text-xl font-semibold">`（`connect.formTitle`）加一句 `text-sm text-muted` 功能说明（D3）。
4. 表单：每个字段用 `Field` + `Input`（帮助链接放进 `help`）；“记住连接”用 `CheckboxLabel` + `Checkbox`；错误用 `<Banner tone="danger" role="alert" className="error-box">`；主按钮已是 `Button variant="primary" size="lg" className="w-full"`；隐私说明 `flex gap-2 text-xs text-muted`，前面加 `LockKeyhole` 图标。
5. “此设备上的笔记”（`cached-connections`）放在表单下方，改为 `Card`，每一行用 `Button variant="ghost" className="cached-connection w-full justify-between"`。
6. 页脚 `px-4 py-4 text-xs text-muted`，只保留 GitHub 源码链接。
7. `ConnectForm` 也用在连接对话框中（`Workspace.tsx`，className 为 `connect-dialog`）。去掉 header 后，要检查对话框里的表单间距。
8. 需要保留的钩子类：`welcome-page`（如果测试用到）、`cached-connection`、`error-box`、`connect-form`。先运行 `pnpm check:hooks` 确认。
9. 截图：`welcome` 场景的 4 个项目，以及连接对话框（点击侧栏的 `.repository-pill` 即可打开，可以在 `tests/screenshots/` 中补一个场景）。

#### 4i 设置页

文件：`src/features/settings/Settings.tsx`，`legacy.css` 中 `.settings-*`、`.page-heading*`、`.repository-name`。

1. 完成 D9–D11。
2. 页面：`settings-page mx-auto w-full max-w-2xl space-y-6 px-4 py-6 md:px-6`；标题 `<h1 className="text-lg font-semibold">`。
3. 每个 `.settings-section` 改为 `<Card title=… className="settings-section">`，每一行改为 `SettingRow`。
4. 分组顺序：外观（主题、语言）→ 仓库连接 → 数据（导出、导入、持久化存储、恢复副本）→ 应用（版本、更新、源码链接）→ **危险操作**（清除此设备的数据，单独一组，使用 `danger-outline`）。
5. 页面底部的状态提示（`<p role="status" className="banner">`）改为 `Banner`。

#### 4e 提示条、Toast、空状态

1. 所有 `.banner`、`.banner.warning`、`.error-box` 和作为错误提示的 `<p role="alert">` 改为 `Banner`，并保留原有类名。主要在 `NoteDialog.tsx`、`BackupImportDialog.tsx`、`MarkdownExportDialog.tsx`、`IssueDialog.tsx`、`Workspace.tsx`（`feed.error`）中。
2. `src/app/toast.tsx`：
   - 样式改为 `toast flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-popover`，容器改为 `toast-layer fixed right-4 bottom-4 z-70 flex flex-col gap-2`，图标颜色用 `text-accent`、`text-danger`、`text-muted`，关闭按钮改用 `IconButton size="xs"`。
   - `aria-label="Notifications"` 和 `"Dismiss"` 改用新增的 key `toast.region` 和 `toast.dismiss`（中英文都要加）。
   - 删除 `legacy.css` 中的 `.toast*` 规则。
3. `App.tsx` 中的更新提示 `.update-toast` 改为 `fixed right-4 bottom-4 z-70 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-popover`。规则 `body:has([role='dialog']) .update-toast { display: none }` 暂时保留在 `legacy.css` 中。
4. `NotesView.tsx` 的空状态改用 `EmptyState`（完成 D12、D13）；`IssuesView.tsx` 的空状态也改用 `EmptyState`。
5. 删除 `.empty-state*`、`.empty-illustration`、`.banner*`、`.error-box`、`.error-banner`、`.loading-notice` 等旧规则（注意 `.loading-notice` 在 `App.tsx` 中也有使用，要一起迁移）。

#### 4d 表单控件

1. `Filters.tsx`（筛选对话框）、`CreateLabelDialog.tsx`、`LabelContextMenu.tsx`（重命名表单）、`BackupImportDialog.tsx`、`MarkdownExportDialog.tsx`、`NoteDialog.tsx`（标签选择器中的复选框）中的 `<input>`、`<select>`、`<label>` 改用 `Field`、`Input`、`Select`、`Checkbox`、`CheckboxLabel`。
2. 筛选对话框的 `fieldset`/`legend` 保留（语义正确），`legend` 用 `mb-3 text-xs font-medium text-muted`，选项区用 `flex flex-wrap gap-x-4 gap-y-2.5`。
3. 颜色选择器 `<input type="color">` 保留为原生控件，样式写成 `h-9 w-14 cursor-pointer rounded-lg border border-line-strong bg-surface p-1`。
4. 顶栏搜索框（`Topbar.tsx`）：外框 `.search-box` 用 `flex h-10 items-center gap-1 rounded-lg border border-transparent bg-hover px-1 focus-within:border-line-strong focus-within:bg-surface`；输入框 `min-w-0 flex-1 border-0 bg-transparent p-0 text-base md:text-sm outline-none placeholder:text-muted`。
5. `NoteDialog` 的标题输入框 `.note-title-input` **不要**用 `Input`，写成 `w-full border-0 bg-transparent p-0 pb-3 text-2xl md:text-3xl font-semibold leading-tight outline-none placeholder:text-muted`。
6. 删除 `legacy.css` 中对应的旧规则（`.filter-fields*`、`.date-fields*`、`.choices*`、`.check-label`、`.color-choice`、`.label-form*`、`.search-box*` 等）。全局元素规则留到阶段 5 再删。

#### 4g 笔记卡片与列表

文件：`src/features/notes/NoteCard.tsx`、`NotesGrid.tsx`、`notes.css`、`src/features/labels/LabelBadge.tsx`、`labels.css`、`src/features/filters/Filters.tsx`（`FilterChips`）、`IssuesView.tsx`。

1. `.note-card`：`rounded-xl border border-line p-4 transition-shadow hover:shadow-card-hover`。颜色用映射对象（不要拼接类名）：
   ```ts
   const cardColor = {
     default: 'bg-card-default',
     yellow: 'bg-card-yellow border-transparent',
     green: 'bg-card-green border-transparent',
     blue: 'bg-card-blue border-transparent',
     purple: 'bg-card-purple border-transparent',
     red: 'bg-card-red border-transparent',
   } satisfies Record<NoteColor, string>; // NoteColor 从 src/domain/types.ts 导入
   ```
   继续保留 `note-${color}` 钩子类（测试会用到 `.note-yellow`）。
2. 选中态用 `ring-2 ring-accent`；`note-selected-mark` 中的 `✓` 改为 `Check` 图标。
3. 标题 `text-base font-semibold line-clamp-2`；正文 `text-sm`；日期和状态 `text-xs text-muted`。
4. 清单预览的 `.preview-checkbox` 改为 `size-4 rounded border border-line-strong`，勾选时 `bg-accent border-accent text-accent-fg` 并显示 `Check` 图标。
5. `FilterChips` 改用 `Chip`（标签颜色继续使用 `labelStyle()`）。`LabelBadge` 的移除按钮把 `::before` 中的 `×` 换成 `X` 图标。
6. 卡片中的 Markdown 预览样式（`.card-rich-preview` 系列）属于内容排版，移到 `editor.css` 末尾（仍在 `@layer legacy` 中），不能改成 utility。
7. **网格间距**：如果修改卡片间距，要同时修改 `src/features/workspace/useWorkspaceLayout.ts` 中的 `GRID_GAP`（现为 18）和 CSS 中的 `gap`，否则单列与双列的切换判断会出错。
8. 完成后删除 `notes.css`、`labels.css` 及其 `import`，并把它们从 `check-ui-rules.mjs` 的 `ALLOWED_CSS` 中移除。

#### 4h 编辑器外框

文件：`src/features/notes/NoteDialog.tsx`、`MarkdownEditor.tsx`、`editor.css`，以及 `legacy.css` 中的 `.floating-editor*`、`.note-dialog*`、`.note-save-row*`、`.note-properties`、`.note-label-*`、`.conflict-*`、`.editor-layer*`、`.note-editor-footer`。

1. 浮层：桌面端 `md:h-[calc(100dvh-48px)] md:w-[min(1040px,calc(100vw-80px))] md:rounded-2xl md:border md:border-line md:shadow-dialog`；手机端 `fixed inset-0 rounded-none`，并保留 `pt-[env(safe-area-inset-top)]`（`floating-editor-mobile` 分支）。
2. 头部 `h-14 border-b border-line px-3 gap-2`；保存状态文字 `text-xs text-muted`。
3. 冲突面板改用 `Card` 加两列 `grid gap-3 md:grid-cols-2`。
4. 完成 D16。
5. `editor.css` 中 ProseMirror 的**正文排版**保留，只把颜色、圆角、字号换成令牌和规范值（正文 16px，行高 1.7）。
6. **不要改动** `NoteDialog.tsx` 中 `MarkdownEditor` 的 `lazy` 导入（PWA 离线检测依赖这个 chunk 名）。

#### 4f 应用外壳（最后做）

文件：`src/features/workspace/Sidebar.tsx`、`Topbar.tsx`、`Workspace.tsx`，新建 `BottomNav.tsx`，以及 `legacy.css` 中的 `.workspace*`、`.sidebar*`、`.main-nav`、`.nav-item*`、`.nav-count`、`.labels-heading*`、`.label-nav*`、`.label-nav-row*`、`.sidebar-bottom`、`.workspace-preferences`、`.repository-pill*`、`.connection-dot*`、`.brand*`、`.app-topbar`、`.topbar-note-actions*`、`.view-toggle*`、`.main-content*`、`.selection-toolbar`、`.drawer-close`、`.mobile-drawer .*`，以及各 `@media` 中的对应规则。

1. 按第 5 节实现。
2. 侧栏：`bg-sidebar border-r border-line`；导航项 `flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg hover:bg-hover active:bg-active`，当前项（`.active`、`.selected`）为 `bg-active font-medium`；计数 `ms-auto text-xs text-muted tabular-nums`；“标签”标题 `px-2 text-xs font-medium text-muted`（中文不要用 uppercase 和字距）。
3. 完成 D14、D15。
4. 顶栏：`h-14 border-b border-line bg-canvas px-4 gap-2`。**保留** `isCompactTopbar` 和 `singleColumnOnly` 的 JS 判断（`useWorkspaceLayout.ts`，`topbar-layout.spec.ts` 依赖它们）。
5. 视图切换的宽屏版可以改用 `SegmentedControl`，但必须保留 `view-toggle` 钩子类和两个按钮的无障碍名称。
6. 这个阶段最容易触发 `topbar-layout.spec.ts`、`sidebar-controls.spec.ts`、`context-interactions.spec.ts` 失败，建议拆成“侧栏”“顶栏”“底部导航”3 个 PR。

### 6.3 阶段 5：收尾

1. 所有组件迁移完成后，删除 `legacy.css` 中的全局元素规则（`input:not(...)`、`select`、`textarea`、`label`、`label > input`、`fieldset`、`legend`、`button { font-size: max(16px, 1em) }` 等）。删除前，确认所有原生控件都已改用 `src/ui` 组件或写了完整的 utility 类，然后检查所有对话框的截图。
2. 找出 `legacy.css` 中已经没有任何 TSX 使用的选择器，然后删除：
   ```sh
   grep -oE '\.[a-z][a-z0-9-]+' src/styles/legacy.css | sort -u | sed 's/^\.//' | while read c; do grep -rqw --include='*.tsx' --include='*.ts' -e "$c" src || echo "$c"; done
   ```
   输出中的 `note-*`、`status-*`、`toast-*` 是误报：它们由代码拼接生成（例如 `` `note-${color}` ``），实际在使用。截至目前，确认无用的规则有：`.results-toolbar*`、`.filter-button*`、`.count-badge`、`.language-icon-control*`、`.error-banner`。
3. 最终目标：`legacy.css` 只剩 `.sr-only`、`.update-toast` 显示规则等少量内容（<150 行），或者整个删除。删除文件时，同步修改 `app.css` 和 `ALLOWED_CSS`。
4. 删除 `theme.css` 中的旧令牌 `--shadow`、`--radius`（先 `grep -rn "var(--shadow)\|var(--radius)" src` 确认已无引用）。

---

## 7. 每个 PR 的最低验证清单

在 PR 描述中逐条贴出结果：

```sh
pnpm typecheck
pnpm lint
pnpm exec prettier --check <本次改动的文件>   # 不要对整个仓库运行 --write，见规则 11
pnpm test
pnpm check:hooks
pnpm check:ui
pnpm build                                   # CSS + JS 体积不应比上一版增加超过 10%
pnpm test:e2e --project=chromium --workers=4  # 本机并发过高时会出现偶发超时，见“进度”中的已知问题
```

阶段 4e、4f 和 5 还需要运行 PWA 测试。**`/Tebikae/` 子路径的构建必须在 PowerShell 中执行**：Git Bash 会把 `/Tebikae/` 自动转换成 Windows 路径，导致构建产物错误。

```powershell
pnpm build
$env:VITE_BASE_PATH = '/Tebikae/'; pnpm exec vite build --outDir .artifacts/pages-dist; Remove-Item Env:VITE_BASE_PATH
pnpm test:pwa --project=pwa-chromium --project=pages-chromium
```

截图（PowerShell）：

```powershell
$env:TEBIKAE_SCREENSHOT_RUN = 'phase-4j'   # 换成当前阶段名；修改前先用 'before' 拍一次
pnpm screenshots --project=desktop-light-en --project=desktop-dark-zh-CN --project=mobile-light-en --project=mobile-dark-zh-CN
Remove-Item Env:TEBIKAE_SCREENSHOT_RUN
pnpm exec playwright show-report .artifacts/screenshots/phase-4j/report
```

逐张检查：文字截断、元素溢出或重叠、深色模式下文字看不见、焦点环缺失、手机端被遮挡。改了组件库，还要跑 `tests/screenshots/ui-kit.spec.ts`。至少手动检查一次键盘操作：Tab 顺序、Esc 关闭、右键菜单、Shift+F10。

---

## 8. 常见陷阱

| 现象                                             | 原因和处理                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 写了 Tailwind 类但不生效                         | ① 类名是拼接出来的；② 用了已被清空的默认颜色（如 `bg-gray-100`）；③ 在 `cn()` 中被同组的后一个类覆盖了                                   |
| 迁移后元素位置奇怪（例如偏移、宽度不对）         | 钩子类的旧规则还在，它设置了 utility 没覆盖的属性（`top`、`transform`、`margin` 等）。按 3.6 第 2 步删掉旧规则                           |
| 原生输入框多出上下内边距或外边距                 | 旧的全局元素规则仍然有效（阶段 5 才删）。用 `src/ui` 控件，或自己加上 `m-0 py-0`                                                         |
| 表单点提交没反应                                 | `Button` 默认是 `type="button"`，提交按钮要显式写 `type="submit"`                                                                        |
| 禁用按钮上的右键菜单或提示消失                   | 加了 `pointer-events-none`，删掉它                                                                                                       |
| 对话框里的菜单被挡住                             | 菜单必须是 `z-60`，对话框是 `z-50`                                                                                                       |
| E2E 测量菜单位置时差几个像素                     | 菜单入场动画用了缩放。`menuSurface` 已把缩放原点设为锚点；自己写弹出层时也要加 `origin-(--radix-dropdown-menu-content-transform-origin)` |
| 右键菜单测试断言失败：`font-weight` 或下划线不对 | 可多选项的选中样式（加粗加下划线）是测试锁定的产品约定，不要改成勾号                                                                     |
| `ContextMenu` 包裹的元素布局塌了                 | 外层是 `display: contents`，通过 `className` 传入 `block` 或 `flex`                                                                      |
| 手机上点输入框时页面放大                         | 字号小于 16px，应使用 `text-base md:text-sm`                                                                                             |
| E2E 在 760px 附近失败                            | 用了写死的像素断点。项目的 `md:` 已设为 761px，直接用 `md:` / `max-md:`                                                                  |
| 深色模式下某处颜色不对                           | 写了原始颜色或 `dark:` 覆盖。改用令牌                                                                                                    |
| PWA 离线测试失败                                 | 改动了 chunk 拆分方式（`MarkdownEditor` 的 `lazy` 导入），或者 `/Tebikae/` 的构建产物是在 Git Bash 下生成的                              |
| `git status` 里出现了没改过的业务文件            | 对整个目录运行了 `prettier --write`，见规则 11                                                                                           |
| 新的自定义阴影类在 `cn()` 中被莫名合并掉         | 没有在 `src/ui/cn.ts` 中登记                                                                                                             |
| `check:hooks` 通过，但测试依赖的类名其实被误删了 | 测试中是 `toHaveCount(0)` 这类“不存在”断言，这种断言在类名被改后会永远通过。所以规则 3 要求一律不改类名                                  |

---

## 9. 关于迁移到 Next.js 的评估

### 9.1 结论

**本轮不迁移，建议继续使用 Vite。** 当前界面“丑”和“乱”的根源是样式和组件没有体系，而不是框架；阶段 0–4c 已经在 Vite 上证明了这一点。Next.js 不提供设计系统，同时会与本项目的核心约束冲突。

### 9.2 理由

| #   | Next.js 的主要能力或迁移后的变化                                                                          | 在本项目中的情况                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SSR、React Server Components、Server Actions、Route Handlers、ISR、图片优化                               | 产品要求**纯静态、无后端**。只能使用 `output: 'export'`，上述能力基本都用不上；笔记是私人数据，也不需要 SEO                                                                                                                                                                   |
| 2   | App Router 的静态导出 HTML 中含有**内联 `<script>`**（用于传递 RSC 数据，形如 `self.__next_f.push(...)`） | 与 `script-src 'self'` 冲突。Next 的 CSP nonce 方案需要动态渲染，静态导出用不了；只能放宽为 `'unsafe-inline'`，或在每次构建后计算内联脚本的 hash，这会破坏架构文档第 11.3 节的安全基线。以上判断基于当前 Next.js 的实现，是否仍然成立要在 9.5 节的试验中验证                  |
| 3   | 构建时会预渲染所有组件，包括 `'use client'` 组件                                                          | 大量代码在渲染阶段就访问 `window`、`navigator`、`localStorage`、`matchMedia`、IndexedDB（例如 `useWorkspaceLayout.ts` 中的 `useOnline()`、NoteDialog）。要么逐处加防护，要么用 `dynamic(…, { ssr: false })` 把整个应用包成一个客户端组件，那就等于在 Next 里再跑一个 Vite SPA |
| 4   | 基于文件的路由                                                                                            | 项目**刻意**使用 HashRouter：Token 和搜索词不进入 URL，静态托管刷新也不依赖服务端回退。文件路由需要为每个路由生成 HTML，并为 `/Tebikae/` 子路径配置 `basePath`；如果继续使用 hash 路由，Next 的路由能力就用不上                                                               |
| 5   | PWA                                                                                                       | 需要把 `vite-plugin-pwa` 换成 Serwist 等方案，并重写注册逻辑、离线就绪检测（`usePwaLifecycle.ts` 依赖 Vite 的 chunk 命名）和 `tests/pwa/`                                                                                                                                     |
| 6   | 工具链                                                                                                    | Vitest 配置、构建信息插件、`import.meta.env.*`、Playwright 的 `webServer`、开发预览页的 `import.meta.env.DEV` 都要改。改动面比 UI 改造更大，却不带来用户可见的收益                                                                                                            |
| 7   | “App 化”                                                                                                  | 与框架无关。项目已经是可安装的 PWA，第 5 节的外壳改造在 Vite 上就能完成；以后要上架应用商店，Capacitor 或 Tauri 可以直接打包 Vite 的静态产物                                                                                                                                  |

### 9.3 什么时候需要重新评估

- 要用 **GitHub OAuth 登录**代替 PAT。OAuth 用授权码换 token 时需要 client secret，这一步必须在服务端完成。
- 要提供官方同步服务、分享链接等需要服务端的功能。
- 要做需要 SEO 的**营销官网**。这种情况建议单独建站，不需要迁移笔记应用本身。
- `docs/roadmap.md` 中的远程 MCP 服务落地。按路线图，它应该是独立服务。

即便出现这些情况，更推荐的做法也是：**笔记应用继续保持静态 SPA，另建一个小的服务端**。

### 9.4 如果目标是“像原生 App”

- 短期（本方案覆盖）：PWA 加第 5 节的外壳改造，安装后以独立窗口运行。
- 中期（本方案之外）：用 Capacitor 打包 iOS 和 Android 应用，用 Tauri 打包桌面应用，都直接使用 `pnpm build` 生成的 `dist/`。原生容器中的 CSP、Service Worker 以及 IndexedDB 持久化都与浏览器不同，需要单独立项验证。

### 9.5 如果维护者仍然决定试验 Next.js

只允许在独立分支上做**限时 2 天的验证试验**，并且**只能在第 6 节全部完成之后进行**：

1. 新建分支 `spike/nextjs-export`，初始化 Next.js（App Router，`output: 'export'`，`basePath` 取自环境变量）。
2. 新建唯一的页面 `app/page.tsx`（`'use client'`），用 `dynamic(() => import('../src/main-app'), { ssr: false })` 加载现有应用（把 `main.tsx` 中 `createRoot` 以外的部分抽出来复用）。
3. 执行 `next build`，然后用 `grep -c "<script>" out/index.html` 统计没有 `src` 的内联脚本数量。
4. 把 `public/_headers` 中的 CSP 原样写入 `app/layout.tsx` 的 `<meta httpEquiv="Content-Security-Policy">`，用静态服务器打开 `out/`，查看控制台是否有 CSP 违规。
5. 让现有的 E2E 和 PWA 测试指向 `out/` 运行。

**继续迁移的前提（必须全部满足）**：不放宽任何 CSP 指令；E2E 和 PWA 测试全部通过；首屏 JS 体积不比 Vite 版本大 10% 以上；离线启动正常；在 `/Tebikae/` 子路径下部署正常。任一条件不满足就终止试验，并把结论记录在本节。
