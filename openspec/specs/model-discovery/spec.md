# model-discovery Specification

## Purpose
定义扩展从 LiteLLM 发现哪些模型、过滤哪些模型，以及如何为每个模型填充名称、能力、上下文与输出上限、推理档位与价格；规定 LiteLLM 与 models.dev 两个数据源的优先级。行为基线与 ../opencode-litellm-provider 的 model-discovery 能力一致。

## Requirements

### Requirement: 以真实部署作为模型清单
扩展 SHALL 以 LiteLLM `/v1/model/info` 返回的部署作为模型清单来源，按 `model_name` 聚合为模型。扩展 MUST NOT 注册仅出现在 `/v1/models` 或 `/model_group/info`、但在 `/v1/model/info` 中没有任何部署的模型名。

#### Scenario: 团队白名单中残留已删除的模型名
- **WHEN** `/v1/models` 返回 `gpt-5.5`，但 `/v1/model/info` 中不存在 `model_name` 为 `gpt-5.5` 的部署
- **THEN** `gpt-5.5` 不被注册

### Requirement: 只注册对话模型
扩展 SHALL 只注册 `mode` 为 `chat`、`responses` 或未设置 `mode` 的部署；`mode` 为其他任何值（如 `embedding`、`image_generation`、`audio_transcription`、`audio_speech`、`moderation`、`rerank`、`search`、`completion`、`ocr`、`realtime`）的部署 MUST NOT 被注册。`mode` 未设置时，模型名匹配图像模型特征（以 `gpt-image` 或 `dall-e` 开头，或包含 `image`）的部署 MUST NOT 被注册；`mode` 已设置时不按名字排除。

#### Scenario: 过滤非对话模型
- **WHEN** 发现结果中包含 `mode: embedding` 的 `text-embedding-v4` 与 `mode: image_generation` 的 `gpt-image-2`
- **THEN** 两者都不出现在模型选择器中

#### Scenario: mode 缺失的图像模型
- **WHEN** 某部署未设置 `mode`，模型名为 `dall-e-3`
- **THEN** 该部署不被注册

#### Scenario: mode 缺失的普通模型
- **WHEN** 某部署未设置 `mode`，模型名为 `qwen3.7-plus`
- **THEN** 该部署按对话模型注册

### Requirement: 多部署模型的能力合并
同一 `model_name` 下有多个部署时，扩展 SHALL 采用保守合并：布尔能力取所有部署的交集（全部支持才视为支持），数值上限取最小值，模态取交集。

#### Scenario: 两个部署上限不同
- **WHEN** 同名模型两个部署的 `max_input_tokens` 分别为 200000 与 128000
- **THEN** 注册的上下文上限基于 128000

### Requirement: 能力字段映射与数据源优先级
扩展 SHALL 按以下优先级确定每个字段：LiteLLM 部署信息中的值 > models.dev 选中记录中的值 > pi 默认值。LiteLLM 字段为 null、缺失或类型不符时 SHALL 视为"未提供"，继续向下一来源回退，而不是当作 false 或 0。映射至少包括：上下文 / 输入上限 `max_input_tokens`；输出上限 `max_output_tokens`（缺失时回退 `max_tokens`）；工具调用 `supports_function_calling`（三个来源都没有时默认支持）；输入模态（文本恒有；`supports_vision` → 图片）、输出模态。pi 的输入模态只有 text 与 image 两种；LiteLLM / models.dev 声明的 PDF、音频、视频输入模态 SHALL 被丢弃，不影响文本与图片的判定。模态例外：对 DeepSeek、Kimi、MiMo、Qwen 家族，若 LiteLLM 给出的输入模态只有文本而 models.dev 选中记录声明了更多输入模态，扩展 SHALL 采用 models.dev 的输入模态（经网关转发时 LiteLLM 模态标注常不可靠）。

#### Scenario: LiteLLM 缺失输出上限
- **WHEN** 某部署没有 `max_output_tokens` 与 `max_tokens`，而 models.dev 选中记录的 `limit.output` 为 65536
- **THEN** 注册的输出上限为 65536

