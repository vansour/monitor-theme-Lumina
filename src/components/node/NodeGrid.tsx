import { memo, useCallback, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useNodeGroups, useOfflineNodeIds, useVisibleNodeIds } from "@/hooks/useNode";
import { useHomepagePingOverview } from "@/hooks/usePingMini";
import type { PingCellRegistrar } from "@/hooks/usePingMini";
import { useThemeConfig } from "@/hooks/useThemeConfig";
import { offlineLast } from "@/utils/grouping";
import type { NodeGroup } from "@/utils/grouping";
import { NodeCard } from "./NodeCard";

const COLLAPSED_GROUPS_STORAGE_KEY = "lumina:collapsed-groups";
/** 最多记多少组：分组再多也不该把访客的 localStorage 撑爆。 */
const MAX_COLLAPSED_GROUPS = 100;

function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter((value): value is string => typeof value === "string")
        .slice(0, MAX_COLLAPSED_GROUPS),
    );
  } catch {
    // localStorage 不可用（隐私模式、配额满）就当作没折叠过。
    return new Set();
  }
}

function persistCollapsedGroups(names: Set<string>): void {
  try {
    localStorage.setItem(
      COLLAPSED_GROUPS_STORAGE_KEY,
      JSON.stringify([...names].slice(0, MAX_COLLAPSED_GROUPS)),
    );
  } catch {
    // 写不进去就只留内存里的状态。
  }
}

/** 空串是「没填分组」，界面上写「未分组」。 */
function groupLabel(name: string): string {
  return name || "未分组";
}

/** 分区标题右边那串：台数 · 在线数，有离线的报离线，否则报同步中的。 */
function groupSummary(group: NodeGroup): string {
  const parts = [`${group.ids.length} 台`, `${group.online} 在线`];
  if (group.offline > 0) parts.push(`${group.offline} 离线`);
  else if (group.pending > 0) parts.push(`${group.pending} 同步中`);
  return parts.join(" · ");
}

export function NodeGrid() {
  const ids = useVisibleNodeIds();
  const offline = useOfflineNodeIds();
  const groups = useNodeGroups();
  const { data: config } = useThemeConfig();
  const registerPingCell = useHomepagePingOverview(ids);

  // null = 全部。不用字符串哨兵：分组名是站长随手填的，什么都可能出现。
  const [filter, setFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedGroups);

  const toggleGroup = useCallback((name: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(name)) next.add(name);
      persistCollapsedGroups(next);
      return next;
    });
  }, []);

  const offlineBehind = config?.offline_nodes_behind === true;
  const groupIds = useMemo(
    () =>
      new Map(
        groups.map((group) => [
          group.name,
          offlineBehind ? offlineLast(group.ids, offline) : group.ids,
        ]),
      ),
    [groups, offline, offlineBehind],
  );

  if (ids.length === 0) {
    return (
      <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
        <span className="text-[15px]">尚未连接到任何节点</span>
        <span className="text-[12px]">等待后端推送或前往管理后台添加</span>
      </div>
    );
  }

  // 只有「一个正经分组都没有」才回落平铺：整站都在同一个分组里时，
  // 分区标题是唯一的分组线索，不能省。
  const grouped = config?.group_nodes !== false && groups.some((group) => group.name !== "");
  if (!grouped) {
    return (
      <CardGrid
        ids={offlineBehind ? offlineLast(ids, offline) : ids}
        registerPingCell={registerPingCell}
      />
    );
  }

  // 选中的分组可能已经改名或一个节点都不剩了，回落「全部」——不然后面是一片空白。
  const active = filter !== null && groups.some((group) => group.name === filter) ? filter : null;

  return (
    <>
      {groups.length >= 2 && (
        <div
          className="instance-segmented is-scrollable home-group-filter"
          role="group"
          aria-label="按分组筛选"
        >
          <button
            type="button"
            data-active={active === null ? "true" : "false"}
            aria-pressed={active === null}
            onClick={() => setFilter(null)}
          >
            全部
            <span className="home-group-filter-count tabular">{ids.length}</span>
          </button>
          {groups.map((group) => (
            <button
              key={group.name}
              type="button"
              data-active={active === group.name ? "true" : "false"}
              aria-pressed={active === group.name}
              title={groupLabel(group.name)}
              onClick={() => setFilter(group.name)}
            >
              {groupLabel(group.name)}
              <span className="home-group-filter-count tabular">{group.ids.length}</span>
            </button>
          ))}
        </div>
      )}

      {groups.map((group, index) => {
        const label = groupLabel(group.name);
        // 筛选态下折叠不生效：否则「选中一个折叠着的组」会得到一片空白，
        // 而且那时连标题都不画，没有东西可点。
        const isCollapsed = active === null && collapsed.has(group.name);
        const panelId = `node-group-panel-${index}`;
        return (
          <section
            key={group.name}
            className="node-group-section"
            hidden={active !== null && active !== group.name}
            aria-label={label}
          >
            {active === null && (
              <h2 className="home-group-heading">
                <button
                  type="button"
                  className="home-group-header"
                  aria-expanded={!isCollapsed}
                  aria-controls={panelId}
                  onClick={() => toggleGroup(group.name)}
                >
                  <ChevronDown
                    className="home-group-chevron"
                    size={14}
                    strokeWidth={2.2}
                    aria-hidden="true"
                  />
                  <span className="home-group-name" title={label}>
                    {label}
                  </span>
                  <span
                    className="home-group-counts tabular"
                    data-alert={group.offline > 0 ? "true" : "false"}
                  >
                    {groupSummary(group)}
                  </span>
                </button>
              </h2>
            )}
            <CardGrid
              panelId={panelId}
              hidden={isCollapsed}
              ids={groupIds.get(group.name) ?? group.ids}
              registerPingCell={registerPingCell}
            />
          </section>
        );
      })}
    </>
  );
}

/**
 * 一组卡片的网格：分组时每节一个，平铺时整页一个。
 *
 * 折叠与筛选都只加 `hidden`，卡片留在 DOM 里 —— 探测的 job、缓存、画布都不丢，
 * 展开时不用重新拉数据，隐藏的那些也自然不再轮询（不在视野里就不查）。
 * Tailwind preflight 里那条 `[hidden]{display:none!important}` 压得住这里的
 * `display:grid`，不用再补一道。
 */
function CardGrid({
  ids,
  registerPingCell,
  panelId,
  hidden,
}: {
  ids: string[];
  registerPingCell: PingCellRegistrar;
  panelId?: string;
  hidden?: boolean;
}) {
  return (
    <div className="node-card-grid" id={panelId} hidden={hidden}>
      {ids.map((id) => (
        <GridCell key={id} id={id} registerPingCell={registerPingCell} />
      ))}
    </div>
  );
}

/**
 * 延迟轮询要知道卡片在不在视野里，观察的是**这个栅格单元格**而不是卡片本身：
 * NodeCard 在节点数据还没到时渲染的是另一个 div，卡片根节点会换，而这个 wrapper
 * 从挂到卸始终是同一个。
 */
const GridCell = memo(function GridCell({
  id,
  registerPingCell,
}: {
  id: string;
  registerPingCell: PingCellRegistrar;
}) {
  // 回调必须是块体：React 19 会把 ref 回调的返回值当成清理函数，返回了东西就
  // 收不到卸载通知了。
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      registerPingCell(id, element);
    },
    [id, registerPingCell],
  );

  return (
    <div ref={setRef}>
      <NodeCard id={id} />
    </div>
  );
});
