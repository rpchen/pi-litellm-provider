## 1. Fixtures 与配置解析

> 真实抓取只从 `~/.agents/skills/opencode-litellm-config-sync/.env` 读取 `LITELLM_BASE_URL` / `LITELLM_API_KEY`，只在运行时、只在内存使用；地址与 Key 不得写入仓库、fixtures、日志或验收记录。fixtures 脱敏标准：去掉 `litellm_params` 中的 `api_base`、`litellm_credential_name`、`tags` 与 `model_info` 中的 `access_via_team_ids`、`access_groups`、部署 `id`；所有疑似 Key 的字符串替换为 `sk-` 占位。

- [x] 1.1 编写 fixture 生成脚本 `scripts/make-fixtures.ts`：从真实 `/v1/model/info` 响应按上述白名单字段生成脱敏样本到 `test/fixtures/`，覆盖 chat / responses / embedding / image_generation 部署、272k 与 512k 阶梯、db 与路由前缀部署、`custom_llm_provider` 为 anthropic 的部署（Bedrock 上的 Claude）、`supported_endpoints` 有/无、`tiered_pricing`、mode 缺失的图像模型、同名多部署、字段类型异常等场景；验证：脚本对 fixture 内容跑断言（无 `api_base`、无 `sk-` 前缀真实 Key、无内网地址），生成的 fixtures 能被后续单测加载
- [x] 1.2 在 `test/fixtures/` 加入精简 models.dev 目录样本：openai、anthropic、zai、zhipuai、moonshotai、moonshotai-cn、minimax（含 `MiniMax-M3` 大小写差异 id）、xiaomi、alibaba、opencode（Zen）各 provider，覆盖 effort / toggle / budget_tokens（含与不含 max）、`reasoning_options`、`release_date`；验证：样本能被 modelsdev 单测加载且含至少一个经转售流程的 id（证明文件生成路径不污染选择）
- [x] 1.3 实现 `src/extension/config.ts`：解析地址来源（`LITELLM_BASE_URL` env > 项目 `.pi/litellm.json` > 全局 `~/.pi/agent/litellm.json`，经宿主 `getAgentDir()` 定位）与可选配置（`pollInterval`/`contextTierCap`/`protocolOverrides`），容错同 pi-ollama-cloud 的 sanitizeConfig（未知键丢弃、类型错忽略、JSON 损坏不崩）；验证：`test/config.test.ts` 覆盖三层优先级、非法值容错、未连接判定

## 2. 宿主无关核心（复制自 ../opencode-litellm-provider 并中立化）

- [x] 2.1 复制 `src/core/litellm.ts` 与 `src/net/fetch.ts`：地址规范化（`/v1`、末尾斜杠、http(s) 校验）、`model_name` 聚合、mode 过滤与图像模型名字排除、异常字段按未提供处理；验证：`test/core-litellm.test.ts` 用 fixtures 覆盖地址规范化矩阵（含 `/v1/v1` 防重复）、非 http(s) 拒绝、以真实部署为清单、过滤非对话 mode、空结果与单部署异常场景
- [x] 2.2 复制 `src/core/protocol.ts` 并移除 `PROTOCOL_PACKAGES` 宿主泄漏（判定函数只输出中立 Protocol 值）：判定顺序（覆盖 → Anthropic 上游/Claude 家族 → supported_endpoints（responses 优先）→ mode → Chat）、多部署不一致回退 Chat、覆盖忽略不存在模型；验证：`test/core-protocol.test.ts` 覆盖 specs/protocol-routing 全部场景
- [x] 2.3 复制 `src/core/capabilities.ts`：字段优先级（LiteLLM > models.dev > 默认）、null 过滤、模态映射（pi 只保留 text/image，其余丢弃）、信任名单、多部署保守合并、阶梯截断（`*_above_Nk_tokens` 与 `tiered_pricing`，可关闭）、价格换算；验证：`test/core-capabilities.test.ts` 覆盖 specs/model-discovery 的能力映射、合并、模态、截断、价格全部场景（gpt 272000、minimax 512000 断言在 fixtures 上）
- [x] 2.4 复制 `src/core/modelsdev.ts`：候选 id 顺序（base_model → 去前缀路由名 → model_name）、家族表与 `-cn` 备选、`models_dev_provider` 覆盖、记录选择（原厂/备选 → opencode → 唯一 provider）、禁止跨记录合并与模糊匹配、reasoning_options 数据提取（effort/budget/toggle）；验证：`test/core-modelsdev.test.ts` 覆盖 specs 的记录选择与档位生成全部场景
- [x] 2.5 复制 `src/core/build.ts`：组合 deployments + catalog + options → `ModelSpec[]`，稳定排序与稳定序列化指纹；验证：`test/core-build.test.ts` 用全部 fixtures 做快照测试，断言排序稳定与"同输入同指纹、一字段变化指纹变"

