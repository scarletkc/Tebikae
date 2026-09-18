# 右键菜单与多选

实现依据：[右键菜单设计 #13](https://github.com/RabiMew/tebikae-notes/issues/13) 和 [窄屏子菜单修复 #15](https://github.com/scarletkc/Tebikae/issues/15)。

## 操作方式

- 桌面端右键笔记卡片或用户标签。键盘使用菜单键或 `Shift + F10`，方向键导航、Enter 执行、Escape 关闭。
- 触屏长按 500ms 打开对象菜单；移动超过 10px、滚动、松手或取消触摸会取消计时。触屏/窄屏菜单项至少 44px。长按后的点击不会打开笔记。
- 编辑区域保留触屏原生文字选择与系统手柄。标题只提供文字操作，正文按选区、列表、引用、表格、代码块通过右键/长按菜单显示对应命令。`Shift + 右键` 可保留浏览器原生菜单；系统复制粘贴快捷键不变。剪贴板权限失败会显示提示。
- 每个代码块顶部都可以选择或输入语言标识、复制代码；空语言表示 Plain Text。源码模式仍可直接修改 fenced-code language。
- `Ctrl/Cmd + 点击` 切换笔记选择，`Shift + 点击` 按当前排序范围选择；选择模式中普通点击切换选择。列表区域的 `Ctrl/Cmd + A` 和工具栏全选作用于完整筛选结果，包括尚未点击“加载更多”的笔记；文本框中的全选不受影响。
- 已选卡片上的对象菜单作用于整组选区。混合置顶/归档状态显示明确的“全部”操作。标签勾选支持三态：部分拥有时第一次点击给所有选中笔记添加，全选时点击从所有笔记移除。
- 侧栏单击标签为单标签筛选，`Ctrl/Cmd + 点击` 或旁边的 `＋ / ✓` 组合筛选使用 AND。移动侧栏点击 `＋ / ✓` 后保持打开。
- 标签 Badge 的“从此笔记移除”与全局删除分组。全局删除确认显示本地笔记中受影响的数量，不删除笔记。标签管理需要在线且可写；笔记元数据仍通过本地 outbox 同步。

## 实现边界

`ContextMenu` 复用 Radix DropdownMenu 的焦点、子菜单、碰撞定位及键盘导航；子菜单在 Radix 定位后会二次修正横向越界，确保与视口边缘至少保留 8px；触屏采用较大浮动菜单。`noteActions` 为单选和批量入口生成同一组操作，笔记更新经过 `saveEditedNote`，批量本地更新在同一事务中完成。选择状态仅保存在 React 内存中。

标签重命名、颜色更新与删除通过 `SyncEngine` 队列调用 GitHub adapter。删除成功后同步清理本地标签、当前笔记、基线和待发送快照中的标签引用，保留其他草稿字段。正文菜单复用现有 ProseMirror 命令；标题与源码文字操作保留浏览器文本编辑/撤销机制。

## 验证

新增 `tests/e2e/context-menu.spec.ts` 覆盖对象菜单、三态批量标签、标签管理、组合筛选、长按取消、键盘入口、源码格式化、结构菜单，以及中文/深色/窄屏布局；#15 的回归场景额外断言表格子菜单在桌面和 390px 视口、中英文界面下均完整位于视口内。`tests/note-selection.test.tsx` 覆盖超出初始 100 条的范围和全选；同步回归覆盖删除标签后保留草稿及禁止恢复被删标签。

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run --maxWorkers=2 --testTimeout=20000
pnpm exec playwright test tests/e2e/context-menu.spec.ts tests/e2e/editor.spec.ts tests/e2e/note-layout.spec.ts --project=chromium --workers=2
pnpm build
```

自动化触摸事件及窄屏截图不替代 iOS/Android 真机文字选择手柄、软键盘和系统剪贴板权限验证。
