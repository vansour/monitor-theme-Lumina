import type { ReactNode } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, Cpu, Globe, Server } from "lucide-react";
import { useNodesOverview } from "@/hooks/useNode";
import { useThemeConfig } from "@/hooks/useThemeConfig";
import { formatBytes, formatTrafficRate } from "@/utils/format";

/** `formatBytes` 把数字和单位放在一串里，而这里要分开排版。 */
function splitBytes(text: string): [string, string] {
  const index = text.indexOf(" ");
  return index < 0 ? [text, ""] : [text.slice(0, index), text.slice(index + 1)];
}

/**
 * 首页网格上方的站点总览：节点状态、实时带宽、资源占用、本月流量。
 *
 * 四格而不是六格：CPU / 内存 / 磁盘 是同一类数，合成一张「资源」卡后，任何宽度下
 * 都排得满 —— 六格在 768–1279 之间是 3 列两行，三个百分比会被拆到两行去，而且每格
 * 四五百像素宽、内容只占左边一角。
 *
 * 数据全部来自 `useNodesOverview()` —— 它读的是每 2 秒推来的那一帧节点快照，
 * 这一块本身不发任何请求。口径（谁进分母、分子分母是不是同一批机器）写在
 * `src/utils/overview.ts` 里，这里只管画。
 */
export function HomeOverview() {
  const { data: config } = useThemeConfig();
  const overview = useNodesOverview();

  if (config?.show_overview === false) return null;
  // 一个公开节点都没有时空状态由下面的 NodeGrid 说，这里不抢话。
  // `total > 0` 也意味着第一帧已经到了，不必再去看 hasLoaded。
  if (overview.total === 0) return null;

  const down = formatTrafficRate(overview.netDown);
  const up = formatTrafficRate(overview.netUp);
  const hasQuota = overview.quotaLimit > 0;
  const [trafficValue, trafficUnit] = splitBytes(
    formatBytes(hasQuota ? overview.quotaUsed : overview.monthUsed),
  );
  const quotaPct = overview.quotaPct == null ? null : Math.round(overview.quotaPct);

  const nodeNoteParts = [
    overview.offline > 0 ? `${overview.offline} 台离线` : "",
    overview.pending > 0 ? `${overview.pending} 台同步中` : "",
  ].filter(Boolean);
  const nodeNote = nodeNoteParts.length > 0 ? nodeNoteParts.join(" · ") : "全部在线";
  // 小注窄屏会折行或省略号截断，所以每一格都把自己的全文挂在 title 上。
  const ramDetail =
    overview.ramPct == null
      ? undefined
      : `${formatBytes(overview.ramUsed)} / ${formatBytes(overview.ramTotal)}`;
  const diskDetail =
    overview.diskPct == null
      ? undefined
      : `${formatBytes(overview.diskUsed)} / ${formatBytes(overview.diskTotal)}`;
  const trafficNote = hasQuota ? `配额 ${formatBytes(overview.quotaLimit)} · 已用 ${quotaPct}%` : "未设配额";
  const trafficTitle = hasQuota
    ? `本计费周期：设了配额的 ${overview.quotaNodes} 台已用 ${formatBytes(overview.quotaUsed)} / ${formatBytes(overview.quotaLimit)}（${quotaPct}%）；全站 ${overview.total} 台合计 ${formatBytes(overview.monthUsed)}`
    : `本计费周期：全站 ${overview.total} 台合计 ${formatBytes(overview.monthUsed)}，没有节点设流量配额`;

  return (
    <section className="home-overview" aria-label="站点总览">
      <OverviewTile
        icon={<Server size={13} strokeWidth={2} />}
        label="节点"
        value={
          <>
            <span className="tabular">{overview.online}</span>
            <span className="home-overview-unit">/{overview.total}</span>
          </>
        }
        valueTitle={`在线 ${overview.online} 台，共 ${overview.total} 台`}
        note={nodeNote}
        noteTitle={nodeNote}
        noteAlert={overview.offline > 0}
      />

      <OverviewTile
        icon={<ArrowDownUp size={13} strokeWidth={2} />}
        label="实时带宽"
        value={
          <>
            <ArrowDown
              className="home-overview-direction"
              size={14}
              strokeWidth={2.4}
              style={{ color: "var(--status-success)" }}
            />
            <span className="tabular">{down.value}</span>
            <span className="home-overview-unit">{down.unit}</span>
          </>
        }
        valueTitle={`在线节点的实时速率合计：下行 ${down.value} ${down.unit}`}
        note={
          <>
            <ArrowUp
              className="home-overview-direction"
              size={11}
              strokeWidth={2.4}
              style={{ color: "var(--progress-cpu)" }}
            />
            {up.value} {up.unit}
          </>
        }
        noteTitle={`在线节点的实时速率合计：上行 ${up.value} ${up.unit}`}
      />

      <div className="home-overview-item">
        <div className="home-overview-label">
          <Cpu size={13} strokeWidth={2} />
          <span>资源</span>
        </div>
        <div className="home-overview-body">
          <ResourceRow
            label="CPU"
            pct={overview.cpuPct}
            color="var(--progress-cpu)"
            title="在线节点的平均 CPU 占用"
          />
          <ResourceRow
            label="内存"
            pct={overview.ramPct}
            color="var(--progress-memory)"
            detail={ramDetail}
            title="在线节点已用内存 ÷ 在线节点内存总量"
          />
          <ResourceRow
            label="磁盘"
            pct={overview.diskPct}
            color="var(--progress-disk)"
            detail={diskDetail}
            title="在线节点已用磁盘 ÷ 在线节点磁盘总量"
          />
        </div>
      </div>

      <OverviewTile
        icon={<Globe size={13} strokeWidth={2} />}
        label="本月流量"
        value={
          <>
            <span className="tabular">{trafficValue}</span>
            <span className="home-overview-unit">{trafficUnit}</span>
          </>
        }
        valueTitle={trafficTitle}
        note={trafficNote}
        noteTitle={trafficTitle}
        noteAlert={quotaPct != null && quotaPct >= 100}
      />
    </section>
  );
}

