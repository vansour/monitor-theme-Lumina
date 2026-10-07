# monitor-theme-Lumina

[monitor](https://github.com/monitor-probe/monitor) 的状态页主题，移植自 [stqfdyr/komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina) —— 面向 Komari 的同名主题。

首页是卡片式的高密度节点列表，详情页整合了负载与延迟图表。React 19 + Vite + Tailwind 4 + uPlot。

![首页](./preview.png)

## 安装

在 hub 后台「主题」页上传 `theme.tar.gz`，或者把主题目录放进 hub 的 `--themes` 位置（一键部署的默认值是 `/opt/monitor/data/themes/`），目录名必须是 `lumina`。之后在后台选中它，无需重启。

也可以下载 release 里的 `theme.tar.gz`，用 `gzip -t` 校验一下再传。

## 路由

| 路径 | 内容 |
|---|---|
| `/` | 站点总览 + 节点卡片列表 |
| `/instance/{id}` | 单个节点的详情与图表 |

`/admin`、`/api`、`/install.sh`、`/agent/*` 由 hub 接管，不属于主题。

**`/instance/{id}` 要在反代或 WAF 上放行。** 从列表点进详情只是 `pushState`，边缘看不见请求；只有**刷新详情页**才会真的请求这个前缀。症状是「点进去正常、一刷新就被拦」。

## 主题设置

设置项声明在 `theme.json` 的 `config` 里，站长在 hub 后台「主题」页调整。主题用 `GET /api/themes/lumina/config` 读取，任何失败都静默回落到默认值。

| 设置 | 默认 | 作用 |
|---|---|---|
| 默认外观 | 跟随系统 | 浅色 / 深色 / 跟随系统。访客自己切换过之后跟随访客 |
| 显示后台入口 | 开 | 右上角设置菜单里的一行，指向 `/admin/` |
| 显示首页总览 | 开 | 见下方「总览的口径」 |
| 首页按分组分区 | 开 | 见下方「节点分组」 |
| 离线节点排在最后 | 关 | 只把离线的整体移到后面，不改变站长拖出来的相对顺序 |
| 显示网络延迟页签 | 开 | 关掉则详情页只剩负载图表 |
| 默认时间范围 | 6 小时 | 打开详情页时先画的范围 |

站点级设置一律走这里，只有访客自己的外观选择进 localStorage —— 在右上角那个常驻的设置菜单里切换（浅色 / 跟随系统 / 深色），选完即生效，菜单不关，方便来回比。

### 站点图标

图标走 hub 自己的站点图标设置（后台「设置」页），主题这边不提供上传口：hub 直接回答 `/favicon.svg`、`/favicon.ico`、`/apple-touch-icon.png` 这些路径，站长在后台传过图标就全站生效，切换主题也不丢。

- `index.html` 里原样写着 `href="/favicon.svg"` 与 `href="/apple-touch-icon.png"`：hub 返回页面时会按当前图标的字节给这两个 URL 加上版本号，图标一换网址就变，浏览器与 iOS 书签不会抱着旧图标不放。
- 主题自带一份 `dist/favicon.svg` 与 180×180、不透明底色的 `dist/apple-touch-icon.png`，站长没传图标时 hub 落到它们；传过之后这两个文件不再被访问。
- iOS 的主屏幕图标只认 `apple-touch-icon`，别用 SVG；透明的地方会被 iOS 填成黑色，所以那份 PNG 必须是不透明的。
- 反代或 WAF 按路径放行时，这三个路径要在白名单里，否则图标到不了浏览器与 iOS 主屏幕。

### 总览的口径

首页网格上方那行小格子（节点 / 实时带宽 / CPU / 内存 / 磁盘 / 本月流量）全部由每 2 秒推来的那一帧节点快照现算，**不产生任何请求**。几处容易看错的地方：

- **带宽与资源只合计在线节点。** 离线节点上留着最后一次上报的数字，内存/磁盘的「总量」还会退回静态配置 —— 让它进分母，全站百分比会被一路拉低。
- **内存与磁盘是「已用之和 ÷ 总量之和」**，不是各台百分比的平均：1 GiB 的机器和 100 GiB 的机器不该等量齐观。CPU 那格相反，是在线节点的百分比均值（不同核数没有共同分母），小注写着「在线均值」。
- **本月流量**那格的大数字与百分比取同一批机器 —— 设了流量配额的节点；没配额的机器只进全站合计，鼠标停在那一格上能看到两个口径的数。
- 「同步中」是已连接但还没上报过的节点（`online: null`），单独计数，不混进离线。

### 节点分组

卡片按 hub 后台给每个节点设的分组**分区**显示，每节一个标题：

- **分区顺序**取站长排序里这一组第一次出现的位置（不是字母序）；没填分组的节点单独成区、永远在最后；组内保持站长拖出来的顺序。「离线节点排在最后」在每一节内部生效。
- 点标题可以**收起**一组，选择按访客存在 `localStorage` 的 `lumina:collapsed-groups` 里；组名改了或删了，那条记录就不再匹配，不会出错。
- 顶部标签栏可以只看某一组（分组数 ≥ 2 时才出现），**不记忆**，刷新回到「全部」。筛选时那一节一定展开 —— 否则选中一个收起的组会得到一片空白。
- 收起与筛选都只是把那一节 `display:none`：卡片留在 DOM 里，画布不丢，展开时不用重画。
- 关掉「首页按分组分区」就回到不分组的平铺栅格；详情页里的分组信息不受影响。

## 开发

主题只读公开数据，任何一个开着状态页的 hub 都能当数据源：

```bash
npm ci
MONITOR_HUB=https://hub.example.com npm run dev
```

不设 `MONITOR_HUB` 时 `vite` 把 `/api` 与 WebSocket 代理到 `http://127.0.0.1:9911`。在本机起 hub 的写法见文档站的[主题开发](https://monitor-document.pages.dev/dev/theme)页。

构建产物在 `dist/`。提交前跑 `npm run build && npm run lint && npm test`。

`npm test` 跑三个文件。`src/utils/adapters.ts` 盯的是那几个错了不显眼的地方 —— 流量比的是哪个口径、到期天数与离线时长谁在数、一条坏上报怎么处置、探测顺序按什么定；`src/utils/overview.ts` 盯总览的合计口径 —— 谁进分母、百分比是「先合计再相除」还是「各台取平均」、配额的分子分母是不是同一批机器；`src/utils/grouping.ts` 盯分组的顺序 —— 组的先后由谁定、空白组名算不算一组、在线数变了快照认不认得出来。没有测试框架，node 自己剥掉类型，失败时退出码非零。

## 打包

```bash
npm run build && npm run package     # 产出 theme.tar.gz
```

包里是一个可直接安装的主题目录：`dist/` + `theme.json` + `preview.png`。这与 hub 从磁盘读主题时的布局一致，也与会发布到 release 的包完全一样。

## 发版

改动记在 [CHANGELOG.md](./CHANGELOG.md)。发布步骤：

1. 把改动写进 `[未发布]` 一节
2. 发布时新开 `## [x.y.z] - YYYY-MM-DD`，把 `[未发布]` 的内容挪进去
3. `theme.json`、`package.json`、`package-lock.json` 三个版本号都改成 `x.y.z`
4. 打 tag `vx.y.z` 推送

推送 tag 会触发 `release.yml`：先卡 tag 与 `theme.json` 的版本号是否相等，再从 CHANGELOG 里取出这一版的一节当 release 说明（**取不到就直接失败**，不会发出一个没有说明的 release），然后构建、打包、校验包内容，最后附上 `theme.tar.gz` 与它的 sha256 发 release。

手动触发同一个工作流只构建打包、留个 artifact 供下载，不发 release —— 用来在不打 tag 的情况下验证这条流水线。

`npm run changelog -- <版本号>` 可以在本地把某一节的说明打出来看看。

`ci.yml` 在推 main 和开 PR 时跑 lint / test / build，并检查三个文件的版本号是否一致。

## 实时数据

节点数据只有一条来路：`/api/ws` 每 2 秒推一帧。浏览器有 `DecompressionStream` 时连的是 `/api/ws?gzip`，帧是 gzip 二进制；旧版 hub 不认这个参数、站长登录着时 hub 推的管理帧一律不压缩，两种都还是文本帧，主题两种都收。WebSocket 断开时 `/api/nodes` 每 5 秒顶班，直到流回来。

- **10 秒没有一帧读得出来**就按断流处理。NAT 忘掉一条连接、手机把页面挂起，这类断开没有 close 事件，浏览器要等 TCP keepalive 放弃（Chrome 是 450 秒）才会发现 —— 不设这个看门狗，页面会一直停在旧数据上，右上角的同步异常提示也不会出现。
- **页面隐藏时松手**：关掉推送、停掉轮询，挂起前发出的请求结果一律丢弃；回到前台立刻取一次 `/api/nodes` 并重连。手机挂起过的连接可能还显示已连接却再也收不到数据，留着一场空。

## 用到的 hub 接口

全部同源、全部只读：

| 接口 | 用途 |
|---|---|
| `GET /api/me` | 站名、登录状态、公开页开关 |
| `GET /api/nodes` | 节点列表与实时指标（WebSocket 断开时的回退） |
| `GET /api/ws?gzip` | 每 2 秒推送一帧完整节点快照，`?gzip` 时是 gzip 二进制帧 |
| `GET /api/nodes/{id}/metrics` | 历史指标与延迟记录 |
| `GET /api/themes/lumina/config` | 站长改过的设置 |

站点图标不在这个表里：它由 hub 后台设置，主题只是把 `/favicon.svg` 与 `/apple-touch-icon.png` 写进 `index.html`，请求由 hub 回答。

## 与上游 Lumina 的差异

上游是给 Komari 写的，数据模型有几处对不上，移植时按 monitor 的能力做了取舍：

- **首页多了一行站点总览**（上游没有）：节点状态、实时带宽合计、资源占用与本月流量，全部由实时推送那一帧现算，不额外请求 hub。
- **详情页只画四张历史图**（CPU / 内存 / 磁盘 / 网络）。hub 的历史表只存这四样加聚合列，Swap、负载均值、进程数、连接数都只有实时值、不落盘。这四项在详情页的信息栏里照常显示，只是没有曲线。
- **首页卡片不画延迟与丢包条**（上游画）。那一条要靠每张卡片每三分钟一次的历史查询喂，hub 的历史查询同时只跑 4 个、排队超过直接 503，访客一滚页就把名额占满；延迟与丢包改到详情页看，首页卡片只留实时推送里就有的东西。
- **探测由节点自己的分配决定，不绑定到卡片**。monitor 没有公开的 Ping 任务列表接口（那是管理员接口），但每个节点被分配到的探测可以匿名读到（`probes` 随样本一起下发）。详情页的多探测图按 hub 给的顺序画：图例、配色与统计卡的先后都跟随后台拖出来的排列（hub 1.3.0 起，`ping_task.sort`）；不把两个不同目标的探测取平均，那是个对谁都不成立的数。
- **站内设置面板没有了**，设置改到 hub 后台。上游的 `?view=theme-manage` 面板同时承担「首页 Ping 绑定」，而绑定这件事在 monitor 里由 hub 后台的探测分配决定，主题这边不需要。
- **分组搬到分区标题上，卡片不再挂标签**。monitor 的节点模型没有 tags，只有分组；上游那套 DStatus 标签胶囊（连同它的调色板）跟着删掉了，分组改由首页的分区标题承载。
- **到期天数用 hub 给的 `expires_in`**，不拿浏览器时钟算。hub 按自己的日历数，和续费、掉线通知口径一致；用浏览器时钟算，hub 跑 UTC、访客在 UTC+8 时会每个周期提前八小时显示「已过期」。
- **流量进度条比的是本计费周期的用量**（`month_used`），不是累计流量。monitor 的 `traffic_limit` 是按 `traffic_mode` 计的每周期上限，拿一年的累计量去除它，一台开了半年的机器会画成 1000%。
- **付款周期按 monitor 的写法读**：`monthly` / `quarterly` / … 或 `<n>m` / `once`，不是天数。
- **网络图多了一条峰值线**。hub 会落盘每个桶内的峰值网速（agent 每个上报间隔测一次），上游的 Komari 没有这个数据。

## 许可

MIT，见 [LICENSE](./LICENSE)。

本仓库是 [stqfdyr/komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina) 的移植（Komari → monitor），界面设计与绝大部分样式来自上游，数据层为适配 monitor 的公开接口重写。

`public/assets/flags/` 下的 258 个国旗图标看上去来自 [circle-flags](https://github.com/HatScripts/circle-flags)（MIT）。
