# Sync PR9 multi-endpoint specs into canonical specs

## Why

Canonical `openspec/specs/` 从未吸收已归档的 PR9 change（`openspec/changes/archive/2026-09-29-pr9-multi-endpoint-activation/`）：

- canonical specs 缺少整个 `multi-endpoint-activation` capability（PR9 delta 中的 4 条 ADDED Requirement 未落地）；
- `litellm-connection` 仍写着 PR9 之前的行为：从项目级 `.pi/litellm.json` 解析地址，且包含“项目级覆盖全局”Scenario。实现（`src/extension/config.ts`）、README（“PR9 起不再读取项目级 `.pi/litellm.json`”）与测试（`test/config.test.ts`）均已切换到全局-only 配置。

 canonical spec 与已交付行为矛盾属于 specification drift，违反共享 testing-standard 的 OpenSpec 闭环门禁（canonical spec 必须描述当前系统应具有的行为）。`test:openspec-closure` 只检查 active change 是否遗留，无法发现“archive 时 delta 未合入 canonical”的漂移，因此 CI 未拦截。

本 change 只把 canonical 规格纠正为 PR9 已交付的行为，**不修改任何产品行为**。

## What Changes

- ADD capability `multi-endpoint-activation` 到 canonical specs：恢复 PR9 归档 delta 中的 4 条 requirement（Global endpoint registry / Legacy zero-migration behavior / Independent activation / Endpoint isolation），并补写真实 Purpose（共享 testing-standard 第 7 节要求新 capability 不得遗留 placeholder Purpose）。
- MODIFY `litellm-connection` 的“LiteLLM 地址经配置文件或环境变量提供” requirement：
  - 地址来源改为全局-only：legacy 模式为 `LITELLM_BASE_URL` → 全局 `~/.pi/agent/litellm.json`；显式 `endpoints` 模式只读全局 `endpoints.<id>.baseUrl`，且 MUST NOT 读取 `LITELLM_BASE_URL`；
  - 明确 MUST NOT 读取项目级 `.pi/litellm.json`（PR9 移除，零迁移）；
  - 明确 legacy 单 endpoint 字段与 `endpoints` MUST NOT 混用；
  - 移除“项目级覆盖全局”Scenario，新增“显式 endpoints 模式忽略 LITELLM_BASE_URL”与“legacy 字段与 endpoints 混用被拒绝”Scenario（均有既有测试证据）。