#### Scenario: 两个来源冲突
- **WHEN** 某 GPT 部署的 LiteLLM 信息显式给出 `supports_vision: false`，models.dev 记录的输入模态包含 image
- **THEN** 注册的输入模态不包含图片

#### Scenario: 非文本图片模态被丢弃
- **WHEN** models.dev 选中记录声明输入模态包含 pdf 与 audio
- **THEN** 注册的输入模态只保留映射后 pi 支持的 text 与/或 image

#### Scenario: 模态信任名单
- **WHEN** `kimi-k2.6` 的 LiteLLM 部署只给出文本输入，models.dev 选中记录的输入模态为 text、image、video
- **THEN** 注册的输入模态包含 text 与 image（video 被 pi 模态集合丢弃）

### Requirement: models.dev 记录选择
扩展 SHALL 只从一条 models.dev 记录补充一个模型的缺失字段。候选 id 依次为：部署的 `base_model`、去掉路由前缀的 `litellm_params.model`、`model_name`；id 比较不区分大小写。对每个候选 id，记录选择顺序为：1）模型原厂 provider（含原厂备选 provider）下 id 匹配的记录；2）OpenCode Zen（models.dev provider id `opencode`）下 id 匹配的记录；3）若该 id 在全部 provider 中只存在于唯一一个 provider，则取该记录。所有候选都不满足时 SHALL 不补充任何字段。扩展 MUST NOT 跨多条记录合并字段，MUST NOT 通过去掉 `-free` 等后缀进行模糊匹配（大小写不敏感不属于模糊匹配）。模型原厂 SHALL 由模型名所属家族识别（完整家族表与备选顺序继承基线），部署 `model_info` 中若显式给出 `models_dev_provider`，SHALL 以它作为原厂。

#### Scenario: 原厂记录缺失时使用 Zen
- **WHEN** 模型 `kimi-k2.6` 在 models.dev 的 `moonshotai` 下不存在，但在 `opencode` 下存在
- **THEN** 使用 `opencode` 下的记录补充缺失字段

#### Scenario: 大小写不同的原厂 id
- **WHEN** 模型 `minimax-m3` 在 models.dev 的 `minimax` 下的 id 为 `MiniMax-M3`
- **THEN** 选中 `minimax` 下的 `MiniMax-M3` 记录，而不是 `opencode` 下的记录

#### Scenario: 多个转售记录且无原厂与 Zen 记录
- **WHEN** 某模型 id 只存在于两个第三方 provider 下
- **THEN** 不从 models.dev 补充任何字段

### Requirement: 推理档位来源
扩展 SHALL 仅依据上一条规则选中的 models.dev 记录的 `reasoning_options` 生成推理档位；扩展 MUST NOT 依据 LiteLLM 的 `supports_*_reasoning_effort` 等字段生成或删减档位。档位 SHALL 翻译为 pi 的 `thinkingLevelMap`，规则如下：
- `type: effort` 的每个取值映射到同名 pi 档位（`none` 映射到 `off`）；记录未声明的 pi 档位 SHALL 显式置 `null` 隐藏，使模型选择器只提供实际可用的档位。
- `type: budget_tokens` 且协议为 Anthropic Messages 时，生成 `high` 与（记录声明最大值时）`max` 两个档位；记录未声明最大值时只生成 `high`；声明的最大值小于 16000 时只生成 `high`。`off` 不写键（保持可关闭思考）；`minimal`/`low`/`medium` 与未声明的 `max` 置 `null` 隐藏。档位对应的预算数值由 pi 宿主按自身设置推导（扩展注册接口无法按模型注入预算数值），扩展 MUST NOT 通过映射值编码预算。
- `type: toggle` 不生成档位。无 `reasoning_options` 或无选中记录时 SHALL 不生成档位（`reasoning` 为 false），模型照常注册，这是合法的最终状态。

