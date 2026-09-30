import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { getNodePing } from "@/lib/api";
import { getNodeSnapshot } from "@/lib/nodes";
import { useThemeConfig } from "@/hooks/useThemeConfig";
import { isLostPingSample, isValidPingLatency } from "@/utils/pingValues";
import { pingOverviewItem } from "@/utils/adapters";
import type { PingOverviewBucket, PingOverviewItem } from "@/types/monitor";

/** 卡片上的窗口：最近一小时，与分桶窗口一致。 */
const WINDOW_HOURS = 1;
/** 一轮查完之后的等待。与数据本身的分钟级分辨率对齐。 */
const REFRESH_MS = 60_000;
const MIN_REFRESH_MS = 30_000;
const MAX_REFRESH_MS = 300_000;
/** 被 hub 挡回来之后的退避：历史查询的名额是共享的，连着撞只会更糟。 */
const BACKOFF_MS = 300_000;
/**
 * 同时在飞的历史查询数。
 *
 * hub 的历史查询走一个只有 4 个名额的信号量，而且**排队超过就返回 503** 而不是等 ——
 * 每个查询都占着 agent 上报用的那条 SQLite 连接。一次把 50 张卡片的查询全发出去，
 * 只会让别处（包括后台面板）的查询被拒。
 */
const MAX_CONCURRENCY = 3;
/** 卡片上延迟条画多少根 —— 沿用 Lumina 的密度。 */
const MAX_VISIBLE_HOMEPAGE_PING_BUCKETS = 24;
/** 卡片上延迟条画多少根，就是 Lumina 原本的密度。 */

const EMPTY_PING: PingOverviewItem = {
  client: "",
  isAssigned: null,
  lastValue: null,
  samples: [],
  loss: null,
};

let items = new Map<string, PingOverviewItem>();
const listeners = new Map<string, Set<() => void>>();

let visibleIds: string[] = [];
let visibleKey = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopped = false;
let nextDelay = REFRESH_MS;

function emit(id: string) {
  const set = listeners.get(id);
  if (set) for (const listener of set) listener();
}

function setItem(id: string, item: PingOverviewItem) {
  const prev = items.get(id);
  if (prev && sameItem(prev, item)) return;
  items.set(id, item);
  emit(id);
}

function sameItem(a: PingOverviewItem, b: PingOverviewItem): boolean {
  if (
    a.client !== b.client ||
    a.isAssigned !== b.isAssigned ||
    a.lastValue !== b.lastValue ||
    a.loss !== b.loss ||
    a.samples.length !== b.samples.length
  ) {
    return false;
  }
  for (let i = 0; i < a.samples.length; i++) {
    if (a.samples[i]!.time !== b.samples[i]!.time || a.samples[i]!.value !== b.samples[i]!.value) {
      return false;
    }
  }
  return true;
}

function staleBeyondWindow(id: string): boolean {
  const node = getNodeSnapshot(id);
  if (!node || node.updatedAt <= 0) return false;
  return Date.now() / 1000 - node.updatedAt / 1000 >= WINDOW_HOURS * 3600;
}

/** 一轮刷新：每个可见节点一次请求，并发受 `MAX_CONCURRENCY` 限制。 */
async function refreshRound(ids: string[]) {
  if (running) return;
  running = true;

  const queue: { id: string; nodeId: number }[] = [];
  for (const id of ids) {
    const node = getNodeSnapshot(id);
    if (!node) continue;
    // 最近一次上报早于窗口起点，这个节点的窗口里不可能有记录，问了也是白问。
    if (staleBeyondWindow(id)) {
      setItem(id, { ...EMPTY_PING, client: id, isAssigned: true });
      continue;
    }
    queue.push({ id, nodeId: node.nodeId });
  }

  let refused = false;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      try {
        const res = await getNodePing(next.nodeId, WINDOW_HOURS);
        setItem(next.id, pingOverviewItem(next.id, res));
      } catch {
        // 查不到就保留上一次的显示 —— 「被拒了」和「窗口里没数据」是两回事，
        // 画成一样会把读的人引到错误的结论上。
        refused = true;
      }
    }
  });
  await Promise.all(workers);

  nextDelay = refused ? BACKOFF_MS : REFRESH_MS;
  running = false;
}