function percentValue(pct: number | null) {
  if (pct == null) return <span className="home-overview-empty">—</span>;
  return (
    <>
      <span className="tabular">{pct.toFixed(1)}</span>
      <span className="home-overview-unit">%</span>
    </>
  );
}

/** 「资源」格里的一行：名称、进度条、百分比，右边再挂一行明细（窄屏让位给前三个）。 */
function ResourceRow({
  label,
  pct,
  color,
  detail,
  title,
}: {
  label: string;
  pct: number | null;
  color: string;
  detail?: string;
  title: string;
}) {
  const width = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div className="home-overview-row home-overview-metric-row" title={title}>
      <span className="home-overview-metric-label">{label}</span>
      <span className="home-overview-bar" aria-hidden>
        <span
          className="home-overview-bar-fill"
          style={{ width: `${width}%`, background: color }}
        />
      </span>
      <span className="home-overview-metric-value">{percentValue(pct)}</span>
      {detail ? <span className="home-overview-detail">{detail}</span> : null}
    </div>
  );
}

function OverviewTile({
  icon,
  label,
  value,
  valueTitle,
  note,
  noteTitle,
  noteAlert = false,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  valueTitle?: string;
  note: ReactNode;
  noteTitle?: string;
  noteAlert?: boolean;
}) {
  return (
    <div className="home-overview-item">
      <div className="home-overview-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="home-overview-body">
        <div className="home-overview-row">
          <span className="home-overview-value" title={valueTitle}>
            {value}
          </span>
          <span
            className="home-overview-note"
            data-alert={noteAlert ? "true" : undefined}
            title={noteTitle}
          >
            {note}
          </span>
        </div>
      </div>
    </div>
  );
}
