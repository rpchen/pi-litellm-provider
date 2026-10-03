# pi-litellm-provider

Pi 扩展：连接 LiteLLM 后，自动发现当前 API Key 可用的对话模型，并同步到 Pi 的模型选择器。

它会自动处理模型发现、Chat / Responses / Messages 协议选择、context / input / output 上限、价格/模态映射、models.dev 元数据补充、thinking levels，以及定时刷新和临时故障降级。

## 快速开始

**1. 安装**

```bash
pi install git:github.com/rpchen/pi-litellm-provider
```

锁定当前发行版：

```bash
pi install git:github.com/rpchen/pi-litellm-provider#v0.6.0
```

要求：Pi `>=0.87.1`；LiteLLM 地址使用 `http://` 或 `https://`；API Key 能访问 `/v1/model/info`（旧版可回退 `/model/info`）以及实际要调用的模型。

**2. 配置 LiteLLM 地址**

推荐写入：

```jsonc
// ~/.pi/agent/litellm.json
{
  "baseUrl": "http://litellm.example:4000"
}
```

也可以设置 `LITELLM_BASE_URL`。地址带不带 `/v1`、末尾斜杠都可以，扩展会自动规范化。

legacy 单 endpoint 模式下，地址优先级为：`LITELLM_BASE_URL` → 全局 `~/.pi/agent/litellm.json`。不再读取项目级 `.pi/litellm.json`，endpoint 定义和 activation 都是全局的。

需要多个 LiteLLM endpoint 时，改用显式 `endpoints`：

```jsonc
{
  "pollInterval": 300,
  "contextTierCap": true,
  "endpoints": {
    "default": {
      "baseUrl": "https://personal.example",
      "protocolOverrides": {}
    },
    "company": {
      "baseUrl": "https://company.example",
      "protocolOverrides": {
        "glm-5.3": "chat"
      }
    }
  }
}
```

endpoint id 是用户定义的稳定 ASCII slug，必须匹配 `[a-z0-9][a-z0-9-_]*`；`default` 保留旧 provider id `litellm`，其他 endpoint 映射为 `litellm-<id>`。legacy 单 endpoint 字段与 `endpoints` 不能同时使用。显式模式不会读取 `LITELLM_BASE_URL`。

**3. 登录 API Key**

在 Pi 会话中：

```text
/login → 选择 LiteLLM（或 LiteLLM · <endpoint-id>）→ 粘贴该 endpoint 的 API Key
```

无交互环境可设置 `LITELLM_API_KEY`，但它只服务 legacy/default endpoint。非 default endpoint 必须使用 Pi 的宿主凭据存储（`/login`）；不存在 `LITELLM_API_KEY_<ENDPOINT>` 之类的动态环境变量。两者同时存在时，default endpoint 上 `/login` 保存的凭据优先。

**4. 选择模型**

执行 `/model`，在 **LiteLLM** 下选择模型即可。每次打开模型选择器都会触发一次实时发现。

## 常用命令

| 命令 | 用途 |
|---|---|
| `/model` | 打开模型选择器并实时刷新 LiteLLM 模型 |
| `/thinking` | 切换当前模型的 thinking level |
| `/litellm-diagnostics [endpoint-id]` | 无参数查看 endpoint 总览；传 id 查看该 endpoint 的发现、缓存、models.dev、协议、Core 诊断与 Runtime Identity |
| `/litellm-audit-export [endpoint-id]` | 导出已注册模型清单与完整 Runtime Identity 到本地 JSON 文件；无参数导出全部已激活 endpoint |
| `/litellm-accept-degraded <endpoint-id> <model-id>` | 显式接受某个未完成模型的降级配置（仍标记为降级，非完整配置，重启后需重新接受） |
| `/litellm-endpoints` | endpoint 管理中心：新增、修改 Base URL、删除、启用/停用、连接/替换/断开 API Key；也支持 `all` / `none` / `<endpoint-id>` 参数快速切换启用状态 |
| `/login` / `/logout` | 保存、切换或移除 LiteLLM 凭据 |
| `/reload` | 修改 `litellm.json` 后重新读取配置 |