function schedule() {
  if (timer != null) clearTimeout(timer);
  timer = null;
  // 后台标签页不排下一轮；回来时再补一次。
  if (stopped || document.hidden) return;
  const delay = Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, nextDelay));
  timer = setTimeout(() => {
    void refreshRound(visibleIds).then(schedule);
  }, delay);
}

function onVisible() {
  if (document.hidden) return;
  void refreshRound(visibleIds).then(schedule);
}

function setVisibleIds(ids: string[]) {
  const key = ids.join("\u0000");
  const changed = key !== visibleKey;
  visibleKey = key;
  visibleIds = ids;

  if (stopped) {
    stopped = false;
    document.addEventListener("visibilitychange", onVisible);
  }
  if (changed) {
    nextDelay = REFRESH_MS;
    void refreshRound(ids).then(schedule);
  }
}

function stop() {
  stopped = true;
  if (timer != null) clearTimeout(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
}

function subscribeToItem(id: string, listener: () => void): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

/**
 * 起首页的探测轮询。由 `NodeGrid` 挂载一次，参数是当前可见的节点。
 *
 * 关掉这个开关时一切都不做：节点多的时候，这些历史查询会占满 hub 的查询名额，
 * 站长可以据此换回一点余量。
 */
export function useHomepagePingOverview(ids: string[]) {
  const { data: config } = useThemeConfig();
  const enabled = config?.show_ping_mini !== false;
  const key = ids.join("\u0000");

  useEffect(() => {
    if (!enabled) return;
    setVisibleIds(key ? key.split("\u0000") : []);
  }, [enabled, key]);

  // 离开首页即停止轮询；缓存留着，回来时立刻有东西可画。
  useEffect(() => stop, []);
}

const noopUnsubscribe = () => undefined;

export function usePingMini(id: string): PingOverviewItem {
  // subscribe 的身份必须稳定，否则 useSyncExternalStore 每次 render 都会重订阅。
  const subscribeFn = useCallback(
    (cb: () => void) => (id ? subscribeToItem(id, cb) : noopUnsubscribe),
    [id],
  );
  const getSnapshotFn = useCallback(() => (id ? (items.get(id) ?? EMPTY_PING) : EMPTY_PING), [id]);
  return useSyncExternalStore(subscribeFn, getSnapshotFn, getSnapshotFn);
}

/** 卡片上那一小时的分桶。纯前端聚合，与后端形状无关。 */
export function usePingMiniBuckets(
  ping: Pick<PingOverviewItem, "samples">,
  count?: number,
): PingOverviewBucket[] {
  return useMemo(() => {
    const now = Date.now();
    const totalWindowMs = 60 * 60 * 1000;
    const resolvedCount = count ?? MAX_VISIBLE_HOMEPAGE_PING_BUCKETS;
    const bucketMs = totalWindowMs / resolvedCount;
    const windowStart = now - bucketMs * resolvedCount;
    const totals = new Array<number>(resolvedCount).fill(0);
    const losts = new Array<number>(resolvedCount).fill(0);
    const positiveSums = new Array<number>(resolvedCount).fill(0);
    const positiveCounts = new Array<number>(resolvedCount).fill(0);

    for (const sample of ping.samples ?? []) {
      if (sample.time < windowStart || sample.time > now) continue;

      let bucketIndex = Math.floor((sample.time - windowStart) / bucketMs);
      if (bucketIndex < 0) continue;
      if (bucketIndex >= resolvedCount) bucketIndex = resolvedCount - 1;

      totals[bucketIndex] += 1;
      if (isValidPingLatency(sample.value)) {
        positiveSums[bucketIndex] += sample.value;
        positiveCounts[bucketIndex] += 1;
      } else if (isLostPingSample(sample.value)) {
        losts[bucketIndex] += 1;
      }
    }

    return Array.from({ length: resolvedCount }, (_, index) => {
      const startAt = windowStart + index * bucketMs;
      const endAt = startAt + bucketMs;
      const total = totals[index];
      const lost = losts[index];
      const positiveCount = positiveCounts[index];

      return {
        index,
        value: positiveCount > 0 ? positiveSums[index] / positiveCount : null,
        loss: total > 0 ? (lost / total) * 100 : null,
        total,
        lost,
        startAt,
        endAt,
      };
    });
  }, [count, ping.samples]);
}

