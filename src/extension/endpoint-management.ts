/**
 * `/litellm-endpoints` management center: list / add / edit / delete endpoints, manage each
 * endpoint's credential, and toggle activation. Every choice, confirmation and text entry goes through
 * the host's real `ui.select / confirm / input` dialogs (TUI and RPC). See design.md D1/D4/D5/D6.
 */
import { providerIdForEndpoint } from "./provider-id.ts"
import type { EndpointActivation } from "./activation.ts"
import { DEFAULT_ENDPOINT_ID, type EndpointRegistryConfig } from "./config.ts"
import {
  ConfigStoreError,
  inspectConfig,
  mutateConfig,
  validateBaseUrl,
  validateEndpointId,
} from "./config-store.ts"
import {
  credentialState,
  removeModelsStoreEntry,
  removeStoredCredential,
  saveStoredCredential,
  validateApiKey,
} from "./host-state.ts"

export interface ManagementContext {
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>
    confirm(title: string, message: string): Promise<boolean>
    input(title: string, placeholder?: string): Promise<string | undefined>
    notify(message: string, type?: "info" | "warning" | "error"): void
  }
  modelRegistry: { refresh(input: { providers: string[]; force: boolean }): Promise<unknown> }
}

export interface ManagementHost {
  agentDir: string
  configPath: string
  env: Record<string, string | undefined>
  /** Re-read litellm.json + activation from disk (skipped for injected test state). */
  reload(): void
  registry(): EndpointRegistryConfig
  activation(): EndpointActivation
  persistActivation(next: EndpointActivation): void
  /** Re-register providers / polling to match registry + activation. */
  sync(ctx: ManagementContext): void
  /** Drop in-memory diagnostics for a deleted endpoint. */
  forget(endpointId: string): void
}

type Credential = "stored" | "environment" | "none" | "unknown"

interface EndpointView {
  id: string
  baseUrl: string
  active: boolean
  credential: Credential
}

