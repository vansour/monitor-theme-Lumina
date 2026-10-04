/**
 * hub 的数据 → 界面要的形状。全是纯函数：没有 fetch，没有模块状态。
 *
 * 单独放一处是因为这里集中了几个容易写错、错了又不显眼的地方 —— 流量比的是哪个
 * 口径、到期天数谁来算、一条坏上报怎么处置。`adapters.test.ts` 盯着它们。
 */
import type { MetricsResponse, Node, NodeDisplay } from "../types/monitor.ts";

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pct(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0;
}

/** 上报里的每一个数字字段，都得是有限非负数，不然整条上报作废。 */
const METRIC_FIELDS = [
  "uptime",
  "cpu",
  "mem_total",
  "mem_used",
  "swap_total",
  "swap_used",
  "disk_total",
  "disk_used",
  "net_rx",
  "net_tx",
  "total_rx",
  "total_tx",
  "month_rx",
  "month_tx",
  "tcp",
  "udp",
  "procs",
] as const;

/**
 * 一条坏上报不该把整页节点带下水。指标不全的节点当作「没有实时数据」，
 * 卡片于是走离线那一套渲染，而不是把 NaN 送进 formatBytes 印成「NaN TB」。
 */
export function safeNodes(nodes: Node[]): Node[] {
  const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  return nodes.map((node) => {
    const m = node.metrics;
    const sound =
      !!m &&
      METRIC_FIELDS.every((key) => ok(m[key])) &&
      Array.isArray(m.load) &&
      m.load.length === 3 &&
      m.load.every(ok);
    return sound ? node : { ...node, metrics: null };
  });
}

/**
 * 本计费周期已用流量。hub 会算好（`month_used`），这里的分支只服务于更早的 hub：
 * `traffic_mode` 决定这个套餐是按上行、下行、较大者还是两者之和计量。
 *
 * 进度条必须用这个而不是累计流量 —— `traffic_limit` 是每周期上限。
 */
export function monthUsage(node: Node): number {
  if (typeof node.month_used === "number") return node.month_used;
  switch (node.traffic_mode) {
    case "up":
      return num(node.month_tx);
    case "down":
      return num(node.month_rx);
    case "max":
      return Math.max(num(node.month_rx), num(node.month_tx));
    default:
      return num(node.month_rx) + num(node.month_tx);
  }
}

/** 旧版 hub 不给 `expires_in` 时的兜底。按 UTC 算，尽量贴近 hub 的日历。 */
export function daysUntilUtc(expiresAt: string | null | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const ts = Date.parse(`${expiresAt}T00:00:00Z`);
  if (Number.isNaN(ts)) return null;
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((ts - today) / 86_400_000);
}

/**
 * 剩余天数。hub 给了就用 hub 的 —— 它按自己的日历算，和续费通知口径一致；
 * 用浏览器时钟算，hub 跑 UTC、访客在 UTC+8 时会每个周期提前八小时显示「已过期」。
 *
 * `"expires_in" in node` 而不是 `??`：`null` 是「没填到期日」这个有效答案，
 * 与「旧版 hub 不认识这个键」是两回事。
 */
export function expireDays(node: Node, now = Date.now()): number | null {
  if ("expires_in" in node) return node.expires_in ?? null;
  return daysUntilUtc(node.expires_at, now);
}

/**
 * hub 的三种节点状态各对应一种界面：离线、已连接但还没上报（`online: true` 而
 * `metrics: null`，最容易漏掉的一种）、以及正常在线。中间那种映射成 null，
 * 卡片显示「状态同步中」而不是谎报 0%。
 */
export function onlineState(node: Node): boolean | null {
  if (!node.online) return false;
  return node.metrics ? true : null;
}

