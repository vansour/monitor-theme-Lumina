/**
 * 适配层的断言。没有测试框架 —— node 自己剥掉类型，失败时退出码非零。
 *
 *   npm test
 *
 * 盯的是几个错了不显眼的地方：流量比的是哪个口径、到期天数与离线时长谁来算、
 * 一条坏上报怎么处置、探测顺序按什么定。
 */
import assert from "node:assert/strict";
import {
  daysUntilUtc,
  expireDays,
  monthUsage,
  onlineState,
  pingSeriesFrom,
  safeNodes,
  sampleStep,
  secondsSinceSeen,
  toDisplay,
} from "./adapters.ts";
import type { MetricsResponse, Node } from "../types/monitor.ts";

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

const GiB = 1024 ** 3;

function node(over: Partial<Node> = {}): Node {
  return {
    id: 1,
    name: "n1",
    sort: 0,
    public: true,
    online: true,
    country: "JP",
    group: "",
    last_seen: 1_700_000_000,
    metrics: null,
    os: "Debian",
    kernel: "6.12.48",
    arch: "x86_64",
    virt: "kvm",
    cpu_name: "EPYC",
    cpu_cores: 4,
    mem_total: 4 * GiB,
    swap_total: 2 * GiB,
    disk_total: 40 * GiB,
    agent_version: "1.2.4",
    price: 0,
    currency: "USD",
    billing_cycle: "monthly",
    expires_at: null,
    traffic_limit: 0,
    traffic_mode: "sum",
    traffic_reset_day: 1,
    total_rx: 0,
    total_tx: 0,
    month_rx: 0,
    month_tx: 0,
    month_start: "2026-09-01",
    day_rx: 0,
    day_tx: 0,
    ...over,
  };
}

const liveMetrics = {
  uptime: 100,
  cpu: 12.5,
  load: [1, 2, 3] as [number, number, number],
  mem_total: 4 * GiB,
  mem_used: GiB,
  swap_total: 2 * GiB,
  swap_used: GiB / 2,
  disk_total: 40 * GiB,
  disk_used: 10 * GiB,
  net_rx: 1000,
  net_tx: 500,
  total_rx: 7 * GiB,
  total_tx: 3 * GiB,
  month_rx: GiB,
  month_tx: GiB / 2,
  tcp: 60,
  udp: 12,
  procs: 180,
};

test("a malformed report takes that node down, not the page", () => {
  const bad = [
    node({ id: 1, metrics: { ...liveMetrics, cpu: Number.NaN } }),
    node({ id: 2, metrics: { ...liveMetrics, mem_used: -1 } }),
    // load must be exactly three numbers
    node({ id: 3, metrics: { ...liveMetrics, load: [1, 2] as unknown as [number, number, number] } }),
    node({ id: 4, metrics: { ...liveMetrics, procs: "many" as unknown as number } }),
  ];
  const good = node({ id: 5, metrics: liveMetrics });
  const out = safeNodes([...bad, good]);
  assert.equal(out.slice(0, 4).every((n) => n.metrics === null), true, "every bad report is voided");
  assert.equal(out[4]!.metrics, liveMetrics, "the sound one is left alone");
  // Voiding is a copy, never a mutation of what the hub sent.
  assert.notEqual(bad[0]!.metrics, null);
});

test("a metered plan uses its own period, not lifetime traffic", () => {
  // The case that renders as 1000% if the bar divides lifetime bytes by a monthly cap.
  const metered = node({
    traffic_limit: 100 * GiB,
    traffic_mode: "max",
    total_rx: 700 * GiB,
    total_tx: 260 * GiB,
    month_rx: 12 * GiB,
    month_tx: 6 * GiB,
  });
  assert.equal(monthUsage(metered), 12 * GiB, "max mode picks the larger direction");
  assert.equal(toDisplay(metered).monthUsed, 12 * GiB);

  // Older hubs have no `month_used`, so the mode decides.
  assert.equal(monthUsage(node({ traffic_mode: "sum", month_rx: 3 * GiB, month_tx: 2 * GiB })), 5 * GiB);
  assert.equal(monthUsage(node({ traffic_mode: "up", month_rx: 3 * GiB, month_tx: 2 * GiB })), 2 * GiB);
  assert.equal(monthUsage(node({ traffic_mode: "down", month_rx: 3 * GiB, month_tx: 2 * GiB })), 3 * GiB);
  assert.equal(monthUsage(node({ traffic_mode: "max", month_rx: 3 * GiB, month_tx: 2 * GiB })), 3 * GiB);
  // The hub's own figure wins when present.
  assert.equal(monthUsage(node({ month_used: 9 * GiB, traffic_mode: "sum", month_rx: GiB, month_tx: GiB })), 9 * GiB);
});