## 3. 宿主适配层（src/extension/）

- [x] 3.1 实现 `src/extension/map.ts` 的 `toProviderModels(specs, baseUrl)`：`ModelSpec` → `ProviderModelConfig`（api 按协议、reasoning/thinkingLevelMap 按 design D4——effort 类映射到同名档位且未声明档位显式 `null`、budget 类生成 high/max、无档位不写 map、messages 模型逐模型 baseUrl 用根地址、chat/responses 用 `/v1` 地址）；验证：`test/map.test.ts` 扩展覆盖三种协议的字段映射、effort/budget/无档位三种 thinkingLevelMap（含 `null` 隐藏断言）、messages 的 baseUrl 差异
- [x] 3.2 实现发现入口与 `refreshModels`：restore 阶段（`allowNetwork: false`）返回 `context.stored` 快照；network 阶段按 design D6 失败分类执行（网络错误 throw 保留旧结果；401/403 返回 `[]` 撤下；404 回退 `/model/info`；未连接返回 `[]` 不发请求），`context.credential.key` 作发现 Key，`context.signal` 贯穿 fetch，成功结果（含空清单）经 `context.publish({ persist })` 持久化，models.dev 6h 缓存 + 60s 退避；验证：`test/discovery.test.ts` 用 mock fetch + fake context 覆盖两阶段行为、失败分类全表、Key 来源、signal 中止、缓存与退避、空清单与 401 撤下都持久化
- [x] 3.3 实现 `src/extension/index.ts` 工厂：读 config，`pi.registerProvider("litellm", …)`（`apiKey` 传 `$LITELLM_API_KEY` 引用由宿主解析、未连接也注册空清单 provider 不抛错），`session_start` 启动轮询（每周期调用 `ctx.modelRegistry.refresh({ providers: ["litellm"], force: true })` 驱动宿主刷新）、`session_shutdown` 幂等清理；验证：`test/extension.test.ts` 用 fake pi API 断言注册形态、轮询启停幂等（模拟 reload 序列不重复轮询）、轮询调用的是宿主 refresh 而非自行重注册

## 4. 集成验收（真实环境）

> 以下凭据规则同 tasks 1 头注。所有真实验收结果记录到 `docs/research/acceptance-notes.md`（只记行为结论，不记地址与 Key）。发现宿主行为与 design 假设不符时：先调整实现并同步更新 design.md；只有 spec 无法满足时才停下来与用户确认。

- [x] 4.1 本地全量验证：`bun run typecheck && bun test && npm run validate:spec && bun run test:package` 全绿；在真实 pi 中执行 `/login` 选 LiteLLM 粘贴 Key，确认 Key 落入 auth.json、`pi -e ./extensions/index.ts --list-models litellm` 列出与 `/v1/model/info` 一致的对话模型（同时验证 env 兜底路径与未配置时无加载错误）
- [x] 4.2 真实 LiteLLM 三协议验收：chat / responses / messages（Claude 家族）各选一个代表模型发一条消息成功；确认 messages 请求实际发往的端点路径与 design D3 假设一致、请求头携带同一把 Key；切换推理档位发消息确认档位参数生效（xhigh 与 off 各一次）；重启 pi 验证持久化清单回放（restore 阶段模型立即可见，network 阶段校正）；发现与 design 不符处更新 design.md 与 map.ts 并复跑本项。（**显式豁免**：当前 LiteLLM 无 Claude/Messages 部署，messages 的"真实调用成功"以 mock server + pi-ai 真实适配器验证端点与 `x-api-key` 头替代——见 `docs/research/acceptance-notes.md` §2 与 `test/messages-endpoint.test.ts`；design Open Question"LiteLLM 是否接受 `x-api-key`"保持开放，待有真实部署时补验。）
- [x] 4.3 轮询与降级验收：真实环境等待一个轮询周期确认新增/删除模型被跟随；临时断网或改错地址确认旧模型保留；换无效 Key 确认模型撤下并出现 Key 无效错误、恢复后模型回归；结果记入 acceptance-notes
- [x] 4.4 更新 README：安装方式（`pi install git:`）、Key 录入两种方式（`/login` 首选 + `LITELLM_API_KEY` 兜底）、地址配置三层来源（env / 项目级 / 全局 `litellm.json`）、可选配置项说明（pollInterval/contextTierCap/protocolOverrides）、从手工 models.json 迁移的步骤与回滚；验证：README 示例中的地址全部为占位符（`http://litellm.example:4000`），无任何真实内网地址或 Key

