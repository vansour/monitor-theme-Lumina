/**
 * 首页总览的断言。
 *
 *   npm test
 *
 * 盯的是四个合计口径里错了不显眼的地方：离线机器该不该进分母、内存百分比是「先合计
 * 再相除」还是「每人百分比取平均」、配额的分子分母是不是同一批机器。
 * 没有测试框架 —— node 自己剥掉类型，失败时退出码非零。
 */
import assert from "node:assert/strict";
import { EMPTY_OVERVIEW, sameOverview, summarizeNodes } from "./overview.ts";
import type { NodesOverview } from "./overview.ts";
import type { NodeDisplay } from "../types/monitor.ts";

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

function display(over: Partial<NodeDisplay> = {}): NodeDisplay {
  return {
    id: "1",
    nodeId: 1,
    name: "n1",
    group: "",
    region: "JP",
    os: "Debian",
    arch: "x86_64",
    virtualization: "kvm",
    kernel_version: "6.12.48",
    cpu_name: "EPYC",
    cpu_cores: 4,
    mem_total: 0,
    swap_total: 0,
    disk_total: 0,
    price: 0,
    billing_cycle: "",
    currency: "",
    expired_at: "",
    expiresIn: null,
    traffic_limit: 0,
    traffic_mode: "sum",
    traffic_reset_day: 1,
    monthUsed: 0,

    online: true,
    updatedAt: 1_700_000_000_000,
    lastSeenAgo: 0,
    uptime: 0,
    cpuPct: 0,
    ramUsed: 0,
    ramTotal: 0,
    ramPct: 0,
    swapUsed: 0,
    swapTotal: 0,
    swapPct: 0,
    diskUsed: 0,
    diskTotal: 0,
    diskPct: 0,
    load1: 0,
    load5: 0,
    load15: 0,
    netUp: 0,
    netDown: 0,
    trafficUp: 0,
    trafficDown: 0,
    process: 0,
    connectionsTcp: 0,
    connectionsUdp: 0,
    ...over,
  };
}

test("offline nodes keep their monthly traffic but contribute nothing else", () => {
  // 离线节点上仍然带着最后一次上报的数字，而 ramTotal/diskTotal 还会退回静态的
  // mem_total/disk_total —— 让它进分母，全站百分比会一路被拉低。
  const offline = display({
    id: "off",
    online: false,
    netUp: 9_999,
    netDown: 9_999,
    cpuPct: 90,
    ramUsed: 3 * GiB,
    ramTotal: 4 * GiB,
    diskUsed: 30 * GiB,
    diskTotal: 40 * GiB,
    monthUsed: 100 * GiB,
  });
  const online = display({
    id: "on",
    netUp: 1_000,
    netDown: 2_000,
    cpuPct: 20,
    ramUsed: GiB,
    ramTotal: 2 * GiB,
    diskUsed: 5 * GiB,
    diskTotal: 10 * GiB,
    monthUsed: 7 * GiB,
  });

  const overview = summarizeNodes([offline, online]);
  assert.equal(overview.total, 2);
  assert.equal(overview.online, 1);
  assert.equal(overview.offline, 1);
  assert.equal(overview.pending, 0);

  assert.equal(overview.netUp, 1_000, "离线节点的速率不该进合计");
  assert.equal(overview.netDown, 2_000);
  assert.equal(overview.cpuPct, 20, "CPU 只算在线节点");
  assert.equal(overview.ramUsed, GiB);
  assert.equal(overview.ramTotal, 2 * GiB, "离线机器的静态总量不能进分母");
  assert.equal(overview.diskTotal, 10 * GiB);
  assert.equal(overview.ramPct, 50);
  // 用掉的流量不会因为机器离线而消失。
  assert.equal(overview.monthUsed, 107 * GiB);
});

test("memory and disk are sum over sum, not the mean of per-node percentages", () => {
  const small = display({ id: "a", ramUsed: 0.9 * GiB, ramTotal: GiB, diskUsed: 0.9 * GiB, diskTotal: GiB });
  const big = display({
    id: "b",
    ramUsed: 10 * GiB,
    ramTotal: 100 * GiB,
    diskUsed: 10 * GiB,
    diskTotal: 100 * GiB,
  });

  const overview = summarizeNodes([small, big]);
  // 90% 与 10% 的平均是 50%，但那是把 1 GiB 的机器和 100 GiB 的机器等量齐观。
  assert.notEqual(overview.ramPct, 50);
  assert.ok(Math.abs(overview.ramPct! - (10.9 / 101) * 100) < 1e-9);
  assert.ok(Math.abs(overview.diskPct! - (10.9 / 101) * 100) < 1e-9);
});

