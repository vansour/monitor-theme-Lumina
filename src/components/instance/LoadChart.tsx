import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { Cpu, HardDrive, MemoryStick, Network } from "lucide-react";
import { useNodeMetrics } from "@/hooks/useMetrics";
import { useNode } from "@/hooks/useNode";
import { InstancePanel } from "./InstancePanel";
import {
  createAxisSizer,
  createTimeAxisValues,
  decimalsForIncrement,
  formatChartCoverageRange,
  formatCursorTime,
  formatRangeSummary,
  getChartTooltipPosition,
  toChartSeconds,
  useChartSize,
} from "./chartShared";
import {
  fillMissingMetricPoints,
  interpolateMetricGaps,
} from "./chartData";
import { formatBytes, formatTrafficRateLabel } from "@/utils/format";
import { useResolvedAppearance } from "@/hooks/usePreferences";

const CHART_COLORS = {
  cpu: "#5d88ff",
  memory: "#a35cf5",
  disk: "#f1873d",
  success: "#61c08f",
} as const;

const LOAD_HISTORY_SAMPLE_LIMIT = 360;
const LOAD_HISTORY_RENDER_LIMIT = 720;
const REALTIME_HISTORY_SEED_LIMIT = 120;
const REALTIME_SAMPLE_LIMIT = 600;
/** 请求点数：1440 是 hub 的上限，也是能拿到的最细栅格。 */
const LOAD_POINTS = 1440;

/**
 * 只有这四样有历史 —— hub 的 `metric` 表就存了 CPU、内存、磁盘、网速，
 * Swap、负载均值、进程数、连接数都是只有实时值、不落盘的。详情页不再画那四张图。
 */
const CPU_KEYS = ["cpu"];
const CPU_COLORS = [CHART_COLORS.cpu];
const MEMORY_KEYS = ["ram"];
const MEMORY_COLORS = [CHART_COLORS.memory];
const DISK_KEYS = ["disk"];
const DISK_COLORS = [CHART_COLORS.disk];
/**
 * `netInMax`/`netOutMax` 是 hub 在桶内取的峰值网速（agent 每个上报间隔测一次），
 * 均值线下面那条淡带。旧版 hub 没有这两个字段时值为 0，画带子前会先判一下。
 */
const NETWORK_KEYS = ["netIn", "netOut", "netInMax", "netOutMax"];
const NETWORK_COLORS = [CHART_COLORS.success, CHART_COLORS.cpu, CHART_COLORS.success, CHART_COLORS.cpu];
const SERIES_LABELS: Record<string, string> = {
  cpu: "CPU",
  ram: "内存",
  disk: "磁盘",
  netIn: "下行",
  netOut: "上行",
  netInMax: "下行峰值",
  netOutMax: "上行峰值",
};
const LOAD_INTERPOLATE_KEYS = ["cpu", "ram", "disk", "netIn", "netOut"];

interface ChartPoint {
  time: number;
  [key: string]: number | null;
}

interface TooltipState {
  show: boolean;
  left: number;
  top: number;
  rows: Array<{ label: string; value: string; color: string }>;
  time: string;
}

const HIDDEN_TOOLTIP: TooltipState = {
  show: false,
  left: 0,
  top: 0,
  rows: [],
  time: "",
};

function metricData(points: ChartPoint[], keys: string[]): uPlot.AlignedData {
  const times = points.map((point) => point.time);
  return [times, ...keys.map((key) => points.map((point) => point[key] ?? null))] as uPlot.AlignedData;
}

function getHistoryRenderLimit(hours: number) {
  if (hours <= 4) return LOAD_HISTORY_SAMPLE_LIMIT;
  return LOAD_HISTORY_RENDER_LIMIT;
}

function downsamplePoints(points: ChartPoint[], limit: number) {
  if (points.length <= limit || limit < 2) return points;

  const result: ChartPoint[] = [];
  const lastIndex = points.length - 1;
  const step = lastIndex / (limit - 1);
  let previousIndex = -1;

  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.min(lastIndex, Math.round(index * step));
    if (sourceIndex === previousIndex) continue;
    result.push(points[sourceIndex]);
    previousIndex = sourceIndex;
  }

  return result;
}

function getSeriesLabel(key: string) {
  return SERIES_LABELS[key] ?? key;
}

