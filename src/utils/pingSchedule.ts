/**
 * 首页延迟轮询的排期算术。全是纯函数：不认定时器、fetch、DOM，也不持有状态。
 *
 * 单独放一处，是因为这几条规矩错了都不显眼 —— 一批卡片会不会一起发出去、
 * 被 503 挡回来的那张会不会把别人也拖慢、从后台切回来会不会变成一次爆发。
 * `pingSchedule.test.ts` 用一个假时钟把整套排期推一遍。
 *
 * 前提：hub 的历史查询走一个只有 4 个名额、排队超过就直接返回 503 的信号量，
 * 每个查询都占着 agent 上报用的那条 SQLite 连接。所以这里的目标不是「查得多快」，
 * 而是「任何时刻只占一两个名额，且从不齐发」。
 */

/** 每张卡片多久轮到一次。探测记录按分钟落盘，取 3 分钟 —— 再快也只是重复读同一个桶。 */
export const PING_PERIOD_MS = 180_000;
/** 数据落后这么久就算没跟上，走快车道补。 */
export const CATCH_UP_STALE_MS = PING_PERIOD_MS * 2;
/** 稳态下相邻两次请求的最小间隔。 */
export const STEADY_MIN_GAP_MS = 150;
/** 稳态间隔的上限：卡片很少时也不至于干等。 */
export const STEADY_MAX_GAP_MS = 30_000;
/** 快车道的间隔：首屏、滚进视口、切回标签页时用。 */
export const CATCH_UP_GAP_MS = 200;
/** 到期时间的抖动比例，卡片才不会长期对齐成同一批、一起到期一起发。 */
export const JITTER_RATIO = 0.1;
/** 失败退避的起点与上限。 */
export const BACKOFF_BASE_MS = PING_PERIOD_MS;
export const BACKOFF_MAX_MS = 900_000;
/** 同时在飞的请求数。hub 一共 4 个名额，留两个给后台、详情页和别的访客。 */
export const MAX_CONCURRENCY = 2;
/** 保险闹钟：只要还有在飞的请求就至少这么久醒一次，完成回调丢了也不会永久停摆。 */
export const WATCHDOG_MS = 1_000;

export interface PingJob {
  id: string;
  /** 在不在轮询集合里：滚到视野内，或者站点小到直接全查。 */
  active: boolean;
  /** 下次该处理的时刻；新卡片是 0，立刻到期。 */
  dueAt: number;
  /** 上次处理完的时刻 —— 成功、失败、判定不用查都算。0 表示从没处理过。 */
  settledAt: number;
  /** 连续失败次数，成功清零。 */
  failures: number;
  inFlight: boolean;
}

function jitter(random: () => number, ratio: number): number {
  return 1 + (random() * 2 - 1) * ratio;
}

/** 成功之后的下次到期：一个周期，带抖动。 */
export function refreshDelayMs(random: () => number = Math.random): number {
  return PING_PERIOD_MS * jitter(random, JITTER_RATIO);
}

/** 失败之后的退避：一个周期起、逐次加倍、封顶，带抖动。 */
export function backoffDelayMs(failures: number, random: () => number = Math.random): number {
  const steps = Math.min(Math.max(1, Math.floor(failures)) - 1, 20);
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** steps);
  return Math.min(BACKOFF_MAX_MS, base * jitter(random, JITTER_RATIO));
}

/**
 * 稳态间隔：把一整个刷新周期摊在这批卡片上，平均速率正好等于它们的刷新需求。
 * 卡片极多时不再低于 `STEADY_MIN_GAP_MS`（发得再快也追不上，徒增 503），
 * 卡片极少时不超过 `STEADY_MAX_GAP_MS`。
 */
export function steadyGapMs(activeCount: number): number {
  const spread = PING_PERIOD_MS / Math.max(activeCount, 1);
  return Math.min(STEADY_MAX_GAP_MS, Math.max(STEADY_MIN_GAP_MS, spread));
}

