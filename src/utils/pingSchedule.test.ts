/**
 * 排期算术的断言。
 *
 *   npm test
 *
 * 盯的是首页延迟轮询里那几条错了不显眼的规矩：一批卡片会不会一起发出去、
 * 被 hub 拒过的那张会不会把别人拖慢、从后台切回来会不会变成一次爆发。
 * 没有测试框架 —— node 自己剥掉类型，失败时退出码非零。
 */
import assert from "node:assert/strict";
import {
  BACKOFF_MAX_MS,
  CATCH_UP_GAP_MS,
  CATCH_UP_STALE_MS,
  MAX_CONCURRENCY,
  PING_PERIOD_MS,
  STEADY_MAX_GAP_MS,
  STEADY_MIN_GAP_MS,
  backoffDelayMs,
  catchUpGapMs,
  isCatchUp,
  nextDueAt,
  pickRipeJob,
  planPingDispatch,
  refreshDelayMs,
  steadyGapMs,
} from "./pingSchedule.ts";
import type { PingJob } from "./pingSchedule.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`\n✗ ${name}\n`, error);
    process.exit(1);
  }
}

/** 浮点比较：乘上比例之后不该拿 `===` 去卡。 */
function close(actual: number, expected: number, message?: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    message ?? `${actual} 与 ${expected} 差得太远`,
  );
}

const HALF = () => 0.5; // 抖动取中值，方便看基线

function job(over: Partial<PingJob> = {}): PingJob {
  return {
    id: "1",
    active: true,
    dueAt: 0,
    settledAt: 0,
    failures: 0,
    inFlight: false,
    ...over,
  };
}

interface Start {
  id: string;
  at: number;
}

/**
 * 用一个假时钟把泵跑一遍：只调 `planPingDispatch`，请求按固定耗时完成。
 * 这样时间表——而不是代码——是断言的对象。
 */
function runTimetable(
  cards: PingJob[],
  options: { durationMs: number; latencyMs: number; failIds?: Set<string> },
): { starts: Start[]; maxInFlight: number; origin: number } {
  const inFlight: { job: PingJob; doneAt: number }[] = [];
  const starts: Start[] = [];
  // 从真实的时间尺度出发：`settledAt: 0` 是「从没处理过」，只有相对真实时钟才成立。
  const start = 1_800_000_000_000;
  const until = start + options.durationMs;
  let now = start;
  let lastStartAt = Number.NEGATIVE_INFINITY;
  let maxInFlight = 0;
  let guard = 0;

  while (now <= until && guard++ < 200_000) {
    // 先收掉这一时刻完成的请求。
    for (let i = inFlight.length - 1; i >= 0; i--) {
      const entry = inFlight[i]!;
      if (entry.doneAt > now) continue;
      inFlight.splice(i, 1);
      const done = entry.job;
      done.inFlight = false;
      done.settledAt = now;
      if (options.failIds?.has(done.id)) {
        done.failures += 1;
        done.dueAt = now + backoffDelayMs(done.failures, HALF);
      } else {
        done.failures = 0;
        done.dueAt = now + refreshDelayMs(HALF);
      }
    }

    const plan = planPingDispatch(cards, {
      now,
      lastStartAt,
      inFlightCount: inFlight.length,
      pauseUntil: 0,
    });
    if (plan.start) {
      plan.start.inFlight = true;
      lastStartAt = now;
      starts.push({ id: plan.start.id, at: now });
      inFlight.push({ job: plan.start, doneAt: now + options.latencyMs });
    }
    maxInFlight = Math.max(maxInFlight, inFlight.length);

    const next = plan.wakeAt ?? (inFlight.length > 0 ? inFlight[0]!.doneAt : null);
    if (next === null) break;
    now = Math.max(now + 1, next);
  }

  return { starts, maxInFlight, origin: start };
}