const CREDENTIAL_LABEL: Record<Credential, string> = {
  stored: "已连接",
  environment: "已连接（环境变量）",
  none: "未连接",
  unknown: "凭据状态未知",
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createEndpointManager(host: ManagementHost) {
  const views = (): EndpointView[] => {
    const registry = host.registry()
    const activation = host.activation()
    const selected = new Set(activation.mode === "selected" ? activation.endpointIds : Object.keys(registry.endpoints))
    return Object.entries(registry.endpoints)
      .filter(([, endpoint]) => registry.mode === "explicit" || endpoint.baseUrl.length > 0)
      .map(([id, endpoint]) => {
        const stored = credentialState(host.agentDir, providerIdForEndpoint(id))
        let credential: Credential = stored === "stored" ? "stored" : stored === "unknown" ? "unknown" : "none"
        if (credential === "none" && id === DEFAULT_ENDPOINT_ID && host.env.LITELLM_API_KEY?.trim()) credential = "environment"
        return { id, baseUrl: endpoint.baseUrl, active: selected.has(id), credential }
      })
  }

  const activeIds = (): string[] => views().filter((view) => view.active).map((view) => view.id)

  const refreshProviders = async (ctx: ManagementContext, ids: string[]) => {
    if (ids.length === 0) return
    try {
      await ctx.modelRegistry.refresh({ providers: ids.map(providerIdForEndpoint), force: true })
    } catch (error) {
      ctx.ui.notify(`已保存，但刷新模型失败：${errorText(error)}`, "warning")
    }
  }

  const applyActivation = async (ctx: ManagementContext, ids: string[]) => {
    host.persistActivation({ mode: "selected", endpointIds: ids })
    host.sync(ctx)
    await refreshProviders(ctx, ids)
  }

  const fail = (ctx: ManagementContext, error: unknown) => ctx.ui.notify(errorText(error), "error")

  const promptBaseUrl = async (ctx: ManagementContext, title: string, placeholder: string): Promise<string | undefined> => {
    let heading = title
    for (;;) {
      const raw = await ctx.ui.input(heading, placeholder)
      if (raw === undefined) return undefined
      const check = validateBaseUrl(raw)
      if (check.ok) return check.value
      heading = `${title}（输入无效：${check.message}）`
    }
  }

  const addEndpoint = async (ctx: ManagementContext) => {
    let inspection
    try {
      inspection = inspectConfig(host.configPath, host.env)
    } catch (error) {
      return fail(ctx, error)
    }
    let heading = "新增 endpoint：Endpoint ID"
    let id: string
    for (;;) {
      const raw = await ctx.ui.input(heading, "company")
      if (raw === undefined) return
      const candidate = raw.trim()
      const invalid = validateEndpointId(candidate)
      if (invalid) heading = `新增 endpoint：Endpoint ID（输入无效：${invalid}）`
      else if (inspection.ids.includes(candidate)) heading = `新增 endpoint：Endpoint ID（${candidate} 已存在，请换一个）`
      else {
        id = candidate
        break
      }
    }
    const baseUrl = await promptBaseUrl(ctx, `新增 endpoint ${id}：Base URL`, "http://litellm.example:4000")
    if (baseUrl === undefined) return

    if (inspection.mode === "legacy" && inspection.ids.length > 0) {
      const fromEnv = Boolean(host.env.LITELLM_BASE_URL?.trim())
      const ok = await ctx.ui.confirm(
        "迁移为多 endpoint 配置",
        "当前使用单 endpoint（顶层 baseUrl）配置。新增第二个 endpoint 需要把现有地址迁移到 endpoints.default；" +
          "provider id、已保存的凭据和缓存保持不变。" +
          (fromEnv ? "\n现有地址来自环境变量 LITELLM_BASE_URL，迁移后会写入配置文件，且显式模式不再读取该环境变量。" : "") +
          "\n是否继续？",
      )
      if (!ok) return
    }

    try {
      // New endpoints start inactive: materialise the current active set (without the new id) first.
      host.persistActivation({ mode: "selected", endpointIds: activeIds().filter((existing) => existing !== id) })
      await mutateConfig(host.configPath, { kind: "add", id, baseUrl }, { env: host.env })
      host.reload()
      host.sync(ctx)
      ctx.ui.notify(`已添加 endpoint ${id}（未启用、未连接）。请在列表中选择它来连接 API Key 并启用。`, "info")
    } catch (error) {
      fail(ctx, error)
    }
  }

  const editBaseUrl = async (ctx: ManagementContext, view: EndpointView) => {
    const baseUrl = await promptBaseUrl(ctx, `修改 ${view.id} 的 Base URL（ID 不可修改）`, view.baseUrl)
    if (baseUrl === undefined) return
    if (baseUrl === view.baseUrl) return ctx.ui.notify("Base URL 没有变化", "info")
    try {
      await mutateConfig(host.configPath, { kind: "edit", id: view.id, baseUrl }, { env: host.env })
      host.reload()
      host.sync(ctx)
      if (view.active) await refreshProviders(ctx, [view.id])
      ctx.ui.notify(`已更新 ${view.id} 的 Base URL`, "info")
    } catch (error) {
      fail(ctx, error)
    }
  }

  const connect = async (ctx: ManagementContext, view: EndpointView) => {
    const replacing = view.credential === "stored"
    const raw = await ctx.ui.input(`${replacing ? "替换" : "连接"} ${view.id} 的 API Key`, "sk-xxx")
    if (raw === undefined) return
    const check = validateApiKey(raw)
    if (!check.ok) return ctx.ui.notify(check.message, "warning")
    try {
      await saveStoredCredential(host.agentDir, providerIdForEndpoint(view.id), check.key)
      if (view.active) await refreshProviders(ctx, [view.id])
      ctx.ui.notify(`${view.id} 的 API Key 已${replacing ? "替换" : "保存"}`, "info")
    } catch (error) {
      fail(ctx, error)
    }
  }

  const disconnect = async (ctx: ManagementContext, view: EndpointView) => {
    const ok = await ctx.ui.confirm("断开凭据", `仅删除 ${view.id} 已保存的 API Key；不会删除 endpoint，也不会改变启用状态。是否继续？`)
    if (!ok) return
    try {
      await removeStoredCredential(host.agentDir, providerIdForEndpoint(view.id))
      if (view.active) await refreshProviders(ctx, [view.id])
      ctx.ui.notify(`已断开 ${view.id} 的凭据`, "info")
    } catch (error) {
      fail(ctx, error)
    }
  }

  const deleteEndpoint = async (ctx: ManagementContext, view: EndpointView): Promise<boolean> => {
    const ok = await ctx.ui.confirm(
      `删除 endpoint ${view.id}`,
      "将彻底删除：endpoint 配置、启用状态、已保存的 API Key、模型发现缓存/快照。此操作不可撤销，其他 endpoint 不受影响。是否删除？",
    )
    if (!ok) return false
    const providerId = providerIdForEndpoint(view.id)
    try {
      // Cleanup first, definition last: a mid-way failure leaves the endpoint visible so Delete can be retried.
      host.persistActivation({ mode: "selected", endpointIds: activeIds().filter((existing) => existing !== view.id) })
      host.sync(ctx)
      await removeModelsStoreEntry(host.agentDir, providerId)
      await removeStoredCredential(host.agentDir, providerId)
      await mutateConfig(host.configPath, { kind: "delete", id: view.id }, { env: host.env })
      host.reload()
      host.sync(ctx)
      host.forget(view.id)
      await removeModelsStoreEntry(host.agentDir, providerId) // late publish from an in-flight refresh
      ctx.ui.notify(`已删除 endpoint ${view.id}`, "info")
      return true
    } catch (error) {
      ctx.ui.notify(`删除未完成（endpoint 定义仍保留，可重试）：${errorText(error)}`, "error")
      return false
    }
  }

  const detail = async (ctx: ManagementContext, id: string) => {
    for (;;) {
      host.reload()
      const view = views().find((entry) => entry.id === id)
      if (!view) return ctx.ui.notify(`未知 LiteLLM endpoint：${id}`, "warning")
      const options = [
        view.active ? "停用" : "启用",
        "修改 Base URL",
        view.credential === "stored" ? "替换 API Key" : "连接 API Key",
        ...(view.credential === "stored" ? ["断开凭据"] : []),
        "删除 endpoint",
        "返回",
      ]
      const title = `${view.id} · ${view.baseUrl} · ${view.active ? "已启用" : "未启用"} · ${CREDENTIAL_LABEL[view.credential]}`
      const choice = await ctx.ui.select(title, options)
      if (choice === undefined || choice === "返回") return
      if (choice === "启用" || choice === "停用") {
        const current = activeIds()
        await applyActivation(ctx, view.active ? current.filter((existing) => existing !== id) : [...current, id])
      } else if (choice === "修改 Base URL") await editBaseUrl(ctx, view)
      else if (choice === "连接 API Key" || choice === "替换 API Key") await connect(ctx, view)
      else if (choice === "断开凭据") await disconnect(ctx, view)
      else if (choice === "删除 endpoint" && (await deleteEndpoint(ctx, view))) return
    }
  }

  const line = (view: EndpointView) =>
    `${view.active ? "✓" : "○"} ${view.id} · ${view.active ? "已启用" : "未启用"} · ${CREDENTIAL_LABEL[view.credential]}`

  const announce = (ctx: ManagementContext) =>
    ctx.ui.notify(`已激活 endpoint：${activeIds().join(", ") || "无"}`, "info")

  async function run(args: string, ctx: ManagementContext): Promise<void> {
    host.reload()
    host.sync(ctx)
    const arg = args.trim()
    if (arg) {
      const all = views().map((view) => view.id)
      if (arg === "all") await applyActivation(ctx, all)
      else if (arg === "none") await applyActivation(ctx, [])
      else if (all.includes(arg)) {
        const current = activeIds()
        await applyActivation(ctx, current.includes(arg) ? current.filter((id) => id !== arg) : [...current, arg])
      } else return ctx.ui.notify(`未知 LiteLLM endpoint：${arg}`, "warning")
      return announce(ctx)
    }

    for (;;) {
      host.reload()
      const current = views()
      const entries = new Map<string, () => Promise<void>>()
      entries.set("＋ 新增 endpoint", () => addEndpoint(ctx))
      if (current.length > 0) {
        entries.set("全部启用", async () => { await applyActivation(ctx, current.map((view) => view.id)); announce(ctx) })
        entries.set("全部停用", async () => { await applyActivation(ctx, []); announce(ctx) })
      }
      for (const view of current) entries.set(line(view), () => detail(ctx, view.id))
      const choice = await ctx.ui.select("LiteLLM endpoints", [...entries.keys()])
      if (choice === undefined) return
      const action = entries.get(choice)
      if (action) await action()
    }
  }

  return { run }
}

export { ConfigStoreError }
