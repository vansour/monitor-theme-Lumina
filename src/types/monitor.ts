/**
 * 两段类型定义：
 *
 * 1. `Node` / `Metrics` / `MetricPoint` / `PingPoint` —— monitor hub 公开接口的原始结构，
 *    字段名与 hub 的 src/api.rs 一一对应。主题只读这些。
 * 2. `NodeDisplay` / `PingOverviewItem` / `TrafficTrendSample` —— 组件层消费的扁平展示模型，
 *    沿用 Lumina 原本的形状，所以组件与 CSS 基本不用改。
 *
 * 契约要求「把每个键都当成可能不存在」：旧版 hub 少字段是常态，读的时候一律给默认值。
 */

// ---- hub 公开接口 ----

/** 实时指标。匿名调用只拿到白名单里的键，地址与原始内核计数器都不在其中。 */
export type Metrics = {
  uptime: number;
  /** 百分比，0–100。 */
  cpu: number;
  load: [number, number, number];
  mem_total: number;
  mem_used: number;
  swap_total: number;
  swap_used: number;
  disk_total: number;
  disk_used: number;
  /** 字节/秒。 */
  net_rx: number;
  /** 字节/秒。 */
  net_tx: number;
  /** 累计字节。 */
  total_rx: number;
  total_tx: number;
  month_rx: number;
  month_tx: number;
  tcp: number;
  udp: number;
  procs: number;
};

export type Node = {
  id: number;
  name: string;
  sort: number;
  public: boolean;
  online: boolean;
  /** ISO 3166-1 alpha-2，hub 定位不到时是空串。 */
  country: string;
  /** 站长设的分组，空串是未分组。旧版 hub 没有这个键。 */
  group?: string;
  last_seen: number;
  /** 离线、或已连接但还没上报过，都是 null。 */
  metrics: Metrics | null;
  os: string;
  kernel: string;
  arch: string;
  virt: string;
  cpu_name: string;
  cpu_cores: number;
  mem_total: number;
  swap_total: number;
  disk_total: number;
  agent_version: string;
  price: number;
  currency: string;
  billing_cycle: string;
  expires_at: string | null;
  /** hub 日历上还剩几天，已过期是负数，没填到期日是 null。旧版 hub 没有这个键。 */
  expires_in?: number | null;
  traffic_limit: number;
  traffic_mode: string;
  traffic_reset_day: number;
  total_rx: number;
  total_tx: number;
  month_rx: number;
  month_tx: number;
  month_used?: number;
  month_start: string;
  day_rx: number;
  day_tx: number;
};

export type Me = {
  authed: boolean;
  github: boolean;
  site_name: string;
  public_page: boolean;
  site: string;
};

export type NodesResponse = {
  nodes: Node[];
  admin: boolean;
};

/** 一个历史桶。除 `ts` 外都是该桶的均值，`net_*_max` 是桶内峰值。 */
export type MetricPoint = {
  ts: number;
  cpu: number;
  mem_used: number;
  disk_used: number;
  net_rx: number;
  net_tx: number;
  /** 旧版 hub 没有这两个键。 */
  net_rx_max?: number;
  net_tx_max?: number;
};

/** 一个延迟桶。`latency` 是桶内中位数，整桶全超时是 null。 */
export type PingPoint = {
  task_id: number;
  ts: number;
  latency: number | null;
  /** 桶内答上来的样本跨的区间，只在这个桶有跨度时出现。 */
  band?: [number, number];
  /** 桶内超时百分比，只在大于 0 时出现。 */
  loss?: number;
};

export type MetricsResponse = {
  metrics: MetricPoint[];
  ping: PingPoint[];
  /** 探测 id → 名字。只含这个节点被分配到的探测。 */
  probes: Record<string, string>;
  /** 探测 id → 整窗丢包百分比，没丢包的不出现。 */
  loss: Record<string, number>;
};

// ---- 展示模型 ----

/** 扁平化的节点：静态信息 + 实时指标 + 在线状态，组件直接读这里。 */
export interface NodeDisplay {
  /** `String(node.id)`，让整个组件层继续用字符串做键。 */
  id: string;
  /** 数字主键，请求历史时用。 */
  nodeId: number;

  name: string;
  group: string;
  region: string;
  os: string;
  arch: string;
  virtualization: string;
  kernel_version: string;
  cpu_name: string;
  cpu_cores: number;
  mem_total: number;
  swap_total: number;
  disk_total: number;
  price: number;
  billing_cycle: string;
  currency: string;
  expired_at: string;
  /** 剩余天数，负数已过期，`null` 是没填到期日。已按 hub 的日历解好。 */
  expiresIn: number | null;
  traffic_limit: number;
  traffic_mode: string;
  traffic_reset_day: number;
  /** 本计费周期已用流量，与 `traffic_limit` 同口径。进度条必须用它，不能用累计流量。 */
  monthUsed: number;

  /** true 在线；false 离线；null 已连接但还没上报过，界面上显示「状态同步中」。 */
  online: boolean | null;
  updatedAt: number;
  uptime: number;
  cpuPct: number;
  ramUsed: number;
  ramTotal: number;
  ramPct: number;
  swapUsed: number;
  swapTotal: number;
  swapPct: number;
  diskUsed: number;
  diskTotal: number;
  diskPct: number;
  load1: number;
  load5: number;
  load15: number;
  /** 字节/秒。 */
  netUp: number;
  /** 字节/秒。 */
  netDown: number;
  /** 累计字节。 */
  trafficUp: number;
  trafficDown: number;
  process: number;
  connectionsTcp: number;
  connectionsUdp: number;
}

/** 首页卡片延迟条的一个采样点。 */
export interface PingSample {
  time: number;
  /** 延迟毫秒；负值是丢包标记，沿用 Lumina 的约定。 */
  value: number;
}

/** 首页一张卡片的延迟概览。 */
export interface PingOverviewItem {
  client: string;
  /**
   * 这个节点有没有被分配探测：true 有、false 没有、null 还没查过。
   * 三种要分开 —— 「没配」是站长的配置事实，还没查出来之前不该替他下结论。
   */
  isAssigned: boolean | null;
  lastValue: number | null;
  samples: PingSample[];
  loss: number | null;
}

/** 延迟条按时间分桶后的一个桶。 */
export interface PingOverviewBucket {
  index: number;
  value: number | null;
  loss: number | null;
  total: number;
  lost: number;
  startAt: number | null;
  endAt: number | null;
}

/** 卡片上网速迷你条的一个点。 */
export interface TrafficTrendSample {
  value: number;
  level: number;
  opacity: number;
}
