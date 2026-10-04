# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## 怎么发版

1. 在下面的 `## [未发布]` 里写清楚改了什么
2. 准备发布时，新开一节 `## [x.y.z] - YYYY-MM-DD`，把 `[未发布]` 里的内容挪进去
3. 把 `theme.json`、`package.json`、`package-lock.json` 的版本号都改成 `x.y.z`
4. 打 tag `vx.y.z` 并推送

tag 会被 release 工作流拦下来校验：必须等于 `theme.json` 的版本号，而且本文件里必须有对应的一节 —— 缺了就报错，发布不会在半截状态下发生。release 说明直接取那一节的内容。

## [未发布]

## [0.0.3] - 2026-10-04

### 新增

- 站长可以在右上角菜单里上传站点图标（favicon）：登录着后台时多出「站点图标」一栏，选一个 `.ico`（不超过 32 KiB）即可，图标转成 data URL 存进 hub 的主题设置，所有访客下次加载生效，不用重新部署；同一栏里也能移除。这个设置键不写进 `theme.json`（hub 的表单没有文件类型），读取、上限与 ICO 文件头的判定在 `src/utils/favicon.ts`，有对应的 `npm test` 断言
- 新增 `src/utils/favicon.test.ts`，`npm test` 由三个文件变四个

### 移除

- 首页卡片不再显示延迟与丢包，`show_ping_mini` 设置一并删掉。那一条要每张卡片每三分钟向 hub 查一次探测历史，占 hub 的历史查询名额（同时 4 个，排队超过直接返回 503）；延迟与丢包改到详情页看，首页只留实时推送里就有的东西
- 随之删掉首页的探测轮询（排队、退避、按视野取数那一套）与它的排期算术 `src/utils/pingSchedule.ts`
- 清掉约 480 行从未渲染过的样式：上游站内设置面板的 `theme-manage-*`、旧版概览/系列/丢包条残留，以及只被它们用到的 14 个颜色变量与 4 个 `@theme` 条目
- 删掉无人引用的代码：`lossHeatFraction`、`NodesResponse` 类型、`formatExpireDays` 里从未被读过的 `tone`、`InstancePanel` 的 `description` 与 `Spinner` 的 `size`；只在本文件内部使用的符号不再多余地 `export`，`tsconfig.test.json` 里已删文件的 include 也一并去掉

### 修复

- 详情页延迟图不再按探测 id 排序：图例、配色与下方探测统计卡跟随 hub 的面板顺序（后台拖出来的探测排列），站长调整「延迟检测」的顺序后公开页跟随
- `Spinner` 引用了一个主题里从未定义过的 `--accent-500`，顶部弧线一直退回继承色；改为主题自己的 `--progress-cpu`

### 文档

- README 删掉「延迟条的开销」与设置表里对应的一行；主题描述不再提卡片上的延迟与丢包条；新增「站点图标」与上传接口的说明，`npm test` 的文件数随之调整

## [0.0.2] - 2026-09-30

### 新增

- 首页卡片列表上方新增一行总览小格子：节点状态、实时带宽合计、CPU / 内存 / 磁盘占用与本月流量。数据全部来自既有的实时推送，不额外请求 hub
- 新增设置「显示首页总览」（默认开）
- 首页节点按 hub 的分组**分区**显示：每节一个标题（组名 + 台数 / 在线数），点标题可以收起一组（按访客记在本地），顶部标签栏可以只看某一组（分组数 ≥ 2 时出现）。没分组的节点单独成区、排在最后；组内保持站长拖出来的顺序
- 新增设置「首页按分组分区」（默认开），关掉回到不分组的平铺栅格

### 变更