#### Scenario: effort 档位
- **WHEN** 走 responses 协议的模型 `gpt-5.5` 选中记录的 `reasoning_options` 为 `[{type: effort, values: [none, low, medium, high, xhigh]}]`
- **THEN** 该模型的 thinkingLevelMap 给出 `off`、`low`、`medium`、`high`、`xhigh` 五个档位，`minimal` 与 `max` 为 `null`，`reasoning` 为 true

#### Scenario: budget 档位
- **WHEN** 走 Messages 协议的模型选中记录的 `reasoning_options` 为 `[{type: budget_tokens, max: 64000}]`
- **THEN** 该模型的 thinkingLevelMap 给出 `high` 与 `max` 两个档位（`minimal`/`low`/`medium` 为 `null`），`reasoning` 为 true

#### Scenario: 只有 toggle
- **WHEN** 选中记录的 `reasoning_options` 为 `[{type: toggle}]`，LiteLLM 给出 `supports_reasoning: true`
- **THEN** 模型正常注册，`reasoning` 为 false 且没有任何档位

### Requirement: 按价格阶梯截断上下文
扩展 SHALL 从部署信息推算价格阶梯点：形如 `input_cost_per_token_above_<N>k_tokens` 的非零字段（阶梯点 N×1000），以及 `tiered_pricing` 数组中各档 `range` 起点大于 0 的值；取所有来源中最小的作为首个阶梯点；存在阶梯点且小于原上下文上限时，注册的上下文上限 SHALL 被限制为该阶梯点。该行为 SHALL 默认开启，并可通过扩展配置关闭。扩展 MUST NOT 读取本地 Codex `models_cache.json`。

#### Scenario: 272k 阶梯
- **WHEN** 部署的 `max_input_tokens` 为 1050000，且存在非零的 `input_cost_per_token_above_272k_tokens`
- **THEN** 注册的上下文上限为 272000

#### Scenario: tiered_pricing 阶梯
- **WHEN** 部署的 `max_input_tokens` 为 1000000，`tiered_pricing` 包含 `range: [0, 256000]` 与 `range: [256000, 1000000]` 两档
- **THEN** 注册的上下文上限为 256000

#### Scenario: 用户关闭截断
- **WHEN** 扩展配置关闭阶梯截断
- **THEN** 同一模型注册的上下文上限为 1050000

### Requirement: 显示名与价格
扩展 SHALL 使用 LiteLLM 的 `model_name` 作为模型 id、调用时的模型名与显示名（原样显示，不做格式化）。扩展 SHALL 在 LiteLLM 提供按 token 计价字段时填充每百万 token 的价格（输入、输出、缓存读、缓存写），缺失时回退到 models.dev 的价格，两者都没有时为 0。

#### Scenario: 显示名
- **WHEN** 部署的 `model_name` 为 `gpt-5.6-sol`，models.dev 选中记录的 `name` 为 `GPT-5.6 Sol`
- **THEN** 模型显示名为 `gpt-5.6-sol`

#### Scenario: 价格换算
- **WHEN** 部署的 `input_cost_per_token` 为 2.5e-06
- **THEN** 注册的输入价格为每百万 token 2.5 美元

### Requirement: 空结果与异常数据
LiteLLM 请求成功但过滤后没有任何对话模型时，扩展 SHALL 注册空的模型清单（撤下之前的模型），不得当作失败而保留上次结果。单个部署字段缺失或类型异常时，扩展 SHALL 把该字段按"未提供"处理；部署缺少 `model_name` 时 SHALL 跳过该部署；不得因单个部署异常导致整次发现失败。

#### Scenario: 对话模型全部被删除
- **WHEN** 上次注册了 5 个模型，本次 `/v1/model/info` 成功返回，但只剩 embedding 部署
- **THEN** LiteLLM provider 下不再有任何模型

#### Scenario: 单个部署数据异常
- **WHEN** 某部署的 `max_input_tokens` 为字符串 `"abc"`，其他部署正常
- **THEN** 其他部署照常注册，该部署的上下文上限按回退规则确定