/** 快车道：比稳态快，但不快过 `CATCH_UP_GAP_MS`。 */
export function catchUpGapMs(activeCount: number): number {
  return Math.min(steadyGapMs(activeCount), CATCH_UP_GAP_MS);
}

/**
 * 有没有卡片明显落后（含从没处理过的）。
 *
 * 不活跃、在飞的不算：前者不该让队列一直快跑，后者本来就在处理。
 * 判定「不用查」的卡片也要写 `settledAt`，否则离线节点会把间隔永久压在快车道上。
 */
export function isCatchUp(jobs: Iterable<PingJob>, now: number): boolean {
  for (const job of jobs) {
    if (!job.active || job.inFlight) continue;
    if (now - job.settledAt > CATCH_UP_STALE_MS) return true;
  }
  return false;
}

/** 定序：先到期时间，再数据新旧，最后 id —— 结果可复现。 */
function before(a: PingJob, b: PingJob): boolean {
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt;
  if (a.settledAt !== b.settledAt) return a.settledAt < b.settledAt;
  return a.id < b.id;
}

/**
 * 现在最该发的那一张：到期、不在飞、在轮询集合里。
 * 一批卡片同时到期时也只是选出最旧的那张 —— 放行的节奏由间隔管，不由这里管。
 */
export function pickRipeJob(jobs: Iterable<PingJob>, now: number): PingJob | null {
  let best: PingJob | null = null;
  for (const job of jobs) {
    if (!job.active || job.inFlight || job.dueAt > now) continue;
    if (best === null || before(job, best)) best = job;
  }
  return best;
}

/** 在轮询集合里、不在飞的最早到期时刻；一张都没有就是 null。 */
export function nextDueAt(jobs: Iterable<PingJob>): number | null {
  let soonest: number | null = null;
  for (const job of jobs) {
    if (!job.active || job.inFlight) continue;
    if (soonest === null || job.dueAt < soonest) soonest = job.dueAt;
  }
  return soonest;
}

export interface PingPumpState {
  now: number;
  /** 上一次发车的时刻；还没发过就用 `Number.NEGATIVE_INFINITY`。 */
  lastStartAt: number;
  inFlightCount: number;
  /** 刚被拒过的话，整队先停到这个时刻。 */
  pauseUntil: number;
}

export interface PingDispatch {
  /** 这一轮该发的那张卡片；null 表示现在不发。 */
  start: PingJob | null;
  /** 下一次该醒来的时刻；null 表示等事件（请求完成、切回前台、视口变化）。 */
  wakeAt: number | null;
}

/**
 * 泵的全部判断。
 *
 * 两条不变量：
 * - **一次只发一单**，下一次最早也要等到 `lastStartAt + gap`，所以一批同时到期的
 *   卡片也是逐个放行，不会齐发；
 * - 只要还有在飞的请求就留一个保险闹钟。完成回调负责提前唤醒，但泵的活性不押在它身上 ——
 *   一个永远不 settle 的请求不该让整页卡片停摆。
 */
export function planPingDispatch(jobs: readonly PingJob[], state: PingPumpState): PingDispatch {
  const { now, lastStartAt, inFlightCount, pauseUntil } = state;
  const activeCount = jobs.reduce((count, job) => count + (job.active ? 1 : 0), 0);
  const gap = isCatchUp(jobs, now) ? catchUpGapMs(activeCount) : steadyGapMs(activeCount);

  const mayStart =
    now >= pauseUntil && inFlightCount < MAX_CONCURRENCY && now >= lastStartAt + gap;
  const start = mayStart ? pickRipeJob(jobs, now) : null;

  const inFlight = inFlightCount + (start ? 1 : 0);
  const nextStart = (start ? now : lastStartAt) + gap;

  if (inFlight >= MAX_CONCURRENCY) {
    return { start, wakeAt: Math.max(now + WATCHDOG_MS, nextStart, pauseUntil) };
  }
  const due = nextDueAt(jobs);
  if (due !== null) return { start, wakeAt: Math.max(due, nextStart, pauseUntil) };
  return { start, wakeAt: inFlight > 0 ? Math.max(now + WATCHDOG_MS, pauseUntil) : null };
}
