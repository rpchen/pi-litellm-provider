import { createServer } from "node:http"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { spawn, spawnSync } from "node:child_process"
import { strict as nodeAssert } from "node:assert"

const EXPECTED_PI_VERSION = process.env.E2E_PI_VERSION ?? "0.87.1"
const PACKAGE_SPEC = process.env.E2E_PACKAGE_SPEC?.trim()
const PI_BIN = process.env.PI_BIN?.trim() || (process.platform === "win32" ? "pi.cmd" : "pi")
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 30_000)

if (!PACKAGE_SPEC) {
  throw new Error("E2E_PACKAGE_SPEC is required and must point at an immutable Git commit or tag")
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed (${result.status}): ${command} ${args.join(" ")}`,
        result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : "",
        result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : "",
      ].filter(Boolean).join("\n"),
    )
  }
  return result.stdout.trim()
}

async function startFakeLiteLLM(name, initialKey, models) {
  const requests = []
  const state = { apiKey: initialKey, models, failStatus: 0 }
  const server = createServer((req, res) => {
    const apiKey = state.apiKey
    const authorization = req.headers.authorization ?? ""
    requests.push({ method: req.method, url: req.url, authorization })

    // [REAL-HOST-E2E] An injected outage must surface as a metadata failure
    // in diagnostics instead of silently republishing pseudo-complete models.
    if (state.failStatus) {
      res.writeHead(state.failStatus, { "content-type": "application/json" })
      res.end(JSON.stringify({ detail: "injected metadata failure" }))
      return
    }

    if (req.method !== "GET" || (req.url !== "/v1/model/info" && req.url !== "/model/info")) {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ detail: "not found" }))
      return
    }
    if (authorization !== `Bearer ${apiKey}`) {
      res.writeHead(401, { "content-type": "application/json" })
      res.end(JSON.stringify({ detail: "unauthorized" }))
      return
    }

    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ data: state.models }))
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") throw new Error(`${name}: failed to allocate local port`)
  return {
    name,
    state,
    get apiKey() { return state.apiKey },
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      // A still-running Pi holds keep-alive sockets; close() would wait forever without this.
      server.closeAllConnections?.()
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

class RpcClient {
  constructor(child) {
    this.child = child
    this.records = []
    this.stderr = ""
    this.buffer = ""
    this.waiters = new Set()
    this.exit = undefined

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => {
      this.stderr += chunk
      if (this.stderr.length > 100_000) this.stderr = this.stderr.slice(-100_000)
    })

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk
      while (true) {
        const newline = this.buffer.indexOf("\n")
        if (newline < 0) break
        const raw = this.buffer.slice(0, newline).replace(/\r$/u, "")
        this.buffer = this.buffer.slice(newline + 1)
        if (!raw) continue

        let record
        try {
          record = JSON.parse(raw)
        } catch (error) {
          this.failAll(new Error(`Pi RPC emitted non-JSON stdout: ${raw}\n${String(error)}`))
          return
        }
        this.records.push(record)
        for (const waiter of [...this.waiters]) {
          if (this.records.length <= waiter.after) continue
          if (!waiter.predicate(record)) continue
          clearTimeout(waiter.timer)
          this.waiters.delete(waiter)
          waiter.resolve(record)
        }
      }
    })

    child.once("exit", (code, signal) => {
      this.exit = { code, signal }
      if (code !== 0) {
        this.failAll(new Error(`Pi RPC exited early: code=${code} signal=${signal ?? ""}\nstderr:\n${this.stderr}`))
      }
    })
    child.once("error", (error) => this.failAll(error))
  }

  failAll(error) {
    for (const waiter of [...this.waiters]) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.waiters.clear()
  }

  waitFor(predicate, options = {}) {
    const after = options.after ?? 0
    for (let index = after; index < this.records.length; index++) {
      const record = this.records[index]
      if (predicate(record)) return Promise.resolve(record)
    }
    if (this.exit) {
      return Promise.reject(new Error(`Pi RPC already exited: ${JSON.stringify(this.exit)}\nstderr:\n${this.stderr}`))
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        after,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(new Error(`Timed out waiting for Pi RPC record after ${options.timeoutMs ?? TIMEOUT_MS}ms\nstderr:\n${this.stderr}`))
        }, options.timeoutMs ?? TIMEOUT_MS),
      }
      this.waiters.add(waiter)
    })
  }

  async request(command, options = {}) {
    const id = command.id ?? `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const after = this.records.length
    this.child.stdin.write(JSON.stringify({ ...command, id }) + "\n")
    let response
    try {
      response = await this.waitFor(
        (record) => record?.type === "response" && record.id === id,
        { after, timeoutMs: options.timeoutMs },
      )
    } catch (error) {
      throw new Error(`RPC ${command.type} (${command.message ?? ""}) got no response; exit=${JSON.stringify(this.exit)}; last records:\n${this.records.slice(-5).map((r) => JSON.stringify(r).slice(0, 300)).join("\n")}\n${error.message}`)
    }
    assert(response.success === true, `RPC command ${command.type} failed: ${response.error ?? JSON.stringify(response)}`)
    return { response, after }
  }

  async extensionCommand(message) {
    return this.request({ type: "prompt", message })
  }

  /**
   * Run a slash command whose handler opens host dialogs and answer each real
   * `extension_ui_request` (select / input / confirm) in order. Every step must match the dialog
   * the host actually asks for, so a fake menu (plain notify text) can never satisfy the flow.
   */
  async driveCommand(message, steps) {
    const id = `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`
    let cursor = this.records.length
    const start = cursor
    this.child.stdin.write(JSON.stringify({ type: "prompt", message, id }) + "\n")
    const seen = []
    for (const [index, step] of steps.entries()) {
      let request
      try {
        request = await this.waitFor(
          (record) => record?.type === "extension_ui_request" && ["select", "input", "confirm"].includes(record.method),
          { after: cursor },
        )
      } catch (error) {
        const tail = this.records.slice(start).map((r) => JSON.stringify(r).slice(0, 300)).join("\n")
        throw new Error(`${message} step ${index}: no host dialog arrived. records since command:\n${tail}\n${error.message}`)
      }
      cursor = this.records.indexOf(request) + 1
      seen.push({ method: request.method, title: request.title, options: request.options, message: request.message })
      const kind = "select" in step ? "select" : "input" in step ? "input" : "confirm"
      assert(request.method === kind, `${message} step ${index}: expected a host ${kind} dialog, got ${request.method} "${request.title}"`)
      let reply
      if (kind === "select") {
        if (step.select === undefined) reply = { cancelled: true }
        else {
          const match = request.options.find((option) => typeof step.select === "string" ? option === step.select : step.select.test(option))
          assert(match, `${message} step ${index}: no option matching ${String(step.select)} in ${JSON.stringify(request.options)}`)
          reply = { value: match }
        }
        step.check?.(request)
      } else if (kind === "input") {
        step.check?.(request)
        reply = step.input === undefined ? { cancelled: true } : { value: step.input }
      } else {
        step.check?.(request)
        reply = { confirmed: step.confirm }
      }
      this.child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: request.id, ...reply }) + "\n")
    }
    let response
    try {
      response = await this.waitFor((record) => record?.type === "response" && record.id === id, { after: start })
    } catch (error) {
      const tail = this.records.slice(start).map((r) => JSON.stringify(r).slice(0, 400)).join("\n")
      throw new Error(`${message}: prompt never completed after ${steps.length} scripted dialogs. records:\n${tail}\nstderr=${this.stderr}`)
    }
    assert(response.success === true, `${message} failed: ${response.error ?? JSON.stringify(response)}`)
    return { seen, notices: this.records.slice(start).filter((r) => r?.type === "extension_ui_request" && r.method === "notify") }
  }

  async close() {
    if (this.child.exitCode !== null) return
    this.child.stdin.end()
    await Promise.race([
      new Promise((resolve) => this.child.once("exit", resolve)),
      // Give Pi time to flush and release its own proper-lockfile locks: a force-killed holder leaves a
      // models-store.json.lock that the next Pi only reclaims after the 30s stale window.
      new Promise((resolve) => setTimeout(resolve, 15_000)),
    ])
    if (this.child.exitCode === null) this.killTree()
  }

  /** On Windows the shell wrapper is not the Pi process: kill the whole tree so no orphan contends for the agent dir. */
  killTree() {
    if (process.platform === "win32" && this.child.pid) {
      spawnSync("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { stdio: "ignore" })
    } else {
      this.child.kill("SIGTERM")
    }
  }
}