test("expiry is counted on the hub's calendar", () => {
  const noon = Date.UTC(2026, 8, 30, 12, 0, 0);
  // The hub said so: use it, whatever the browser thinks.
  assert.equal(expireDays(node({ expires_in: 5, expires_at: "2026-10-05" }), noon), 5);
  // null is a real answer — no expiry date — not a reason to fall back.
  assert.equal(expireDays(node({ expires_in: null, expires_at: "2026-10-05" }), noon), null);
  // The key missing means an older hub; then, and only then, count locally.
  assert.equal(expireDays(node({ expires_at: "2026-10-05" }), noon), 5);
  assert.equal(expireDays(node({ expires_at: "2026-09-29" }), noon), -1);
  assert.equal(expireDays(node({ expires_at: null }), noon), null);
  // A hub on UTC and a visitor on UTC+8 must agree on the day count.
  assert.equal(daysUntilUtc("2026-09-30", Date.UTC(2026, 8, 30, 23, 59)), 0);
});

test("offline time is counted on the hub's clock", () => {
  const noon = Date.UTC(2026, 9, 7, 12, 0, 0);
  // The hub said so: use it, and never consult the visitor's clock for it.
  assert.equal(secondsSinceSeen(node({ last_seen_ago: 90, last_seen: 0 }), noon), 90);
  assert.equal(secondsSinceSeen(node({ last_seen_ago: 90 }), noon + 8 * 3_600_000), 90);
  // null is a real answer — never reported — not a reason to fall back.
  assert.equal(secondsSinceSeen(node({ last_seen_ago: null, last_seen: 1_700_000_000 }), noon), null);
  // The key missing means an older hub; then, and only then, count locally.
  assert.equal(secondsSinceSeen(node({ last_seen: noon / 1000 - 300 }), noon), 300);
  // A browser clock behind the hub's must not produce a negative duration.
  assert.equal(secondsSinceSeen(node({ last_seen: noon / 1000 + 600 }), noon), 0);
  assert.equal(secondsSinceSeen(node({ last_seen: 0 }), noon), null, "never seen is not `just now`");
  assert.equal(toDisplay(node({ last_seen_ago: 90 })).lastSeenAgo, 90);
});

test("connected-but-not-yet-reporting is its own state", () => {
  assert.equal(onlineState(node({ online: true, metrics: null })), null, "never a green 0%");
  assert.equal(onlineState(node({ online: false, metrics: null })), false);
  assert.equal(onlineState(node({ online: true, metrics: liveMetrics })), true);
  assert.equal(toDisplay(node({ online: true, metrics: null })).online, null);
});

test("directions and units survive the mapping", () => {
  const d = toDisplay(node({ metrics: liveMetrics }));
  assert.equal(d.netUp, 500, "up is what the node sent");
  assert.equal(d.netDown, 1000, "down is what the node received");
  assert.equal(d.ramPct, 25);
  assert.equal(d.diskPct, 25);
  assert.equal(d.swapPct, 25);
  assert.equal(d.load1, 1);
  assert.equal(d.process, 180);
  assert.equal(d.connectionsTcp, 60);
  // last_seen is seconds; the interface works in milliseconds.
  assert.equal(d.updatedAt, 1_700_000_000_000);
  assert.equal(d.id, "1");
  assert.equal(d.nodeId, 1);
});

