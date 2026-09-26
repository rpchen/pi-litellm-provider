import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = process.cwd()

describe("dist provenance", () => {
  test("记录独立 core 仓库、main 分支和完整 SHA", () => {
    const provenance = JSON.parse(readFileSync(path.join(root, "dist", "core-provenance.json"), "utf8")) as {
      repository?: unknown
      branch?: unknown
      sha?: unknown
    }
    expect(provenance.repository).toBe("https://github.com/rpchen/litellm-discovery-core.git")
    expect(provenance.branch).toBe("main")
    expect(provenance.sha).toMatch(/^[0-9a-f]{40}$/)
    const selected = process.env.LITELLM_CORE_SHA
    if (selected) expect(provenance.sha).toBe(selected)
  })

  test("运行时入口只引用包内相对产物", () => {
    const entry = readFileSync(path.join(root, "dist", "extension", "index.js"), "utf8")
    expect(entry).not.toContain("litellm-discovery-core")
    expect(entry).not.toContain(".tmp/discovery-core")
    expect(entry).toContain("../core/index.js")
  })
})
