## Purpose

定义 Pi 插件如何在更新构建时获取并固定独立的 `litellm-discovery-core`，让类型检查、测试和编译复用同一份源码，并把带来源证明的 core 编译产物随插件交付且不产生运行时远端依赖。

## ADDED Requirements

### Requirement: 单次构建固定 core SHA
每次更新构建 SHALL 先解析 `https://github.com/rpchen/litellm-discovery-core` 的 `main` 实际 commit SHA，再按该 SHA 获取源码；本次类型检查、测试和编译 MUST 只使用该 SHA 对应的源码。构建缓存可以位于被忽略的目录，但不得成为运行时输入或需要手工维护的源码副本。

#### Scenario: main 更新后构建
- **WHEN** core 的 `main` 在两次插件构建之间前进
- **THEN** 后一次更新构建记录新的实际 SHA，并用该 SHA 的源码完成全部检查与编译

#### Scenario: 复验已有产物
- **WHEN** 复验一个已经生成且带 provenance 的插件产物
- **THEN** 复验使用产物记录的 core SHA，不因远端 `main` 后续前进而改变输入

### Requirement: 构建产物包含 core 且可追溯
插件构建 SHALL 将 core 编译进 `dist` 下的相对路径模块，扩展入口 SHALL 只从该产物加载；产物 MUST 自动记录 core 仓库 URL、分支名和准确 commit SHA。Git 安装或打包文件 MUST 包含入口、扩展适配层、编译后的 core 与 provenance 记录。

#### Scenario: provenance 可查询
- **WHEN** 检查一次成功构建的 `dist` 产物
- **THEN** 能读取 core 仓库、`main` 分支和完整 40 位 SHA，且与本次构建解析到的 SHA 一致

#### Scenario: 安装包完整
- **WHEN** 对插件执行打包清单检查
- **THEN** 清单包含 `extensions` 入口、`dist` 编译文件和 provenance，且不要求平级 core 仓库

### Requirement: 运行时无 core 获取依赖
插件运行时 MUST NOT 从 GitHub 下载 core、读取本机 core 缓存路径或依赖安装生命周期脚本；加载已提交产物只允许依赖 Pi 宿主提供的 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` peer dependency。

#### Scenario: 禁用 lifecycle scripts 安装
- **WHEN** 在干净目录使用 Git/打包内容并禁用安装 lifecycle scripts
- **THEN** 安装后直接从包入口加载扩展成功，不触发网络获取 core 或现场编译

#### Scenario: 无平级仓库
- **WHEN** 安装目录不存在 `../opencode-litellm-provider` 或任何 core 缓存
- **THEN** Pi 扩展仍能加载并注册 provider

### Requirement: core 逻辑单副本
Pi 仓库 SHALL 删除独立维护的 `src/core/` 实现，适配层只能引用构建时获取的独立 core 公共 API；Pi 的 provider 注册、凭据解析、协议映射、模型能力映射和网络降级行为 MUST 与迁移前固定 fixtures 的结果一致。

#### Scenario: 固定 fixtures 行为一致
- **WHEN** 使用相同的 LiteLLM `/v1/model/info` 与 models.dev 脱敏 fixtures 构建模型清单
- **THEN** 迁移后模型 id、协议、输入能力、上下文/输出上限和推理档位与迁移前快照一致
