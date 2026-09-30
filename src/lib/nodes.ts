import { getNodes } from "@/lib/api";
import type { Node, NodeDisplay, TrafficTrendSample } from "@/types/monitor";

type Listener = () => void;

interface TrafficTrendSeries {
  buffer: TrafficTrendSample[];
  start: number;
  size: number;
  signature: string;
  snapshot: TrafficTrendSample[];
}

interface NodeTrafficTrend {
  up: TrafficTrendSeries;
  down: TrafficTrendSeries;
  snapshot: { up: TrafficTrendSample[]; down: TrafficTrendSample[] };
}

interface State {
  byId: Record<string, NodeDisplay>;
  trafficTrends: Record<string, NodeTrafficTrend>;
  order: string[];
  hasLoaded: boolean;
  failureStreak: number;
}

/** 卡片上网速迷你条的长度。 */
const TRAFFIC_TREND_SAMPLE_COUNT = 18;
/** WebSocket 断开后回退轮询的间隔。 */
const POLL_INTERVAL_MS = 5_000;

const EMPTY_TRAFFIC_TREND_SAMPLE: TrafficTrendSample = { value: 0, level: 0.25, opacity: 0.52 };
const EMPTY_TRAFFIC_TREND_SNAPSHOT = Array.from(
  { length: TRAFFIC_TREND_SAMPLE_COUNT },
  () => EMPTY_TRAFFIC_TREND_SAMPLE,
);
const EMPTY_TRAFFIC_TREND_SERIES: TrafficTrendSeries = {
  buffer: [],
  start: 0,
  size: 0,
  signature: "",
  snapshot: EMPTY_TRAFFIC_TREND_SNAPSHOT,
};
const EMPTY_NODE_TRAFFIC_TREND_SNAPSHOT = {
  up: EMPTY_TRAFFIC_TREND_SNAPSHOT,
  down: EMPTY_TRAFFIC_TREND_SNAPSHOT,
};
const EMPTY_TRAFFIC_TREND: NodeTrafficTrend = {
  up: EMPTY_TRAFFIC_TREND_SERIES,
  down: EMPTY_TRAFFIC_TREND_SERIES,
  snapshot: EMPTY_NODE_TRAFFIC_TREND_SNAPSHOT,
};

function emptyState(): State {
  return { byId: {}, trafficTrends: {}, order: [], hasLoaded: false, failureStreak: 0 };
}

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
function daysUntilUtc(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const ts = Date.parse(`${expiresAt}T00:00:00Z`);
  if (Number.isNaN(ts)) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((ts - today) / 86_400_000);
}

/**
 * 剩余天数。hub 给了就用 hub 的 —— 它按自己的日历算，和续费通知口径一致；
 * 用浏览器时钟算，hub 跑 UTC、访客在 UTC+8 时会每个周期提前八小时显示「已过期」。
 *
 * `"expires_in" in node` 而不是 `?? `：`null` 是「没填到期日」这个有效答案，
 * 与「旧版 hub 不认识这个键」是两回事。
 */
function expireDays(node: Node): number | null {
  if ("expires_in" in node) return node.expires_in ?? null;
  return daysUntilUtc(node.expires_at);
}

/**
 * hub 的三种节点状态各对应一种界面：离线、已连接但还没上报（`online: true` 而
 * `metrics: null`，最容易漏掉的一种）、以及正常在线。中间那种映射成 null，
 * 卡片显示「状态同步中」而不是谎报 0%。
 */
function onlineState(node: Node): boolean | null {
  if (!node.online) return false;
  return node.metrics ? true : null;
}