test("the steady gap spreads one whole period across the cards", () => {
  // 12 张卡：相邻两次间隔正好把三分钟摊平，平均速率等于它们的刷新需求。
  close(steadyGapMs(12) * 12, PING_PERIOD_MS);
  // 卡片极多时不再加快 —— 发得再快也追不上，只会多占 hub 的名额。
  assert.equal(steadyGapMs(10_000), STEADY_MIN_GAP_MS);
  // 卡片极少时不干等。
  assert.equal(steadyGapMs(1), STEADY_MAX_GAP_MS);
  assert.equal(steadyGapMs(0), STEADY_MAX_GAP_MS);
});

test("catch-up is quicker than steady state, but never a burst", () => {
  assert.equal(catchUpGapMs(1), CATCH_UP_GAP_MS);
  assert.equal(catchUpGapMs(12), CATCH_UP_GAP_MS);
  // 卡片多到稳态本身就更快时，快车道不会反过来比稳态还猛。
  assert.equal(catchUpGapMs(10_000), STEADY_MIN_GAP_MS);
});

test("only cards that fell two periods behind push the queue to catch up", () => {
  const now = 1_000_000_000;
  assert.equal(isCatchUp([job({ settledAt: now - CATCH_UP_STALE_MS + 1 })], now), false);
  assert.equal(isCatchUp([job({ settledAt: now - CATCH_UP_STALE_MS - 1 })], now), true);
  // 从没处理过的（settledAt 为 0）也算落后，否则首屏会按稳态一张一张慢慢画。
  assert.equal(isCatchUp([job({ settledAt: 0 })], now), true);
  // 滚出视野的不该让队列一直快跑，在飞的本來就在处理。
  assert.equal(isCatchUp([job({ active: false, settledAt: 0 })], now), false);
  assert.equal(isCatchUp([job({ inFlight: true, settledAt: 0 })], now), false);
});

test("the pump picks one ripe card, the one whose data is oldest", () => {
  const now = 1_000_000_000;
  const fresh = job({ id: "fresh", dueAt: now - 1, settledAt: now - 1_000 });
  const old = job({ id: "old", dueAt: now - 1, settledAt: now - 100_000 });
  const later = job({ id: "later", dueAt: now + 5_000 });

  assert.equal(pickRipeJob([fresh, old, later], now)?.id, "old", "一起到期时先补数据最旧的");
  assert.equal(pickRipeJob([later], now), null, "没到期的不发");
  assert.equal(pickRipeJob([job({ inFlight: true })], now), null, "在飞的不重复发");
  assert.equal(pickRipeJob([job({ active: false })], now), null, "不在轮询集合里的不发");

  assert.equal(nextDueAt([fresh, later]), fresh.dueAt, "取最早到期的那个");
  assert.equal(
    nextDueAt([job({ active: false, dueAt: 1 }), job({ inFlight: true, dueAt: 2 })]),
    null,
    "不活跃与在飞的都不算待办",
  );
});

test("a refused card backs off further each time, up to a cap", () => {
  assert.equal(backoffDelayMs(1, HALF), PING_PERIOD_MS);
  assert.equal(backoffDelayMs(2, HALF), PING_PERIOD_MS * 2);
  assert.equal(backoffDelayMs(3, HALF), PING_PERIOD_MS * 4);
  assert.equal(backoffDelayMs(50, HALF), BACKOFF_MAX_MS);

  for (let failures = 1; failures <= 12; failures++) {
    // 抖动只在一个小范围内，而且越退越长、不会越过上限。
    assert.ok(backoffDelayMs(failures, () => 0) >= PING_PERIOD_MS * 0.89);
    assert.ok(backoffDelayMs(failures, () => 1) <= BACKOFF_MAX_MS);
    assert.ok(backoffDelayMs(failures, HALF) <= backoffDelayMs(failures + 1, HALF));
  }
});

test("a refresh lands within a tenth of the period", () => {
  assert.equal(refreshDelayMs(HALF), PING_PERIOD_MS);
  close(refreshDelayMs(() => 0), PING_PERIOD_MS * 0.9);
  close(refreshDelayMs(() => 1), PING_PERIOD_MS * 1.1);
});

