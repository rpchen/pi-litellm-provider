# pi-litellm-provider

Pi extension：填写 LiteLLM 地址和自己的 API Key 后，自动发现并同步当前 Key 实际可用的对话模型。

> 状态：脚手架（scaffold）。核心发现逻辑尚未接入；共享 core 的抽取方案见 `openspec/changes/`。

## 计划能力

- 以用户自己的 Key 请求 LiteLLM `/v1/model/info`，只注册真实存在且有权访问的对话模型
- 按 LiteLLM 的 `supported_endpoints` / `mode` / 上游家族判定协议，并映射到 pi 的内置 API 实现
- 映射上下文窗口、输出上限、输入输出模态、工具调用与价格
- 从 models.dev 精确补充模型元数据并生成推理档位
- 默认按 LiteLLM 的阶梯价格起点截断上下文窗口
- 在启动与定时轮询时同步模型清单；短暂故障时保留上次成功结果

## 与 opencode-litellm-provider 的关系

本仓库是 LiteLLM 自动发现能力的 **pi 宿主适配器**。宿主无关的发现核心（LiteLLM 归一化、models.dev 补缺、能力映射、协议判定、轮询与降级）来自平级的
`../opencode-litellm-provider`，按“单副本共享”方式复用；两者不共享宿主层代码。

决策背景见 `docs/decisions.md`。

## 要求

- pi `>=0.87.1`
- Bun（测试）、Node.js（无 Bun 时的脚本执行）
- LiteLLM 地址必须使用 `http://` 或 `https://`
- API Key 必须有权访问 `/v1/model/info`（旧版部署可通过 `/model/info` 回退）及要调用的模型

## 安装（计划）

```bash
pi install git:github.com/rpchen/pi-litellm-provider
```

> 尚未发布；当前先用本地路径加载（见下）。

## 开发

```bash
npm ci
bun run typecheck
bun test
npm run validate:spec  # OpenSpec 规格校验
bun run test:package # 校验 pi.extensions 与 npm 打包内容
```

在真实 pi 中加载（单次运行，不写入 settings）：

```bash
pi -e ./extensions/index.ts
```

`pi -e` 可指定本地文件或目录；改完代码在会话内执行 `/reload`。

## OpenSpec

本项目使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 管理规格变更：`openspec/changes/` 存放在途变更，`openspec/specs/` 存放已落地能力规格。