`/litellm-diagnostics` 只读取已有状态，**不会发起模型请求，也不会产生额外 token 消耗**；输出不会包含 API Key、LiteLLM 地址或原始传输错误。诊断中的“最近成功发现”“下次允许重试”等绝对时间会按**当前运行 Pi 的宿主机器时区**显示，并附带 UTC 偏移；内部 snapshot/cache 时间仍保持标准 UTC/epoch。

`/litellm-audit-export` 每次执行都会在 `<agentDir>/litellm-audit/` 下生成一个新 JSON 文件，不覆盖已有报告。报告包含已注册模型的 allowlist 字段与完整的 Runtime Identity，不包含 API Key、LiteLLM 地址或原始上游响应；分享前请自行检查。导出失败不会影响 provider 注册与轮询。

### 模型配置状态（正常发布 / 未完成 / 降级 / LKG）

endpoint 里发现了模型，不等于模型已经正确配置完成。只有能力信息完整可信（上下文窗口、输出上限、工具调用、reasoning 等足以让宿主正确使用）的模型，才会作为正常模型注册。`/litellm-diagnostics` 的“模型配置”段会列出：可用、未完成（含缺失字段）、已接受降级、以及正使用历史完整快照（LKG）的模型。

- 未完成模型不会伪装成正常模型；元数据获取失败（超时、5xx、网络不可达等）不会用默认值拼出看似正常的配置。
- 元数据暂时失败但存在仍可信的历史完整快照时，模型继续可用并标注为 LKG（标注来源与数据年龄；年龄本身不会使快照失效）。
- 确认了解缺失仍想使用某个模型时，用 `/litellm-accept-degraded <endpoint-id> <model-id>` 显式接受降级；接受后模型仍标记为降级，可用 `/litellm-diagnostics` 查看剩余缺口。

### Runtime Identity

Runtime Identity 是当前正在运行的扩展 artifact 自身的不可变身份，用于把问题对应到具体的构建产物，而不是猜测 Git HEAD、分支或 Release。它包含三个字段：

- `Plugin Version`：扩展版本，取自 `package.json`
- `Artifact`：当前 artifact 的确定性 SHA-256 摘要（相同产物相同，不同产物不同）
- `Core Commit`：该 artifact 内嵌的 `litellm-discovery-core` 完整 commit SHA

查看位置：

- `/litellm-diagnostics` 末尾的 `Runtime Identity` 块（短形式，各取前 8 位）
- `/litellm-audit-export` 导出的 JSON 中的 `runtimeIdentity`（完整值）
- 扩展启动日志中的 `LiteLLM Runtime Identity plugin=<ver> artifact=<short> core=<short>` 行

```text
Runtime Identity

Plugin Version   0.6.0
Artifact         f149674c
Core Commit      8e155e0e
```

反馈问题时，请附上 `/litellm-diagnostics` 中的 Runtime Identity 段落，或 audit 导出文件中的 `runtimeIdentity` 对象。

CLI 单次调用示例：

```bash
pi -p "总结这个仓库的结构" --model litellm/gpt-6-sol --thinking high
```

查看上次发现的模型：

```bash
pi --list-models litellm
```

`--list-models` **不会主动联网刷新**。全新安装尚未完成首次发现时为空属正常，需要刷新时打开 `/model`。

## 配置

可选项只写在全局 `~/.pi/agent/litellm.json`：

| 配置项 | 默认值 | 说明 |
|---|---:|---|
| `pollInterval` | `300` | 模型发现轮询间隔，单位秒；最小 30 |
| `contextTierCap` | `true` | 按第一个非零输入价格阶梯截断上下文窗口 |
| `protocolOverrides` | `{}` | legacy 单 endpoint 时按 LiteLLM `model_name` 覆盖协议；显式模式改为每个 endpoint 内配置 |

```jsonc
{
  "pollInterval": 300,
  "contextTierCap": true,
  "protocolOverrides": {
    "glm-5.3": "chat"
  }
}
```

`protocolOverrides` 仅在自动协议判断与真实 LiteLLM 路由不一致时使用；值只能是 `chat`、`responses` 或 `messages`。

在 Pi 运行期间修改 endpoint 定义后，执行 `/reload` 或重启 Pi。

### 管理 endpoint（`/litellm-endpoints`）

执行 `/litellm-endpoints` 打开管理中心，用 Pi 的原生选择框操作（`↑` / `↓` 选择，`Enter` 确认，`Esc` 返回/关闭）。列表每行显示 `✓`/`○`（启用/未启用）和凭据状态（已连接/未连接）。