function fromNode(node: Node): NodeDisplay {
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

/** 只有真正变了才换对象身份，没变的节点原样复用，卡片就不会白白重渲染。 */
function sameStatic(a: NodeDisplay, b: NodeDisplay): boolean {
  return (
    a.name === b.name &&
    a.group === b.group &&
    a.region === b.region &&
    a.os === b.os &&
    a.arch === b.arch &&
    a.virtualization === b.virtualization &&
    a.kernel_version === b.kernel_version &&
    a.cpu_name === b.cpu_name &&
    a.cpu_cores === b.cpu_cores &&
    a.mem_total === b.mem_total &&
    a.swap_total === b.swap_total &&
    a.disk_total === b.disk_total &&
    a.price === b.price &&
    a.billing_cycle === b.billing_cycle &&
    a.currency === b.currency &&
    a.expired_at === b.expired_at &&
    a.expiresIn === b.expiresIn &&
    a.traffic_limit === b.traffic_limit &&
    a.traffic_mode === b.traffic_mode &&
    a.traffic_reset_day === b.traffic_reset_day &&
    a.monthUsed === b.monthUsed
  );
}

function sameLive(a: NodeDisplay, b: NodeDisplay): boolean {
  return (
    a.online === b.online &&
    a.updatedAt === b.updatedAt &&
    a.uptime === b.uptime &&
    a.cpuPct === b.cpuPct &&
    a.ramUsed === b.ramUsed &&
    a.ramTotal === b.ramTotal &&
    a.ramPct === b.ramPct &&
    a.swapUsed === b.swapUsed &&
    a.swapTotal === b.swapTotal &&
    a.swapPct === b.swapPct &&
    a.diskUsed === b.diskUsed &&
    a.diskTotal === b.diskTotal &&
    a.diskPct === b.diskPct &&
    a.netUp === b.netUp &&
    a.netDown === b.netDown &&
    a.trafficUp === b.trafficUp &&
    a.trafficDown === b.trafficDown &&
    a.load1 === b.load1 &&
    a.load5 === b.load5 &&
    a.load15 === b.load15 &&
    a.process === b.process &&
    a.connectionsTcp === b.connectionsTcp &&
    a.connectionsUdp === b.connectionsUdp
  );
}

function materializeTrafficTrendSnapshot(buffer: TrafficTrendSample[], start: number, size: number) {
  if (size <= 0) return EMPTY_TRAFFIC_TREND_SNAPSHOT;

  const snapshot = new Array<TrafficTrendSample>(TRAFFIC_TREND_SAMPLE_COUNT);
  const padding = TRAFFIC_TREND_SAMPLE_COUNT - size;
  for (let i = 0; i < padding; i++) snapshot[i] = EMPTY_TRAFFIC_TREND_SAMPLE;
  for (let i = 0; i < size; i++) {
    snapshot[padding + i] = buffer[(start + i) % TRAFFIC_TREND_SAMPLE_COUNT]!;
  }
  return snapshot;
}

function updateTrafficTrendSeries(
  prev: TrafficTrendSeries,
  value: number,
  updatedAt: number,
  online: boolean | null,
) {
  if (online === false) {
    return prev.size === 0 ? { series: prev, changed: false } : { series: EMPTY_TRAFFIC_TREND_SERIES, changed: true };
  }

  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const signature = `${updatedAt || 0}:${safeValue}`;
  if (signature === prev.signature) return { series: prev, changed: false };

  // 相对本条缓冲里的最大值着色，网速量级不同的节点看起来才都是同一条条带。
  let visibleMax = safeValue > 0 ? safeValue : 1;
  for (let i = 0; i < prev.size; i++) {
    const sample = prev.buffer[(prev.start + i) % TRAFFIC_TREND_SAMPLE_COUNT];
    if (sample && sample.value > visibleMax) visibleMax = sample.value;
  }

  const level = safeValue > 0 ? Math.max(0.2, Math.min(1, safeValue / visibleMax)) : 0.25;
  const nextSample: TrafficTrendSample = {
    value: safeValue,
    level,
    opacity: safeValue > 0 ? 0.4 + level * 0.48 : 0.52,
  };

  const buffer =
    prev.buffer.length === TRAFFIC_TREND_SAMPLE_COUNT
      ? prev.buffer
      : new Array<TrafficTrendSample>(TRAFFIC_TREND_SAMPLE_COUNT);
  const full = prev.size >= TRAFFIC_TREND_SAMPLE_COUNT;
  const nextSize = full ? TRAFFIC_TREND_SAMPLE_COUNT : prev.size + 1;
  const nextStart = full ? (prev.start + 1) % TRAFFIC_TREND_SAMPLE_COUNT : prev.start;
  const insertIndex = full
    ? prev.start
    : (prev.start + prev.size) % TRAFFIC_TREND_SAMPLE_COUNT;

  if (buffer !== prev.buffer && prev.size > 0) {
    for (let i = 0; i < prev.size; i++) {
      buffer[(prev.start + i) % TRAFFIC_TREND_SAMPLE_COUNT] =
        prev.buffer[(prev.start + i) % TRAFFIC_TREND_SAMPLE_COUNT]!;
    }
  }
  buffer[insertIndex] = nextSample;

  return {
    series: {
      buffer,
      start: nextStart,
      size: nextSize,
      signature,
      snapshot: materializeTrafficTrendSnapshot(buffer, nextStart, nextSize),
    },
    changed: true,
  };
}

export interface StoreStatus {
  hasLoaded: boolean;
  failureStreak: number;
}

let state: State = emptyState();
const globalListeners = new Set<Listener>();
const nodeListeners = new Map<string, Set<Listener>>();
let visibleNodeIdsSnapshot: string[] = [];
let visibleNodeIdsSource: State | null = null;
let offlineIdsSnapshot: string[] = [];
let offlineIdsSource: State | null = null;
let storeStatusSnapshot: StoreStatus = { hasLoaded: false, failureStreak: 0 };

function commit(next: State, touched: Iterable<string>) {
  state = next;
  for (const listener of globalListeners) listener();
  for (const id of touched) {
    const listeners = nodeListeners.get(id);
    if (listeners) for (const listener of listeners) listener();
  }
}

/**
 * 把一帧节点列表并进状态里。
 *
 * hub 的每一帧都带完整的节点信息（静态字段也在内），所以没有「静态信息轮询」这一层 ——
 * 一帧到位。没变的节点复用原对象，只通知真正变了的那些。
 */
function applySnapshot(raw: Node[]): void {
  const byId: Record<string, NodeDisplay> = {};
  const trafficTrends: Record<string, NodeTrafficTrend> = {};
  const order: string[] = [];
  const touched = new Set<string>();

  // `sort` 是站长拖出来的顺序，`id` 只用来打破并列，让顺序稳定。
  const sorted = safeNodes(raw).sort((a, b) => num(a.sort) - num(b.sort) || a.id - b.id);

  for (const node of sorted) {
    const id = String(node.id);
    const next = fromNode(node);
    const prev = state.byId[id];
    order.push(id);

    if (prev && sameStatic(prev, next) && sameLive(prev, next)) {
      byId[id] = prev;
    } else {
      byId[id] = next;
      touched.add(id);
    }

    const prevTrend = state.trafficTrends[id] ?? EMPTY_TRAFFIC_TREND;
    const up = updateTrafficTrendSeries(prevTrend.up, next.netUp, next.updatedAt, next.online);
    const down = updateTrafficTrendSeries(prevTrend.down, next.netDown, next.updatedAt, next.online);
    if (up.changed) touched.add(id);
    if (down.changed) touched.add(id);

    const snapshotUnchanged =
      up.series.snapshot === prevTrend.up.snapshot && down.series.snapshot === prevTrend.down.snapshot;
    trafficTrends[id] = snapshotUnchanged
      ? prevTrend
      : {
          up: up.series,
          down: down.series,
          snapshot: { up: up.series.snapshot, down: down.series.snapshot },
        };
  }

  // 顺序没变就沿用原数组的身份，`getVisibleNodeIdsSnapshot` 才能靠它做缓存。
  const sameOrder =
    order.length === state.order.length && order.every((id, i) => id === state.order[i]);

  // 状态快照只在真的变了时换身份，顶栏那类订阅者才不会跟着空转重渲染。
  if (!state.hasLoaded || state.failureStreak !== 0) {
    storeStatusSnapshot = { hasLoaded: true, failureStreak: 0 };
  }

  commit({ byId, trafficTrends, order: sameOrder ? state.order : order, hasLoaded: true, failureStreak: 0 }, touched);
}

function markFailure(): void {
  const failureStreak = state.failureStreak + 1;
  storeStatusSnapshot = { hasLoaded: state.hasLoaded, failureStreak };
  commit({ ...state, failureStreak }, []);
}

let started = false;
let socket: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function stopPolling() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function refreshOnce() {
  getNodes()
    .then((data) => applySnapshot(data.nodes ?? []))
    .catch(() => markFailure());
}

function connect() {
  // 一条连接只留一个重连定时器：close 事件重复到达时不该排出两条。
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;
  try {
    socket = new WebSocket(url);
  } catch {
    startPolling();
    reconnectTimer = setTimeout(connect, POLL_INTERVAL_MS);
    return;
  }

  socket.onmessage = (event) => {
    let payload: { nodes?: Node[] };
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!Array.isArray(payload.nodes)) return;
    applySnapshot(payload.nodes);
    // 流回来了，轮询只是替它值班。
    stopPolling();
  };
  socket.onerror = () => socket?.close();
  socket.onclose = () => {
    // hub 重启、公开页被关掉、会话失效都会走到这里。轮询顶上，同时重连。
    markFailure();
    startPolling();
    reconnectTimer = setTimeout(connect, POLL_INTERVAL_MS);
  };
}

