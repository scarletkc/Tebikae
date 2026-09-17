# 数据协议与实现入口

协议的规范定义保持在[架构文档第 6–9 节](github-issues-notes-product-architecture.md#6-远端数据协议)。产品品牌为 **Tebikae**；为遵循既定数据协议，远端起始标记仍是 `<!-- issue-notes`，JSON 导出格式仍为 `issue-notes-export`。这些字符串不是界面中的旧品牌。

## 代码入口

| 模块     | 实现                            | 职责                                                   |
| -------- | ------------------------------- | ------------------------------------------------------ |
| 类型     | `src/domain/types.ts`           | 笔记、快照、连接、队列与筛选契约                       |
| 元数据   | `src/domain/codec.ts`           | 版本／大小校验、四类读取结果、安全保留扩展字段、序列化 |
| Markdown | `src/domain/markdown.ts`        | CommonMark/GFM 支持检测、按 AST 源位置勾选任务         |
| 合并     | `src/domain/merge.ts`           | 完整正文作为一个字段，逐字段三方合并                   |
| 筛选     | `src/domain/filters.ts`         | 时间边界、标签匹配、排序与标签计数                     |
| GitHub   | `src/adapters/github/client.ts` | 固定 API 版本、受信分页、条件 GET、错误分类、串行请求  |
| 凭证     | `src/security/credentials.ts`   | 仅内存 Token 与会话代次                                |
| 连接保存 | `src/security/saved-session.ts` | 独立 IndexedDB 中的加密连接、不可导出密钥与恢复校验    |
| 数据库   | `src/storage/db.ts`             | `github.com:<viewerId>:<repoId>` 隔离、Dexie schema v1 |
| 命令     | `src/application/commands.ts`   | 原子保存文档与 outbox、字段意图、转换、冲突选择、导出  |
| 同步     | `src/sync/engine.ts`            | 远端核对、冻结尝试、版本确认、UUID 找回、恢复副本      |
| 互斥     | `src/sync/lock.ts`              | 同 scope 的 Web Locks 独占编辑                         |

Domain 与 GitHub Adapter 不依赖 React 或 Dexie，可用于后续 MCP；现在无需独立 SDK 包。

## 修改时必须保留的约束

- 编辑器和卡片提交字段变化时，使用 `saveEditedNote()` 和操作前的文档快照。在数据库事务内将这次意图合并到最新本地文档，避免另一个同步确认刚写入的新正文被旧界面覆盖。
- 新版本输入与已经发出的尝试分开。HTTP 成功只确认自己的 `attemptRevision`；不能用响应替换更新后的草稿。
- POST 结果未知时扫描所有 Issues 找 UUID。PATCH 结果未知时核对 `attemptSnapshot`、原基线和最新远端，不能机械重放。
- 正文 PATCH 不携带完整标签集合。标签写入采用最新名称解析和增量添加／移除，并处理正文成功、标签失败的部分确认。
- 完整拉取结束前不能标为完整。游标推进到本轮开始的远端锚点；增量读取重叠 60 秒；缓存 304 页面仍跟随缓存的 Link。
- 只读／损坏／更高版本元数据不得自动转换；保留原始数据供导出。未知扩展字段以最新远端为基础保留。
- GitHub 不提供本应用可依赖的 Issue 原子比较并交换操作。保存前读取能发现已有冲突，无法消除跨设备检查和写入间的竞争窗口；恢复副本不能被宣传为实时协作锁。

恢复副本保留最近 10 份可整理记录；未解决冲突和未知结果的副本不自动清除，因此总数可能超过 10。数据库迁移需要新增 Dexie version，不能用清空缓存作为升级方案。

## JSON 备份恢复

`src/domain/backup-import.ts` 解析 `issue-notes-export` schemaVersion 1，限制文件大小和条目数量，逐项调用文档校验。只读取 `notes[].current` 与导出标签目录；`drafts`、`conflicts` 是重复视图，不再各自导入。安全克隆保留未知元数据键，显示预览时不执行正文中的 HTML。

`src/application/backup-import.ts` 为选中条目生成独立 UUID，并按当前 scope 的同名标签映射新的标签 ID。笔记与全新 create outbox 在同一 Dexie 事务提交；事务开始和提交决定前检查编辑权限，任何失败整体回滚。预览后标签的缺失状态变化会要求重新选择文件，避免静默改变用户确认的内容。

本地笔记的可选 `importFingerprint` 保存导入源记录的 SHA-256 摘要，用于本设备、同 scope 的重复检测；摘要包含源 UUID、文档内容与标签名称，不依赖源标签 ID。字段只保存在本地记录，不写入远端笔记元数据，也不需要新增数据库索引。提交事务再次检查摘要，防止并发导入重复创建。

GitHub 创建 Issue 后初始状态为 open。对于归档草稿，同步引擎先保存 POST 返回的远端身份及部分确认，再单独 PATCH 为 closed。POST 响应丢失后通过 UUID 找回时，以实际发送的内容和 open 状态作为基线，三方合并远端后续编辑与本地后续编辑，并保留尚未完成的归档意图；同字段竞争修改进入冲突处理，不得用旧发送快照覆盖远端。找回后的剩余操作作为 update 保存；关闭失败走已有更新恢复流程，不能重发 POST。旧备份中的远端身份和未完成同步尝试不参与此过程。

## HTTP 缓存的取消边界

网络超时覆盖请求发送、接收和响应正文解析，在解析完成并确认请求仍有效后停止计时，不包含可选的 IndexedDB 缓存写入。调用方取消和会话有效性检查仍保留到请求返回；存储失败本身不得使成功的网络读取失败。

`HttpCache.put(entry, checkActive)` 必须在写事务开始和写入后、提交决定前执行有效性检查。`src/storage/http-cache.ts` 在同一个 Dexie 事务中完成这两个检查；检查失败时回滚整个写入，保留旧的有效条目。内存缓存仅在持久化步骤结束并再次通过检查后发布。

事务内最后一次有效性检查是缓存的提交决定边界。在此之前观察到的取消或会话切换会阻止缓存发布；此边界之后发生的取消仍可能使调用方收到失败，但不追溯撤销有效提交的、按账户与仓库隔离的缓存。缓存不是凭证，也不能绕过后续认证请求或会话检查。
