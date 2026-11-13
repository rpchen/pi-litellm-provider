## Why

v0.11.2 Release run 43363773153实测安装Pi 1.5.2后，npm run把仓库node_modules/.bin的0.87.1放在全局PATH前，tag E2E的精确宿主版本断言失败。旧tag保持不可变，本版0.11.3重新发版。

## What Changes

安装最新版Pi后在npm脚本启动前捕获command -v pi到现有PI_BIN环境入口。保持完整真实宿主E2E、精确版本断言、tag安装与附件校验，不增加输入或降级门禁。同步版本、README、release notes和Runtime Identity；产品源码与Core SHA不变。

## Impact

仅Pi发行流程与版本元数据；Core和OpenCode无此改动，不改变SDK契约。