function startPolling() {
  pollTimer ??= setInterval(refreshOnce, POLL_INTERVAL_MS);
}

/**
 * 起连接。幂等，每个用到的 hook 都会调它。
 *
 * hub 的 WebSocket 是只推不收的：客户端发什么都不读，所以这里没有订阅消息，
 * 重连就只是重开一条连接。
 */
export function ensureStarted(): void {
  if (started) return;
  started = true;
  // 先取一次快照，别让首屏等 WebSocket 握手。
  refreshOnce();
  connect();
}

export function subscribe(listener: Listener): () => void {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}

export function subscribeToNode(id: string, listener: Listener): () => void {
  let listeners = nodeListeners.get(id);
  if (!listeners) {
    listeners = new Set();
    nodeListeners.set(id, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) nodeListeners.delete(id);
  };
}

export function getNodeSnapshot(id: string): NodeDisplay | undefined {
  return state.byId[id];
}

export function getNodeTrafficTrendSnapshot(id: string): {
  up: TrafficTrendSample[];
  down: TrafficTrendSample[];
} {
  return state.trafficTrends[id]?.snapshot ?? EMPTY_NODE_TRAFFIC_TREND_SNAPSHOT;
}

/** 全部节点的 id，已按站长的顺序排好。 */
export function getVisibleNodeIdsSnapshot(): string[] {
  if (visibleNodeIdsSource !== state) {
    visibleNodeIdsSource = state;
    visibleNodeIdsSnapshot = state.order;
  }
  return visibleNodeIdsSnapshot;
}

/**
 * 离线节点的 id，顺序即列表顺序。
 *
 * 单独开一个快照而不是让调用方去读每个节点：身份只在**离线集合本身**变化时才变，
 * 「离线节点排最后」这个开关就不会被每两秒一次的实时数据推着空转重渲染。
 */
export function getOfflineNodeIdsSnapshot(): string[] {
  if (offlineIdsSource !== state) {
    offlineIdsSource = state;
    const next = state.order.filter((id) => state.byId[id]?.online === false);
    const same = next.length === offlineIdsSnapshot.length && next.every((id, i) => id === offlineIdsSnapshot[i]);
    if (!same) offlineIdsSnapshot = next;
  }
  return offlineIdsSnapshot;
}

export function getStoreStatusSnapshot(): StoreStatus {
  return storeStatusSnapshot;
}