test("the quota percentage shares its numerator and denominator", () => {
  const metered = display({ id: "metered", monthUsed: 10 * GiB, traffic_limit: 100 * GiB });
  const unmetered = display({ id: "unmetered", monthUsed: 900 * GiB });

  const overview = summarizeNodes([metered, unmetered]);
  assert.equal(overview.monthUsed, 910 * GiB);
  assert.equal(overview.quotaNodes, 1);
  assert.equal(overview.quotaLimit, 100 * GiB);
  assert.equal(overview.quotaUsed, 10 * GiB);
  assert.equal(overview.quotaPct, 10);
  // 拿全站已用当分子会算出 910% —— 那个数对不上任何一条配额上限。
  assert.notEqual(overview.quotaPct, 910);
});

test("a zero or negative traffic limit is not a quota", () => {
  const overview = summarizeNodes([
    display({ id: "a", monthUsed: 5 * GiB, traffic_limit: 0 }),
    display({ id: "b", monthUsed: 5 * GiB, traffic_limit: -1 }),
  ]);
  assert.equal(overview.quotaLimit, 0);
  assert.equal(overview.quotaUsed, 0);
  assert.equal(overview.quotaPct, null);
  assert.equal(overview.monthUsed, 10 * GiB);
});

test("cpu is the mean over online nodes, and null when nobody is online", () => {
  const a = display({ id: "a", cpuPct: 10 });
  const b = display({ id: "b", cpuPct: 40 });
  // 已连接但还没上报：卡片上显示「状态同步中」，不算在线也不算离线。
  const c = display({ id: "c", online: null, cpuPct: 100, netUp: 5_000 });

  const mixed = summarizeNodes([a, b, c]);
  assert.equal(mixed.cpuPct, 25);
  assert.equal(mixed.pending, 1);
  assert.equal(mixed.online, 2);
  assert.equal(mixed.netUp, 0, "还没上报的节点没有速率可言");

  const allOffline = summarizeNodes([display({ online: false, cpuPct: 80, ramUsed: GiB, ramTotal: GiB })]);
  // null 而不是 0：「没有在线节点」与「在线节点都闲着」是两回事。
  assert.equal(allOffline.cpuPct, null);
  assert.equal(allOffline.ramPct, null);
  assert.equal(allOffline.diskPct, null);
});

test("every node lands in exactly one of online, offline and pending", () => {
  const overview = summarizeNodes([
    display({ id: "a" }),
    display({ id: "b" }),
    display({ id: "c", online: false }),
    display({ id: "d", online: null }),
  ]);
  assert.equal(overview.total, 4);
  assert.equal(overview.online + overview.offline + overview.pending, overview.total);
});

test("an empty list is the empty overview, with no NaN", () => {
  const overview = summarizeNodes([]);
  assert.deepEqual(overview, EMPTY_OVERVIEW);
  for (const [key, value] of Object.entries(overview)) {
    assert.ok(
      value === null || Number.isFinite(value),
      `${key} 是 ${String(value)}，不是有限数也不是 null`,
    );
  }
});

test("sameOverview notices every single field", () => {
  const base = summarizeNodes([
    display({
      cpuPct: 10,
      ramUsed: GiB,
      ramTotal: 4 * GiB,
      diskUsed: GiB,
      diskTotal: 8 * GiB,
      netUp: 500,
      netDown: 600,
      monthUsed: 7 * GiB,
      traffic_limit: 100 * GiB,
    }),
  ]);

  // 漏掉任何一个字段，那一格就会在真实数据变化时一动不动。
  assert.equal(sameOverview(base, { ...base }), true);
  for (const key of Object.keys(base) as Array<keyof NodesOverview>) {
    const current = base[key];
    const mutated: Record<string, number | null> = { ...base };
    mutated[key] = current === null ? 1 : current + 1;
    assert.equal(
      sameOverview(mutated as unknown as NodesOverview, base),
      false,
      `${key} 变了却没被察觉`,
    );
  }
});

console.log(`overview: ${passed} tests passed`);
