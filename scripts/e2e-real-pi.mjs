import { createServer } from "node:http"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { spawn, spawnSync } from "node:child_process"

const EXPECTED_PI_VERSION = process.env.E2E_PI_VERSION ?? "0.87.1"
const PACKAGE_SPEC = process.env.E2E_PACKAGE_SPEC?.trim()
const PI_BIN = process.env.PI_BIN?.trim() || (process.platform === "win32" ? "pi.cmd" : "pi")
const TIMEOUT_MS = 30_000

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

async function startFakeLiteLLM(name, apiKey, models) {
  const requests = []
  const server = createServer((req, res) => {
    const authorization = req.headers.authorization ?? ""
    requests.push({ method: req.method, url: req.url, authorization })

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
    res.end(JSON.stringify({ data: models }))
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
    apiKey,
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
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

  async request(command) {
    const id = command.id ?? `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const after = this.records.length
    this.child.stdin.write(JSON.stringify({ ...command, id }) + "\n")
    const response = await this.waitFor(
      (record) => record?.type === "response" && record.id === id,
      { after },
    )
    assert(response.success === true, `RPC command ${command.type} failed: ${response.error ?? JSON.stringify(response)}`)
    return { response, after }
  }

  async extensionCommand(message) {
    return this.request({ type: "prompt", message })
  }

  async close() {
    if (this.child.exitCode !== null) return
    this.child.stdin.end()
    await Promise.race([
      new Promise((resolve) => this.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ])
    if (this.child.exitCode === null) this.child.kill("SIGTERM")
  }
}

function pluginModels(response) {
  const models = response?.data?.models
  assert(Array.isArray(models), `get_available_models returned unexpected payload: ${JSON.stringify(response)}`)
  return models.filter((model) => typeof model?.provider === "string" && model.provider.startsWith("litellm"))
}

function modelInfo(modelName, mode, input = 32_000, output = 4_096) {
  return {
    model_name: modelName,
    litellm_params: { model: `openai/${modelName}` },
    model_info: {
      mode,
      max_input_tokens: input,
      max_output_tokens: output,
      input_cost_per_token: 0.000001,
      output_cost_per_token: 0.000002,
      supports_function_calling: true,
    },
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
  ])
  companyServer = await startFakeLiteLLM("company", "sk-company-e2e", [
    modelInfo("e2e-company-chat", "chat", 64_000, 8_192),
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
  writeFileSync(fetchHook, `
const originalFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url === "https://models.dev/api.json") {
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  return originalFetch(input, init)
}
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
  for (const name of ["litellm-endpoints", "litellm-diagnostics"]) {
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
  assert(!diagnosticNotice.message.includes(defaultServer.apiKey), "Diagnostics leaked the API key")
  assert(!diagnosticNotice.message.includes(defaultServer.baseUrl), "Diagnostics leaked the LiteLLM URL")

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

  console.log(
    `real Pi ${EXPECTED_PI_VERSION} E2E ok: installed ${PACKAGE_SPEC}; commands, credentials, models, limits, diagnostics and activation verified`,
  )
} finally {
  if (rpc) await rpc.close().catch(() => {})
  if (defaultServer) await defaultServer.close().catch(() => {})
  if (companyServer) await companyServer.close().catch(() => {})
  rmSync(root, { recursive: true, force: true })
}
