# Pi 实施与验收证据

Core #34 squash merge 为 `cf797e953eb1f6de8e7c3e0fd5e98094398c26f9`，本插件构建、复验和真实安装均使用该 SHA。未使用 PR HEAD 作为 provenance。

## 实施结果

Core 整记录配置直接映射；reasoningSupported 独立决定支持，空档位显式隐藏 Pi SDK 默认档位，Messages 原有预算兼容控制保留。输入只映射已有 text/image。删除 serving/candidate/operator 诊断及旧字段差异的适配、渲染和测试。审计只取公开来源与实际注册字段。schema9/2 沿既有入口迁移，价格错误归零，contextTierCap 忽略。README 与当前决策/context 同步。

冻结16项输入、公开 catalog 和 oracle 从已合并 Core 字节一致复制；测试不读取内部路由，不修改 oracle。GPT 每型号单独检查，DeepSeekFlash 输出393216，GPT上下文1050000。

## 自动化结果

- Windows 全量 `bun run test`：334 pass、3 POSIX权限 skip、0 fail，337项/23文件，339.64秒。随后诊断删减和后备来源补测：`bun test test/` 262 pass、3 skip、0 fail，1109断言；未改索引测试。Linux CI 执行完整相同门禁，包括权限用例。
- `bun run verify:dist`、`bun run typecheck`、`bun run test:package`、`npm run validate:spec`、scenario coverage、OpenSpec closure、release metadata 和 required merge gate 通过；verify:dist 在隔离目录按 provenance SHA 重建比较。
- [CI 38065205625](https://github.com/rpchen/pi-litellm-provider/actions/runs/38065205625)：候选06a4c21的CI/Real Pi 0.87.1 E2E均SUCCESS。最终 HEAD 状态以本PR checks为准，文档不声称旧候选等于后续提交。

## 真实 Pi 0.87.1

Windows 使用仓库安装的 pinned 0.87.1 CLI，`pi install` 安装 `git:github.com/rpchen/pi-litellm-provider@06a4c217f97a70efd58875d83b174eaef9424c2d`，隔离 HOME/XDG/PI_CODING_AGENT_DIR，两本地fake LiteLLM及独立合成credential，Node24.13.0。未读写用户真实配置或服务凭据。

16/16 最终注册/picker字段符合 oracle，60次真实 SDK Chat/Responses/Messages请求检查调用名、协议路径和每个声明档位。支持无effort、不支持推理、已有Messages预算单独控制验证。价格错误不撤下；catalog outage、内部route变化、恢复、成功空目录、通知跨重启、认证隔离、activation及完整endpoint管理/legacy迁移通过。fake server按pathname接受Anthropic SDK正常的?beta=true。

本地日志在被忽略的 .tmp；Windows清理隔离临时目录遇到EPERM，测试断言与进程退出成功，未将此当作产品功能失败。Linux真实宿主job同样覆盖完整脚本。最终审查交付包含该脚本，最新不可变候选由CI重新安装验证。

候选 `131a0eb950e3c4ac9623c58605973ed2bc10ef72` 的 [CI 38068469751](https://github.com/rpchen/pi-litellm-provider/actions/runs/38068469751) 已通过：Linux完整339/339，真实Pi0.87.1以自身installer重新安装该Git候选，63个实际SDK请求覆盖全部16模型，包括kimi-k2.7-code、mimo-v2.6-flash、mimo-v2.6-pro的空picker与无默认推理参数；每个有档位型号仍逐effort核对。此前60请求结果是历史候选，补测后的验收以63为准。最终文档HEAD仍须通过同一CI/native门禁。

## Pi picker 展示 Review 修复

Review 证实默认诊断与 audit 的 metadata.reasoningLevels 错用 thinkingLevelMap 的 value：冻结 gpt-5.6-luna 显示 none 而不是 picker 的 off，Messages 则漏掉 SDK 默认 off。两处现在直接调用 Pi SDK getSupportedThinkingLevels；原始 thinkingLevelMap、Core 输入、注册与请求映射不变。README 明确 picker 名称与请求 effort 的区别。

test/metadata-priority.test.ts 新增冻结 GPT 与现有 e2e-messages 回归，两条在旧实现均失败，修复后与 diagnostics/audit 相关36项全部通过。真实 Pi 脚本新增16项 audit/picker 一致性、GPT 诊断 off、Messages 诊断/audit off，并验证原始映射不变；原63请求验收保留。完整门禁与不可变新候选的真实安装结果以 PR #55 最新 HEAD 的 CI checks 和审查描述为准，不将旧候选结果当作新 HEAD 证据。

## Review 边界

PR #55 交代码Review，不合并、不打tag、不发布；任务5.2/5.3等待归档/授权合并与finish。未修改历史archive。
