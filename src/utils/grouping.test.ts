/**
 * 首页分组的断言。
 *
 *   npm test
 *
 * 盯的是几个错了不显眼的地方：组的先后由谁定、没填分组和填了一串空格的算不算一组、
 * 在线数变了快照认不认得出来（认不出来标题上的「11 在线」就冻住了）。
 * 没有测试框架 —— node 自己剥掉类型，失败时退出码非零。
 */
import assert from "node:assert/strict";
import { EMPTY_GROUPS, groupNodes, offlineLast, sameGroups } from "./grouping.ts";
import type { GroupableNode, NodeGroup } from "./grouping.ts";

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

function node(id: string, group = "", online: boolean | null = true): GroupableNode {
  return { id, group, online };
}

test("group order follows the admin order, not the alphabet", () => {
  // 「香港」的机器排在「日本」前面，就按这个来 —— 按字母序会翻成「日本、香港」，
  // 所以这组名字正好能分辨两种实现。
  const groups = groupNodes([node("1", "香港"), node("2", "日本"), node("3", "香港")]);
  assert.deepEqual(
    groups.map((group) => group.name),
    ["香港", "日本"],
    "字母序会把两组翻过来",
  );
  assert.deepEqual(
    groupNodes([node("1", "Zulu"), node("2", "Alpha")]).map((group) => group.name),
    ["Zulu", "Alpha"],
  );
});

test("ungrouped nodes are always the last group", () => {
  const groups = groupNodes([node("1"), node("2", "香港"), node("3")]);
  assert.deepEqual(
    groups.map((group) => group.name),
    ["香港", ""],
  );
  assert.deepEqual(groups.at(-1)!.ids, ["1", "3"]);
});

test("group names are trimmed, and trimmed-equal names merge", () => {
  const groups = groupNodes([node("1", " 东京 "), node("2", "东京"), node("3", "\t东京")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.name, "东京");
  assert.deepEqual(groups[0]!.ids, ["1", "2", "3"]);
});

test("a whitespace-only group name counts as ungrouped", () => {
  const groups = groupNodes([node("1", "   "), node("2", "香港")]);
  assert.deepEqual(
    groups.map((group) => group.name),
    ["香港", ""],
  );
  assert.deepEqual(groups[1]!.ids, ["1"]);
});

test("ids keep the admin order inside their group", () => {
  const groups = groupNodes([
    node("7", "A"),
    node("3", "B"),
    node("9", "A"),
    node("1", "A"),
  ]);
  assert.deepEqual(groups[0]!.ids, ["7", "9", "1"]);
  assert.deepEqual(groups[1]!.ids, ["3"]);
});

test("online, offline and pending partition every node", () => {
  const groups = groupNodes([
    node("1", "A", true),
    node("2", "A", false),
    node("3", "A", null),
    node("4", "A", true),
    node("5", "B", false),
  ]);
  const first = groups[0]!;
  assert.equal(first.online, 2);
  assert.equal(first.offline, 1);
  assert.equal(first.pending, 1);
  assert.equal(first.online + first.offline + first.pending, first.ids.length);
  // 还没上报过的既不算在线也不算离线。
  assert.equal(groups[1]!.offline, 1);
  assert.equal(groups[1]!.pending, 0);
});

test("an empty list is no groups at all", () => {
  assert.deepEqual(groupNodes([]), EMPTY_GROUPS);
});

test("sameGroups accepts a rebuilt but equal list", () => {
  const build = () => groupNodes([node("1", "A", true), node("2", "A", false), node("3")]);
  assert.equal(sameGroups(build(), build()), true);
  assert.equal(sameGroups(build(), build()), true, "重建出来的对象也该被认为相等");
});

test("sameGroups notices every single field", () => {
  const base = groupNodes([
    node("1", "A", true),
    node("2", "A", false),
    node("3", "A", null),
    node("4", "B", true),
  ]);

  // 漏掉计数 = 分区标题上的「11 在线」在真实变化时冻住。
  const mutations: Array<[string, NodeGroup[]]> = [
    ["少一组", base.slice(0, 1)],
    ["换名字", base.map((group, i) => (i === 0 ? { ...group, name: "C" } : group))],
    ["在线数", base.map((group, i) => (i === 0 ? { ...group, online: group.online + 1 } : group))],
    ["离线数", base.map((group, i) => (i === 0 ? { ...group, offline: 9 } : group))],
    ["同步中", base.map((group, i) => (i === 0 ? { ...group, pending: 9 } : group))],
    ["ids 少一个", base.map((group, i) => (i === 0 ? { ...group, ids: ["1"] } : group))],
    ["ids 换顺序", base.map((group, i) => (i === 0 ? { ...group, ids: ["2", "1", "3"] } : group))],
  ];
  for (const [what, mutated] of mutations) {
    assert.equal(sameGroups(mutated, base), false, `${what} 变了却没被察觉`);
  }
});

test("offlineLast keeps the order inside each half", () => {
  const online = ["a", "b", "c"];
  const offline = new Set(["b"]);
  assert.deepEqual(offlineLast([...online, "d"], [...offline]), ["a", "c", "d", "b"]);
  // 没有离线的、或者整个都是离线的，都原样返回。
  assert.deepEqual(offlineLast(["a", "b"], []), ["a", "b"]);
  assert.deepEqual(offlineLast(["a", "b"], ["a", "b"]), ["a", "b"]);
  // 不在名单里的 id 不会被丢掉。
  assert.deepEqual(offlineLast(["x"], ["y"]), ["x"]);
});

console.log(`grouping: ${passed} tests passed`);
