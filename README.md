# dsh-balance

在 DeepSeek Harness 侧边栏左下角「设置」按钮上方显示你的 DeepSeek 开放平台账户余额的插件。

## 功能

- 侧边栏底部、设置按钮上方显示 **余额 ¥xx.xx**（折叠成窄条时显示紧凑金额）
- 金额后追加**预计耗尽提示**，如「余额 ¥12.34 · 约 23 天」
- 悬停显示明细：充值余额 / 赠送余额 / **预计耗尽日期、日均消耗、估算依据天数** / 最近更新时间
- 点击跳转到 platform.deepseek.com/usage 用量页
- 每 2 分钟自动刷新；服务端 30 秒短缓存，不会频繁打 DeepSeek API
- API Key **只在服务端**解析与使用，浏览器端永远接触不到

## 预计耗尽时间是怎么算的

DeepSeek API 不提供消费历史，所以插件会在服务端把每次成功查询的余额快照
记录到 `~/.dsh/dsh-balance/balance-history.json`（保留最近 90 天）。估算时从
最新记录向前找**最近一段余额持续下降的区间**（余额上涨即充值点，自动跳过），
用该区间的消耗量 ÷ 天数得到日均消耗，再推算当前余额还能用多久。

- 余额历史不足 1 天（或从未下降过）时暂不显示估算，等数据积累后自动出现
- 充值后估算会自动切换为基于充值后的新消耗段
- 可配置项：`estimateMinDays`（至少累计多少天才估算，默认 1）、
  `historyMaxAgeDays`（历史保留天数，默认 90）

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

## 安装

```powershell
# 1. 把插件放进 web profile 的 node_modules（目录联接，改源码即生效）
$profile = "$HOME\.dsh\profiles\web"
$target  = "$profile\node_modules\dsh-balance"
New-Item -ItemType Junction -Path $target -Target "<本目录>" -ErrorAction SilentlyContinue

# 2. 在 $profile\cordis.patch.yml 末尾追加：
# - insert:
#     - id: dsh-balance
#       name: dsh-balance
#       config:
#         apiKeyEnv: DEEPSEEK_API_KEY
```

> 本仓库只包含插件本身；如果你在本机从 dsh 工作区使用，也可以直接运行工作区根目录的
> `install-dsh-balance.ps1`（它等价于上面两步，并把插件复制到 `~/.dsh/profiles/node_modules`）。

## 生效

- 刷新浏览器页面（新插件条目需要页面重新读取 boot 清单；若补丁热重载已把条目加入 loader，刷新即可，否则需要重启 dsh web）。
- 若刷新后仍不出现，重启一次 dsh --profile web。

## 验证

```powershell
# 服务端路由（Key 已配置时）
curl http://127.0.0.1:3080/ds-balance/balance
# 期望 {"ok":true,"is_available":true,"balance_infos":[{"currency":"CNY",...}],...}
```

## 卸载

```powershell
Remove-Item "$HOME\.dsh\profiles\web\node_modules\dsh-balance" -Recurse
# 并从 cordis.patch.yml 删除 dsh-balance 条目
```