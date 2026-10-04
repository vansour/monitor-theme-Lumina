import type { Me, MetricsResponse, Node } from "@/types/monitor";

class ApiError extends Error {
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
  signal?: AbortSignal,
): Promise<MetricsResponse> {
  const query = new URLSearchParams({ hours: String(hours), points: String(points) });
  if (series) query.set("series", series);
  return api<MetricsResponse>(`/nodes/${id}/metrics?${query}`, signal ? { signal } : undefined);
}
