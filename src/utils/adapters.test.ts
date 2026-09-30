/**
 * 适配层的断言。没有测试框架 —— node 自己剥掉类型，失败时退出码非零。
 *
 *   npm test
 *
 * 盯的是几个错了不显眼的地方：流量比的是哪个口径、到期天数谁来算、
 * 一条坏上报怎么处置、探测顺序按什么定。
 */
import assert from "node:assert/strict";
import {
  daysUntilUtc,
  expireDays,
  monthUsage,
  onlineState,
  pingOverviewItem,
  pingSeriesFrom,
  safeNodes,
  sampleStep,
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

test("the sampling grid matches the hub's own formula", () => {
  // hub: 60 * max(ceil(hours*60 / clamp(points,60,1440)), 1)
  assert.equal(sampleStep(1, 1440), 60, "an hour bottoms out at the one-minute grid");
  assert.equal(sampleStep(6, 1440), 60);
  assert.equal(sampleStep(24, 1440), 60);
  assert.equal(sampleStep(168, 1440), 420);
  assert.equal(sampleStep(720, 1440), 1800);
  assert.equal(sampleStep(168, 60), 10080 > 0 ? 60 * Math.ceil((168 * 60) / 60) : 0, "few points means a coarse grid");
});

const pingResponse = (over: Partial<MetricsResponse> = {}): MetricsResponse => ({
  metrics: [],
  ping: [],
  probes: {},
  loss: {},
  ...over,
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

test("a card shows 未配置 only when the node really has no probes", () => {
  const unassigned = pingOverviewItem("7", pingResponse());
  assert.equal(unassigned.isAssigned, false, "no probes at all");

  // Assigned but the window is empty: a different answer, and not a claim of 0% loss.
  const quiet = pingOverviewItem("7", pingResponse({ probes: { "1": "电信" } }));
  assert.equal(quiet.isAssigned, true);
  assert.equal(quiet.samples.length, 0);
  assert.equal(quiet.loss, null, "no samples is not 'nothing was lost'");
  assert.equal(quiet.lastValue, null);

  // With samples, a probe absent from `loss` lost nothing.
  const busy = pingOverviewItem(
    "7",
    pingResponse({
      probes: { "1": "电信" },
      ping: [
        { task_id: 1, ts: 1000, latency: 41 },
        { task_id: 1, ts: 1060, latency: null },
      ],
    }),
  );
  assert.equal(busy.isAssigned, true);
  assert.equal(busy.lastValue, 41, "the last bucket that answered");
  assert.equal(busy.loss, 0, "absent from `loss` means nothing was lost");
  assert.deepEqual(busy.samples.map((s) => s.value), [41, -1]);
});

console.log(`adapters: ${passed} tests passed`);
