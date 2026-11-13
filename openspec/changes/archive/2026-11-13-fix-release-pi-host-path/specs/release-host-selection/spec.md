## ADDED Requirements

### Requirement: Release E2E uses the installed latest host executable
Release SHALL 在进入npm脚本环境前记录本轮安装的最新Pi可执行绝对路径，供现有PI_BIN入口使用；不得以仓库devDependency二进制代替已解析的精确宿主版本。

#### Scenario: [RELEASE-HOST-PATH] 旧devDependency不会遮蔽发行宿主
- **WHEN** 仓库含旧Pi devDependency，Release安装并解析最新Pi
- **THEN** tag E2E调用记录的绝对路径，精确宿主版本断言及完整真实宿主矩阵必须通过。
