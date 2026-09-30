import { useMemo } from "react";
import { useOfflineNodeIds, useVisibleNodeIds } from "@/hooks/useNode";
import { useHomepagePingOverview } from "@/hooks/usePingMini";
import { useThemeConfig } from "@/hooks/useThemeConfig";
import { NodeCard } from "./NodeCard";

/**
 * 把离线节点整体沉到后面。这是稳定排序，组内仍按站长拖出来的相对顺序，
 * 离线那批在组内的相对顺序也不变。
 */
export function offlineLast(ids: string[], offline: string[]): string[] {
  const behind = new Set(offline);
  return [...ids].sort((a, b) => Number(behind.has(a)) - Number(behind.has(b)));
}

export function NodeGrid() {
  const ids = useVisibleNodeIds();
  const offline = useOfflineNodeIds();
  const { data: config } = useThemeConfig();
  useHomepagePingOverview(ids);

  const ordered = useMemo(
    () => (config?.offline_nodes_behind ? offlineLast(ids, offline) : ids),
    [ids, offline, config?.offline_nodes_behind],
  );

  if (ids.length === 0) {
    return (
      <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
        <span className="text-[15px]">尚未连接到任何节点</span>
        <span className="text-[12px]">等待后端推送或前往管理后台添加</span>
      </div>
    );
  }

  return (
    <div
      className="grid gap-4 xl:gap-5"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))" }}
    >
      {ordered.map((id) => (
        <div key={id}>
          <NodeCard id={id} />
        </div>
      ))}
    </div>
  );
}