/** 一个节点 → 组件层消费的扁平结构。 */
export function toDisplay(node: Node): NodeDisplay {
  const m = node.metrics;
  const cpuCores = num(node.cpu_cores);
  return {
    id: String(node.id),
    nodeId: node.id,

    name: node.name ?? "",
    group: node.group ?? "",
    region: node.country ?? "",
    os: node.os ?? "",
    arch: node.arch ?? "",
    virtualization: node.virt ?? "",
    kernel_version: node.kernel ?? "",
    cpu_name: node.cpu_name ?? "",
    cpu_cores: cpuCores,
    mem_total: num(node.mem_total),
    swap_total: num(node.swap_total),
    disk_total: num(node.disk_total),
    price: num(node.price),
    billing_cycle: node.billing_cycle ?? "",
    currency: node.currency ?? "",
    expired_at: node.expires_at ?? "",
    expiresIn: expireDays(node),
    traffic_limit: num(node.traffic_limit),
    traffic_mode: node.traffic_mode ?? "",
    traffic_reset_day: num(node.traffic_reset_day),
    monthUsed: monthUsage(node),

    online: onlineState(node),
    // `last_seen` 是秒，界面统一用毫秒。
    updatedAt: num(node.last_seen) * 1000,
    uptime: num(m?.uptime),
    cpuPct: num(m?.cpu),
    ramUsed: num(m?.mem_used),
    ramTotal: num(m?.mem_total) || num(node.mem_total),
    ramPct: pct(num(m?.mem_used), num(m?.mem_total) || num(node.mem_total)),
    swapUsed: num(m?.swap_used),
    swapTotal: num(m?.swap_total) || num(node.swap_total),
    swapPct: pct(num(m?.swap_used), num(m?.swap_total) || num(node.swap_total)),
    diskUsed: num(m?.disk_used),
    diskTotal: num(m?.disk_total) || num(node.disk_total),
    diskPct: pct(num(m?.disk_used), num(m?.disk_total) || num(node.disk_total)),
    load1: num(m?.load?.[0]),
    load5: num(m?.load?.[1]),
    load15: num(m?.load?.[2]),
    netUp: num(m?.net_tx),
    netDown: num(m?.net_rx),
    trafficUp: num(m?.total_tx) || num(node.total_tx),
    trafficDown: num(m?.total_rx) || num(node.total_rx),
    process: num(m?.procs),
    connectionsTcp: num(m?.tcp),
    connectionsUdp: num(m?.udp),
  };
}

/**
 * `60 * ceil(hours*60/budget)`，budget 被 hub 夹在 60..1440 —— 与 hub 的
 * `sample_step` 同式。主题据此知道自己的曲线画在什么栅格上。
 */
export function sampleStep(hours: number, points: number): number {
  const budget = Math.min(1440, Math.max(60, points));
  return 60 * Math.max(Math.ceil((hours * 60) / budget), 1);
}

export interface PingSeriesRecord {
  task_id: number;
  /** 秒。 */
  time: number;
  /** 延迟毫秒；负值是「这个桶整个超时」。 */
  value: number;
}

export interface PingSeriesTask {
  id: number;
  name: string;
  /** 这条曲线的真实采样栅格（秒）。hub 给的是降采样后的桶，比探测配置的间隔粗。 */
  interval: number;
  loss: number;
}

interface PingSeries {
  records: PingSeriesRecord[];
  tasks: PingSeriesTask[];
  /** 按 task id 的字符串形式索引，单位为秒。 */
  sampleIntervals: Record<string, number>;
  from: number;
  to: number;
}

/**
 * 把 hub 的探测历史摊成曲线。
 *
 * 两点是刻意的：
 * - `latency === null`（整桶全超时）映射成负值，下游的断口判定与着色沿用同一条约定；
 * - `interval` 给的是**采样栅格**而不是探测配置的间隔 —— 后者是管理员才看得到的信息，
 *   hub 不下发。降采样之后曲线本来就画在粗栅格上，断档判定按真实栅格来才不会误判。
 *
 * 探测顺序取 `ping` 数组本身：hub 按 `ping_task.sort, id` 排过，是稳定的，
 * 而 `probes` 对象的键序没有这样的保证。
 */
export function pingSeriesFrom(
  res: MetricsResponse,
  hours: number,
  points: number,
  now = Date.now(),
): PingSeries {
  const step = sampleStep(hours, points);
  const orderedIds: number[] =
    res.ping.length > 0
      ? [...new Set(res.ping.map((row) => row.task_id))]
      : Object.keys(res.probes ?? {}).map(Number);

  const tasks: PingSeriesTask[] = orderedIds.map((id) => ({
    id,
    name: res.probes?.[String(id)] || `探测 ${id}`,
    interval: step,
    loss: res.loss?.[String(id)] ?? 0,
  }));

  const records: PingSeriesRecord[] = res.ping.map((row) => ({
    task_id: row.task_id,
    time: row.ts,
    value: row.latency == null ? -1 : row.latency,
  }));

  const to = Math.floor(now / 1000);
  return {
    records,
    tasks,
    sampleIntervals: Object.fromEntries(tasks.map((task) => [String(task.id), step])),
    from: to - hours * 3600,
    to,
  };
}
