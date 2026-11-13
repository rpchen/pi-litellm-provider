## 实施

- [x] 根据失败Release日志确认npm PATH遮蔽及精确版本断言。
- [x] 捕获安装的Pi绝对路径并同步0.11.3版本、README与release notes。
- [x] 固定同一Core重建identity、复验dist、版本与规格，CLI归档。

交付：PR与main的CI/真实宿主E2E通过后创建新tag；Release必须实际通过精确宿主断言及完整E2E。旧v0.11.2 tag不移动、不删除。
