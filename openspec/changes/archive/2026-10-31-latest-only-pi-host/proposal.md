# Proposal

## Why

当前 Pi 已发布 1.4.0；固定旧宿主检查不能及时验证最新版本。用户要求停止旧版本测试并让最新宿主检查成为 GitHub 必需门禁。

## What Changes

- CI 和 Release 解析最新稳定 Pi 的精确版本并运行真实宿主 E2E。
- 将 GitHub 必需检查切换至稳定名称 `Real Pi latest E2E`，保留其他保护。
- 校验运行的真实 Pi 版本与解析版本完全相同。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pi-integration`: 最新稳定宿主 E2E。
- `release-governance`: Release 及分支保护切换到最新宿主检查。
- `model-audit-export`: 审计的真实宿主检查改用最新稳定 Pi。

## Impact

沿用 registerProvider、refreshModels、凭据、命令与事件 API；业务和 Core 边界不变。peer 依赖不变；当前验证 1.4.0，不推断所有未来版本兼容。GitHub 规则修改只替换必需检查，保留其余保护。
