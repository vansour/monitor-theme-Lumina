import type { Me, MetricsResponse, Node } from "@/types/monitor";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * hub 回的每个错误都是一行写明原因的中文纯文本，可以直接拿给访客看。
 * 非 text/plain 的错误来自 hub 前面的反代或 CDN，它的正文不该显示，
 * 按状态码给一句话。
 */
async function failure(res: Response): Promise<ApiError> {
  const text = res.headers.get("content-type")?.startsWith("text/plain") ? (await res.text()).trim() : "";
  return new ApiError(
    res.status,
    text ||
      (res.status >= 500
        ? `服务暂时无法访问（HTTP ${res.status}），稍后再试`
        : `请求被拦截（HTTP ${res.status}），稍后再试`),
  );
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch {
    throw new ApiError(0, "网络连接失败，稍后再试");
  }
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return undefined as T;
  // 200 却回 HTML，那是反代的页面而不是 hub 的 JSON。
  return res.json().catch(() => {
    throw new ApiError(res.status, "收到的不是状态数据，稍后再试");
  });
}

export function getMe(): Promise<Me> {
  return api<Me>("/me");
}

export function getNodes(): Promise<{ nodes: Node[] }> {
  return api<{ nodes: Node[] }>("/nodes");
}

/**
 * `60 * ceil(hours*60/budget)`，budget 被 hub 夹在 60..1440 —— 与 hub 的
 * `sample_step` 同式。主题据此知道自己的曲线是画在什么栅格上的。
 */
export function sampleStep(hours: number, points: number): number {
  const budget = Math.min(1440, Math.max(60, points));
  return 60 * Math.max(Math.ceil((hours * 60) / budget), 1);
}

/** 匿名窗口上限 168 小时，登录后 2160；超出 hub 静默截断。 */
export const ANON_MAX_HOURS = 168;
export const ADMIN_MAX_HOURS = 2160;

/**
 * 历史指标与延迟。
 *
 * hub 给的是**每桶的聚合**而不是原始样本：`metrics` 里除 `ts` 外都是桶内均值
 * （`net_*_max` 是峰值），`ping` 里 `latency` 是桶内中位数。请求的 `points`
 * 只会让 hub 抽得更稀，不会更密。
 */
export function getMetrics(
  id: number,
  hours: number,
  points: number,
  series?: "metrics" | "ping",
): Promise<MetricsResponse> {
  const query = new URLSearchParams({ hours: String(hours), points: String(points) });
  if (series) query.set("series", series);
  return api<MetricsResponse>(`/nodes/${id}/metrics?${query}`);
}

/** 首页卡片用的：一个节点最近一小时的探测记录。 */
export function getNodePing(id: number, hours = 1) {
  return getMetrics(id, hours, 60, "ping");
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

export interface PingSeries {
  records: PingSeriesRecord[];
  tasks: PingSeriesTask[];
  /** 按 task id 的字符串形式索引，单位为秒 —— 与 hub 的栅格对齐。 */
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
 */
export function pingSeries(res: MetricsResponse, hours: number, points: number): PingSeries {
  const step = sampleStep(hours, points);
  // 探测顺序取 `ping` 数组本身：hub 按 `ping_task.sort, id` 排过，是稳定的，
  // 而 `probes` 对象的键序没有这样的保证。
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

  const to = Math.floor(Date.now() / 1000);
  return {
    records,
    tasks,
    sampleIntervals: Object.fromEntries(tasks.map((task) => [String(task.id), step])),
    from: to - hours * 3600,
    to,
  };
}
