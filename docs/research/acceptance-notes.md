# 验收记录 — add-litellm-auto-discovery（pi 宿主）

记录真实环境验收的**行为结论**。不记录 LiteLLM 地址、API Key 或任何凭据（约定见 AGENTS.md）。

验证环境：pi 0.87.1（`@earendil-works/pi-coding-agent` 与 `pi-ai`）、Bun 1.3.10、Windows。
真实 LiteLLM 凭据在运行时从约定来源读取，仅内存使用；隔离 agent 目录（`.tmp/pi-agent*`）避免污染用户配置。

## 1. 宿主集成（任务 4.1）

| 验证项 | 方法 | 结果 |
|---|---|---|
| 扩展加载无诊断 | `createAgentSessionServices`（宿主真实启动路径） | 0 diagnostics，provider `litellm` 注册成功 |
| 发现与注册 | `modelRuntime.refresh({ providers: ["litellm"], force: true })` | 0 errors，18 个对话模型注册（embedding / image_generation 已过滤） |
| 持久化 | 检查 `models-store.json` | `litellm` 条目含 18 个模型，`checkedAt` 已写入 |
| restore 回放 | 新进程 `refresh({ allowNetwork: false })` | 0 errors，从持久化清单回放 18 个模型（跨会话立即可用） |
| `/login` 路径 | 仅 `auth.json` 存 stored credential、清空环境变量 | 0 errors，18 个模型（宿主解析链 stored credential 生效） |
| 未配置时加载 | 无地址/无 Key | 0 diagnostics；模型 0；宿主报 `Failed to resolve API key … LITELLM_API_KEY`（宿主语义，非扩展抛错） |

模型协议分布（实测）：Responses 16 个、Chat 2 个、Messages 0 个。

## 2. 三协议调用（任务 4.2）

| 协议 | 代表模型 | 结果 |
|---|---|---|
| Responses | `gpt-6-sol` | ✅ 真实调用成功（经 pi-ai `openai-responses`） |
| Chat | `mimo-v2.6-pro` | ✅ 真实调用成功（经 pi-ai `openai-completions`） |
| Messages | 无部署 | ⚠️ 当前 LiteLLM 无 Claude/Messages 部署，无法真实调用 |

Messages 的端点契约以 mock server + pi-ai 真实适配器验证（`test/messages-endpoint.test.ts`）：

- 模型 baseUrl 用**根地址**时请求发往 `{root}/v1/messages`，带 `x-api-key` 头（D3 假设成立）；
- 若 baseUrl 带 `/v1` 会拼成 `/v1/v1/messages`——证明逐模型 baseUrl 差异是必需的。

首次 Responses 调用先命中一个已退役模型（LiteLLM 返回 410，上游模型退役信息），换用 `gpt-6-sol` 后成功；说明请求确实到达 Responses 端点。

## 3. 推理档位（任务 4.2）

用 `before_provider_request` hook 抓请求体（`reasoning.effort`）：

| pi 档位 | 请求体 `reasoning.effort` |
|---|---|
| `xhigh` | `xhigh` |
| `medium` | `medium` |
| `off` | `none` |

三个档位调用均成功。证明 `thinkingLevelMap`（含 `off → "none"`）端到端生效。

## 4. 轮询与降级（任务 4.3）

| 验证项 | 方法 | 结果 |
|---|---|---|
| 轮询触发宿主刷新 | 探针挂载真实扩展（短间隔 30s），观察 `modelRuntime.refresh` 调用 | ✅ 35s 内自动出现 `refresh({providers:["litellm"],force:true})`，无需用户操作 |
| 会话结束停止轮询 | 调用 `session_shutdown` 后继续观察 35s | ✅ 0 次刷新（定时器已清理） |
| 模型变更跟随 | mock LiteLLM 端增删部署 + 真实发现入口 | ✅ 新增模型出现、删除模型消失，持久化同步更新（`test/poll-follow.test.ts`） |
| 不可达地址保留旧结果 | 真实发现入口 + 坏地址 | ✅ 抛 `network` 错误（宿主保留上次清单），warn 日志不含 Key |
| 无效 Key 撤下模型 | 真实发现入口 + 无效 Key | ✅ 返回空清单并持久化空清单，error 明确 "Key 无效或无权限" |
| 恢复 | 换回真实 Key | ✅ 18 个模型回归 |

补充说明：**`pi update --models` 不加载扩展**（`package-manager-cli.js` 只读 `models.json`），因此它不会调用扩展的 `refreshModels`。宿主对扩展 provider 的真实网络刷新路径是交互式启动（`InteractiveMode.run` → `refreshModelCatalogs`）、模型选择器打开、以及本扩展的轮询。README 需如实说明。

## 5. 待办

- [ ] design Open Question：LiteLLM 对 Anthropic Messages 的 `x-api-key` 头是否接受——待有真实 Messages 部署时补验（当前以 `test/messages-endpoint.test.ts` 的 mock + pi-ai 真实适配器固化契约；见 tasks 4.2 的显式豁免注记）

> 任务 4.4（README 更新）已于 2026-09-26 完成，不再是待办。2026-09-26 独立评审的修复进度见 `openspec/changes/add-litellm-auto-discovery/tasks.md` 第 6 组。
