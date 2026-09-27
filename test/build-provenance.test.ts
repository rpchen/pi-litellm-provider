import { describe, expect, test } from "bun:test"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { assertCleanCheckout, prepareCore } from "../scripts/prepare-core.ts"

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

  test("拒绝带未跟踪修改的 core 缓存", () => {
    const sha = process.env.LITELLM_CORE_SHA ?? JSON.parse(readFileSync(path.join(root, "dist", "core-provenance.json"), "utf8")).sha
    const selection = prepareCore({ sha })
    const marker = path.join(selection.cachePath, ".dirty-cache-review-marker")
    writeFileSync(marker, "dirty\n", "utf8")
    try {
      expect(() => assertCleanCheckout(selection.cachePath)).toThrow("不干净")
    } finally {
      rmSync(marker, { force: true })
    }
  })
})
