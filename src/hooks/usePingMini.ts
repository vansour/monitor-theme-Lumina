import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { getNodePing } from "@/lib/api";
import { getNodeSnapshot } from "@/lib/nodes";
import { useThemeConfig } from "@/hooks/useThemeConfig";
import { isLostPingSample, isValidPingLatency } from "@/utils/pingValues";
import { pingOverviewItem } from "@/utils/adapters";
import {
  PING_PERIOD_MS,
  backoffDelayMs,
  planPingDispatch,
  refreshDelayMs,
} from "@/utils/pingSchedule";
import type { PingJob } from "@/utils/pingSchedule";
import type { MetricsResponse, PingOverviewBucket, PingOverviewItem } from "@/types/monitor";

/**
 * 首页卡片的延迟 / 丢包轮询。
 *
 * 压力全在 hub 那边：历史查询走一个只有 4 个名额的信号量，**排队超过就返回 503**
 * 而不是等 —— 每个查询都占着 agent 上报用的那条 SQLite 连接。所以这里的规矩是
 * 「少发、慢发、错开发」：
 *
 * - 只轮询滚动到视野里的卡片（共享一个 IntersectionObserver）；节点总数不超过
 *   `ALL_POLL_MAX_CARDS` 的站全部轮询，小站保持原来的行为；
 * - 每张卡片三分钟一轮，带抖动 —— 不会整齐地一起到期；
 * - 一个泵按到期时间逐张发车，一次只发一单：同时在飞最多 2 个，相邻两次至少隔开
 *   一段间隔（稳态 = 三分钟 ÷ 在轮询的卡片数，夹在 150 毫秒到 30 秒之间；落后的
 *   卡片走 200 毫秒的快车道），所以一批同时到期的卡片也是逐个放行；
 * - 被挡回来只影响那一张：它自己指数退避，其余卡片照常，卡片上保留上一次的显示。
 *
 * 排期算术在 `src/utils/pingSchedule.ts`，`pingSchedule.test.ts` 用假时钟盯着它。
 */

/** 卡片上的窗口：最近一小时，与分桶窗口一致。 */
const WINDOW_HOURS = 1;
/** 站点小到这个数就整站轮询 —— 这几十个查询占不满 hub 的名额，不值得再做按需。 */
const ALL_POLL_MAX_CARDS = 24;
/** 一个请求最多等多久。挂住的请求会一直占着在飞的名额，掐掉重排比干等强。 */
const REQUEST_TIMEOUT_MS = 15_000;
/** 被拒之后整队先停一下：hub 说了名额满，接着撞只会更糟。任意一次成功就解除。 */
const FAILURE_PAUSE_MS = 5_000;
/** 卡片上延迟条画多少根 —— 沿用 Lumina 的密度。 */
const MAX_VISIBLE_HOMEPAGE_PING_BUCKETS = 24;

const EMPTY_PING: PingOverviewItem = {
  client: "",
  isAssigned: null,
  lastValue: null,
  samples: [],
  loss: null,
};

const items = new Map<string, PingOverviewItem>();
const listeners = new Map<string, Set<() => void>>();

/** 每张卡片一个 job，节点没了才会删：滚出视口只是 `active` 置假，排期状态留着。 */
const jobs = new Map<string, PingJob>();
/** 卡片在不在视口里。 */
const inViewport = new Map<string, boolean>();
/** 站点小到全查时，视口不参与判断。 */
let pollAll = true;
/** 元素 ↔ 卡片 id，两向都要：回调里由元素找 id，注销时由 id 找元素。 */
const cellIds = new Map<Element, string>();
const cellElements = new Map<string, Element>();
let observer: IntersectionObserver | null = null;

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlightCount = 0;
let lastStartAt = Number.NEGATIVE_INFINITY;
let pauseUntil = 0;

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

function isActive(id: string): boolean {
  return pollAll || inViewport.get(id) === true;
}

/**
 * 排一次车。所有会改变「下一次什么时候该动手」的地方都汇到这里：定时器到点、
 * 请求结束、切回前台、卡片进出视口、节点列表变化。
 */
function pump(): void {
  if (!running) return;
  arm(null);
  // 后台标签页不排下一轮；切回可见时 visibilitychange 会再叫一次。
  if (document.hidden) return;

  const now = Date.now();
  const plan = planPingDispatch(Array.from(jobs.values()), {
    now,
    lastStartAt,
    inFlightCount,
    pauseUntil,
  });
  if (plan.start) start(plan.start, now);
  arm(plan.wakeAt);
}

/** 唯一的定时器写入点：先清后排，所以任何时刻至多一只定时器。 */
function arm(at: number | null): void {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (at === null) return;
  timer = setTimeout(pump, Math.max(0, at - Date.now()));
}

function start(job: PingJob, now: number): void {
  job.inFlight = true;
  inFlightCount += 1;
  lastStartAt = now;
  // 发车是 fire-and-forget：漏网的异常不该变成未处理的 rejection，也不该拖垮泵。
  void dispatch(job).catch(() => undefined);
}

