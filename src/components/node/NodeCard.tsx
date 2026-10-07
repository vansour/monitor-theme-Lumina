import { memo, useCallback, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Cpu,
  Gauge,
  MemoryStick,
  HardDrive,
  Globe,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Power,
} from "lucide-react";
import { useNode, useNodeTrafficTrend } from "@/hooks/useNode";
import { useResolvedAppearance } from "@/hooks/usePreferences";
import {
  formatBytes,
  formatExpireDays,
  formatOfflineDuration,
  formatTrafficRate,
  formatUptimeDays,

} from "@/utils/format";
import { getExpireTextColor } from "@/utils/expireStatus";
import { Flag } from "@/components/ui/Flag";
import { MetricBar } from "./MetricBar";
import { CanvasStrip, fillRoundedRect, resolveCssColor } from "./CanvasStrip";
import { clsx } from "clsx";
import type { TrafficTrendSample } from "@/types/monitor";
import type { TrafficRateDisplay } from "@/utils/format";

function buildSubtitle(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

export const NodeCard = memo(function NodeCard({
  id,
}: {
  id: string;
}) {
  const resolvedAppearance = useResolvedAppearance();
  const node = useNode(id);
  const trafficTrend = useNodeTrafficTrend(id);

  if (!node) {
    return (
      <div
        className="server-card animate-pulse"
        // 与卡片实测高度一致（桌面栅格 358px），骨架不该比真卡片高或矮；
        // 同一数字在 surface.css 的 contain-intrinsic-size 里也有一份。
        style={{ minHeight: 358 }}
        aria-busy
      />
    );
  }

  const expire = formatExpireDays(node.expiresIn);
  const uptime = formatUptimeDays(node.uptime);
  const subtitle = buildSubtitle([node.os, node.arch, node.virtualization]);
  const expireText = `${expire.value}${expire.unit ? ` ${expire.unit}` : ""}`;
  const uptimeText = `${uptime.value}${uptime.unit ? ` ${uptime.unit}` : ""}`;
  const subtitleWithMeta = buildSubtitle([subtitle, `到期 ${expireText}`, `在线 ${uptimeText}`]);
  const loadBaseline = node.cpu_cores > 0 ? node.cpu_cores : 4;
  const loadFraction = Math.max(0, Math.min(1, node.load1 / loadBaseline));
  const upRate = formatTrafficRate(node.netUp);
  const downRate = formatTrafficRate(node.netDown);
  const isOnline = node.online === true;
  const isOffline = node.online === false;
  const offlineFor = isOffline ? formatOfflineDuration(node.lastSeenAgo) : null;

  return (
    <article
      className={clsx("server-card", isOffline && "is-offline")}
      data-appearance={resolvedAppearance}
    >
      {isOffline && (
        <div className="offline-mask">
          <span className="offline-badge" title={offlineFor?.full}>
            <Power size={14} strokeWidth={2.2} />
            <span className="offline-badge-copy">
              <span>离线</span>
              <span className="offline-badge-time">
                {offlineFor?.value}
                {offlineFor?.unit ? ` ${offlineFor.unit}` : ""}
              </span>
            </span>
          </span>
        </div>
      )}

      <div className="server-card-content">
        <header className="server-card-header">
          <div className="server-card-title-block">
            <div className="server-card-title-row">
              <Flag region={node.region} size={15} />
              <Link
                to={`/instance/${node.id}`}
                className="server-card-title-link"
                title={node.name}
              >
                {node.name}
              </Link>
              <span
                className={clsx("server-card-online-dot", isOffline && "is-offline")}
                style={{
                  background:
                    node.online == null
                      ? "var(--text-tertiary)"
                      : isOnline
                        ? "var(--status-online)"
                        : "var(--status-offline)",
                  boxShadow: `0 0 0 3px color-mix(in srgb, ${
                    node.online == null
                      ? "var(--text-tertiary)"
                      : isOnline
                        ? "var(--status-online)"
                        : "var(--status-offline)"
                  } 20%, transparent)`,
                }}
                title={node.online == null ? "状态同步中" : isOnline ? "在线" : "离线"}
              />
            </div>
            {/* 到期与在线从底部的单独一栏挪上来（那栏还带着一条分隔线），
                缩成副标题下面的一行小字。挤进副标题同一行的话，长一点的系统名
                会把「在线 X 天」截掉。 */}
            {subtitle ? (
              <p className="server-card-subtitle" title={subtitle}>
                {subtitle}
              </p>
            ) : null}
            <p className="server-card-subtitle-meta" title={subtitleWithMeta}>
              <span style={{ color: getExpireTextColor(node.expiresIn) }}>
                到期 {expireText}
              </span>
              {" · "}
              <span style={{ color: "var(--progress-cpu)" }}>在线 {uptimeText}</span>
            </p>
          </div>
          <Link
            to={`/instance/${node.id}`}
            className="server-card-detail-link"
            title="查看详情"
          >
            <ExternalLink size={15} strokeWidth={2} />
          </Link>
        </header>

        <div className="server-card-stack">
          <div className="card-metric-section server-metric-grid">
            <MetricBar
              icon={<Cpu size={13} strokeWidth={2} />}
              label="CPU"
              valueText={node.cpuPct.toFixed(2)}
              unit="%"
              detailText={`${node.cpu_cores || 0} 核`}
              fraction={node.cpuPct / 100}
              redrawKey={resolvedAppearance}
              paint={{ kind: "solid", color: "var(--progress-cpu)" }}
            />
            <MetricBar
              icon={<MemoryStick size={13} strokeWidth={2} />}
              label="内存"
              valueText={node.ramPct.toFixed(2)}
              unit="%"
              detailText={`${formatBytes(node.ramUsed)} / ${formatBytes(node.ramTotal)}`}
              fraction={node.ramPct / 100}
              redrawKey={resolvedAppearance}
              paint={{ kind: "solid", color: "var(--progress-memory)" }}
            />
            <MetricBar
              icon={<HardDrive size={13} strokeWidth={2} />}
              label="磁盘"
              valueText={node.diskPct.toFixed(1)}
              unit="%"
              detailText={`${formatBytes(node.diskUsed)} / ${formatBytes(node.diskTotal)}`}
              fraction={node.diskPct / 100}
              redrawKey={resolvedAppearance}
              paint={{ kind: "solid", color: "var(--progress-disk)" }}
            />
            <MetricBar
              icon={<Gauge size={13} strokeWidth={2} />}
              label="负载"
              valueText={node.load1.toFixed(2)}
              // 大数字是 1 分钟均值，明细给全三个 —— 负载这一格原来是四格里唯一
              // 没有明细的，旁边的进度条又是按「除以核数」画的，缺上下文。
              detailText={`${node.load1.toFixed(2)} / ${node.load5.toFixed(2)} / ${node.load15.toFixed(2)}`}
              fraction={loadFraction}
              redrawKey={resolvedAppearance}
              paint={{
                kind: "gradient",
                from: "var(--progress-cpu)",
                to: "var(--progress-memory)",
              }}
            />
          </div>

          <div className="card-metric-section server-traffic-section">
            <TrafficStat
              direction="上行"
              totalLabel="出站"
              rate={upRate}
              total={formatBytes(node.trafficUp)}
              samples={trafficTrend.up}
              live={isOnline}
              redrawKey={resolvedAppearance}
              color="var(--progress-cpu)"
              icon={<ArrowUp size={15} strokeWidth={2.4} />}
            />
            <TrafficStat
              direction="下行"
              totalLabel="入站"
              rate={downRate}
              total={formatBytes(node.trafficDown)}
              samples={trafficTrend.down}
              live={isOnline}
              redrawKey={resolvedAppearance}
              color="var(--status-success)"
              icon={<ArrowDown size={15} strokeWidth={2.4} />}
            />
          </div>
        </div>
      </div>
    </article>
  );
});

function TrafficStat({
  direction,
  totalLabel,
  rate,
  total,
  samples,
  live,
  redrawKey,
  color,
  icon,
}: {
  direction: "下行" | "上行";
  totalLabel: "入站" | "出站";
  rate: TrafficRateDisplay;
  total: string;
  samples: TrafficTrendSample[];
  live: boolean;
  redrawKey: string;
  color: string;
  icon: ReactNode;
}) {
  return (
    <div className="traffic-stat">
      <div className="traffic-stat-head">
        <div className="traffic-stat-label" style={{ color }}>
          {icon}
          <span>{direction}</span>
        </div>
        <span className="traffic-stat-value tabular" style={{ color }}>
          {rate.value}
          <span className="traffic-stat-unit">{rate.unit}</span>
        </span>
      </div>
      <div className="traffic-stat-trend" aria-hidden>
        <TrafficTrendStrip samples={samples} color={color} redrawKey={redrawKey} />
        <span className="traffic-stat-live" data-live={live ? "true" : "false"}>
          <span
            className="traffic-stat-live-dot"
            style={{
              background: color,
            }}
          />
          <span>{live ? (rate.bitsPerSec > 0 ? "实时" : "空闲") : "离线"}</span>
        </span>
      </div>
      <div className="traffic-stat-foot">
        <div className="traffic-stat-total-label">
          <GlobeArrow direction={totalLabel} color={color} />
          <span>{totalLabel}</span>
        </div>
        <span className="tabular">{total}</span>
      </div>
    </div>
  );
}

/**
 * 最近若干次采样的迷你柱：一条 8px 高的细带，柱高就是那次采样的流量档位。
 * 原来是一排圆点（半径编码档位），占掉一整行；压成细带后这一行并进了速率那一行下面。
 */
function TrafficTrendStrip({
  samples,
  color,
  redrawKey,
}: {
  samples: TrafficTrendSample[];
  color: string;
  redrawKey: string;
}) {
  // useCallback 固定 draw 身份，避免卡片重渲染时重绘画布。
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      if (samples.length === 0) return;
      const slotWidth = width / samples.length;
      const barWidth = Math.max(1, Math.min(3, slotWidth - 1));
      const baseColor = resolveCssColor(color);
      const inactiveColor = resolveCssColor("var(--progress-bg)");

      samples.forEach((sample, index) => {
        const hasTraffic = sample.value > 0;
        const barHeight = hasTraffic ? 2 + sample.level * (height - 2) : 1.5;
        const x = index * slotWidth + (slotWidth - barWidth) / 2;
        ctx.globalAlpha = hasTraffic ? Math.min(1, sample.opacity + 0.05) : 0.5;
        ctx.fillStyle = hasTraffic ? baseColor : inactiveColor;
        fillRoundedRect(ctx, x, height - barHeight, barWidth, barHeight, barWidth / 2);
      });

      ctx.globalAlpha = 1;
    },
    [color, samples],
  );

  return (
    <CanvasStrip
      className="traffic-trend-strip"
      height={8}
      ariaHidden
      redrawKey={redrawKey}
      draw={draw}
    />
  );
}

function GlobeArrow({
  direction,
  color,
}: {
  direction: "入站" | "出站";
  color: string;
}) {
  const isInbound = direction === "入站";
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{
        width: 18,
        height: 18,
        color,
      }}
      aria-hidden
    >
      <Globe size={15} strokeWidth={1.9} />
      {isInbound ? (
        <ArrowDown
          size={9}
          strokeWidth={2.4}
          className="absolute -right-[2px] bottom-[-1px]"
        />
      ) : (
        <ArrowUp
          size={9}
          strokeWidth={2.4}
          className="absolute -right-[2px] bottom-[-1px]"
        />
      )}
    </span>
  );
}