/** 实时档的一个点，直接取自 WebSocket 推来的那一帧。 */
function pointFromNode(node: NonNullable<ReturnType<typeof useNode>>): ChartPoint {
  return {
    time: Date.now() / 1000,
    cpu: node.cpuPct,
    ram: node.ramTotal > 0 ? (node.ramUsed / node.ramTotal) * 100 : 0,
    disk: node.diskTotal > 0 ? (node.diskUsed / node.diskTotal) * 100 : 0,
    netIn: node.netDown,
    netOut: node.netUp,
    netInMax: null,
    netOutMax: null,
  };
}

function formatTooltipValue(key: string, value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (key === "netIn" || key === "netOut" || key === "netInMax" || key === "netOutMax") {
    return formatTrafficRateLabel(value);
  }
  if (unit === "%") return `${value.toFixed(2)}%`;
  return value.toFixed(2);
}

function formatNetworkAxisValue(value: number) {
  if (!Number.isFinite(value)) return "";
  if (value <= 0) return "0";
  return formatTrafficRateLabel(value);
}

/**
 * 数值几乎恒定时 uPlot 会把噪声放大到小数点后好几位，
 * 这里给每类指标一个最小跨度，读数才有意义。
 */
function percentRange(minSpan: number): uPlot.Scale.Range {
  return (_self, dataMin, dataMax) => {
    let low = Math.max(0, Math.min(dataMin ?? 0, dataMax ?? 0));
    let high = Math.min(100, Math.max(dataMax ?? 0, low));
    const span = high - low;
    if (span < minSpan) {
      const center = (low + high) / 2;
      low = center - minSpan / 2;
      high = center + minSpan / 2;
      if (low < 0) {
        high -= low;
        low = 0;
      }
      if (high > 100) {
        low = Math.max(0, low - (high - 100));
        high = 100;
      }
    } else {
      const pad = span * 0.08;
      low = Math.max(0, low - pad);
      high = Math.min(100, high + pad);
    }
    return [low, high];
  };
}

function fromZeroRange(minTop: number): uPlot.Scale.Range {
  return (_self, _dataMin, dataMax) => {
    const top = Math.max(minTop, (dataMax ?? 0) * 1.15);
    return [0, top];
  };
}

function buildChartOptions({
  title,
  keys,
  colors,
  unit,
  height,
  width,
  resolvedAppearance,
  spanGaps,
  axisKind = "default",
  syncKey,
}: {
  title: string;
  keys: string[];
  colors: string[];
  unit: string;
  height: number;
  width: number;
  resolvedAppearance: "light" | "dark";
  spanGaps?: boolean;
  axisKind?: "default" | "percent" | "network";
  syncKey: string;
}): uPlot.Options {
  const isDark = resolvedAppearance === "dark";
  const grid = isDark ? "rgba(255,255,255,0.065)" : "rgba(0,0,0,0.08)";
  const text = isDark ? "#a5a5aa" : "#52525b";
  const yRange = axisKind === "percent" ? percentRange(0.5) : fromZeroRange(1);

  return {
    width,
    height,
    padding: [8, 16, 8, 2],
    cursor: {
      drag: { x: true, y: false },
      y: false,
      sync: { key: syncKey, scales: ["x", null] },
    },
    legend: { show: false },
    scales: { x: { time: true }, y: { auto: true, range: yRange } },
    axes: [
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid, size: 4 },
        gap: 4,
        size: 32,
        space: 62,
        values: createTimeAxisValues(),
      },
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid, size: 4 },
        gap: 5,
        size: createAxisSizer(34),
        values: (_self, splits, _axisIdx, _foundSpace, foundIncr) => {
          const decimals = decimalsForIncrement(foundIncr, axisKind === "percent" ? 2 : 3);
          return splits.map((value) => {
            if (axisKind === "network") return formatNetworkAxisValue(value);
            if (axisKind === "percent") return `${value.toFixed(decimals)}%`;
            return `${value.toFixed(decimals)}${unit}`;
          });
        },
      },
    ],
    series: [
      { label: "time" },
      ...keys.map((key, index) => {
        // 峰值那两条画成不发散的细线衬在均值下面，读的是包络而不是两条独立曲线。
        const peak = key.endsWith("Max");
        return {
          label: getSeriesLabel(key),
          stroke: colors[index] ?? colors[0],
          fill: index === 0 ? `${colors[index] ?? colors[0]}22` : undefined,
          width: peak ? 1 : 1.6,
          dash: peak ? [4, 3] : undefined,
          alpha: peak ? 0.5 : 1,
          spanGaps: spanGaps ?? false,
          points: { show: false },
        };
      }),
    ],
    hooks: {
      init: [
        (u) => {
          u.root.setAttribute("aria-label", title);
        },
      ],
    },
  };
}