- 首页延迟查询改成按需轮询：只查滚动到视野里的卡片（节点总数不超过 24 时全部轮询），每张三分钟一次，请求之间保持间隔、一次只发一单 —— 不再每分钟把整站节点的查询一起发出去，把 hub 的历史查询名额让给后台与详情页
- 单张卡片被 hub 挡回时只有它自己退避（三分钟起，逐次加倍，上限 15 分钟），不再让整页卡片一起停 5 分钟
- 首页的探测请求加了 15 秒超时：挂住的请求不会再一直占着在飞的名额
- 卡片底部不再显示分组胶囊，分组信息改由分区标题承载（详情页的分组显示不受影响）；顺手删掉上游遗留的 DStatus 标签样式与调色板
- 右上角改成一个常驻的设置菜单：外观三选一与后台入口收进点开的二级面板，按钮不再伸缩；面板与按钮都换成与卡片一致的实心底 + 细边 + 卡片阴影，不再用半透明与背景模糊

### 修复

- `pingValues.ts` 的注释指向了一个不存在的函数名，改指 `adapters.ts` 的 `pingOverviewItem`

### 文档

- README 的「延迟条的开销」与 `theme.json` 的开关说明改写成按需轮询的行为
- README 补上「总览的口径」「节点分组」两节与设置表里对应的两行，并说明首页多了站点总览、分组改由分区标题承载（与上游的差异）
- `npm test` 增加 `src/utils/pingSchedule.test.ts`、`src/utils/overview.test.ts` 与 `src/utils/grouping.test.ts`

## [0.0.1] - 2026-09-30

首个版本：把 [Komari](https://github.com/komari-monitor/komari) 的 [Lumina](https://github.com/stqfdyr/komari-theme-Lumina) 主题移植到 [monitor](https://github.com/monitor-probe/monitor)。

### 新增

- 首页节点卡片：CPU / 内存 / 磁盘 / 负载四条指标条、上下行网速与迷你趋势条、延迟与丢包条、到期与在线时长
- 详情页：四张负载历史图（CPU / 内存 / 磁盘 / 网络）与一张多探测延迟图，支持框选缩放与断点连线
- 负载图的「实时」档：从历史末段接上，之后跟着 WebSocket 每 2 秒推的帧追加新点
- 主题设置：在 `theme.json` 里声明，站长在 hub 后台「主题」页调整
- 六项设置：默认外观、后台入口、离线节点排最后、卡片显示延迟与丢包、显示延迟页签、默认时间范围

### 说明

- 详情页只画 CPU / 内存 / 磁盘 / 网络四张历史图：hub 的历史表只存这四样，Swap、负载均值、进程数、连接数都只有实时值
- 首页延迟条用节点**自己**被分配到的探测，不需要把 Ping 任务绑定到卡片
- 一个节点挂了多个探测时，卡片只画第一个（按后台里探测的排列顺序）
- 设置改到 hub 后台，上游的站内设置面板（`?view=theme-manage`）没有移植
- 节点模型没有标签，卡片底部只显示分组

### 修复（相对上游）

- 流量进度条改比**本计费周期**用量：hub 的 `traffic_limit` 是每周期上限，拿累计流量去除它，一台开了半年的机器会画成 1000%
- 到期天数改用 hub 给的 `expires_in`：用浏览器时钟算，hub 跑 UTC、访客在 UTC+8 时会每个周期提前八小时显示「已过期」
- 历史曲线「多大的洞算断档」改成按典型采样间距的倍数判断，不再随缩放级别变化
- 首页延迟查询并发限制在 3 个、离线节点直接跳过、被 hub 挡回时保留上一次显示并退避 5 分钟 —— hub 的历史查询只有 4 个并发名额

### 依赖

- React 19、Vite 8、TypeScript 7、Tailwind 4、uPlot 1.6、lucide-react 1.49

[未发布]: https://github.com/vansour/monitor-theme-Lumina/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/vansour/monitor-theme-Lumina/releases/tag/v0.0.3
[0.0.2]: https://github.com/vansour/monitor-theme-Lumina/releases/tag/v0.0.2
[0.0.1]: https://github.com/vansour/monitor-theme-Lumina/releases/tag/v0.0.1
