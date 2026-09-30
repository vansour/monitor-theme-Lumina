/**
 * 首页节点分组的纯函数。`grouping.test.ts` 盯着它。
 *
 * 两条容易写错的地方：
 * - 分组顺序取**站长排的顺序里第一次出现的位置**，不是字母序；未分组永远在最后。
 * - `sameGroups` 必须比到计数：在线状态变了而 id 没变时，快照的身份也得换，
 *   否则分区标题上的「11 在线」会一动不动。
 */
import type { NodeDisplay } from "../types/monitor.ts";

/** 分组只用到这三样。写成结构化类型，测试里造数据不必把整个 NodeDisplay 拼出来。 */
export type GroupableNode = Pick<NodeDisplay, "id" | "group" | "online">;

export interface NodeGroup {
  /** 站长填的分组名，已 trim；空串表示未分组。 */
  name: string;
  /** 组内节点 id，顺序就是站长拖出来的顺序。 */
  ids: string[];
  online: number;
  offline: number;
  /** `online === null`：已连接但还没上报过，卡片上显示「状态同步中」。 */
  pending: number;
}

export const EMPTY_GROUPS: NodeGroup[] = [];

/**
 * 按 hub 的分组把节点分成几节。
 *
 * 组名只在这里 trim 一次（`toDisplay` 存的是原样）：一个只剩空白的组名是「没填」，
 * 而「 东京 」和「东京」是同一组 —— 站长在后台多打一个空格不该多出一节。
 */
export function groupNodes(nodes: readonly GroupableNode[]): NodeGroup[] {
  const byName = new Map<string, NodeGroup>();
  const named: string[] = [];

  for (const node of nodes) {
    const name = node.group.trim();
    let group = byName.get(name);
    if (!group) {
      group = { name, ids: [], online: 0, offline: 0, pending: 0 };
      byName.set(name, group);
      // 未分组先不进顺序表，最后单独补。
      if (name) named.push(name);
    }
    group.ids.push(node.id);
    if (node.online === true) group.online += 1;
    else if (node.online === false) group.offline += 1;
    else group.pending += 1;
  }

  const groups = named.map((name) => byName.get(name)!);
  const ungrouped = byName.get("");
  if (ungrouped) groups.push(ungrouped);
  return groups;
}

/** 逐字段比较。`lib/nodes.ts` 靠它决定要不要换快照的身份。 */
export function sameGroups(a: readonly NodeGroup[], b: readonly NodeGroup[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.name !== right.name ||
      left.online !== right.online ||
      left.offline !== right.offline ||
      left.pending !== right.pending ||
      left.ids.length !== right.ids.length
    ) {
      return false;
    }
    for (let j = 0; j < left.ids.length; j++) {
      if (left.ids[j] !== right.ids[j]) return false;
    }
  }
  return true;
}

/**
 * 把离线节点整体沉到后面。这是稳定排序：组内仍按站长拖出来的相对顺序，
 * 离线那批在组内的相对顺序也不变。分组时每组各排一次，平铺时整列排一次。
 */
export function offlineLast(ids: string[], offline: string[]): string[] {
  const behind = new Set(offline);
  return [...ids].sort((a, b) => Number(behind.has(a)) - Number(behind.has(b)));
}