| 想做的事 | 怎么做 |
|---|---|
| **新增** | 选 **＋ 新增 endpoint** → 输入 Endpoint ID → 输入 Base URL。新 endpoint **默认未启用、未连接**，不会自动启用 |
| **修改 Base URL** | 选中 endpoint → **修改 Base URL**。ID 不可修改（没有 rename）；`protocolOverrides` 等配置原样保留 |
| **连接 / 替换 / 断开 API Key** | 选中 endpoint → **连接 API Key** / **替换 API Key** / **断开凭据**。已保存的 Key 永远不会显示；断开只删除该 endpoint 的 Key |
| **启用 / 停用** | 选中 endpoint → **启用** / **停用**；也可以用列表里的 **全部启用** / **全部停用**。立即生效，允许 0 个启用 |
| **删除** | 选中 endpoint → **删除 endpoint**，确认后彻底删除：配置、启用状态、已保存的 Key、模型发现缓存。**取消确认不会留下任何改动**（包括 env-legacy default 的内部迁移） |

说明：

- 连接 Key、启用/停用互相独立：连接不会自动启用，断开不会自动停用；未启用的 endpoint 也可以连接、替换、断开 Key。停用不会删除 Key 和缓存。
- 这里保存的 Key 与 `/login` 是**同一份**宿主凭据（`auth.json`），两边看到的状态一致。Pi 扩展的输入框不会遮罩，输入 Key 时屏幕上可见；不想在屏幕上输入时请用 `/login`。
- 管理中心改的是 `~/.pi/agent/litellm.json`，它仍是唯一的 endpoint 配置，你也可以继续手工编辑；下次打开管理中心会看到文件里的真实状态。文件必须是合法 JSON，无法解析时管理中心会拒绝写入并提示，不会覆盖你的文件。
- 只有一个 endpoint 且使用旧的顶层 `baseUrl` 配置时，新增第二个 endpoint 会先请你确认，然后把现有地址迁移到 `endpoints.default`（provider、Key、缓存不变）。地址来自环境变量 `LITELLM_BASE_URL` 时，修改/删除前也需要这次迁移；删除的迁移包含在最终删除确认里（确认后先迁移再立即删除），**取消删除不留任何改动**。
- 通过管理中心新增 endpoint 后，启用状态会固定为“明确选择的集合”；之后手工写进文件的新 endpoint 需要在管理中心里启用。
- 仍需手工编辑配置文件：`protocolOverrides`、`pollInterval`、`contextTierCap`。endpoint ID 创建后不能直接改名；要换名请新增新 endpoint 并删除旧的。

activation 独立保存在 `~/.pi/agent/litellm.activation.json`。缺省为全部启用；停用 endpoint 会立即撤下对应 provider 并停止其发现/轮询。

每个 endpoint 是独立 provider、独立凭据、独立发现/缓存/snapshot/故障域。插件不会跨 endpoint 聚合模型、负载均衡或自动故障切换。

## 模型发现与故障行为

| 情况 | 扩展行为 |
|---|---|
| Pi 启动 | 若有兼容 snapshot，先恢复上次模型，再联网校正 |
| 打开 `/model` | 实时发现 |
| 轮询到点 | 后台刷新模型清单 |
| LiteLLM 暂时不可达 / 超时 / 429 / 5xx | 保留 last-known-good，后续重试；诊断显示 `stale` |
| models.dev 不可达 | 继续使用 LiteLLM 数据；部分补充元数据/thinking levels 暂缺 |
| Key 无效（401 / 403） | 撤下当前模型 |
| 地址未配置或不可用 | 不发起无效请求，不注册模型，并给出日志提示 |

`/v1/model/info` 是模型发现的事实来源；models.dev 只补充元数据，不会添加 LiteLLM 没返回的模型。能力补缺优先使用原厂记录；原厂 provider 记录不可用时依次使用 OpenRouter、OpenCode，再考虑全局唯一记录。这样同一模型被多个网关收录时，不会仅因为 provider 多而丢失 context、输出上限或 reasoning 等关键能力。

