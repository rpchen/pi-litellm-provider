## 1. 回归与构建

- [x] 1.1 复制 Core 固定合成 /v1/model/info、可见名称及 catalog 样本，添加刷新/持久化/诊断回归，并证明旧 Core 失败
- [x] 1.2 固定已合并 Core 完整 SHA 更新构建与 provenance，回归通过，不添加 adapter 业务过滤
- [x] 1.3 扩展真实宿主 E2E，验证运行中模型撤销、命令诊断及 endpoint 隔离
- [x] 1.4 更新 README

## 2. 验收与归档

- [x] 2.1 通过固定产物复验、类型检查、完整测试、隔离包消费和适用交付检查
- [x] 2.2 创建插件 PR，真实宿主 required E2E 和常规 CI 全部成功；PR 记录 Scenario → 自动化证据
- [x] 2.3 回填证据，通过 OpenSpec CLI 同步与归档、strict validation、closure

## Evidence

- 旧 Core a08db4a70498ae7f397c264bb3f7c01eb196e1f8：新回归失败，刷新仍多出七个 GPT。
- 新 Core 1ff0979c8f22ec06479331d94ced2cf466f1fd42：npm test 343/343、类型检查、固定产物复验、隔离包消费、strict OpenSpec、scenario coverage、closure、release metadata 全部通过。
- [BLOCKED-HOST-REFRESH]：test/blocked-deployments.test.ts 验证20→13、持久化及诊断，并再次刷新排除旧发布/LKG复活；真实宿主链路在 scripts/e2e-real-pi.mjs。
- [BLOCKED-HOST-ISOLATION]：scripts/e2e-real-pi.mjs 验证真实 Pi company 模型移除时 default 清单不变，/litellm-diagnostics company 报告13。
- 实现提交 a50421b4b8668c15a81e7070f52ed6b8777f9d80 的 [CI #231](https://github.com/rpchen/pi-litellm-provider/actions/runs/39559208769) 全部成功，包括 Real Pi 0.87.1 E2E；本地从相同 Git commit 经 pi install 安装的完整 E2E 也通过。

## Retrospective

Core #39 已合并，两个插件固定相同完整 SHA；本插件生产源码没有复制过滤逻辑或模型名称特判。README 与主规格将统一暂停语义，最终归档提交仅改规格/证据；最终 CI 由 PR 单独回读确认。没有创建临时 workflow、版本/tag/Release 或修改用户配置。本 PR 待审核，未授权合并；合并后的 main/index finish 与发版另行执行。配套 OpenCode PR：https://github.com/rpchen/opencode-litellm-provider/pull/70。

- CLI archive 已同步 canonical requirement；归档后 strict validation 23/23、closure 0 mismatch，产品源码、测试和 dist 与通过实现验收的提交逐字节一致。
