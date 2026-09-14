# 变更日志

记录 `dsh-balance` 插件的版本变更。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.2.0] - 2026-09-14

> 要求 **DSH ≥ 0.1.5**：客户端半边使用了新版 slots 运行时的「等待插槽声明」写法。
> Release：https://github.com/btbxbob/dsh-deepseek-balance/releases/tag/v0.2.0

### 新增

- 徽标第二行**常驻显示**预计耗尽时间，不再只放在悬停 `title` 里
- 估算不足 1 天时显示具体时分（如「今天 13:22 见底」）；窄条模式显示紧凑版 `≈7h` / `≈37天` / `≈1.2年` / `用不完`
- 新配置项 `estimateLookback`：估算基于最近多少次查询，默认 8
- 响应新增 `windowHours`（估算依据的时间跨度）与 `basedOnSamples`（依据的查询次数）

### 变更

- **耗尽估算改为娱乐向**：放弃「余额连续下降且跨度 ≥ 1 天」的严格门槛——在每 2 分钟采样、
  余额长期持平的现实下几乎永远凑不出来，导致估算经常缺失。改为取最近 N 次查询，把窗口内
  相邻采样之间的每次下降累加为消耗、摊到窗口跨度得日均消耗，再除以当前余额
- 移除配置项 `estimateMinDays`（其门槛逻辑已被上式取代）
- 窗口内余额没有下降时不再隐藏估算，而是显示「余额纹丝不动，感觉能用到地老天荒」

### 修复

- **修复 DSH 0.1.5 下整个 loader entry 加载失败**：新版 slots 运行时要求插槽先被父条目声明，
  原 `apply()` 中直接 `ctx.slots.register(...)` 会报

  ```
  failed to apply loader entry <hash> (dsh-balance): slot "sidebar.footer.action" is not declared
  (a parent entry's children table must declare it)
  ```

  症状有迷惑性：宿主路由正常、boot 清单里也有 `dsh-balance/client.js`，但页面上徽标不出现，
  只在浏览器控制台报错。改用 `ctx.slots.inject("sidebar.footer.action", …)` 等待声明
  （控制器归本 fiber，卸载自动取消等待 / 撤下贡献）
- 余额历史不足 2 次查询时明确提示「查询次数还太少，再攒几次就能瞎猜了」，而不是不显示

### 文档

- README 新增**兼容性**章节（记录上述报错原文、根因与修法）
- 修正安装 / 生效 / 卸载路径：生效副本在 `~/.dsh/profiles/node_modules/<name>`
  （扁平回退目录，纯拷贝），并强调 `cordis.patch.yml` 中的挂载行**被注释 = 完全不加载**

## [0.1.0] - 2026-08-16

### 新增

- 首个版本：侧边栏左下角「设置」按钮上方的 DeepSeek 账户余额徽标
- 悬停显示充值 / 赠送余额明细；点击跳转 platform.deepseek.com/usage
- 每 2 分钟自动刷新；服务端 30 秒短缓存，不会频繁打 DeepSeek API
- API Key 只在服务端解析（凭证服务优先，兼容环境变量），浏览器端永远接触不到
- 服务端注册仅回环可信的 `GET /ds-balance/balance` 路由，并把每次成功查询快照到
  `~/.dsh/dsh-balance/balance-history.json`（保留最近 90 天）
- 基于「最近一段连续下降区间」的耗尽时间估算，金额后追加「· 约 23 天」

### 文档

- README 标题改为仓库名 `dsh-deepseek-balance`、补侧边栏截图、去掉工作区外部脚本引用

[未发布]: https://github.com/btbxbob/dsh-deepseek-balance/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/btbxbob/dsh-deepseek-balance/releases/tag/v0.2.0
[0.1.0]: https://github.com/btbxbob/dsh-deepseek-balance/commit/e54fdf9
