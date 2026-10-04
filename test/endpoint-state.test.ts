/**
 * Unit tests for the canonical endpoint state model. Pure, no Pi host.
 *
 * Maps to openspec specs/endpoint-state-consistency:
 * [STATE-*], [CRED-STORED-LABEL], [CRED-MISSING-IS-NOT-INVALID], [REGRESSION-MODELS-ZERO-LIMIT]
 */
import { describe, expect, test } from "bun:test"
import {
  applyErrorLabel,
  canPublish,
  canRestoreSnapshot,
  canRetry,
  credentialLabel,
  initialEndpointState,
  statusLabel,
  userVisibleStatus,
  type AppliedState,
  type CredentialState,
  type EndpointState,
  type ValidationState,
} from "../src/extension/endpoint-state.ts"

const OK: ValidationState = { kind: "ok" }
const INVALID: ValidationState = { kind: "invalid", reason: "Base URL 非法" }

const APPLIED_NOT: AppliedState = { kind: "not-applied" }
const APPLIED_ACTIVE: AppliedState = { kind: "active", modelCount: 7, lastDiscoveryAt: "2026-10-04T00:00:00Z" }
const APPLIED_ERROR: AppliedState = { kind: "error", category: "network", message: "timeout" }

function state(
  desired: "enabled" | "disabled",
  validation: ValidationState,
  credential: CredentialState,
  applied: AppliedState,
): EndpointState {
  return { endpointId: "x", desired, validation, credential, applied }
}

describe("userVisibleStatus: seven states", () => {
  test("[STATE-ENABLED-ACTIVE] enabled+valid+stored+active", () => {
    expect(userVisibleStatus(state("enabled", OK, "stored", APPLIED_ACTIVE))).toBe("enabled-active")
    expect(userVisibleStatus(state("enabled", OK, "environment", APPLIED_ACTIVE))).toBe("enabled-active")
  })

  test("[STATE-ENABLED-NEEDS-AUTH] enabled+valid+no credential → needs-authentication", () => {
    expect(userVisibleStatus(state("enabled", OK, "none", APPLIED_NOT))).toBe("enabled-needs-authentication")
    expect(userVisibleStatus(state("enabled", OK, "none", APPLIED_ACTIVE))).toBe("enabled-needs-authentication")
    expect(userVisibleStatus(state("enabled", OK, "unknown", APPLIED_NOT))).toBe("enabled-needs-authentication")
  })

  test("[STATE-ENABLED-NOT-APPLIED] enabled+valid+credential+not-applied", () => {
    expect(userVisibleStatus(state("enabled", OK, "stored", APPLIED_NOT))).toBe("enabled-not-applied")
  })

  test("[STATE-ENABLED-ERROR] enabled+valid+credential+error", () => {
    expect(userVisibleStatus(state("enabled", OK, "stored", APPLIED_ERROR))).toBe("enabled-error")
  })

  test("[STATE-DESIRED-ENABLED-INVALID] enabled+invalid → invalid-configuration regardless of credential/applied", () => {
    expect(userVisibleStatus(state("enabled", INVALID, "stored", APPLIED_ACTIVE))).toBe("enabled-invalid-configuration")
    expect(userVisibleStatus(state("enabled", INVALID, "none", APPLIED_NOT))).toBe("enabled-invalid-configuration")
    expect(userVisibleStatus(state("enabled", INVALID, "stored", APPLIED_ERROR))).toBe("enabled-invalid-configuration")
  })

  test("[STATE-DISABLED-INVALID] disabled+invalid → disabled-invalid (still listed)", () => {
    expect(userVisibleStatus(state("disabled", INVALID, "none", APPLIED_NOT))).toBe("disabled-invalid")
    expect(userVisibleStatus(state("disabled", INVALID, "stored", APPLIED_NOT))).toBe("disabled-invalid")
  })

  test("[STATE-DISABLED] disabled+valid → disabled regardless of credential/applied", () => {
    expect(userVisibleStatus(state("disabled", OK, "none", APPLIED_NOT))).toBe("disabled")
    expect(userVisibleStatus(state("disabled", OK, "stored", APPLIED_ACTIVE))).toBe("disabled")
    expect(userVisibleStatus(state("disabled", OK, "stored", APPLIED_ERROR))).toBe("disabled")
  })
})

describe("labels", () => {
  test("[CRED-STORED-LABEL] credential labels do not say connected", () => {
    expect(credentialLabel("stored")).toBe("已保存 API Key")
    expect(credentialLabel("environment")).toBe("API Key 来自环境变量")
    expect(credentialLabel("none")).toBe("未保存 API Key")
    expect(credentialLabel("unknown")).toBe("凭据状态未知")
    for (const value of ["stored", "environment", "none", "unknown"] as const) {
      const label = credentialLabel(value)
      expect(label.includes("已连接")).toBe(false)
      expect(label.toLowerCase().includes("connected")).toBe(false)
    }
  })

  test("status labels", () => {
    expect(statusLabel("enabled-active")).toBe("已启用 · 已生效")
    expect(statusLabel("enabled-needs-authentication")).toBe("已启用 · 需要认证")
    expect(statusLabel("enabled-not-applied")).toBe("已启用 · 未生效")
    expect(statusLabel("enabled-error")).toBe("已启用 · 出错")
    expect(statusLabel("enabled-invalid-configuration")).toBe("已启用 · 配置非法")
    expect(statusLabel("disabled")).toBe("未启用")
    expect(statusLabel("disabled-invalid")).toBe("未启用 · 配置非法")
  })

  test("apply error labels", () => {
    expect(applyErrorLabel("credential-missing")).toBe("缺少凭据")
    expect(applyErrorLabel("config-invalid")).toBe("配置非法")
    expect(applyErrorLabel("auth")).toBe("认证失败")
    expect(applyErrorLabel("network")).toBe("网络/上游错误")
    expect(applyErrorLabel("parse")).toBe("响应解析失败")
  })
})