async function dispatch(job: PingJob): Promise<void> {
  try {
    const node = getNodeSnapshot(job.id);
    if (!node || !(node.nodeId > 0)) {
      // 节点快照还没到，先顺延一个周期 —— 这不是请求失败。
      defer(job);
      return;
    }
    if (staleBeyondWindow(job.id)) {
      // 最近一次上报早于窗口起点，这个窗口里不可能有记录，问了也是白问。
      // 但空 item 也要写上、也要算「处理过」，否则这张卡片会把间隔永久压在快车道上。
      setItem(job.id, { ...EMPTY_PING, client: job.id, isAssigned: true });
      settle(job);
      return;
    }

    let res: MetricsResponse;
    try {
      res = await getNodePing(node.nodeId, WINDOW_HOURS, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    } catch {
      // 只有请求这一层算失败：「被拒了」和「窗口里没数据」是两回事，
      // 画成一样会把读的人引到错误的结论上。
      fail(job);
      return;
    }

    // 适配层或订阅者抛错不算请求失败 —— 那会给这张卡片平白加一次退避。
    setItem(job.id, pingOverviewItem(job.id, res));
    settle(job);
  } finally {
    job.inFlight = false;
    inFlightCount = Math.max(0, inFlightCount - 1);
    pump();
  }
}

function settle(job: PingJob): void {
  const now = Date.now();
  job.settledAt = now;
  job.failures = 0;
  job.dueAt = now + refreshDelayMs();
  pauseUntil = 0;
}

function fail(job: PingJob): void {
  const now = Date.now();
  job.failures += 1;
  job.settledAt = now;
  job.dueAt = now + backoffDelayMs(job.failures);
  // 只有这张卡片退避，但整队也让一下：hub 说了名额满，接着撞只会更糟。
  pauseUntil = Math.max(pauseUntil, now + FAILURE_PAUSE_MS);
}

function defer(job: PingJob): void {
  const now = Date.now();
  job.settledAt = now;
  job.dueAt = now + PING_PERIOD_MS;
}

/** 可以重复调用：StrictMode 的 mount → cleanup → mount 走一遍也只会得到一个泵。 */
function startRunning(): void {
  if (running) return;
  running = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
  pump();
}

/** 离开首页或关掉开关。只拆运行时的东西，items / jobs / 视口状态都留着。 */
function stop(): void {
  running = false;
  arm(null);
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

function onVisibilityChange(): void {
  if (!document.hidden) pump();
}

function setTrackedIds(ids: string[]): void {
  pollAll = ids.length <= ALL_POLL_MAX_CARDS;

  const keep = new Set(ids);
  for (const id of jobs.keys()) {
    if (keep.has(id)) continue;
    // 节点从列表里消失了，排期与缓存都没有意义了。
    jobs.delete(id);
    items.delete(id);
  }
  for (const id of ids) {
    let job = jobs.get(id);
    if (!job) {
      // 新卡片立刻到期：第一次取数不该等一个周期，但仍会被间隔与并发上限逐个放出。
      job = { id, active: false, dueAt: 0, settledAt: 0, failures: 0, inFlight: false };
      jobs.set(id, job);
    }
    job.active = isActive(id);
  }

  startRunning();
}

/** 视口状态变了就重算这张卡片的 `active`。返回是否真的变了。 */
function setInViewport(id: string, visible: boolean): boolean {
  if (inViewport.get(id) === visible) return false;
  inViewport.set(id, visible);

  const job = jobs.get(id);
  if (!job) return false;
  const active = isActive(id);
  if (job.active === active) return false;
  job.active = active;
  return true;
}

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  observer ??= new IntersectionObserver(
    (entries) => {
      let changed = false;
      for (const entry of entries) {
        const id = cellIds.get(entry.target);
        if (id) changed = setInViewport(id, entry.isIntersecting) || changed;
      }
      if (changed) pump();
    },
    // 一个像素相交就算进视口：卡片将近 440 像素高，阈值取半张卡没有意义。
    { threshold: 0 },
  );
  return observer;
}

/**
 * 由 `NodeGrid` 的每个栅格单元格注册自己，`element` 为 null 表示这个格子卸载了。
 *
 * 观察的是**栅格单元格**而不是卡片本身：NodeCard 在节点数据还没到时渲染的是另一个
 * div，卡片根节点会换，而这个 wrapper 从挂到卸始终是同一个。
 */
function registerPingCell(id: string, element: Element | null): void {
  const shared = sharedObserver();

  if (element === null) {
    const previous = cellElements.get(id);
    if (previous) {
      shared?.unobserve(previous);
      cellIds.delete(previous);
      cellElements.delete(id);
    }
    // 保留最后一次的可见性：重挂时不该先当成不可见再翻回来。
    return;
  }
  if (cellElements.get(id) === element) return;

  const previous = cellElements.get(id);
  if (previous) {
    shared?.unobserve(previous);
    cellIds.delete(previous);
  }
  cellElements.set(id, element);
  cellIds.set(element, id);

  if (!shared) {
    // 没有 IntersectionObserver 就按「全部可见」降级。
    if (setInViewport(id, true)) pump();
    return;
  }
  shared.observe(element);
}

export type PingCellRegistrar = (id: string, element: Element | null) => void;

/**
 * 起首页的探测轮询。由 `NodeGrid` 挂载一次，参数是当前可见的节点；返回的函数交给
 * 每个栅格单元格注册自己 —— 只有滚到视野里的卡片才轮询（节点总数不超过
 * `ALL_POLL_MAX_CARDS` 时全部轮询）。
 *
 * 关掉这个开关时一切都不做：节点多的时候，这些历史查询会占满 hub 的查询名额，
 * 站长可以据此换回一点余量。
 */
export function useHomepagePingOverview(ids: string[]): PingCellRegistrar {
  const { data: config } = useThemeConfig();
  const enabled = config?.show_ping_mini !== false;
  const key = ids.join("\u0000");

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    setTrackedIds(key ? key.split("\u0000") : []);
  }, [enabled, key]);

  // 离开首页即停止轮询；缓存与排期留着，回来时立刻有东西可画，也不会从头再来一轮。
  useEffect(() => stop, []);

  // 身份必须稳定：它是每个栅格单元格的 ref，换了身份 React 会把卡片全部重挂一遍。
  return useCallback<PingCellRegistrar>((id, element) => {
    registerPingCell(id, element);
  }, []);
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
