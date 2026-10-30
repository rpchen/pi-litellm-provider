# Design

## Context

用户要求 CI 和 Release 仅测试最新稳定 Pi，并更新 GitHub 必需检查；当前规则仍要求旧检查名。

## Decisions

每次运行从 npm latest 解析并验证精确版本、安装并通过 Pi 自己的安装器运行固定 Git 候选 E2E；CI 结果名称固定为 Real Pi latest E2E。先在功能分支产生新检查并通过，再只替换 ruleset 的对应检查，保持其余保护。

## Risks / Trade-offs

latest 可能引入破坏性变化，应让检查失败并定位；不再宣称持续验证旧版。共享 Core 算法及插件发现行为不变。
