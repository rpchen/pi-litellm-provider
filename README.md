# pi-litellm-provider

Pi 扩展：连接 LiteLLM 后，自动发现当前 API Key 可用的对话模型，并同步到 Pi 的模型选择器。

它会自动处理：

- 从 LiteLLM `/v1/model/info` 发现当前 Key 可见的对话模型
- 自动选择 Chat Completions、Responses 或 Anthropic Messages
- 映射上下文窗口、输出上限、工具调用、模态和价格
- 用 models.dev 补充元数据和 thinking levels
- 启动、打开模型选择器和定时轮询时刷新模型
- 短暂故障时保留上次成功结果，认证失败时撤下旧模型

## 快速开始

### 1. 安装

安装并跟随仓库 `main`：

```bash
pi install git:github.com/rpchen/pi-litellm-provider
```

锁定当前发行版：

```bash
pi install git:github.com/rpchen/pi-litellm-provider#v0.2.0
```

要求：

- Pi `>=0.87.1`
- LiteLLM 地址使用 `http://` 或 `https://`
- API Key 能访问 `/v1/model/info`（旧版可回退 `/model/info`）以及实际要调用的模型

### 2. 配置 LiteLLM 地址

推荐写入全局配置：

```jsonc
// ~/.pi/agent/litellm.json
{
  "baseUrl": "http://litellm.example:4000"
}
```

也可以使用环境变量：

```bash
export LITELLM_BASE_URL="http://litellm.example:4000"
```

PowerShell：

```powershell
$env:LITELLM_BASE_URL = "http://litellm.example:4000"
```

地址带不带 `/v1`、带不带末尾斜杠都可以，扩展会自动规范化。

地址优先级：

1. `LITELLM_BASE_URL`
2. 项目级 `<项目>/.pi/litellm.json`
3. 全局 `~/.pi/agent/litellm.json`

### 3. 登录 API Key

在 Pi 会话中：

```text
/login → 选择 LiteLLM → 粘贴 API Key
```

也可以使用环境变量：

```bash
export LITELLM_API_KEY="sk-xxx"
```

PowerShell：

```powershell
$env:LITELLM_API_KEY = "sk-xxx"
```

两者同时存在时，`/login` 保存的凭据优先。发现模型和实际调用始终使用同一把 Key。

### 4. 选择模型

会话内执行：

```text
/model
```

LiteLLM 下显示的就是当前 Key 可访问的对话模型。

## 常用操作

### 选择模型

`/model` 打开模型选择器。每次打开时 Pi 都会触发一次实时发现。

### 调整推理档位

`/thinking` 打开 thinking level 选择器；CLI 也可以使用：

```bash
pi -p "总结这个仓库的结构" --model litellm/gpt-6-sol --thinking high
```

可用档位由 models.dev 中该模型的记录决定。没有 reasoning metadata 的模型只提供普通模式。

### 查看诊断

会话内执行：

```text
/litellm-diagnostics
```

会显示：

- 当前发现状态
- 已注册模型数
- 缓存来源：`snapshot` / `network` / `memory-cache` / `stale`
- models.dev 命中情况
- 协议 fallback 数量
- 当前插件编入的 Core SHA

该命令只读取已有状态，**不会发起模型请求，也不会产生额外 token 消耗**。输出不会包含 API Key、LiteLLM 地址或原始传输错误。

### 查看已发现模型

```bash
pi --list-models litellm
```

这个命令只读取上次发现结果，**不会主动联网刷新**。全新安装尚未完成首次发现时显示为空属正常；需要实时刷新时打开 `/model`。

### 重新读取配置

如果在 Pi 运行期间修改了 `litellm.json`，执行：

```text
/reload
```

或者重启 Pi。

## 可选配置

项目级和全局 `litellm.json` 都支持：

| 配置项 | 默认值 | 说明 |
|---|---:|---|
| `pollInterval` | `300` | 模型发现轮询间隔，单位秒；最小 30 |
| `contextTierCap` | `true` | 按第一个非零输入价格阶梯截断上下文窗口 |
| `protocolOverrides` | `{}` | 按 LiteLLM `model_name` 覆盖协议 |

示例：

```jsonc
{
  "pollInterval": 300,
  "contextTierCap": true,
  "protocolOverrides": {
    "glm-5.3": "chat"
  }
}
```

`protocolOverrides` 只在自动协议判断与真实 LiteLLM 路由不一致时使用。值只能是 `chat`、`responses` 或 `messages`。

## 模型发现与故障行为

| 情况 | 扩展行为 |
|---|---|
| Pi 启动 | 如果有兼容 snapshot，先恢复上次模型，再联网校正 |
| 打开 `/model` | 触发实时发现 |
| 轮询到点 | 后台刷新模型清单 |
| LiteLLM 暂时不可达 / 超时 / 429 / 5xx | 保留 last-known-good，后续重试；诊断显示 `stale` |
| models.dev 不可达 | 继续使用 LiteLLM 数据；部分补充元数据/thinking levels 暂缺 |
| Key 无效（401 / 403） | 撤下当前模型 |
| 地址未配置或不可用 | 不发起无效请求，不注册模型，并给出日志提示 |

> `pi update --models` 只处理 `models.json`，不会加载扩展，因此不会刷新本插件的模型清单。

## 从手工 `models.json` 迁移

如果以前在 `~/.pi/agent/models.json` 手工配置过 `litellm` provider：

1. 按上面的方式配置地址并通过 `/login` 或 `LITELLM_API_KEY` 提供凭据
2. 确认模型已经出现在 `/model`
3. 删除 `models.json` 中手工的 `litellm` provider 块

如果文件里只有这一块，直接删除整个 `models.json` 即可；不要留下 0 字节空文件。

扩展激活时会整体接管同名 `litellm` provider，不会与手工配置合并；手工块中的 Key 也不会被扩展采用。扩展不会修改 `models.json` 文件，移除扩展后原手工配置仍可恢复使用。

## 卸载

```bash
pi remove git:github.com/rpchen/pi-litellm-provider
```

如曾通过 `/login` 保存 LiteLLM 凭据，可再使用 `/logout` 移除。

## 隐私与安全

- API Key 不会写入日志、模型定义、diagnostics 或持久化 discovery snapshot
- diagnostics 不显示 LiteLLM 地址、Key 或原始传输错误
- models.dev 只用于补充元数据，不会把 LiteLLM 没返回的模型添加进清单
- `/v1/model/info` 是模型发现的事实来源

## 开发与架构

普通用户不需要安装共享 Core、运行构建脚本或维护 provenance。Core 已在构建时编译进插件的 `dist`，运行时不会下载 Core。

开发、构建、测试、OpenSpec 和共享 Core 说明请看：

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [litellm-discovery-core](https://github.com/rpchen/litellm-discovery-core)
- [验收记录](docs/research/acceptance-notes.md)