## 5. 收尾

- [x] 5.1 走治理流程合入 main：功能分支 → PR（`CI` 绿）→ squash merge；`openspec validate --all --strict` 通过；确认本 tasks 全部勾选后按流程归档 change（`openspec-archive-change`，**归档须经用户审核确认后执行**）

## 6. 独立评审修复（2026-09-26 评审报告）

> 来源：`litellm/mimo-v2.6-pro` 独立评审（1 blocker / 4 major / 8 minor）。本组前的 spec/design 修正已随 update-change 写入（A1/A2、B1/B2、C1-C3、D1/D2）；以下为代码与文档侧修复。

- [x] 6.1 修复 B1（blocker）：`src/extension/map.ts` budget 分支不写 `off` 键（保持可关闭思考），修正 `test/map.test.ts` 对应断言（`off` 缺省而非 `null`）；验证：测试覆盖 budget 模型 `off` 缺省 + `getSupportedThinkingLevels` 语义（high/max 可选、minimal/low/medium 为 null）
- [x] 6.2 修复 M1：`src/extension/config.ts` 校验 `baseUrl` 为 http(s) URI，非法时跳过该来源回退下一来源并 `logger.warn`；字段类型非法同样告警；验证：`test/config.test.ts` 新增"非 http(s) 跳过回退"与"字段非法记录警告"两场景
- [x] 6.3 修复 M2：地址缺失时记录说明性提示（"未配置 LiteLLM 地址，设置 LITELLM_BASE_URL 或 litellm.json"）；验证：discovery 测试断言未连接分支发出 warn
- [x] 6.4 修复 m1：注册与轮询重注册前规范化 provider 级 `baseUrl`（经 `normalizeLiteLLMURL` 取根地址，空地址保持空串）；验证：extension 测试断言注册配置的 `baseUrl` 无尾斜杠、无重复 `/v1`
- [x] 6.5 修复 m2：非 http(s) 地址错误按 spec 记 error 级且文案不带"保留上次结果"前缀（配置类错误与网络类错误分级）；验证：测试断言日志级别与文案
- [x] 6.6 修复 m3：未连接与 401/403 分支的空清单持久化前先做指纹比较（与已持久化清单一致时不写入）；验证：discovery 测试连续两次相同空结果只 publish 一次
- [x] 6.7 修复 i6：给 `test/extension.test.ts`"重复 session_start 不叠加轮询"补真实断言（验证轮询刷新只被触发一次的等价行为，或直接断言 stopPolling 幂等状态）；验证：测试含非零断言
- [x] 6.8 修复 m5：清理 `docs/research/acceptance-notes.md` 陈旧待办（4.4 已完成，§4 待办区改为仅存真实未竟项）；验证：文档无已完成的 `[ ]` 条目
- [x] 6.9 全量门禁与治理：`bun run typecheck && bun test && npm run validate:spec && bun run test:package` 全绿 → 功能分支 → PR（`CI` 绿）→ squash merge；合并后回到 5.1 待用户确认归档

## 7. 第二轮独立评审 minor 修复（2026-09-26）

> 来源：`litellm/mimo-v2.6-pro` 第二轮评审（总体通过，0 blocker / 0 major / 3 minor / 4 info）。本组只修 3 项 minor（均为规格/设计文本），info 项按评审结论不阻塞、不处理。

- [x] 7.1 修复 N1：change-sync「仅在内容变化时更新」正文删去"触发宿主刷新或"（与「刷新触发」条款字面冲突，指纹比较发生在刷新内部）；验证：`openspec validate` 通过
- [x] 7.2 修复 N2：design D4 budget 规则摘要补 16000 边界（与 spec 及实现 `maximum > 16000` 对齐）
- [x] 7.3 修复 N3：litellm-connection「地址规范化」改为两级分级（配置来源非法 = 跳过+警告+回退；已采用地址无法规范化 = 不发请求+撤下+错误），对齐「非 http(s) 地址」scenario 并新增「已采用的地址无法规范化」scenario；验证：discovery 测试用 userinfo 地址直接覆盖 error 级场景
- [x] 7.4 全量门禁与治理：`bun run typecheck && bun test && npm run validate:spec && bun run test:package` 全绿 → 功能分支 → PR（`CI` 绿）→ squash merge；合并后回到 5.1 待用户确认归档