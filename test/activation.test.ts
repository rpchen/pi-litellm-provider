import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  activationForSelection,
  activationStatePath,
  activeEndpointIDs,
  createActivationStore,
  DEFAULT_ACTIVATION_STATE,
} from "../src/extension/activation.ts"
import type { ExtensionConfig } from "../src/extension/config.ts"

function multi(ids: string[]): ExtensionConfig {
  return {
    baseUrl: "",
    pollInterval: 300,
    contextTierCap: true,
    protocolOverrides: {},
    globalConfigPath: "/tmp/litellm.json",
    projectConfigPath: "/tmp/project/litellm.json",
    mode: "multi",
    endpoints: ids.map((id) => ({
      id,
      baseUrl: `http://${id}.example:4000`,
      protocolOverrides: {},
    })),
  }
}

describe("PR9 endpoint activation", () => {
  test("all 是默认值且后续新增 endpoint 自动激活", () => {
    expect(activeEndpointIDs(multi(["company"]), DEFAULT_ACTIVATION_STATE)).toEqual(["company"])
    expect(activeEndpointIDs(multi(["company", "personal"]), DEFAULT_ACTIVATION_STATE)).toEqual([
      "company",
      "personal",
    ])
  })

  test("selected 支持 0 active 且移除的 id 不会误激活其他 endpoint", () => {
    const none = activationForSelection(["company", "personal"], new Set(), false)
    expect(none).toEqual({ version: 1, mode: "selected", selected: [] })
    expect(activeEndpointIDs(multi(["company", "personal"]), none)).toEqual([])

    const stale = { version: 1 as const, mode: "selected" as const, selected: ["removed", "personal"] }
    expect(activeEndpointIDs(multi(["company", "personal"]), stale)).toEqual(["personal"])
  })

  test("Activate all 可以保留 all 语义，手工全选则保留 selected 语义", () => {
    const ids = ["company", "personal"]
    const selected = new Set(ids)
    expect(activationForSelection(ids, selected, true).mode).toBe("all")
    expect(activationForSelection(ids, selected, false)).toEqual({
      version: 1,
      mode: "selected",
      selected: ids,
    })
  })

  test("activation 独立持久化，不改写 litellm.json", () => {
    const root = mkdtempSync(join(tmpdir(), "litellm-activation-"))
    const globalConfigPath = join(root, "litellm.json")
    mkdirSync(root, { recursive: true })
    const store = createActivationStore(globalConfigPath)
    store.write({ version: 1, mode: "selected", selected: ["company"] })

    expect(store.read()).toEqual({ version: 1, mode: "selected", selected: ["company"] })
    expect(activationStatePath(globalConfigPath)).toBe(join(root, "litellm-activation.json"))
    expect(() => readFileSync(globalConfigPath, "utf8")).toThrow()
  })
})
