import { startTransition, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { InstanceDetails } from "@/components/instance/InstanceDetails";
import { PingChart } from "@/components/instance/PingChart";
import { LoadChart } from "@/components/instance/LoadChart";
import {
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
} from "@/components/instance/chartShared";
import { useNode } from "@/hooks/useNode";
import { useMe } from "@/hooks/useMe";
import { useThemeConfig } from "@/hooks/useThemeConfig";
import { ADMIN_MAX_HOURS, ANON_MAX_HOURS } from "@/lib/api";

export function Instance() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const { data: me } = useMe();
  const { data: config } = useThemeConfig();
  const node = useNode(id);
  const [chartType, setChartType] = useState<"load" | "ping">("load");
  // null 表示访客还没自己选过，用站长设的默认值；选过之后就一直是它。
  const [loadHours, setLoadHours] = useState<number | null>(null);
  const [pingHours, setPingHours] = useState<number | null>(null);

  // hub 的窗口上限：匿名 168 小时，登录后 2160。超出 hub 会静默截断，
  // 所以直接不列出来。
  const maxHours = me?.authed ? ADMIN_MAX_HOURS : ANON_MAX_HOURS;
  const loadRanges = useMemo(() => buildLoadTimeRangeOptions(maxHours), [maxHours]);
  const pingRanges = useMemo(() => buildPingTimeRangeOptions(maxHours), [maxHours]);

  const defaultHours = Number(config?.default_range_hours) || 6;
  const showPingChart = config?.show_ping_chart !== false;
  const activeRanges = chartType === "load" ? loadRanges : pingRanges;
  const resolvedLoadHours = loadHours ?? defaultHours;
  const resolvedPingHours = pingHours ?? defaultHours;
  const activeHours = chartType === "load" ? resolvedLoadHours : resolvedPingHours;

  const nodeName = node?.name ?? "";
  const siteTitle = me?.site_name || "Monitor";
  const nodeId = node?.nodeId ?? Number(id);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [id]);

  useEffect(() => {
    if (!nodeName) return;
    document.title = `${nodeName} · ${siteTitle}`;
    return () => {
      document.title = siteTitle;
    };
  }, [nodeName, siteTitle]);

  useEffect(() => {
    if (!showPingChart && chartType === "ping") setChartType("load");
  }, [chartType, showPingChart]);

  if (!id || !Number.isFinite(nodeId)) return null;

  return (
    <div className="flex flex-col gap-5 py-2">
      <Link to="/" className="instance-page-back">
        <ChevronLeft size={14} />
        返回
      </Link>
      <InstanceDetails id={id} />
      <div className="instance-chart-controls">
        <div className="instance-segmented">
          <button
            type="button"
            data-active={chartType === "load" ? "true" : "false"}
            onClick={() => {
              startTransition(() => setChartType("load"));
            }}
          >
            负载
          </button>
          {showPingChart && (
            <button
              type="button"
              data-active={chartType === "ping" ? "true" : "false"}
              onClick={() => {
                startTransition(() => setChartType("ping"));
              }}
            >
              Ping
            </button>
          )}
        </div>
        {activeRanges.length > 1 && (
          <div key={`${chartType}-ranges`} className="instance-segmented is-scrollable">
            {activeRanges.map((range) => (
              <button
                key={range.value}
                type="button"
                data-active={activeHours === range.value ? "true" : "false"}
                onClick={() => {
                  startTransition(() => {
                    if (chartType === "load") setLoadHours(range.value);
                    else setPingHours(range.value);
                  });
                }}
              >
                {range.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="instance-chart-stage">
        <div
          className="instance-chart-view"
          hidden={chartType !== "load"}
          aria-hidden={chartType !== "load"}
        >
          <LoadChart nodeId={nodeId} hours={resolvedLoadHours} active={chartType === "load"} />
        </div>
        <div
          className="instance-chart-view"
          hidden={chartType !== "ping"}
          aria-hidden={chartType !== "ping"}
        >
          {showPingChart ? (
            <PingChart nodeId={nodeId} hours={resolvedPingHours} active={chartType === "ping"} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