const ChartCard = memo(function ChartCard({
  icon,
  title,
  value,
  note,
  points,
  keys,
  colors,
  resolvedAppearance,
  unit = "",
  spanGaps,
  axisKind,
  syncKey,
}: {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  note?: ReactNode;
  points: ChartPoint[];
  keys: string[];
  colors: string[];
  resolvedAppearance: "light" | "dark";
  unit?: string;
  spanGaps?: boolean;
  axisKind?: "default" | "percent" | "network";
  syncKey: string;
}) {
  const dataRef = useRef<uPlot.AlignedData>([[]]);
  const hoveredRef = useRef(false);
  const { ref: wrapRef, w, h } = useChartSize<HTMLDivElement>("grid");
  const [tooltip, setTooltip] = useState<TooltipState>(HIDDEN_TOOLTIP);
  const data = useMemo(() => metricData(points, keys), [points, keys]);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const options = useMemo(
    () =>
      buildChartOptions({
        title,
        keys,
        colors,
        unit,
        height: h,
        width: w,
        resolvedAppearance,
        spanGaps,
        axisKind,
        syncKey,
      }),
    [axisKind, colors, h, keys, resolvedAppearance, spanGaps, syncKey, title, unit, w],
  );

  const hideTooltip = useCallback(() => {
    setTooltip((previous) => (previous.show ? HIDDEN_TOOLTIP : previous));
  }, []);

  const enhancedOptions = useMemo<uPlot.Options>(() => ({
    ...options,
    hooks: {
      ...options.hooks,
      setCursor: [
        (u) => {
          // 光标在多图之间同步，只有真正悬停的卡片才弹出气泡。
          if (!hoveredRef.current) {
            hideTooltip();
            return;
          }
          const idx = u.cursor.idx;
          if (idx == null || idx < 0) {
            hideTooltip();
            return;
          }
          const currentData = dataRef.current;
          const timestamp = currentData[0]?.[idx];
          if (typeof timestamp !== "number") {
            hideTooltip();
            return;
          }
          const rows = keys.map((key, keyIndex) => {
            const value = currentData[keyIndex + 1]?.[idx] as number | null | undefined;
            return {
              label: getSeriesLabel(key),
              value: formatTooltipValue(key, value, unit),
              color: colors[keyIndex] ?? colors[0],
            };
          });
          const bbox = u.root.getBoundingClientRect();
          const anchorX = u.valToPos(timestamp, "x");
          const anchorY = typeof u.cursor.top === "number" ? u.cursor.top : bbox.height * 0.5;
          const position = getChartTooltipPosition({
            containerWidth: bbox.width,
            containerHeight: bbox.height,
            anchorX,
            anchorY,
            rowCount: rows.length,
            estimatedWidth: 176,
          });
          setTooltip({
            show: true,
            left: position.left,
            top: position.top,
            rows,
            time: formatCursorTime(u, timestamp),
          });
        },
      ],
    },
  }), [colors, hideTooltip, keys, options, unit]);

  return (
    <div
      className="instance-chart-card"
      style={{ "--chart-accent": colors[0] } as CSSProperties}
    >
      <header className="instance-chart-card-head">
        <div className="instance-chart-card-heading">
          <div className="instance-panel-subhead">
            {icon}
            <span>{title}</span>
          </div>
          {keys.length > 1 && (
            <div className="instance-chart-legend">
              {keys.map((key, index) => (
                <span key={key} className="instance-chart-legend-item">
                  <span
                    className="instance-chart-legend-dot"
                    style={{ background: colors[index] ?? colors[0] }}
                  />
                  {getSeriesLabel(key)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="instance-series-stats">
          <span className="tabular">{value}</span>
          {note && <span className="tabular text-[var(--text-tertiary)]">{note}</span>}
        </div>
      </header>
      <div
        className="instance-uplot-wrap"
        ref={wrapRef}
        onMouseEnter={() => {
          hoveredRef.current = true;
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
          hideTooltip();
        }}
      >
        <UplotReact options={enhancedOptions} data={data} />
        {tooltip.show && (
          <div
            className="instance-chart-tooltip"
            style={{ left: tooltip.left, top: tooltip.top }}
          >
            <div className="instance-chart-tooltip-time">{tooltip.time}</div>
            {tooltip.rows.map((row) => (
              <div key={row.label} className="instance-chart-tooltip-row">
                <span className="instance-chart-tooltip-dot" style={{ background: row.color }} />
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
export function LoadChart({
  nodeId,
  hours,
  active = true,
}: {
  nodeId: number;
  hours: number;
  active?: boolean;
}) {
  // 「实时」档要从历史接上，所以即便实时也先取一小段历史做种子。
  const queryHours = hours === 0 ? 1 : hours;
  const { data, isLoading } = useNodeMetrics(nodeId, queryHours, LOAD_POINTS, "metrics", active);
  const isRealtime = hours === 0;
  const node = useNode(String(nodeId), active);
  // hub 的历史行只有 used，没有 total，百分比的分母取节点当前的容量。
  // 一台机器上这两个数基本不变。
  const ramTotalHint = node?.ramTotal || 0;
  const diskTotalHint = node?.diskTotal || 0;
  const resolvedAppearance = useResolvedAppearance();
  const [realtimePoints, setRealtimePoints] = useState<ChartPoint[]>([]);
  const [connectNulls, setConnectNulls] = useState(false);
  const syncKey = `lumina-load-${nodeId}`;

  useEffect(() => {
    if (!active || !isRealtime || !node) return;
    const point = pointFromNode(node);
    setRealtimePoints((prev) => {
      const last = prev[prev.length - 1];
      // WebSocket 两秒一推，同一秒内的重复帧不该各占一个点。
      if (last && Math.abs(last.time - point.time) < 1) return prev;
      return [...prev, point].slice(-REALTIME_SAMPLE_LIMIT);
    });
  }, [active, isRealtime, node]);

  useEffect(() => {
    setRealtimePoints([]);
  }, [hours, nodeId]);

  const historyPoints = useMemo<ChartPoint[]>(() => {
    const rows = [...(data?.metrics ?? [])];
    const toPercent = (used: number, total: number) => (total > 0 ? (used / total) * 100 : null);
    const rawPoints = rows
      .map((row) => {
        // 峰值只在它确实不低于均值时才算数：旧版 hub 的这一列默认 0，
        // 直接画会在均值线下面多出一条对不上的带子。
        const inMax = typeof row.net_rx_max === "number" && row.net_rx_max >= row.net_rx ? row.net_rx_max : null;
        const outMax = typeof row.net_tx_max === "number" && row.net_tx_max >= row.net_tx ? row.net_tx_max : null;
        return {
          time: toChartSeconds(row.ts),
          cpu: row.cpu,
          ram: toPercent(row.mem_used, ramTotalHint),
          disk: toPercent(row.disk_used, diskTotalHint),
          netIn: row.net_rx,
          netOut: row.net_tx,
          netInMax: inMax,
          netOutMax: outMax,
        };
      })
      .filter((point) => point.time > 0)
      .sort((a, b) => a.time - b.time);
    const sampled = downsamplePoints(rawPoints, getHistoryRenderLimit(hours));
    const filled = fillMissingMetricPoints(sampled);
    return interpolateMetricGaps(filled, LOAD_INTERPOLATE_KEYS);
  }, [data, diskTotalHint, hours, ramTotalHint]);

  const points = useMemo<ChartPoint[]>(() => {
    if (isRealtime) {
      const initial = historyPoints.slice(-REALTIME_HISTORY_SEED_LIMIT);
      const merged = [...initial, ...realtimePoints].sort((a, b) => a.time - b.time);
      const deduped = merged.filter((point, index, arr) => {
        const next = arr[index + 1];
        return !next || Math.abs(next.time - point.time) >= 1;
      });
      return deduped.slice(-REALTIME_SAMPLE_LIMIT);
    }
    return historyPoints;
  }, [historyPoints, isRealtime, realtimePoints]);

  /** 顶部那一行读最新一条**真实**记录，不用重采样补齐出来的空槽。 */
  const latest = useMemo(() => {
    const rows = data?.metrics ?? [];
    return rows.length > 0 ? rows[rows.length - 1]! : null;
  }, [data]);

  const live = isRealtime && node ? node : null;

  /** 网络那张卡的注脚想同时给出均值与峰值 —— 峰值是 hub 存了而 Komari 没有的信息。 */
  const netNote = useMemo(() => {
    if (!latest) return undefined;
    const inMax = latest.net_rx_max;
    const outMax = latest.net_tx_max;
    if (typeof inMax !== "number" || typeof outMax !== "number") return undefined;
    return `峰值 ↓ ${formatTrafficRateLabel(inMax)} · ↑ ${formatTrafficRateLabel(outMax)}`;
  }, [latest]);

  const rangeSummary = formatRangeSummary(hours);
  const sourceCount = data?.metrics.length ?? 0;
  const wasDownsampled = !isRealtime && sourceCount > getHistoryRenderLimit(hours);
  const sampleSummary = isRealtime
    ? `${points.length} 个点`
    : wasDownsampled
      ? `${points.length} / ${sourceCount} 个点`
      : `${points.length} 个点`;
  const coverageSummary = points.length
    ? formatChartCoverageRange(points[0]!.time, points[points.length - 1]!.time)
    : "—";

  if (isLoading) {
    return <section className="instance-panel instance-chart-skeleton" aria-busy />;
  }

  if (!points.length) {
    return (
      <InstancePanel title="负载图表">
        <div className="instance-empty">暂无负载历史数据</div>
      </InstancePanel>
    );
  }

  return (
    <InstancePanel
      title="负载图表"
      aside={<span className="instance-chart-range-chip">{rangeSummary}</span>}
      className="instance-chart-panel"
    >
      <div className="instance-chart-toolbar">
        <div className="instance-chart-meta" aria-label="图表数据范围">
          <span>
            覆盖 <strong>{coverageSummary}</strong>
          </span>
          <span>
            采样 <strong>{sampleSummary}</strong>
          </span>
          <span className="instance-chart-hint">框选缩放 · 双击还原</span>
        </div>
        <button
          type="button"
          className="instance-toggle-button instance-switch-button"
          data-active={connectNulls ? "true" : "false"}
          onClick={() => setConnectNulls((value) => !value)}
          aria-pressed={connectNulls}
          title="开启后断点两侧直接连线，关闭则保留数据缺口"
        >
          <span className="instance-switch-copy">断点连线</span>
          <span className="instance-switch-track" aria-hidden>
            <span className="instance-switch-thumb" />
          </span>
          <span className="instance-switch-state">{connectNulls ? "开启" : "关闭"}</span>
        </button>
      </div>
      <div className="instance-chart-grid">
        <ChartCard
          icon={<Cpu size={13} />}
          title="CPU"
          value={live ? `${live.cpuPct.toFixed(2)}%` : latest ? `${latest.cpu.toFixed(2)}%` : "—"}
          note="使用率"
          points={points}
          keys={CPU_KEYS}
          colors={CPU_COLORS}
          resolvedAppearance={resolvedAppearance}
          unit="%"
          spanGaps={connectNulls}
          axisKind="percent"
          syncKey={syncKey}
        />
        <ChartCard
          icon={<MemoryStick size={13} />}
          title="内存"
          value={
            live
              ? `${formatBytes(live.ramUsed)} / ${formatBytes(live.ramTotal)}`
              : latest
                ? `${formatBytes(latest.mem_used)} / ${formatBytes(ramTotalHint)}`
                : "—"
          }
          note="已用 / 总量"
          points={points}
          keys={MEMORY_KEYS}
          colors={MEMORY_COLORS}
          resolvedAppearance={resolvedAppearance}
          unit="%"
          spanGaps={connectNulls}
          axisKind="percent"
          syncKey={syncKey}
        />
        <ChartCard
          icon={<HardDrive size={13} />}
          title="磁盘"
          value={
            live
              ? `${formatBytes(live.diskUsed)} / ${formatBytes(live.diskTotal)}`
              : latest
                ? `${formatBytes(latest.disk_used)} / ${formatBytes(diskTotalHint)}`
                : "—"
          }
          note="已用 / 总量"
          points={points}
          keys={DISK_KEYS}
          colors={DISK_COLORS}
          resolvedAppearance={resolvedAppearance}
          unit="%"
          spanGaps={connectNulls}
          axisKind="percent"
          syncKey={syncKey}
        />
        <ChartCard
          icon={<Network size={13} />}
          title="网络"
          value={
            live
              ? `↓ ${formatTrafficRateLabel(live.netDown)} · ↑ ${formatTrafficRateLabel(live.netUp)}`
              : latest
                ? `↓ ${formatTrafficRateLabel(latest.net_rx)} · ↑ ${formatTrafficRateLabel(latest.net_tx)}`
                : "—"
          }
          note={netNote}
          points={points}
          keys={NETWORK_KEYS}
          colors={NETWORK_COLORS}
          resolvedAppearance={resolvedAppearance}
          unit=""
          spanGaps={connectNulls}
          axisKind="network"
          syncKey={syncKey}
        />
      </div>
    </InstancePanel>
  );
}
