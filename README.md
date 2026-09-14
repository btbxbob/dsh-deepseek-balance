# dsh-deepseek-balance

> 插件包名：`dsh-balance`

在 DeepSeek Harness 侧边栏左下角「设置」按钮上方显示你的 DeepSeek 开放平台账户余额的插件。

![侧边栏余额徽标](docs/screenshot.png)

## 功能

- 侧边栏底部、设置按钮上方显示**两行余额卡片**：第一行是 **余额 ¥xx.xx**（折叠成窄条时显示紧凑金额）
- 第二行**常驻显示预计耗尽时间**（不用悬停），比如「预计 8/29 耗尽 · 约 3 天见底（最近 2 小时瞎猜）」；若估算今天见底则直接显示具体时间，如「今天 23:15 见底（最近不到 1 小时瞎猜）」
- 悬停显示明细：充值余额 / 赠送余额 / 预计耗尽日期、日均消耗、估算依据查询次数 / 最近更新时间
- 点击跳转到 platform.deepseek.com/usage 用量页
- 每 2 分钟自动刷新；服务端 30 秒短缓存，不会频繁打 DeepSeek API
- API Key **只在服务端**解析与使用，浏览器端永远接触不到

## 预计耗尽时间是怎么算的（娱乐版）

DeepSeek API 不提供消费历史，所以插件会在服务端把每次成功查询的余额快照
记录到 `~/.dsh/dsh-balance/balance-history.json`（保留最近 90 天）。

**刻意放弃准确性，图一乐**：不像以前那样要求「至少连续下降 1 天」——那样在
每 2 分钟采样 + 余额长期持平的现实里几乎永远凑不出来。现在只看**最近几次查询**
（默认最近 8 个采样点，可配 `estimateLookback`），把相邻采样之间的每次下降
累加为消耗，摊到整个窗口跨度上得到日均消耗，再除以当前余额得出剩余天数：

- 有消耗 → 显示「预计 8/29 耗尽 · 约 3 天见底（最近 2 小时瞎猜）」；估算不足 1 天时显示具体时间：「今天 23:15 见底（最近不到 1 小时瞎猜）」
- 窗口内纹丝不动 → 显示「余额纹丝不动，感觉能用到地老天荒」
- 历史不足 2 次查询 → 显示「查询次数还太少，再攒几次就能瞎猜了」

> 所有数字都是估算、且故意带娱乐色彩，别当真。充值后窗口会自然切到新的消耗段。

可配置项：`estimateLookback`（基于最近多少次查询，默认 8）、
`historyMaxAgeDays`（历史保留天数，默认 90）。

## 架构

双半插件（dual-half cordis plugin）：

| 半 | 文件 | 作用 |
|----|------|------|
| 服务端（host） | lib/index.js | 注册 GET /ds-balance/balance 路由（仅回环可信请求），解析 API Key，代理 https://api.deepseek.com/user/balance |
| 浏览器（client） | lib/client.js | 向 sidebar.footer.action 插槽注册余额徽标组件，定时拉取并渲染 |

## API Key 从哪来

按优先级：

1. 插件配置里的字面 apiKey（不推荐，见下）
2. 凭证服务 ctx.credentials 中名为 apiKeyEnv（默认 DEEPSEEK_API_KEY）的引用 —— 也就是 ~/.dsh/.credentials.yaml 里配置的 DeepSeek Key（模型页面 Models 里填的那个）
3. 启动环境变量 DEEPSEEK_API_KEY

> 推荐用凭证服务：Key 不进插件配置、不进浏览器，且与模型调用复用同一把 Key。

## 兼容性

已在 **DSH 0.1.5-rc.1** 上验证（宿主路由 200、徽标正常渲染）。

客户端半边用 `ctx.slots.inject("sidebar.footer.action", …)` **等待侧边栏声明该插槽**后再注册。
这不是可选的写法：0.1.5 起重写的 slots 运行时要求插槽先被父条目声明，若在 `apply()` 里直接
`ctx.slots.register(...)`，整个 loader entry 会加载失败并报：

```
failed to apply loader entry <hash> (dsh-balance): slot "sidebar.footer.action" is not declared
(a parent entry's children table must declare it)
```

症状是宿主路由正常、boot 清单里也有 `dsh-balance/client.js`，但页面上徽标不出现。

## 安装

```powershell
# 1. 把插件放进 profile 的扁平回退目录（生效副本；纯拷贝，改源码后需重新拷贝）
$target = "$HOME\.dsh\profiles\node_modules\dsh-balance"
Copy-Item "<本目录>" $target -Recurse -Force

# 2. 在 $HOME\.dsh\profiles\web\cordis.patch.yml 里加入（不能注释掉，注释=完全不加载）：
# - insert:
#     - id: dsh-balance
#       name: dsh-balance
#       config:
#         apiKeyEnv: DEEPSEEK_API_KEY
```

## 生效

- **宿主半边**（lib/index.js）改动：必须重启 `dsh --profile web`（可用模型工具 `dsh_restart_backend`）。
- **客户端半边**（lib/client.js）改动：重启宿主后刷新页面（bundle rev 是内容哈希，改文件必须重启才会重建 boot 清单）。
- 若刷新后仍不出现：确认 `cordis.patch.yml` 里的行没被注释，并重启一次。

## 验证

```powershell
# 服务端路由（Key 已配置时；插件自注册的路由不受 GUI 认证栅栏影响）
curl http://127.0.0.1:3080/ds-balance/balance
# 期望 {"ok":true,"is_available":true,"balance_infos":[{"currency":"CNY",...}],
#       "estimation":{"available":true,"daysLeft":...,"basedOnSamples":8,...},...}
```

## 卸载

```powershell
Remove-Item "$HOME\.dsh\profiles\node_modules\dsh-balance" -Recurse
# 并从 $HOME\.dsh\profiles\web\cordis.patch.yml 删除 dsh-balance 条目
```