test("no wake-up is ever a busy loop and none is ever lost", () => {
  const now = 1_000_000_000;
  const state = {
    now,
    lastStartAt: Number.NEGATIVE_INFINITY,
    inFlightCount: 0,
    pauseUntil: 0,
  };

  // 没活可干：干脆不排定时器，等事件来叫。
  assert.equal(planPingDispatch([], state).wakeAt, null);

  // 名额满了：给的是保险闹钟，不是 null（否则完成回调一旦丢了就永久停摆），
  // 也不是 0（否则变成忙等）。
  const busy = [job({ dueAt: now - 1 }), job({ dueAt: now - 1 })];
  const plan = planPingDispatch(busy, { ...state, inFlightCount: MAX_CONCURRENCY });
  assert.equal(plan.start, null);
  assert.ok(plan.wakeAt != null && plan.wakeAt > now, "名额满了也要留个保险闹钟");

  // 还有到期卡片、间隔已经过去：这一轮就发一单，下一次最早也要等到间隔之后。
  const one = planPingDispatch([job({ dueAt: now - 1 })], state);
  assert.ok(one.start !== null, "到期了就该发");
  assert.ok(one.wakeAt != null && one.wakeAt > now, "发完一单不会立刻再发一单");

  // 刚发过一单：间隔没到之前，哪怕卡片已经到期也不发。
  const throttled = planPingDispatch([job({ dueAt: now - 1 })], { ...state, lastStartAt: now });
  assert.equal(throttled.start, null);
  assert.ok(throttled.wakeAt != null && throttled.wakeAt >= now + STEADY_MIN_GAP_MS - 1);
});

test("the timetable never bunches up, and never runs more than two at once", () => {
  const cards = Array.from({ length: 40 }, (_, index) => job({ id: `n${index}`, dueAt: 0 }));
  const { starts, maxInFlight, origin } = runTimetable(cards, {
    durationMs: 600_000,
    latencyMs: 30,
  });

  assert.ok(maxInFlight <= MAX_CONCURRENCY, `同时在飞 ${maxInFlight} 个，超过上限`);

  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i]!.at - starts[i - 1]!.at;
    assert.ok(gap >= STEADY_MIN_GAP_MS, `第 ${i} 次发车与上一次只隔了 ${gap}ms`);
  }

  // 首屏：40 张卡片按追赶节奏排下来，10 秒内全部发过一遍（不是一次齐发）。
  const firstRound = new Set(
    starts.filter((start) => start.at - origin <= 10_000).map((s) => s.id),
  );
  assert.equal(firstRound.size, 40, "第一轮没把卡片发完");

  // 稳态：每张卡片一个周期查一次，不多也不少 —— 这正是「总速率等于刷新需求」。
  const perCard = new Map<string, number>();
  for (const start of starts) perCard.set(start.id, (perCard.get(start.id) ?? 0) + 1);
  assert.equal(perCard.size, 40);
  for (const [id, count] of perCard) {
    assert.ok(count >= 3 && count <= 4, `${id} 在 600 秒里被查了 ${count} 次`);
  }
});

test("a refused card backs off alone, the rest keep their pace", () => {
  const cards = Array.from({ length: 3 }, (_, index) => job({ id: `n${index}`, dueAt: 0 }));
  const { starts } = runTimetable(cards, {
    durationMs: 1_800_000,
    latencyMs: 30,
    failIds: new Set(["n0"]),
  });

  const count = (id: string) => starts.filter((start) => start.id === id).length;
  // 一直失败的那张：180s → 360s → 720s → 封顶 900s，半小时里只剩几次。
  assert.ok(count("n0") <= 5, `被拒的卡片重试了 ${count("n0")} 次，退避没生效`);
  // 其余两张照常，每个周期一次。
  assert.ok(count("n1") >= 8 && count("n2") >= 8, "一张卡片失败不该拖慢别的卡片");
});

console.log(`pingSchedule: ${passed} tests passed`);
