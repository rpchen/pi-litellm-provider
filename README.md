# pi-litellm-provider

Pi 扩展：填写 LiteLLM 地址并登录 API Key 后，自动发现并同步当前 Key 实际可用的对话模型。

- 以**用户自己的 Key** 请求 LiteLLM `/v1/model/info`，只注册真实存在且有权访问的对话模型
- 按 LiteLLM 的 `supported_endpoints` / `mode` / 上游家族判定协议，逐模型映射到 pi 的内置 API 实现
- 映射上下文窗口、输出上限、输入输出模态、工具调用与价格
- 从 models.dev 补充模型元数据并生成推理档位（pi 的 thinking levels）
- 默认按 LiteLLM 的阶梯价格起点截断上下文窗口
- 启动、打开模型选择器与定时轮询时同步模型清单；短暂故障保留上次成功结果

## 与 opencode-litellm-provider 的关系

本仓库是 LiteLLM 自动发现能力的 **pi 宿主适配器**。宿主无关的发现核心（LiteLLM 归一化、models.dev 补缺、能力映射、协议判定、轮询与降级）以单副本方式移植自平级的
`../opencode-litellm-provider`（`src/core/`、`src/net/`），两者不共享宿主层代码。

决策背景见 `docs/decisions.md`。

## 要求

- pi `>=0.87.1`
- LiteLLM 地址必须使用 `http://` 或 `https://`
- API Key 必须有权访问 `/v1/model/info`（旧版部署自动回退 `/model/info`）及要调用的模型

## 安装

```bash
pi install git:github.com/rpchen/pi-litellm-provider
```

指定版本：`pi install git:github.com/rpchen/pi-litellm-provider#v0.1.0`
本地试跑（不安装）：`pi -e ./extensions/index.ts`

## 配置

### 1. API Key

首选在 pi 中登录（凭据存入 `~/.pi/agent/auth.json`，`/logout` 可移除）：

```
/login   →   选择 LiteLLM   →   粘贴 API Key
```

无交互环境（CI、脚本）可用环境变量：

```bash
export LITELLM_API_KEY="sk-xxx"
```

两者同时存在时，`/login` 保存的凭据优先。发现与模型调用始终使用同一把 Key。

### 2. LiteLLM 地址

按优先级从高到低：

1. 环境变量 `LITELLM_BASE_URL`
2. 项目级配置文件 `<项目目录>/.pi/litellm.json`
3. 全局配置文件 `~/.pi/agent/litellm.json`

```jsonc
// ~/.pi/agent/litellm.json
{
  "baseUrl": "http://litellm.example:4000"
}
```

地址可以带或不带 `/v1`、带或不带末尾斜杠，扩展会规范化。

### 3. 可选配置

同上两个配置文件位置均可写入；项目级优先于全局。未配置时使用默认值，非法值会被忽略并回落到默认值。

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `pollInterval` | number | `300` | 轮询间隔（秒），最小 `30`；用于跟随 LiteLLM 端增删模型 |
| `contextTierCap` | boolean | `true` | 是否按阶梯价格起点截断上下文窗口（避免越过价格阶梯） |
| `protocolOverrides` | object | `{}` | 按模型名强制指定协议：`"chat"` / `"responses"` / `"messages"` |

```jsonc
{
  "pollInterval": 300,
  "contextTierCap": true,
  "protocolOverrides": { "glm-5.3": "chat" }
}
```

## 刷新时机

模型清单在以下时机刷新（pi 宿主机制）：

- pi 启动时（交互式会话）
- 打开模型选择器（`/model`）时
- 扩展的轮询定时器到点时
- 会话内 `/reload` 后

发现结果会缓存到 pi 的 `models-store.json`，重启时会先回放上次清单再联网校正。

> 注意：`pi update --models` 只刷新 `models.json` 中配置的模型，不加载扩展，因此不会刷新本扩展的清单。

## 故障行为

| 情况 | 行为 |
|---|---|
| LiteLLM 暂时不可达 / 超时 / 5xx / 429 | 保留上次成功清单，下个周期重试 |
| Key 无效（401 / 403） | 撤下全部模型，提示 Key 无效；恢复后自动回来 |
| models.dev 不可达 | 继续用 LiteLLM 数据注册（无推理档位、缺省字段不补充），后续重试 |
| 地址未配置 | 不注册模型，不发起请求 |

API Key 不会写入日志、错误信息或模型定义；错误信息中的 Key 会被脱敏。

## 从手工 models.json 迁移

若此前在 `~/.pi/agent/models.json` 手工配置过 litellm provider：

1. 按上文完成 Key 登录与地址配置，确认模型出现在 `/model` 中
2. 删除 `models.json` 中手工的 litellm provider 块
3. 回滚：`pi remove pi-litellm-provider`，恢复手工配置；如已 `/login`，用 `/logout` 移除凭据

扩展不读写你的 `models.json`。

> **共存行为**：扩展与 `models.json` 中的同名 `litellm` 块**不会合并**——扩展激活期间由扩展整体接管该 provider（模型清单、`baseUrl`、`apiKey` 均以扩展为准）。**手工块里的 Key 不再生效**：扩展的认证来源是 `/login` 或 `LITELLM_API_KEY`，未配置则该 provider 视为未登录、模型不可见。扩展不修改 `models.json` 文件；移除扩展后手工块原样恢复（实测见 `docs/research/acceptance-notes.md` §6）。

## 开发

```bash
npm ci
bun run typecheck
bun test
npm run validate:spec   # OpenSpec 规格校验
bun run test:package    # 校验 pi.extensions 与 npm 打包内容
```

在真实 pi 中加载（单次运行，不写入 settings）：

```bash
pi -e ./extensions/index.ts
```

`pi -e` 可指定本地文件或目录；改完代码在会话内执行 `/reload`。

## OpenSpec

本项目使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 管理规格变更：`openspec/changes/` 存放在途变更，`openspec/specs/` 存放已落地能力规格。