test("the fallback grid matches the pre-`step` hub formula", () => {
  // hub's old `sample_step`: 60 * max(ceil(hours*60 / clamp(points,60,1440)), 1).
  // Only consulted when a response carries no `step` — and such a hub predates
  // the hourly tier as well, so the minute-only formula is the right one there.
  assert.equal(sampleStep(1, 1440), 60, "an hour bottoms out at the one-minute grid");
  assert.equal(sampleStep(6, 1440), 60);
  assert.equal(sampleStep(24, 1440), 60);
  assert.equal(sampleStep(168, 1440), 420);
  assert.equal(sampleStep(720, 1440), 1800);
  assert.equal(sampleStep(168, 60), 10080, "few points means a coarse grid");
});

const pingResponse = (over: Partial<MetricsResponse> = {}): MetricsResponse => ({
  metrics: [],
  ping: [],
  probes: {},
  loss: {},
  ...over,
});

test("the grid comes from the response when the hub reports one", () => {
  // The bucket rows were actually built on beats any formula: the two disagree
  // the moment a window crosses into the hub's hourly tier.
  const NOW_MS = 1_700_000_000_000;
  const base = { probes: { "1": "电信" }, ping: [{ task_id: 1, ts: 1000, latency: 40 }] };
  const reported = pingSeriesFrom(pingResponse({ ...base, step: 900 }), 1, 1440, NOW_MS);
  assert.equal(reported.tasks[0]!.interval, 900, "the response wins");
  assert.deepEqual(reported.sampleIntervals, { "1": 900 });

  // A response without `step` comes from a hub that predates the hourly tier,
  // so the minute formula is the one that matches it — even at 30 days.
  const older = pingSeriesFrom(pingResponse(base), 720, 1440, NOW_MS);
  assert.equal(older.tasks[0]!.interval, 1800, "no `step` means the legacy formula");
});

test("probe order comes from the rows, not from object key order", () => {
  // The hub sorts rows by `ping_task.sort, id`, which is the only stable signal.
  const res = pingResponse({
    probes: { "3": "移动", "1": "电信", "2": "联通" },
    loss: { "1": 10.5 },
    ping: [
      { task_id: 1, ts: 1000, latency: 40 },
      { task_id: 3, ts: 1000, latency: 90 },
      { task_id: 1, ts: 1060, latency: null },
      { task_id: 3, ts: 1060, latency: 91 },
    ],
  });
  // `now` is milliseconds, like Date.now(); the window it derives is in seconds.
  const NOW_MS = 1_700_000_000_000;
  const series = pingSeriesFrom(res, 1, 60, NOW_MS);
  assert.deepEqual(series.tasks.map((t) => t.id), [1, 3], "first appearance wins");
  assert.deepEqual(series.tasks.map((t) => t.name), ["电信", "移动"]);
  assert.equal(series.tasks[0]!.loss, 10.5);
  assert.equal(series.tasks[1]!.loss, 0, "a probe that lost nothing is absent from `loss`");
  assert.equal(series.to, NOW_MS / 1000);
  assert.equal(series.from, NOW_MS / 1000 - 3600);
  assert.deepEqual(series.sampleIntervals, { "1": 60, "3": 60 });
});

test("a probe dragged ahead of a larger id stays first", () => {
  // The panel can drag a probe anywhere, so a consumer that re-sorts by id
  // undoes this. The detail chart hands out legend slots and colours by index.
  const res = pingResponse({
    probes: { "1": "电信", "3": "移动" },
    ping: [
      { task_id: 3, ts: 1000, latency: 90 },
      { task_id: 1, ts: 1000, latency: 40 },
    ],
  });
  const series = pingSeriesFrom(res, 1, 60, 1_700_000_000_000);
  assert.deepEqual(series.tasks.map((t) => t.id), [3, 1], "panel order, not id order");
});

test("a bucket where every probe timed out becomes a gap", () => {
  const res = pingResponse({
    probes: { "1": "电信" },
    ping: [
      { task_id: 1, ts: 1000, latency: 40 },
      { task_id: 1, ts: 1060, latency: null },
    ],
  });
  const series = pingSeriesFrom(res, 1, 60, 1_700_000_000_000);
  assert.deepEqual(series.records.map((r) => r.value), [40, -1], "null latency is the loss sentinel");
});

console.log(`adapters: ${passed} tests passed`);