function pluginModels(response) {
  const models = response?.data?.models
  assert(Array.isArray(models), `get_available_models returned unexpected payload: ${JSON.stringify(response)}`)
  return models.filter((model) => typeof model?.provider === "string" && model.provider.startsWith("litellm"))
}

function modelInfo(modelName, mode, input = 32_000, output = 4_096, overrides = {}) {
  return {
    model_name: modelName,
    litellm_params: { model: `openai/${modelName}` },
    model_info: {
      mode,
      max_input_tokens: input,
      max_output_tokens: output,
      input_cost_per_token: 0.000001,
      output_cost_per_token: 0.000002,
      // This gate stubs models.dev to an empty catalog (and the e2e-* fixture
      // names would never match it anyway), so every capability dimension the
      // trusted publication policy requires must be declared by the endpoint
      // itself: tools, reasoning and the full modality set. A model that leaves
      // any of them unknown is blocked on purpose.
      supports_function_calling: true,
      supports_reasoning: false,
      supports_vision: false,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_video_input: false,
      supports_audio_output: false,
      ...overrides,
    },
  }
}

/** LiteLLM-only metadata with no capability declarations at all: never normally publishable. */
function reducedModelInfo(modelName, mode, input = 32_000, output = 4_096) {
  return {
    model_name: modelName,
    litellm_params: { model: `openai/${modelName}` },
    model_info: { mode, max_input_tokens: input, max_output_tokens: output },
  }
}

const root = mkdtempSync(join(tmpdir(), "pi-litellm-real-host-e2e-"))
const home = join(root, "home")
const agentDir = join(root, "agent")
const workDir = join(root, "work")
const xdgCache = join(root, "xdg-cache")
const xdgConfig = join(root, "xdg-config")
const xdgState = join(root, "xdg-state")
for (const path of [home, agentDir, workDir, xdgCache, xdgConfig, xdgState]) mkdirSync(path, { recursive: true })

const isolatedEnv = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CACHE_HOME: xdgCache,
  XDG_CONFIG_HOME: xdgConfig,
  XDG_STATE_HOME: xdgState,
  PI_CODING_AGENT_DIR: agentDir,
  PI_SKIP_VERSION_CHECK: "1",
  E2E_BOOTSTRAP_KEY: "e2e-bootstrap-key",
  npm_config_cache: join(root, "npm-cache"),
}
delete isolatedEnv.LITELLM_BASE_URL
delete isolatedEnv.LITELLM_API_KEY

let defaultServer
let companyServer
let rpc

