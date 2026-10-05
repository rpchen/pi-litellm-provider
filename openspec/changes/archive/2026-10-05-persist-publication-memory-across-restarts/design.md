# Design: Pi publication memory persistence

## 存储位置

复用既有的 host-persisted catalog payload（`context.stored` / `context.publish({persist})`，每 provider/endpoint 一份），新增 `publicationMemory?: unknown` 字段存放 Core 序列化后的记录。没有新建平行存储系统。

## 生命周期

1. 每次刷新开始时 `restorePublicationMemory(stored?.publicationMemory, controller)`：acknowledgement 与 `previouslyPublished` 基线恢复到 endpoint controller。
2. 成功轮次后计算 `decideAcknowledgement` + `nextPublishedBaseline`，写回 controller 并随 `publish` 持久化；`publishIfChanged` 的比较包含 memory，因此「模型与 snapshot 未变但 acknowledgement 变了」也会写入一次。
3. 失败/空清单路径沿用 `stored?.publicationMemory`，不会把已确认状态清掉。
4. 完全恢复时写入 `acknowledgement: null`（记录仍在，仅清除抑制）。

## 失败模式

`parsePublicationMemory` 返回 `undefined` 时直接忽略：最坏结果是重复提醒一次；publication 结果与 acknowledgement 无关。