模型上限按共享发现规则合并：总 context 与最大 input 分开处理；若两者冲突，Pi 展示的 `contextWindow` 不会超过 Core 判定的总 context。Core diagnostics 会保留 models.dev 未命中的私有模型用于解释，但若最终仍无法得到正数 context/output，Pi 不会把该模型注册成 `contextWindow: 0` / `maxTokens: 0` 的不可用配置。

> `pi update --models` 只处理 `models.json`，不会加载扩展，因此不会刷新本插件的模型清单。

## 从手工 `models.json` 迁移

如果以前在 `~/.pi/agent/models.json` 手工配置过 `litellm` provider：

1. 先按上面的方式配置地址和凭据，确认模型已出现在 `/model`
2. 删除 `models.json` 中手工的 `litellm` provider 块
3. 如果文件里只有这一块，直接删除整个 `models.json`；不要留下 0 字节空文件

扩展激活时会整体接管同名 `litellm` provider，不会与手工配置合并；手工块中的 Key 也不会被扩展采用。扩展不会修改 `models.json` 文件，移除扩展后原手工配置仍可恢复。

## 卸载

```bash
pi remove git:github.com/rpchen/pi-litellm-provider
```

如曾通过 `/login` 保存 LiteLLM 凭据，可再使用 `/logout` 移除。

## 隐私与安全

- API Key 不会写入日志、模型定义、diagnostics 或持久化 discovery snapshot
- diagnostics 不显示 LiteLLM 地址、Key 或原始传输错误
- 发现和实际模型调用始终使用同一份当前凭据

## 开发与架构

普通用户不需要安装共享 Core、运行构建脚本或维护 provenance。Core 已在构建时编译进插件的 `dist`，运行时不会下载 Core。

开发、构建、测试、OpenSpec 和共享 Core 说明请看：

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [litellm-discovery-core](https://github.com/rpchen/litellm-discovery-core)
- [验收记录](docs/research/acceptance-notes.md)

## 开发代码索引

已入库的代码图谱使用与跨客户端配置、Release 附件及本地同步方式见 [docs/codebase-memory.md](docs/codebase-memory.md)。索引工具不属于插件运行时依赖。发布索引必须明确成功，降级结果会阻止导出；本地工作索引按当前 Git 根目录识别，并由客户端持久 MCP 会话跟踪修改。

## Claude Code OpenSpec

在本仓库启动 `claude`，可发现 `.claude/skills/` 中的 6 个 OpenSpec skills：propose、explore、apply-change、update-change、sync-specs、archive-change（命令名均以 `openspec-` 开头）。例如 `/openspec-propose "变更目标"` 创建提案；审阅后再用 `/openspec-apply-change <change-name>` 实施。描述供 Claude 按任务匹配，实际是否自动调用以工具记录为准。

入口由 OpenSpec CLI 1.13.2 生成并入库；新 clone 无需重复初始化。新增 Claude 入口用 `openspec init --tools claude --no-animation`；升级用 `openspec update --force` 刷新 `.agents/skills/` 和 `.claude/skills/` 并审阅差异，两处均由 CLI 模板生成。`CLAUDE.md` 导入 [AGENTS.md](AGENTS.md)，不复制项目规则。

## 每次 PR 后的代码索引

已显式选择的仓库在每个 main 提交通过完整 CI 后，将准确 SHA 的索引发布到 `codebase-memory-index` 分支。新任务先用 `prepare_codebase_task` 同步最新 main 和对应索引；授权合并后用 `finish_codebase_task` 验证本地与远端一致。四客户端共用这两个 MCP 工具，原生工作缓存不会进入源码 PR。详见 [代码索引流程](docs/codebase-memory.md)。

### main 索引同步的安全检查

新任务/合并收尾会在索引下载后及返回 ready 前重新核验远端 main，记录最终核验时刻；分支或源码并发变化会保留工作并失败。发布任务按完整 SHA 隔离排队，快照从固定干净检出生成。已选择子仓的损坏 metadata 会阻止整体 ready；缺失工作 artifact 必须成功恢复。共享缓存竞争只复用完整且身份/校验一致的赢家。四客户端共用 MCP 失败门禁；每次新任务调用 prepare 仍需代理遵循 AGENTS，不能把安装配置当作宿主级强制任务拦截。详见 [索引说明](docs/codebase-memory.md#本轮审核后的同步安全边界)。
