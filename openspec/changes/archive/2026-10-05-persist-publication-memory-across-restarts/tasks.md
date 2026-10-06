# Tasks

- [x] `PersistedCatalog.publicationMemory` + restore/persist 生命周期 + `asStoredCatalog` 保留字段
- [x] `publishIfChanged` 把 memory 纳入变更检测
- [x] diagnostics 提醒状态行
- [x] `test/discovery.test.ts`：round-trip 不重复写入、跨进程抑制、material change 重新提醒、损坏记录不影响 publication
- [x] Real Pi E2E：持久化 JSON 可见、重启后不重复提醒、material change 重新提醒
