# 本地实施证据

- Pi旧Core下REDIRECT-HOST失败：期望393216，实际943718；新Core下通过，包含刷新持久化、诊断及新实例restore。
- 单元测试267 pass / 3 skip / 0 fail；verify:dist、typecheck、test:package、103项e2e-gate、自检inputs、scenario coverage与release metadata通过。
- 索引辅助测试42/42通过；固定Core SHA为90adfe8b0cde94ece261867997990b6f36d3e984，artifact插件版本0.11.2。
- 本地日志在被忽略.tmp/canonical-*.log。真实Pi latest E2E、main/索引、Release及本地真实服务验收以PR/工作流/发布后回读记录为准，不以单测冒充。

Scenario REDIRECT-HOST的固定model-info、公开目录形态、旧快照→网络发现→注册/诊断/持久化→新实例restore链路位于test/canonical-name-redirect.test.ts。README与release notes已更新，选择算法只在Core维护。
