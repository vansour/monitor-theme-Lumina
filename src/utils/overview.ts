/**
 * 首页总览的合计。纯函数，不持有状态 —— `overview.test.ts` 盯着它。
 *
 * 四条容易写错、错了又不显眼的规矩：
 *
 * - **带宽与资源只合计在线节点。** 离线节点的实时指标是空的，而 `toDisplay` 里
 *   `ramTotal`/`diskTotal` 会退回**静态的** `mem_total`/`disk_total` —— 也就是说一台
 *   离线机器会带着「已用 0、总共 4 GiB」混进来，把全站百分比一路拉低。
 * - **内存/磁盘是「在线节点已用之和 ÷ 在线节点总量之和」**，不是每人百分比的平均：
 *   一台 1 GiB 的机器和一台 100 GiB 的机器，平均值对谁都不成立。
 * - **CPU 是在线节点百分比的平均**，不是加权。不同核数没有共同分母；按核数加权又会
 *   在旧版 hub 的 `cpu_cores: 0` 上把这个节点整个丢掉。界面上那一格写着「在线均值」。
 * - **配额的分子分母取同一个子集**（有配额的节点）。全站已用里包含没配额的机器，
 *   拿它当分子会算出一个对不上任何配额上限的百分比。
 */
import type { NodeDisplay } from "../types/monitor.ts";

export interface NodesOverview {
  total: number;
  online: number;
  offline: number;
  /** 已连接但还没上报过（`online === null`），卡片上显示「状态同步中」。 */
  pending: number;

  /** 字节/秒，只合计在线节点。 */
  netUp: number;
  netDown: number;
  /** 在线节点的 CPU 均值（百分比）；没有在线节点时是 null。 */
  cpuPct: number | null;

  ramUsed: number;
  ramTotal: number;
  /** 已用之和 ÷ 总量之和；没有在线节点时是 null。 */
  ramPct: number | null;
  diskUsed: number;
  diskTotal: number;
  diskPct: number | null;

  /** 本计费周期已用流量，含离线节点 —— 用掉的流量不会因为机器离线而消失。 */
  monthUsed: number;
  /** 设了配额（`traffic_limit > 0`）的节点数。 */
  quotaNodes: number;
  /** 这几个节点的已用合计，与 `quotaLimit` 同口径。 */
  quotaUsed: number;
  /** 这几个节点的上限合计；0 表示这个站没人设配额。 */
  quotaLimit: number;
  /** `quotaUsed ÷ quotaLimit`，没有配额时是 null。不封顶：超了就是 118%。 */
  quotaPct: number | null;
}

export const EMPTY_OVERVIEW: NodesOverview = {
  total: 0,
  online: 0,
  offline: 0,
  pending: 0,
  netUp: 0,
  netDown: 0,
  cpuPct: null,
  ramUsed: 0,
  ramTotal: 0,
  ramPct: null,
  diskUsed: 0,
  diskTotal: 0,
  diskPct: null,
  monthUsed: 0,
  quotaNodes: 0,
  quotaUsed: 0,
  quotaLimit: 0,
  quotaPct: null,
};

function pct(used: number, total: number): number | null {
  return total > 0 ? (used / total) * 100 : null;
}

export function summarizeNodes(nodes: Iterable<NodeDisplay>): NodesOverview {
  let total = 0;
  let online = 0;
  let offline = 0;
  let pending = 0;
  let netUp = 0;
  let netDown = 0;
  let cpuSum = 0;
  let ramUsed = 0;
  let ramTotal = 0;
  let diskUsed = 0;
  let diskTotal = 0;
  let monthUsed = 0;
  let quotaNodes = 0;
  let quotaUsed = 0;
  let quotaLimit = 0;

  for (const node of nodes) {
    total += 1;
    monthUsed += node.monthUsed;
    // 旧数据里上限可能是 0 或负数，那都是「没设配额」。
    if (node.traffic_limit > 0) {
      quotaNodes += 1;
      quotaLimit += node.traffic_limit;
      quotaUsed += node.monthUsed;
    }

    if (node.online !== true) {
      if (node.online === false) offline += 1;
      else pending += 1;
      continue;
    }

    online += 1;
    cpuSum += node.cpuPct;
    netUp += node.netUp;
    netDown += node.netDown;
    ramUsed += node.ramUsed;
    ramTotal += node.ramTotal;
    diskUsed += node.diskUsed;
    diskTotal += node.diskTotal;
  }

  return {
    total,
    online,
    offline,
    pending,
    netUp,
    netDown,
    cpuPct: online > 0 ? cpuSum / online : null,
    ramUsed,
    ramTotal,
    ramPct: pct(ramUsed, ramTotal),
    diskUsed,
    diskTotal,
    diskPct: pct(diskUsed, diskTotal),
    monthUsed,
    quotaNodes,
    quotaUsed,
    quotaLimit,
    quotaPct: pct(quotaUsed, quotaLimit),
  };
}

/**
 * 逐字段比较。`lib/nodes.ts` 靠它决定要不要换快照的身份 —— 漏掉哪个字段，
 * 那一格就会在真实数据变化时纹丝不动（而 React 那边看不出任何异常）。
 */
export function sameOverview(a: NodesOverview, b: NodesOverview): boolean {
  return (
    a.total === b.total &&
    a.online === b.online &&
    a.offline === b.offline &&
    a.pending === b.pending &&
    a.netUp === b.netUp &&
    a.netDown === b.netDown &&
    a.cpuPct === b.cpuPct &&
    a.ramUsed === b.ramUsed &&
    a.ramTotal === b.ramTotal &&
    a.ramPct === b.ramPct &&
    a.diskUsed === b.diskUsed &&
    a.diskTotal === b.diskTotal &&
    a.diskPct === b.diskPct &&
    a.monthUsed === b.monthUsed &&
    a.quotaNodes === b.quotaNodes &&
    a.quotaUsed === b.quotaUsed &&
    a.quotaLimit === b.quotaLimit &&
    a.quotaPct === b.quotaPct
  );
}