try {
  const version = runChecked(PI_BIN, ["--version"], { cwd: workDir, env: isolatedEnv })
  assert(
    version.includes(EXPECTED_PI_VERSION),
    `Expected real Pi ${EXPECTED_PI_VERSION}, got: ${version || "<empty>"}`,
  )

  runChecked(PI_BIN, ["install", PACKAGE_SPEC], { cwd: workDir, env: isolatedEnv })
  const installed = runChecked(PI_BIN, ["list"], { cwd: workDir, env: isolatedEnv })
  assert(installed.includes("pi-litellm-provider") || installed.includes(PACKAGE_SPEC), "Pi did not list the installed LiteLLM package")

  defaultServer = await startFakeLiteLLM("default", "sk-default-e2e", [
    modelInfo("e2e-default-responses", "responses"),
    modelInfo("e2e-zero-limit", "chat", 0, 0),
    // [REAL-HOST-E2E] Incomplete metadata: positive limits but no trusted
    // reasoning/tools evidence (models.dev is stubbed to an empty catalog
    // here), so Core must keep this model out of normal registration and
    // explain it in diagnostics.
    modelInfo("e2e-incomplete-capabilities", "chat", 16_000, 2_048, {
      supports_function_calling: undefined,
      supports_reasoning: undefined,
    }),
  ])
  companyServer = await startFakeLiteLLM("company", "sk-company-e2e", [
    modelInfo("e2e-company-chat", "chat", 64_000, 8_192),
    // [REAL-HOST-E2E] Reasoning supported with no selectable levels: the host
    // must see a reasoning-capable model with no thinking level map.
    modelInfo("e2e-company-reasoning", "chat", 32_000, 4_096, { supports_reasoning: true }),
  ])

  writeFileSync(
    join(agentDir, "litellm.json"),
    JSON.stringify({
      pollInterval: 300,
      contextTierCap: false,
      endpoints: {
        default: {
          baseUrl: defaultServer.baseUrl,
          protocolOverrides: { "e2e-default-responses": "responses" },
        },
        company: {
          baseUrl: companyServer.baseUrl,
          protocolOverrides: { "e2e-company-chat": "chat" },
        },
      },
    }, null, 2) + "\n",
  )
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      litellm: { type: "api_key", key: defaultServer.apiKey },
      "litellm-company": { type: "api_key", key: companyServer.apiKey },
    }, null, 2) + "\n",
    { mode: 0o600 },
  )

  const fetchHook = join(root, "fetch-hook.mjs")
  // The stub must survive Pi's own startup: `http-dispatcher` installs undici
  // globals with a plain `globalThis.fetch = ...` assignment. A data property
  // lets that assignment land (Pi keeps its intended dispatcher wiring) while
  // the visible fetch stays ours, so the catalog source is deterministic
  // instead of depending on an external service.
  writeFileSync(fetchHook, `
const originalFetch = globalThis.fetch.bind(globalThis)
let baseFetch = originalFetch
let depth = 0
const isModelsDev = (input) => {
  let url = ""
  if (typeof input === "string") url = input
  else if (input instanceof URL) url = input.href
  else if (input && typeof input.url === "string") url = input.url
  return url === "https://models.dev/api.json"
}
const hookedFetch = (input, init) => {
  if (isModelsDev(input)) {
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  // A wrapper installed on top of this hook may call back into it; fall back to
  // the underlying implementation instead of recursing.
  if (depth > 0) return originalFetch(input, init)
  depth += 1
  try { return baseFetch(input, init) } finally { depth -= 1 }
}
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  enumerable: true,
  get() { return hookedFetch },
  set(value) { if (typeof value === "function") baseFetch = value },
})
`)

  const probeExtension = join(root, "bootstrap-probe.ts")
  writeFileSync(probeExtension, `
export default function bootstrapProbe(pi) {
  pi.registerProvider("e2e-bootstrap", {
    name: "E2E Bootstrap",
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "$E2E_BOOTSTRAP_KEY",
    api: "openai-completions",
    models: [{
      id: "bootstrap",
      name: "bootstrap",
      api: "openai-completions",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1024,
      maxTokens: 128,
    }],
  })
}
`)

  const nodeOptions = [isolatedEnv.NODE_OPTIONS, `--import=${pathToFileURL(fetchHook).href}`]
    .filter(Boolean)
    .join(" ")
  const nodeOptionsValue = nodeOptions
  const probeExtensionPath = probeExtension
  const child = spawn(
    PI_BIN,
    [
      "--mode", "rpc",
      "--no-session",
      "--extension", probeExtension,
      "--model", "e2e-bootstrap/bootstrap",
    ],
    {
      cwd: workDir,
      env: { ...isolatedEnv, NODE_OPTIONS: nodeOptions },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  )
  rpc = new RpcClient(child)

  const commandsResult = await rpc.request({ type: "get_commands" })
  const commands = commandsResult.response?.data?.commands
  assert(Array.isArray(commands), "get_commands did not return a command list")
  for (const name of ["litellm-endpoints", "litellm-diagnostics", "litellm-audit-export"]) {
    const command = commands.find((entry) => entry?.name === name)
    assert(command, `Real Pi did not load extension command /${name}`)
    assert(command.source === "extension", `/${name} is not an extension command`)
    assert(command.sourceInfo?.origin === "package", `/${name} was not loaded from an installed package`)
  }

  const activateAll = await rpc.extensionCommand("/litellm-endpoints all")
  await rpc.waitFor(
    (record) =>
      record?.type === "extension_ui_request" &&
      record.method === "notify" &&
      typeof record.message === "string" &&
      record.message.includes("已激活 endpoint：default, company"),
    { after: activateAll.after },
  )

  const allModelsResult = await rpc.request({ type: "get_available_models" })
  const allModels = pluginModels(allModelsResult.response)
  const defaultModel = allModels.find((model) => model.provider === "litellm" && model.id === "e2e-default-responses")
  const companyModel = allModels.find((model) => model.provider === "litellm-company" && model.id === "e2e-company-chat")
  assert(defaultModel, "Real Pi did not expose default endpoint model")
  assert(companyModel, "Real Pi did not expose company endpoint model")
  assert(defaultModel.api === "openai-responses", `Default model API mismatch: ${defaultModel.api}`)
  assert(companyModel.api === "openai-completions", `Company model API mismatch: ${companyModel.api}`)
  assert(defaultModel.contextWindow > 0 && defaultModel.maxTokens > 0, "Default model has non-operational limits")
  assert(companyModel.contextWindow > 0 && companyModel.maxTokens > 0, "Company model has non-operational limits")
  assert(!allModels.some((model) => model.id === "e2e-zero-limit"), "Real Pi exposed a zero-limit model")
  assert(allModels.every((model) => model.contextWindow > 0 && model.maxTokens > 0), "Real Pi exposed non-positive model limits")
  // [REAL-HOST-E2E] Publication boundary: a model without trustworthy tool/reasoning
  // evidence must not enter normal registration even with positive limits.
  assert(
    !allModels.some((model) => model.id === "e2e-incomplete-capabilities"),
    "Real Pi exposed a model with unknown key capabilities as a normal model",
  )
  // [REAL-HOST-E2E] Reasoning follows the Core verdict: supported-without-levels
  // registers as reasoning-capable with no thinkingLevelMap; a confirmed
  // non-reasoning model registers with reasoning: false.
  const reasoningModel = allModels.find((model) => model.provider === "litellm-company" && model.id === "e2e-company-reasoning")
  assert(reasoningModel, "Real Pi did not expose the reasoning-supported company model")
  assert(reasoningModel.reasoning === true, `Reasoning model must advertise reasoning, got: ${reasoningModel.reasoning}`)
  assert(
    !reasoningModel.thinkingLevelMap || Object.values(reasoningModel.thinkingLevelMap).every((value) => value === null),
    `Reasoning model must expose no selectable levels: ${JSON.stringify(reasoningModel.thinkingLevelMap)}`,
  )
  assert(defaultModel.reasoning === false, `Confirmed non-reasoning model must not advertise reasoning: ${defaultModel.reasoning}`)

  assert(defaultServer.requests.length > 0, "Default fake LiteLLM received no discovery request")
  assert(companyServer.requests.length > 0, "Company fake LiteLLM received no discovery request")
  assert(
    defaultServer.requests.every((request) => request.authorization === `Bearer ${defaultServer.apiKey}`),
    "Default endpoint received a wrong credential",
  )
  assert(
    companyServer.requests.every((request) => request.authorization === `Bearer ${companyServer.apiKey}`),
    "Company endpoint received a wrong credential",
  )
  assert(
    !defaultServer.requests.some((request) => request.authorization.includes(companyServer.apiKey)),
    "Company credential leaked to default endpoint",
  )
  assert(
    !companyServer.requests.some((request) => request.authorization.includes(defaultServer.apiKey)),
    "Default credential leaked to company endpoint",
  )

  const diagnostics = await rpc.extensionCommand("/litellm-diagnostics default")
  const diagnosticNotice = await rpc.waitFor(
    (record) =>
      record?.type === "extension_ui_request" &&
      record.method === "notify" &&
      typeof record.message === "string" &&
      record.message.includes("Endpoint：default"),
    { after: diagnostics.after },
  )
  assert(diagnosticNotice.message.includes("状态：正常"), "Diagnostics did not report a ready endpoint")
  assert(diagnosticNotice.message.includes("已注册模型：1"), "Diagnostics model count is not the host-visible count")
  // [REAL-HOST-E2E] Publication diagnostics name the incomplete model and its gaps.
  assert(
    diagnosticNotice.message.includes("未完成：e2e-incomplete-capabilities"),
    "Diagnostics did not report the incomplete model as blocked",
  )
  assert(
    diagnosticNotice.message.includes("capabilities.tools") && diagnosticNotice.message.includes("reasoning"),
    "Diagnostics did not report which capability fields are unknown",
  )
  assert(!diagnosticNotice.message.includes(defaultServer.apiKey), "Diagnostics leaked the API key")
  assert(!diagnosticNotice.message.includes(defaultServer.baseUrl), "Diagnostics leaked the LiteLLM URL")
  // [REAL-HOST-E2E] Diagnostics carry the short Runtime Identity of the running artifact.
  assert(diagnosticNotice.message.includes("Runtime Identity"), "Diagnostics did not show the Runtime Identity section")
  const pluginVersion = (diagnosticNotice.message.match(/Plugin Version\s+(\S+)/u) ?? [])[1]
  const shortDigest = (diagnosticNotice.message.match(/Artifact\s+([0-9a-f]{8}|unknown)/u) ?? [])[1]
  const shortCore = (diagnosticNotice.message.match(/Core Commit\s+([0-9a-f]{8}|unknown)/u) ?? [])[1]
  assert(pluginVersion && pluginVersion !== "unknown", "Diagnostics plugin version is missing")
  assert(shortDigest && shortDigest !== "unknown", "Diagnostics artifact digest is missing")
  assert(shortCore && shortCore !== "unknown", "Diagnostics core commit is missing")

  // [REAL-HOST-E2E] Audit export carries the full Runtime Identity of the same artifact.
  const auditRun = await rpc.extensionCommand("/litellm-audit-export default")
  const auditNotice = await rpc.waitFor(
    (record) =>
      record?.type === "extension_ui_request" &&
      record.method === "notify" &&
      typeof record.message === "string" &&
      record.message.includes("LiteLLM 审查报告已导出"),
    { after: auditRun.after },
  )
  const auditPath = (auditNotice.message.match(/([A-Za-z]:[\\/][^\s"']+?litellm-audit-[^\s"']+\.json|\/[^\s"']+?litellm-audit-[^\s"']+\.json)/u) ?? [])[1]
  assert(auditPath, `Audit notice did not contain a report path: ${auditNotice.message.slice(0, 300)}`)
  assert(existsSync(auditPath), `Audit report file does not exist: ${auditPath}`)
  const auditReport = JSON.parse(readFileSync(auditPath, "utf8"))
  assert(auditReport?.runtimeIdentity?.pluginVersion === pluginVersion, "Audit plugin version differs from diagnostics")
  assert(
    typeof auditReport?.runtimeIdentity?.artifactDigest === "string"
      && /^sha256:[0-9a-f]{64}$/u.test(auditReport.runtimeIdentity.artifactDigest)
      && auditReport.runtimeIdentity.artifactDigest.slice(7, 15) === shortDigest,
    "Audit artifact digest is invalid or differs from diagnostics",
  )
  assert(
    typeof auditReport?.runtimeIdentity?.coreCommit === "string"
      && /^[0-9a-f]{40}$/u.test(auditReport.runtimeIdentity.coreCommit)
      && auditReport.runtimeIdentity.coreCommit.slice(0, 8) === shortCore,
    "Audit core commit is invalid or differs from diagnostics",
  )
  const auditSerialized = JSON.stringify(auditReport)
  assert(!auditSerialized.includes(defaultServer.apiKey), "Audit leaked the API key")
  assert(!auditSerialized.includes(defaultServer.baseUrl) && !auditSerialized.includes("baseUrl"), "Audit leaked the LiteLLM URL")
  // [REAL-HOST-E2E] The running artifact identity matches the installed package provenance.
  {
    const candidates = []
    const roots = [agentDir, home, xdgState, xdgConfig]
    const visit = (dir, depth = 0) => {
      if (depth > 6 || candidates.length > 0) return
      let names = []
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      if (names.includes("runtime-identity.json") && names.includes("core-provenance.json")) {
        candidates.push(dir)
        return
      }
      for (const name of names) {
        if (name === "node_modules" || name.startsWith(".")) continue
        let entry = null
        try {
          entry = statSync(join(dir, name))
        } catch {
          continue
        }
        if (entry.isDirectory()) visit(join(dir, name), depth + 1)
      }
    }
    for (const dir of roots) visit(dir)
    assert(candidates.length > 0, "Installed package runtime identity was not found under the isolated Pi dirs")
    const installedIdentity = JSON.parse(readFileSync(join(candidates[0], "runtime-identity.json"), "utf8"))
    const installedProvenance = JSON.parse(readFileSync(join(candidates[0], "core-provenance.json"), "utf8"))
    nodeAssert.deepEqual(auditReport.runtimeIdentity, installedIdentity, "Audit identity differs from the installed package")
    assert(installedIdentity.coreCommit === installedProvenance.sha, "Installed identity coreCommit differs from provenance")
  }

  // [REAL-HOST-E2E] The extension startup log records the same Runtime Identity.
  assert(
    typeof rpc.stderr === "string" && rpc.stderr.includes("LiteLLM Runtime Identity"),
    "Extension startup did not log the Runtime Identity",
  )
  assert(rpc.stderr.includes(`plugin=${pluginVersion}`), "Startup plugin version differs from diagnostics")
  assert(rpc.stderr.includes(`artifact=${shortDigest}`), "Startup artifact digest differs from diagnostics")
  assert(rpc.stderr.includes(`core=${shortCore}`), "Startup core commit differs from diagnostics")

  await rpc.extensionCommand("/litellm-endpoints none")
  const noneModelsResult = await rpc.request({ type: "get_available_models" })
  assert(pluginModels(noneModelsResult.response).length === 0, "Deactivated endpoints remained visible in real Pi")

  await rpc.extensionCommand("/litellm-endpoints default")
  const defaultOnlyResult = await rpc.request({ type: "get_available_models" })
  const defaultOnly = pluginModels(defaultOnlyResult.response)
  assert(defaultOnly.some((model) => model.provider === "litellm" && model.id === "e2e-default-responses"), "Default endpoint did not reactivate")
  assert(!defaultOnly.some((model) => model.provider === "litellm-company"), "Company endpoint remained active after default-only activation")

  const activation = JSON.parse(readFileSync(join(agentDir, "litellm.activation.json"), "utf8"))
  assert(
    activation.mode === "selected" &&
      Array.isArray(activation.endpointIds) &&
      activation.endpointIds.length === 1 &&
      activation.endpointIds[0] === "default",
    `Unexpected persisted activation state: ${JSON.stringify(activation)}`,
  )

  // ===== Phase 1b: trusted publication verdicts through the real host =====
  const diagnosticsNotice = async (needle, label) => {
    let last = "<none>"
    for (let attempt = 0; attempt < 80; attempt++) {
      const run = await rpc.extensionCommand("/litellm-diagnostics default")
      const notice = await rpc.waitFor(
        (record) =>
          record?.type === "extension_ui_request" &&
          record.method === "notify" &&
          typeof record.message === "string" &&
          record.message.includes("Endpoint：default"),
        { after: run.after },
      )
      last = notice.message
      if (notice.message.includes(needle)) return notice
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`real Pi diagnostics never reported: ${label ?? needle}\nlast diagnostics:\n${last}`)
  }

  const acceptDegraded = async (args) => {
    const run = await rpc.extensionCommand(`/litellm-accept-degraded ${args}`)
    const notice = await rpc.waitFor(
      (record) =>
        record?.type === "extension_ui_request" &&
        record.method === "notify" &&
        typeof record.message === "string" &&
        /已接受降级：|拒绝降级：|已是完整配置|未知或不可降级模型|用法：litellm-accept-degraded/.test(record.message),
      { after: run.after },
    )
    return notice.message
  }

  const publicationModels = async () =>
    pluginModels((await rpc.request({ type: "get_available_models" })).response)

  // `--no-session` Pi stops endpoint polling once a prompt ends, so Phase 1b
  // drives discovery through the endpoint manager instead of waiting for a
  // background poll. "全部启用" re-applies the current active set, and the
  // manager always force-refreshes those providers before finishing.
  const forceRefresh = async () => {
    await rpc.driveCommand("/litellm-endpoints", [
      { select: "全部启用" },
      { select: undefined },
    ])
  }

  // Partition: only the fully evidenced model registers; illegal limits and
  // unknown capabilities stay blocked with their reasons on screen.
  await forceRefresh()
  const baselineNotice = await diagnosticsNotice(
    "模型配置：可用 1 · 未完成 2 · 降级 0 · LKG 0",
    "the initial publication partition",
  )
  assert(baselineNotice.message.includes("状态：正常"), `Diagnostics did not report a ready endpoint: ${baselineNotice.message}`)
  console.log(`[publication baseline]\n${baselineNotice.message}`)
  // Both metadata sources report their own status; neither is ever faked.
  assert(
    baselineNotice.message.includes("/v1/model/info：ok · /v1/models：未作为发现源"),
    `the model-info source status must be visible: ${baselineNotice.message}`,
  )
  assert(
    baselineNotice.message.includes("models.dev：degraded"),
    `models.dev unavailability must stay visible in diagnostics: ${baselineNotice.message}`,
  )
  assert(
    baselineNotice.message.includes("未完成：e2e-zero-limit · invalid-metadata"),
    `illegal limits must stay visible in diagnostics: ${baselineNotice.message}`,
  )

  // Ineligible states never claim a successful accept.
  assert(
    (await acceptDegraded("default e2e-zero-limit")).startsWith("拒绝降级：e2e-zero-limit"),
    "an invalid-metadata model must be rejected by accept-degraded",
  )
  assert(
    (await acceptDegraded("default e2e-default-responses")).includes("已是完整配置"),
    "a fully configured model must not be accepted as degraded",
  )
  assert(
    (await acceptDegraded("default e2e-unknown-model")).includes("未知或不可降级模型"),
    "an unknown model must not be accepted as degraded",
  )
  assert(
    (await acceptDegraded("nowhere e2e-incomplete-capabilities")).includes("用法：litellm-accept-degraded"),
    "an unknown endpoint must not be accepted as degraded",
  )
  assert(
    (await publicationModels()).filter((model) => model.provider === "litellm").length === 1,
    "a rejected accept-degraded must not register anything",
  )

  // Live capability evidence disappears for a previously configured model:
  // only a provably belonging LKG snapshot may keep it registered.
  defaultServer.state.models = [
    reducedModelInfo("e2e-default-responses", "responses"),
    modelInfo("e2e-zero-limit", "chat", 0, 0),
    modelInfo("e2e-incomplete-capabilities", "chat", 16_000, 2_048, {
      supports_function_calling: undefined,
      supports_reasoning: undefined,
    }),
  ]
  await forceRefresh()
  const lkgNotice = await diagnosticsNotice("LKG 提供：e2e-default-responses", "the valid LKG substitution")
  assert(
    lkgNotice.message.includes("模型配置：可用 1 · 未完成 2 · 降级 0 · LKG 1"),
    `unexpected LKG publication summary: ${lkgNotice.message}`,
  )
  assert(
    (await publicationModels()).some((model) => model.provider === "litellm" && model.id === "e2e-default-responses"),
    "the LKG-backed model disappeared from real Pi",
  )

  // An eligible blocked model registers only through the degraded path and
  // keeps the degraded label with its gaps; it is never re-labelled configured.
  const accepted = await acceptDegraded("default e2e-incomplete-capabilities")
  assert(accepted.startsWith("已接受降级：e2e-incomplete-capabilities"), `eligible accept failed: ${accepted}`)
  const degradedNotice = await diagnosticsNotice("已接受降级：e2e-incomplete-capabilities", "the degraded acceptance")
  assert(
    degradedNotice.message.includes("模型配置：可用 2 · 未完成 1 · 降级 1 · LKG 1"),
    `unexpected degraded publication summary: ${degradedNotice.message}`,
  )
  assert(degradedNotice.message.includes("仍标记为降级，非完整配置"), "diagnostics must keep the degraded label")
  assert(
    !degradedNotice.message.includes("未完成：e2e-incomplete-capabilities"),
    "an accepted degraded model must leave the blocked list",
  )
  assert(
    (await publicationModels()).some((model) => model.provider === "litellm" && model.id === "e2e-incomplete-capabilities"),
    "the accepted degraded model did not register",
  )

  // A real metadata outage is reported, never hidden. `/litellm-endpoints`
  // re-registers the provider, so the first failure of that fresh lifecycle is
  // the discovery-error branch: the host keeps the last catalog, and the
  // diagnostics show the failure, its counter and the retry time.
  defaultServer.state.failStatus = 500
  await forceRefresh()
  const failureNotice = await diagnosticsNotice("状态：发现失败", "the metadata failure")
  assert(
    failureNotice.message.includes("说明：发现失败；详细错误已通过宿主日志记录。"),
    `failure note missing: ${failureNotice.message}`,
  )
  assert(
    /failures=[1-9]\d*/u.test(failureNotice.message),
    `the failure counter must be visible during the outage: ${failureNotice.message}`,
  )
  assert(failureNotice.message.includes("下次允许重试："), `the retry state must be visible: ${failureNotice.message}`)
  assert(
    failureNotice.message.includes("已注册模型：1"),
    `the outage must keep the last registered models: ${failureNotice.message}`,
  )
  assert(!failureNotice.message.includes("状态：正常"), `the endpoint must not look healthy during the outage: ${failureNotice.message}`)
  assert(
    (await publicationModels()).some((model) => model.provider === "litellm" && model.id === "e2e-default-responses"),
    "the endpoint dropped its models instead of keeping the last good catalog",
  )
  assert(
    rpc.stderr.includes("LiteLLM 发现失败"),
    `the metadata failure must be visible in the host log: ${rpc.stderr.slice(-400)}`,
  )

  // Retry recovery: complete trustworthy metadata returns it to normal.
  defaultServer.state.failStatus = 0
  await forceRefresh()
  const recoveredNotice = await diagnosticsNotice("状态：正常", "the retry recovery")
  assert(recoveredNotice.message.includes("LKG 提供：e2e-default-responses"), "LKG selection must survive recovery")
  assert(
    recoveredNotice.message.includes("已接受降级：e2e-incomplete-capabilities"),
    "degraded acceptance must survive recovery",
  )
  console.log(
    "real Pi publication E2E ok: partition, reasoning verdict, LKG substitution, degraded accept/reject and metadata-failure diagnostics verified",
  )

  // ===== Phase 2: Endpoint Management UX (real host dialogs, full vertical) =====
  await rpc.close().catch(() => {})
  rpc = undefined

  const SECRET_A = "sk-e2e-mgmt-one"
  const SECRET_B = "sk-e2e-mgmt-two"
  const SECRET_C = "sk-e2e-mgmt-three"
  const mgmtA = await startFakeLiteLLM("mgmt-a", SECRET_A, [modelInfo("e2e-mgmt-alpha", "chat", 48_000, 6_000)])
  const mgmtB = await startFakeLiteLLM("mgmt-b", SECRET_B, [modelInfo("e2e-mgmt-beta", "responses", 96_000, 8_000)])
  const untouched = await startFakeLiteLLM("untouched", "sk-e2e-untouched", [modelInfo("e2e-untouched", "chat")])
  try {
    const configPath = join(agentDir, "litellm.json")
    const authFile = join(agentDir, "auth.json")
    const storeFile = join(agentDir, "models-store.json")
    const activationFile = join(agentDir, "litellm.activation.json")
    const readJson = (file) => JSON.parse(readFileSync(file, "utf8"))
    const exists = (file) => { try { readFileSync(file); return true } catch { return false } }

    // Canonical config written by hand, with fields the UI does not manage; "untouched" is a bystander.
    writeFileSync(configPath, JSON.stringify({
      pollInterval: 300,
      contextTierCap: false,
      handWrittenNote: { keep: "me" },
      endpoints: {
        untouched: { baseUrl: untouched.baseUrl, protocolOverrides: { "e2e-untouched": "chat" }, mine: 1 },
      },
    }, null, 2) + "\n")
    writeFileSync(authFile, JSON.stringify({ "litellm-untouched": { type: "api_key", key: untouched.apiKey } }, null, 2) + "\n", { mode: 0o600 })
    writeFileSync(activationFile, JSON.stringify({ mode: "selected", endpointIds: ["untouched"] }) + "\n")
    rmSync(storeFile, { force: true })

    const noKeyLeak = (result, ...secrets) => {
      const blob = JSON.stringify({ seen: result.seen, notices: result.notices })
      for (const secret of secrets) assert(!blob.includes(secret), "an API key was echoed to the host UI")
    }
    const startMgmtPi = () => {
      const began = Date.now()
      const child = spawn(PI_BIN, ["--mode", "rpc", "--no-session", "--extension", probeExtensionPath, "--model", "e2e-bootstrap/bootstrap"], {
        cwd: workDir,
        env: { ...isolatedEnv, NODE_OPTIONS: nodeOptionsValue },
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      })
      const client = new RpcClient(child)
      client.startedAt = began
      return client
    }
    const readyWithin = async (client, label) => {
      const began = Date.now()
      // A Pi stopped mid-refresh can leave the host's models-store.json.lock until its 30s stale window
      // passes (host behaviour, not ours); allow for it instead of failing the restart check.
      await client.request({ type: "get_commands" }, { timeoutMs: 90_000 })
      console.log(`${label}: Pi answered get_commands in ${Date.now() - began}ms`)
    }
    let lastStage = "init"
    const stage = (name) => { lastStage = name }
    const litellmModels = async (client) => {
      try {
        return pluginModels((await client.request({ type: "get_available_models" })).response)
      } catch (error) {
        throw new Error(`get_available_models failed at stage "${lastStage}": ${error.message}\nlast records: ${client.records.slice(-4).map((r) => JSON.stringify(r).slice(0, 300)).join("\n")}`)
      }
    }
    const untilModels = async (client, predicate, label) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const models = await litellmModels(client)
        if (predicate(models)) return models
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error(`models did not converge: ${label}; last=${JSON.stringify((await litellmModels(client)).map((m) => `${m.provider}/${m.id}`))}`)
    }

    rpc = startMgmtPi()
    try {
      await rpc.request({ type: "get_commands" })
    } catch (error) {
      throw new Error(`second Pi never answered get_commands: ${error.message}\nexit=${JSON.stringify(rpc.exit)} stderr=${rpc.stderr}\nrecords=${JSON.stringify(rpc.records.slice(0, 5))}`)
    }

    stage("1 list")
    // 1. list: bystander shows enabled + active + saved API Key. Drive one full refresh
    // through the endpoint manager the same way Phase 1b does, then wait for /models.
    // "全部启用" with activation=selected["untouched"] is a no-op for activation state
    // but forces a refreshModels for the bystander in a fresh --no-session Pi (which has
    // no session_start event to drive refresh on its own).
    await rpc.driveCommand("/litellm-endpoints", [
      { select: "全部启用" },
      { select: undefined },
    ])
    await untilModels(rpc, (list) => list.some((m) => m.provider === "litellm-untouched"), "stage 1 bootstrap")
    let result = await rpc.driveCommand("/litellm-endpoints", [
      { select: undefined, check: (r) => {
        assert(r.options.includes("＋ 新增 endpoint"), "Add is not offered as a real select option")
        assert(r.options.includes("✓ untouched · 已启用 · 已生效 · 已保存 API Key"), `unexpected list: ${JSON.stringify(r.options)}`)
      } },
    ])

    stage("2 add")
    // 2. Add (ID + Base URL only) → inactive / no saved credential; nothing auto-activated
    result = await rpc.driveCommand("/litellm-endpoints", [
      { select: "＋ 新增 endpoint" },
      { input: "e2e-new", check: (r) => assert(/Endpoint ID/.test(r.title), "Add must first ask for the ID") },
      { input: mgmtA.baseUrl, check: (r) => assert(/Base URL/.test(r.title), "Add must then ask for the Base URL") },
      { select: undefined, check: (r) => assert(r.options.includes("○ e2e-new · 未启用 · 未保存 API Key"), `new endpoint must be inactive/without a saved key: ${JSON.stringify(r.options)}`) },
    ])
    let config = readJson(configPath)
    assert(config.endpoints["e2e-new"]?.baseUrl === mgmtA.baseUrl, "Add did not write the endpoint")
    assert(Object.keys(config.endpoints).join() === "untouched,e2e-new", "Add changed endpoint order/membership")
    assert(config.handWrittenNote?.keep === "me" && config.contextTierCap === false && config.pollInterval === 300, "Add lost global/unknown fields")
    assert(config.endpoints.untouched.mine === 1 && config.endpoints.untouched.protocolOverrides["e2e-untouched"] === "chat", "Add touched a bystander endpoint")
    assert(readJson(activationFile).endpointIds.join() === "untouched", "Add must not activate the new endpoint")
    assert(!(await litellmModels(rpc)).some((m) => m.provider === "litellm-e2e-new"), "inactive endpoint exposed a model")
    assert(mgmtA.requests.length === 0, "creating an endpoint must not trigger discovery")

    stage("3 connect")
    // 3. Connect key (inactive) → key saved, still inactive, still no models
    result = await rpc.driveCommand("/litellm-endpoints", [
      { select: /e2e-new/ },
      { select: "连接 API Key" },
      { input: SECRET_A },
      { select: "返回", check: (r) => assert(/未启用 · 已保存 API Key/.test(r.title), "connect must not activate") },
      { select: undefined },
    ])
    noKeyLeak(result, SECRET_A)
    assert(readJson(authFile)["litellm-e2e-new"]?.key === SECRET_A, "credential was not stored under the endpoint's provider id")
    assert(readJson(activationFile).endpointIds.join() === "untouched", "Connect must not change activation")
    assert(!(await litellmModels(rpc)).some((m) => m.provider === "litellm-e2e-new"), "saved-key but inactive endpoint exposed a model")

    stage("4 activate")
    // 4. Activate → models appear at once with the right credential
    await rpc.driveCommand("/litellm-endpoints", [{ select: /e2e-new/ }, { select: "启用" }, { select: "返回" }, { select: undefined }])
    let models = await untilModels(rpc, (list) => list.some((m) => m.provider === "litellm-e2e-new" && m.id === "e2e-mgmt-alpha"), "activate")
    assert(models.find((m) => m.id === "e2e-mgmt-alpha").contextWindow === 48_000, "model limits were not mapped")
    assert(mgmtA.requests.length > 0 && mgmtA.requests.every((r) => r.authorization === `Bearer ${SECRET_A}`), "discovery did not use the saved key")
    assert(models.some((m) => m.provider === "litellm-untouched"), "bystander endpoint lost its models")

    stage("5 edit")
    // 5. Edit Base URL → advanced field preserved; new address used
    writeFileSync(configPath, JSON.stringify({ ...readJson(configPath), endpoints: { ...readJson(configPath).endpoints, "e2e-new": { baseUrl: mgmtA.baseUrl, protocolOverrides: { "e2e-mgmt-beta": "responses" }, hand: "written" } } }, null, 2) + "\n")
    mgmtB.state.apiKey = SECRET_A // same key is valid on the new address
    const beforeB = mgmtB.requests.length
    result = await rpc.driveCommand("/litellm-endpoints", [
      { select: /e2e-new/ },
      { select: "修改 Base URL" },
      { input: mgmtB.baseUrl, check: (r) => assert(/ID 不可修改/.test(r.title) && r.placeholder === mgmtA.baseUrl, "edit must be Base-URL-only with the ID read-only") },
      { select: "返回" },
      { select: undefined },
    ])
    config = readJson(configPath)
    assert(config.endpoints["e2e-new"].baseUrl === mgmtB.baseUrl, "Edit did not write the new Base URL")
    assert(config.endpoints["e2e-new"].protocolOverrides["e2e-mgmt-beta"] === "responses" && config.endpoints["e2e-new"].hand === "written", "Edit dropped fields the UI does not manage")
    models = await untilModels(rpc, (list) => list.some((m) => m.provider === "litellm-e2e-new" && m.id === "e2e-mgmt-beta"), "edit url")
    assert(mgmtB.requests.length > beforeB, "edited Base URL was not used for discovery")
    assert(models.find((m) => m.id === "e2e-mgmt-beta").api === "openai-responses", "protocolOverrides from the config file no longer applied")

    stage("6 replace")
    // 6. Replace key → old key dead, new key used, never echoed
    mgmtB.state.apiKey = SECRET_B
    result = await rpc.driveCommand("/litellm-endpoints", [
      { select: /e2e-new/ },
      { select: "替换 API Key" },
      { input: SECRET_B },
      { select: "返回" },
      { select: undefined },
    ])
    noKeyLeak(result, SECRET_A, SECRET_B)
    assert(readJson(authFile)["litellm-e2e-new"].key === SECRET_B, "Replace did not overwrite the stored key")
    models = await untilModels(rpc, (list) => list.some((m) => m.provider === "litellm-e2e-new" && m.id === "e2e-mgmt-beta"), "replace")
    assert(mgmtB.requests.at(-1).authorization === `Bearer ${SECRET_B}`, "discovery still used the replaced key")

    stage("7 disconnect")
    // 7. Disconnect → credential gone, endpoint + activation stay, models gone, bystander intact
    result = await rpc.driveCommand("/litellm-endpoints", [
      { select: /e2e-new/ },
      { select: "断开凭据" },
      { confirm: true },
      { select: "返回" },
      { select: undefined },
    ])
    assert(readJson(authFile)["litellm-e2e-new"] === undefined, "Disconnect left the credential behind")
    assert(readJson(authFile)["litellm-untouched"]?.key === untouched.apiKey, "Disconnect touched another endpoint's credential")
    assert(readJson(configPath).endpoints["e2e-new"], "Disconnect removed the endpoint definition")
    assert(readJson(activationFile).endpointIds.includes("e2e-new"), "Disconnect changed activation")
    await untilModels(rpc, (list) => !list.some((m) => m.provider === "litellm-e2e-new") && list.some((m) => m.provider === "litellm-untouched"), "disconnect")

    stage("8 reconnect+restart")
    // 8. Connect again, then restart Pi → state survives
    mgmtB.state.apiKey = SECRET_C
    await rpc.driveCommand("/litellm-endpoints", [{ select: /e2e-new/ }, { select: "连接 API Key" }, { input: SECRET_C }, { select: "返回" }, { select: undefined }])
    await untilModels(rpc, (list) => list.some((m) => m.provider === "litellm-e2e-new"), "reconnect")
    await rpc.close()
    rpc = startMgmtPi()
    await readyWithin(rpc, "restart#1")
    // Drive one full refresh through the endpoint manager in a fresh --no-session Pi
    // (same pattern as Phase 1b) so refreshModels actually runs before asserting state
    // labels and /models content.
    await rpc.driveCommand("/litellm-endpoints", [
      { select: "全部启用" },
      { select: undefined },
    ])
    await untilModels(rpc, (list) => list.some((m) => m.provider === "litellm-e2e-new") && list.some((m) => m.provider === "litellm-untouched"), "restart")
    await rpc.driveCommand("/litellm-endpoints", [
      { select: undefined, check: (r) => {
        assert(r.options.includes("✓ e2e-new · 已启用 · 已生效 · 已保存 API Key"), `state lost across restart: ${JSON.stringify(r.options)}`)
        assert(r.options.includes("✓ untouched · 已启用 · 已生效 · 已保存 API Key"), "bystander lost across restart")
      } },
    ])
    assert(exists(storeFile) && readJson(storeFile)["litellm-e2e-new"], "discovery snapshot was never persisted for the endpoint")

    stage("9 deactivate")
    // 9. Deactivate → provider gone, credential + snapshot kept
    await rpc.driveCommand("/litellm-endpoints", [{ select: /e2e-new/ }, { select: "停用" }, { select: "返回" }, { select: undefined }])
    await untilModels(rpc, (list) => !list.some((m) => m.provider === "litellm-e2e-new"), "deactivate")
    assert(readJson(authFile)["litellm-e2e-new"]?.key === SECRET_C, "Deactivate removed the credential")
    assert(readJson(storeFile)["litellm-e2e-new"], "Deactivate removed the snapshot")
    assert(readJson(activationFile).endpointIds.join() === "untouched", "Deactivate did not persist")

    stage("10 delete")
    // 10. Delete: cancel first (nothing changes), then confirm (everything goes)
    const snapshotState = () => [configPath, authFile, storeFile, activationFile].map((f) => readFileSync(f, "utf8"))
    const before = snapshotState()
    result = await rpc.driveCommand("/litellm-endpoints", [
      { select: /e2e-new/ },
      { select: "删除 endpoint" },
      { confirm: false, check: (r) => assert(/API Key/.test(r.message) && /缓存/.test(r.message), "Delete confirmation must say what is removed") },
      { select: "返回" },
      { select: undefined },
    ])
    assert(JSON.stringify(snapshotState()) === JSON.stringify(before), "a cancelled Delete changed persisted state")
    await rpc.driveCommand("/litellm-endpoints", [
      { select: /e2e-new/ },
      { select: "删除 endpoint" },
      { confirm: true },
      { select: undefined, check: (r) => assert(!r.options.some((o) => o.includes("e2e-new")), "deleted endpoint is still listed") },
    ])
    config = readJson(configPath)
    assert(!("e2e-new" in config.endpoints), "Delete left the endpoint definition")
    assert(readJson(authFile)["litellm-e2e-new"] === undefined, "Delete left the credential")
    assert(!exists(storeFile) || readJson(storeFile)["litellm-e2e-new"] === undefined, "Delete left the discovery snapshot")
    assert(!readJson(activationFile).endpointIds.includes("e2e-new"), "Delete left the activation entry")
    assert(config.endpoints.untouched.mine === 1 && config.handWrittenNote.keep === "me", "Delete damaged unrelated configuration")
    assert(readJson(authFile)["litellm-untouched"]?.key === untouched.apiKey, "Delete damaged another endpoint's credential")

    stage("11 restart")
    // 11. Restart: nothing resurrects; re-adding the same id starts clean
    // Let Delete's follow-up provider refresh finish before stopping Pi: stopping the host while it holds
    // its own models-store.json.lock makes the next Pi wait out the host's 30s stale-lock window.
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    await rpc.close()
    rpc = startMgmtPi()
    await readyWithin(rpc, "restart#2")
    await rpc.driveCommand("/litellm-endpoints", [
      { select: undefined, check: (r) => assert(!r.options.some((o) => o.includes("e2e-new")), "deleted endpoint resurrected after restart") },
    ])
    assert(!(await litellmModels(rpc)).some((m) => m.provider === "litellm-e2e-new"), "deleted endpoint's models resurrected")
    await rpc.driveCommand("/litellm-endpoints", [
      { select: "＋ 新增 endpoint" },
      { input: "e2e-new" },
      { input: mgmtA.baseUrl },
      { select: undefined, check: (r) => assert(r.options.includes("○ e2e-new · 未启用 · 未保存 API Key"), "re-added id did not start clean") },
    ])
    assert(readJson(authFile)["litellm-e2e-new"] === undefined, "re-added id inherited an old credential")

    stage("12 hand edit")
    // 12. Hand edit is visible on the next open, unknown fields survive UI writes
    const edited = readJson(configPath)
    edited.endpoints["hand-added"] = { baseUrl: mgmtA.baseUrl }
    writeFileSync(configPath, JSON.stringify(edited, null, 2) + "\n")
    await rpc.driveCommand("/litellm-endpoints", [
      { select: undefined, check: (r) => assert(r.options.some((o) => o.includes("hand-added")), "a hand edit was not visible to the UI") },
    ])
    console.log("real Pi endpoint management E2E ok: add/edit/connect/activate/replace/disconnect/deactivate/delete + restart verified through real host dialogs")
  } finally {
    await untouched.close().catch(() => {})
    await mgmtA.close().catch(() => {})
    await mgmtB.close().catch(() => {})
  }

  // ===== Phase 3: legacy single-endpoint management (file-based + LITELLM_BASE_URL migration) =====
  const legacyA = await startFakeLiteLLM("legacy-a", "sk-legacy-a", [modelInfo("e2e-legacy-alpha", "chat", 48_000, 6_000)])
  const legacyB = await startFakeLiteLLM("legacy-b", "sk-legacy-b", [modelInfo("e2e-legacy-beta", "chat", 48_000, 6_000)])
  try {
    const configPath3 = join(agentDir, "litellm.json")
    const authFile3 = join(agentDir, "auth.json")
    const storeFile3 = join(agentDir, "models-store.json")
    const readJson3 = (f) => JSON.parse(readFileSync(f, "utf8"))

    const readyWithin = async (client, label) => {
      const began = Date.now()
      await client.request({ type: "get_commands" }, { timeoutMs: 90_000 })
      console.log(`${label}: Pi answered get_commands in ${Date.now() - began}ms`)
    }
    const noKeyLeak = (result, ...secretsToHide) => {
      const blob = JSON.stringify({ seen: result.seen, notices: result.notices })
      for (const secret of secretsToHide) assert(!blob.includes(secret), "an API key was echoed to the host UI")
    }

    const startLegacyPi = (extraEnv = {}) => {
      const child = spawn(PI_BIN, ["--mode", "rpc", "--no-session", "--extension", probeExtensionPath, "--model", "e2e-bootstrap/bootstrap"], {
        cwd: workDir,
        env: { ...isolatedEnv, ...extraEnv, NODE_OPTIONS: nodeOptionsValue },
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      })
      return new RpcClient(child)
    }

    // A. file-based legacy default: top-level baseUrl + protocolOverrides + unknown fields
    writeFileSync(configPath3, JSON.stringify({
      baseUrl: legacyA.baseUrl,
      protocolOverrides: { "e2e-legacy-alpha": "chat" },
      handWrittenNote: { keep: "legacy" },
    }, null, 2) + "\n")
    writeFileSync(authFile3, JSON.stringify({ litellm: { type: "api_key", key: "sk-legacy-a" } }, null, 2) + "\n", { mode: 0o600 })
    writeFileSync(join(agentDir, "litellm.activation.json"), JSON.stringify({ mode: "all" }) + "\n")
    rmSync(storeFile3, { force: true })

    rpc = startLegacyPi()
    await readyWithin(rpc, "legacy-phase-start")
    // Force a refresh through the manager so the legacy default's models reach /models in
    // this fresh --no-session Pi before asserting the management label. "全部启用" with
    // an existing activation=selected[default] rewrites the same set (no semantic change).
    await rpc.driveCommand("/litellm-endpoints", [
      { select: "全部启用" },
      { select: undefined },
    ])

    // list: legacy default is a real endpoint (saved credential + active)
    let result3 = await rpc.driveCommand("/litellm-endpoints", [
      { select: undefined, check: (r) => assert(r.options.includes("✓ default · 已启用 · 已生效 · 已保存 API Key"), `legacy default missing from list: ${JSON.stringify(r.options)}`) },
    ])

    // credential management on the legacy default (Pi's credential store has no form): Replace
    result3 = await rpc.driveCommand("/litellm-endpoints", [
      { select: /default/ },
      { select: "替换 API Key" },
      { input: "sk-legacy-a2" },
      { select: "返回" },
      { select: undefined },
    ])
    nodeAssert.equal(readJson3(authFile3).litellm.key, "sk-legacy-a2", "Replace on the legacy default did not overwrite the key")
    noKeyLeak(result3, "sk-legacy-a", "sk-legacy-a2")

    // Edit Base URL (file-based legacy): top-level fields are preserved, no migration needed
    result3 = await rpc.driveCommand("/litellm-endpoints", [
      { select: /default/ },
      { select: "修改 Base URL" },
      { input: legacyB.baseUrl },
      { select: "返回" },
      { select: undefined },
    ])
    let config3 = readJson3(configPath3)
    nodeAssert.equal(config3.baseUrl, legacyB.baseUrl, "file-based legacy Edit did not update the address")
    nodeAssert.deepEqual(config3.protocolOverrides, { "e2e-legacy-alpha": "chat" }, "file-based legacy Edit dropped protocolOverrides")
    nodeAssert.deepEqual(config3.handWrittenNote, { keep: "legacy" }, "file-based legacy Edit dropped unknown fields")
    nodeAssert.equal(config3.endpoints, undefined, "file-based legacy Edit must not migrate the config")

    // Delete the file-based legacy default: cancel first — the confirmation must precede every mutation
    const legacyConfigText = readFileSync(configPath3, "utf8")
    const legacyAuthText = readFileSync(authFile3, "utf8")
    result3 = await rpc.driveCommand("/litellm-endpoints", [
      { select: /default/ },
      { select: "删除 endpoint" },
      { confirm: false, check: (r) => assert(/API Key/.test(r.message) && /缓存/.test(r.message), "Delete confirmation must say what is removed") },
      { select: "返回" },
      { select: undefined },
    ])
    nodeAssert.equal(readFileSync(configPath3, "utf8"), legacyConfigText, "a cancelled file-legacy Delete changed litellm.json")
    nodeAssert.equal(readFileSync(authFile3, "utf8"), legacyAuthText, "a cancelled file-legacy Delete changed the credential")

    // Delete the file-based legacy default (confirm): definition + credential go, unknown fields stay
    result3 = await rpc.driveCommand("/litellm-endpoints", [
      { select: /default/ },
      { select: "删除 endpoint" },
      { confirm: true },
      { select: undefined },
    ])
    config3 = readJson3(configPath3)
    nodeAssert.equal(config3.baseUrl, undefined, "Delete left the legacy address")
    nodeAssert.equal(config3.protocolOverrides, undefined, "Delete left the legacy protocolOverrides")
    nodeAssert.deepEqual(config3.handWrittenNote, { keep: "legacy" }, "Delete dropped unknown fields")
    nodeAssert.deepEqual(readJson3(authFile3), {}, "Delete left the legacy credential")

    // B. env-provided legacy address: Edit must migrate into endpoints.default first
    writeFileSync(configPath3, JSON.stringify({
      pollInterval: 60,
      protocolOverrides: { "e2e-legacy-beta": "responses" },
      handWrittenNote: { keep: "env-legacy" },
    }, null, 2) + "\n")
    writeFileSync(authFile3, JSON.stringify({ litellm: { type: "api_key", key: "sk-legacy-b" } }, null, 2) + "\n", { mode: 0o600 })
    writeFileSync(join(agentDir, "litellm.activation.json"), JSON.stringify({ mode: "all" }) + "\n") // reset 3A's delete state
    rmSync(storeFile3, { force: true })
    await rpc.close()
    rpc = startLegacyPi({ LITELLM_BASE_URL: legacyB.baseUrl })
    await readyWithin(rpc, "env-legacy-start")
    // Drive one full refresh through the endpoint manager so the env-legacy default's
    // models reach /models in this fresh --no-session Pi. "全部启用" pins activation to
    // selected[default]; the Delete-cancel test below asserts the pinned value is what
    // survives the cancelled delete (nothing further mutates it).
    await rpc.driveCommand("/litellm-endpoints", [
      { select: "全部启用" },
      { select: undefined },
    ])

    result3 = await rpc.driveCommand("/litellm-endpoints", [
      { select: undefined, check: (r) => assert(r.options.includes("✓ default · 已启用 · 已生效 · 已保存 API Key"), `env-legacy default missing: ${JSON.stringify(r.options)}`) },
    ])

    // Delete Cancel on the env-legacy default: the final confirmation must precede any migration
    const envLegacyConfigText = readFileSync(configPath3, "utf8")
    result3 = await rpc.driveCommand("/litellm-endpoints", [
      { select: /default/ },
      { select: "删除 endpoint" },
      { confirm: false, check: (r) => {
        assert(r.message.includes("LITELLM_BASE_URL"), "the combined Delete confirmation must explain the internal migration")
        assert(/API Key/.test(r.message) && /缓存/.test(r.message), "Delete confirmation must say what is removed")
      } },
      { select: "返回" },
      { select: undefined },
    ])
    nodeAssert.equal(readFileSync(configPath3, "utf8"), envLegacyConfigText, "a cancelled env-legacy Delete changed litellm.json")
    config3 = readJson3(configPath3)
    nodeAssert.equal(config3.endpoints, undefined, "a cancelled env-legacy Delete generated endpoints.default")
    nodeAssert.deepEqual(config3.protocolOverrides, { "e2e-legacy-beta": "responses" }, "a cancelled env-legacy Delete removed the top-level legacy fields")
    nodeAssert.equal(readJson3(authFile3).litellm.key, "sk-legacy-b", "a cancelled env-legacy Delete removed the credential")
    // The pre-Delete "全部启用" above pins activation from "all" to "selected" as a side
    // effect; that's the manager driving refresh on a fresh --no-session Pi. The Delete
    // itself must leave that pinned activation untouched.
    nodeAssert.deepEqual(readJson3(join(agentDir, "litellm.activation.json")), { mode: "selected", endpointIds: ["default"] }, "a cancelled env-legacy Delete changed activation")

    // Edit → migration confirmation → new address; identity fields and unmanaged options survive
    result3 = await rpc.driveCommand("/litellm-endpoints", [
      { select: /default/ },
      { select: "修改 Base URL" },
      { confirm: true, check: (r) => {
        assert(r.title.includes("迁移为可管理配置"), "the migration must be confirmed explicitly")
        assert(r.message.includes("endpoints.default"), "the migration target must be stated")
        assert(r.message.includes("LITELLM_BASE_URL"), "the environment source must be explained")
      } },
      { input: legacyA.baseUrl },
      { select: "返回" },
      { select: undefined },
    ])
    noKeyLeak(result3, "sk-legacy-b")
    config3 = readJson3(configPath3)
    nodeAssert.deepEqual(config3.endpoints, { default: { baseUrl: legacyA.baseUrl, protocolOverrides: { "e2e-legacy-beta": "responses" } } }, "migration must materialise the env address and move protocolOverrides")
    nodeAssert.equal(config3.pollInterval, 60)
    nodeAssert.deepEqual(config3.handWrittenNote, { keep: "env-legacy" })
    nodeAssert.equal(config3.protocolOverrides, undefined)
    nodeAssert.equal(readJson3(authFile3).litellm.key, "sk-legacy-b", "migration must keep the credential identity")

    // after migration everything is normal managed behaviour: Delete works without another migration
    result3 = await rpc.driveCommand("/litellm-endpoints", [
      { select: /default/ },
      { select: "删除 endpoint" },
      { confirm: true },
      { select: undefined },
    ])
    config3 = readJson3(configPath3)
    nodeAssert.deepEqual(config3.endpoints, {}, "Delete after migration left the definition")
    nodeAssert.deepEqual(readJson3(authFile3), {}, "Delete after migration left the credential")
    nodeAssert.deepEqual(config3.handWrittenNote, { keep: "env-legacy" })

    // restart: nothing resurrects, no ghost default
    await rpc.close()
    rpc = startLegacyPi({ LITELLM_BASE_URL: legacyB.baseUrl })
    await readyWithin(rpc, "env-legacy-restart")
    await rpc.driveCommand("/litellm-endpoints", [
      { select: undefined, check: (r) => nodeAssert.deepEqual(r.options, ["＋ 新增 endpoint"], `deleted legacy endpoint resurrected: ${JSON.stringify(r.options)}`) },
    ])

    await rpc.close()
    console.log("real Pi legacy endpoint management E2E ok: file-based Edit/Delete + env-legacy migration verified")
  } finally {
    await legacyA.close().catch(() => {})
    await legacyB.close().catch(() => {})
  }

  console.log(
    `real Pi ${EXPECTED_PI_VERSION} E2E ok: installed ${PACKAGE_SPEC}; commands, credentials, models, limits, diagnostics, activation and endpoint management verified`,
  )
} finally {
  if (rpc) await rpc.close().catch(() => {})
  if (defaultServer) await defaultServer.close().catch(() => {})
  if (companyServer) await companyServer.close().catch(() => {})
  if (process.env.E2E_KEEP_ROOT) console.log("kept", root)
  else {
    // A just-killed Pi may still hold files briefly: never let cleanup mask the real result.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) }
    catch (error) { process.stderr.write(`cleanup skipped: ${error.code ?? error.message}\n`) }
  }
}

// E2E_EXIT_GUARD: flush stdout, then exit even if a stray handle keeps the loop alive.
process.stdout.write("", () => process.exit(process.exitCode ?? 0))
