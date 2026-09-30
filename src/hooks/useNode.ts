import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  ensureStarted,
  getNodeSnapshot,
  getNodeTrafficTrendSnapshot,
  getOfflineNodeIdsSnapshot,
  getStoreStatusSnapshot,
  getVisibleNodeIdsSnapshot,
  subscribe,
  subscribeToNode,
} from "@/lib/nodes";
import type { NodeDisplay, TrafficTrendSample } from "@/types/monitor";

const EMPTY_TRAFFIC_TREND_SNAPSHOT: { up: TrafficTrendSample[]; down: TrafficTrendSample[] } = {
  up: [],
  down: [],
};

function useEnsured(enabled = true) {
  useEffect(() => {
    if (enabled) ensureStarted();
  }, [enabled]);
}

const noopUnsubscribe = () => undefined;

export function useNode(id: string, enabled = true): NodeDisplay | undefined {
  useEnsured(enabled);
  // subscribe 的身份必须稳定：useSyncExternalStore 会在它变化时退订再订阅，
  // 内联箭头会让组件每次 render 都重订阅一次。
  const subscribeFn = useCallback(
    (cb: () => void) => (enabled ? subscribeToNode(id, cb) : noopUnsubscribe),
    [id, enabled],
  );
  const getSnapshotFn = useCallback(() => (enabled ? getNodeSnapshot(id) : undefined), [id, enabled]);
  return useSyncExternalStore(subscribeFn, getSnapshotFn, getSnapshotFn);
}

export function useNodeTrafficTrend(
  id: string,
  enabled = true,
): { up: TrafficTrendSample[]; down: TrafficTrendSample[] } {
  useEnsured(enabled);
  const subscribeFn = useCallback(
    (cb: () => void) => (enabled ? subscribeToNode(id, cb) : noopUnsubscribe),
    [id, enabled],
  );
  const getSnapshotFn = useCallback(
    () => (enabled ? getNodeTrafficTrendSnapshot(id) : EMPTY_TRAFFIC_TREND_SNAPSHOT),
    [id, enabled],
  );
  return useSyncExternalStore(subscribeFn, getSnapshotFn, getSnapshotFn);
}

/** 全部节点 id，已按站长的顺序排好。 */
export function useVisibleNodeIds(): string[] {
  useEnsured();
  return useSyncExternalStore(subscribe, getVisibleNodeIdsSnapshot, getVisibleNodeIdsSnapshot);
}

/** 离线节点的 id。身份只在离线集合变化时变，适合拿来做排序。 */
export function useOfflineNodeIds(): string[] {
  useEnsured();
  return useSyncExternalStore(subscribe, getOfflineNodeIdsSnapshot, getOfflineNodeIdsSnapshot);
}

export function useNodeStoreStatus() {
  useEnsured();
  // 订阅派生快照而不是整个 state：state 每 2 秒换一次身份，
  // 直接订阅会让悬浮按钮这类消费者跟着空转。
  return useSyncExternalStore(subscribe, getStoreStatusSnapshot, getStoreStatusSnapshot);
}
