import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  activeEndpointIds,
  loadActivation,
  saveActivation,
  toggleEndpoint,
} from "../src/extension/activation.ts"

describe("PR9 endpoint activation", () => {
  test("缺省为 all；selected 允许零个 endpoint", () => {
    const path = join(mkdtempSync(join(tmpdir(), "litellm-activation-")), "activation.json")
    expect(loadActivation(path)).toEqual({ mode: "all" })
    saveActivation({ mode: "selected", endpointIds: [] }, path)
    expect(loadActivation(path)).toEqual({ mode: "selected", endpointIds: [] })
    expect(activeEndpointIds(["default", "team"], loadActivation(path))).toEqual([])
  })

  test("all toggle 单 endpoint 后固化为 selected 集合", () => {
    expect(toggleEndpoint(["default", "team"], { mode: "all" }, "team"))
      .toEqual({ mode: "selected", endpointIds: ["default"] })
  })

  test("selected 中未知 id 被保留，但激活视图只与当前配置求交集", () => {
    const value = { mode: "selected" as const, endpointIds: ["removed", "team"] }
    expect(activeEndpointIds(["default", "team"], value)).toEqual(["team"])
  })

  test("持久化文件只保存 activation，不复制 endpoint 配置或凭据", () => {
    const path = join(mkdtempSync(join(tmpdir(), "litellm-activation-")), "activation.json")
    saveActivation({ mode: "selected", endpointIds: ["team"] }, path)
    const text = readFileSync(path, "utf8")
    expect(text).toContain('"team"')
    expect(text).not.toContain("baseUrl")
    expect(text).not.toContain("apiKey")
  })
})
