import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getMetrics } from "@/lib/api";
import type { MetricsResponse } from "@/types/monitor";

/**
 * 一个节点的历史。`series` 只取要画的那一半：响应里省下的那半原本占一多半。
 *
 * `placeholderData: keepPreviousData` 让切换时间范围时旧曲线留在原地，
 * 而不是先空一下再画。
 *
 * hub 侧每个历史查询都占一个并发名额（一共 4 个），排队超过返回 503，
 * 所以调用方要能接受失败 —— 页面保留上一次的数据。
 */
export function useNodeMetrics(
  id: number,
  hours: number,
  points: number,
  series: "metrics" | "ping",
  enabled = true,
) {
  return useQuery<MetricsResponse>({
    queryKey: ["metrics", id, hours, points, series],
    queryFn: () => getMetrics(id, hours, points, series),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: enabled && Number.isFinite(id) && hours > 0,
  });
}