describe("canPublish (strict /models predicate)", () => {
  test("[MODELS-HIDE-DISABLED] disabled never publishes", () => {
    expect(canPublish(state("disabled", OK, "stored", APPLIED_ACTIVE))).toBe(false)
  })

  test("[MODELS-HIDE-INVALID] invalid never publishes", () => {
    expect(canPublish(state("enabled", INVALID, "stored", APPLIED_ACTIVE))).toBe(false)
  })

  test("[MODELS-HIDE-UNAPPLIED] enabled but not applied publishes nothing", () => {
    expect(canPublish(state("enabled", OK, "stored", APPLIED_NOT))).toBe(false)
    expect(canPublish(state("enabled", OK, "stored", APPLIED_ERROR))).toBe(false)
  })

  test("enabled+valid+credential+active publishes", () => {
    expect(canPublish(state("enabled", OK, "stored", APPLIED_ACTIVE))).toBe(true)
    expect(canPublish(state("enabled", OK, "environment", APPLIED_ACTIVE))).toBe(true)
  })

  test("needs authentication never publishes", () => {
    expect(canPublish(state("enabled", OK, "none", APPLIED_ACTIVE))).toBe(false)
    expect(canPublish(state("enabled", OK, "unknown", APPLIED_ACTIVE))).toBe(false)
  })
})

describe("canRestoreSnapshot", () => {
  test("[MODELS-SNAPSHOT-GATE] disabled/invalid/credential-missing block snapshot restore", () => {
    expect(canRestoreSnapshot(state("disabled", OK, "stored", APPLIED_ACTIVE))).toBe(false)
    expect(canRestoreSnapshot(state("enabled", INVALID, "stored", APPLIED_NOT))).toBe(false)
    expect(canRestoreSnapshot(state("enabled", OK, "none", APPLIED_NOT))).toBe(false)
    expect(canRestoreSnapshot(state("enabled", OK, "unknown", APPLIED_NOT))).toBe(false)
  })

  test("enabled+valid+credential permits restore even without active state", () => {
    expect(canRestoreSnapshot(state("enabled", OK, "stored", APPLIED_NOT))).toBe(true)
    expect(canRestoreSnapshot(state("enabled", OK, "stored", APPLIED_ERROR))).toBe(true)
    expect(canRestoreSnapshot(state("enabled", OK, "stored", APPLIED_ACTIVE))).toBe(true)
  })
})

describe("canRetry (Retry / 重新应用 entry)", () => {
  test("[RETRY-SUCCESS] retry offered for enabled-not-applied or enabled-error", () => {
    expect(canRetry(state("enabled", OK, "stored", APPLIED_NOT))).toBe(true)
    expect(canRetry(state("enabled", OK, "stored", APPLIED_ERROR))).toBe(true)
  })

  test("[RETRY-NO-OP-FOR-DISABLED] retry not offered for disabled, invalid, or already-active", () => {
    expect(canRetry(state("disabled", OK, "stored", APPLIED_NOT))).toBe(false)
    expect(canRetry(state("disabled", INVALID, "none", APPLIED_NOT))).toBe(false)
    expect(canRetry(state("enabled", INVALID, "stored", APPLIED_NOT))).toBe(false)
    expect(canRetry(state("enabled", OK, "stored", APPLIED_ACTIVE))).toBe(false)
  })
})

describe("initialEndpointState", () => {
  test("fresh process: applied=not-applied regardless of credential", () => {
    const s = initialEndpointState("x", "enabled", OK, "stored")
    expect(s.applied).toEqual({ kind: "not-applied" })
    expect(userVisibleStatus(s)).toBe("enabled-not-applied")
  })
})

describe("[CRED-MISSING-IS-NOT-INVALID] missing credential never becomes an invalid status", () => {
  test("none / unknown are never mapped to invalid-configuration", () => {
    const statuses = new Set([
      userVisibleStatus(state("enabled", OK, "none", APPLIED_NOT)),
      userVisibleStatus(state("enabled", OK, "none", APPLIED_ERROR)),
      userVisibleStatus(state("enabled", OK, "unknown", APPLIED_NOT)),
      userVisibleStatus(state("enabled", OK, "unknown", APPLIED_ERROR)),
      userVisibleStatus(state("disabled", OK, "none", APPLIED_NOT)),
    ])
    expect(statuses.has("enabled-invalid-configuration")).toBe(false)
    expect(statuses.has("disabled-invalid")).toBe(false)
  })
})
