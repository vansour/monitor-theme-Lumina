export type TimedMetricPoint = {
  time: number;
  [key: string]: number | null;
};

function hasPointNearTime(times: number[], target: number, tolerance: number) {
  let low = 0;
  let high = times.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = times[mid];
    if (Math.abs(value - target) <= tolerance) {
      return true;
    }
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return false;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function normalizePoints(points: TimedMetricPoint[]) {
  if (points.length === 0) {
    return { points: [] as TimedMetricPoint[], keys: [] as string[] };
  }

  const keys = Array.from(
    points.reduce((set, point) => {
      Object.keys(point).forEach((key) => {
        if (key !== "time") set.add(key);
      });
      return set;
    }, new Set<string>()),
  );

  const base = Object.fromEntries(keys.map((key) => [key, null] as const));
  const deduped = new Map<number, TimedMetricPoint>();

  for (const point of [...points].sort((a, b) => a.time - b.time)) {
    deduped.set(point.time, {
      ...base,
      ...point,
    });
  }

  return {
    points: [...deduped.values()].sort((a, b) => a.time - b.time),
    keys,
  };
}

/** 一串时间戳里最常见的间距，单位是**秒** —— 调用方的 x 轴走 `toChartSeconds`。 */
export function detectTypicalIntervalSeconds(times: number[], fallback = 60) {
  if (times.length < 2) return fallback;
  const unique = Array.from(new Set(times)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < unique.length; index += 1) {
    const gap = unique[index] - unique[index - 1];
    if (gap > 0) gaps.push(gap);
  }
  return gaps.length > 0 ? median(gaps) : fallback;
}

export function fillMissingMetricPoints(
  points: TimedMetricPoint[],
  options?: {
    intervalSeconds?: number;
    matchToleranceSeconds?: number;
  },
) {
  const normalized = normalizePoints(points);
  if (normalized.points.length < 2) return normalized.points;

  const { points: sortedPoints, keys } = normalized;
  const intervalSeconds =
    options?.intervalSeconds ?? detectTypicalIntervalSeconds(sortedPoints.map((point) => point.time));
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    return sortedPoints;
  }

  const matchToleranceSeconds = options?.matchToleranceSeconds ?? intervalSeconds / 2;
  const base = Object.fromEntries(keys.map((key) => [key, null] as const));
  const filled: TimedMetricPoint[] = [];
  const start = sortedPoints[0].time;
  const end = sortedPoints[sortedPoints.length - 1].time;
  let pointer = 0;

  for (let current = start; current <= end; current += intervalSeconds) {
    while (
      pointer < sortedPoints.length &&
      sortedPoints[pointer].time < current - matchToleranceSeconds
    ) {
      pointer += 1;
    }

    const matched =
      pointer < sortedPoints.length &&
      Math.abs(sortedPoints[pointer].time - current) <= matchToleranceSeconds
        ? sortedPoints[pointer]
        : null;

    filled.push(
      matched
        ? { ...base, ...matched, time: current }
        : { ...base, time: current },
    );

    if (matched) {
      pointer += 1;
    }
  }

  return filled;
}

export function insertMetricGapSentinels(
  points: TimedMetricPoint[],
  options?: {
    intervals?: Map<string, number>;
    defaultInterval?: number;
    matchToleranceRatio?: number;
  },
) {
  const normalized = normalizePoints(points);
  if (normalized.points.length < 2 || normalized.keys.length === 0) {
    return normalized.points;
  }

  const { points: sortedPoints, keys } = normalized;
  const existingTimes = sortedPoints.map((point) => point.time);
  const intervals = options?.intervals ?? new Map<string, number>();
  const defaultInterval =
    options?.defaultInterval ?? detectTypicalIntervalSeconds(existingTimes);
  const toleranceRatio = options?.matchToleranceRatio ?? 0.25;
  const sentinels = new Map<number, TimedMetricPoint>();

  for (const key of keys) {
    const validTimes = sortedPoints
      .filter((point) => typeof point[key] === "number" && Number.isFinite(point[key]))
      .map((point) => point.time);
    if (validTimes.length < 2) continue;

    // intervals 传进来的必须是数据的**实际**采样间隔，而不是任务配置的 interval：
    // 服务端降采样后聚合点的间距可能远大于配置值，按配置值判断会把每两个相邻点
    // 之间都当成断档。调用方负责把降采样栅格算进去（见 getMetricPingRecords）；
    // 这里只在完全没有信息时才退回按有效点自行推断。
    const effectiveInterval = intervals.get(key);
    const interval =
      typeof effectiveInterval === "number" && effectiveInterval > 0
        ? effectiveInterval
        : detectTypicalIntervalSeconds(validTimes, defaultInterval);
    if (!Number.isFinite(interval) || interval <= 0) continue;

    const tolerance = Math.max(1, interval * toleranceRatio);
    for (let index = 1; index < validTimes.length; index += 1) {
      const previous = validTimes[index - 1];
      const current = validTimes[index];
      if (current - previous <= interval + tolerance) continue;

      for (let expected = previous + interval; expected < current - tolerance; expected += interval) {
        if (hasPointNearTime(existingTimes, expected, tolerance) || sentinels.has(expected)) {
          continue;
        }
        sentinels.set(expected, { time: expected });
      }
    }
  }

  if (sentinels.size === 0) {
    return sortedPoints;
  }

  return normalizePoints([...sortedPoints, ...sentinels.values()]).points;
}

export function interpolateMetricGaps(
  points: TimedMetricPoint[],
  keys: string[],
  options?: {
    /** 单位是秒，与 x 轴的刻度一致（见 `toChartSeconds`）。 */
    maxGap?: number;
    maxGapMultiplier?: number;
    /** 上下限也按典型间距的倍数给，理由见下。 */
    minCapMultiplier?: number;
    maxCapMultiplier?: number;
  },
) {
  if (points.length < 3 || keys.length === 0) return points;

  const out = points.map((point) => ({ ...point }));
  const times = out.map((point) => point.time);
  const multiplier = options?.maxGapMultiplier ?? 6;
  // 上下限原本是两个绝对秒数（120 与 1800）。对同样画在一张图上的两段窗口，那会让
  // 「多大的洞算断档」随缩放级别变：60 秒的栅格上三格算断档，1800 秒的栅格上一格都
  // 不算。改成典型间距的倍数，判定就与缩放无关了。
  const minCapMultiplier = options?.minCapMultiplier ?? 1.5;
  const maxCapMultiplier = options?.maxCapMultiplier ?? 12;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  for (const key of keys) {
    const validIndices: number[] = [];
    for (let index = 0; index < out.length; index += 1) {
      const value = out[index][key];
      if (typeof value === "number" && Number.isFinite(value)) {
        validIndices.push(index);
      }
    }
    if (validIndices.length < 2) continue;

    let maxGap = options?.maxGap;
    if (maxGap == null) {
      const gaps: number[] = [];
      for (let index = 1; index < validIndices.length; index += 1) {
        const gap = times[validIndices[index]] - times[validIndices[index - 1]];
        if (gap > 0) gaps.push(gap);
      }
      if (gaps.length === 0) continue;
      const typical = median(gaps);
      maxGap = clamp(typical * multiplier, typical * minCapMultiplier, typical * maxCapMultiplier);
    }

    for (let index = 0; index < validIndices.length - 1; index += 1) {
      const startIndex = validIndices[index];
      const endIndex = validIndices[index + 1];
      if (endIndex - startIndex <= 1) continue;

      const startTime = times[startIndex];
      const endTime = times[endIndex];
      const totalGap = endTime - startTime;
      if (!Number.isFinite(totalGap) || totalGap <= 0 || totalGap > maxGap) {
        continue;
      }

      const startValue = out[startIndex][key] as number;
      const endValue = out[endIndex][key] as number;
      for (let gapIndex = startIndex + 1; gapIndex < endIndex; gapIndex += 1) {
        const ratio = (times[gapIndex] - startTime) / totalGap;
        out[gapIndex][key] = startValue + (endValue - startValue) * ratio;
      }
    }
  }

  return out;
}

export function cutPeakValues<T extends { [key: string]: any }>(
  data: T[],
  keys: string[],
  alpha = 0.1,
  windowSize = 15,
  spikeThreshold = 0.3,
) {
  if (!data || data.length === 0 || keys.length === 0) return data;

  const result = data.map((point) => ({ ...point }));
  const halfWindow = Math.floor(windowSize / 2);

  for (const key of keys) {
    for (let index = 0; index < result.length; index += 1) {
      const currentValue = result[index][key];
      if (currentValue == null || typeof currentValue !== "number") continue;

      const neighbors: number[] = [];
      for (
        let pointer = Math.max(0, index - halfWindow);
        pointer <= Math.min(result.length - 1, index + halfWindow);
        pointer += 1
      ) {
        if (pointer === index) continue;
        const neighbor = result[pointer][key];
        if (neighbor != null && typeof neighbor === "number" && Number.isFinite(neighbor)) {
          neighbors.push(neighbor);
        }
      }

      if (neighbors.length < 2) continue;

      const mean = neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
      if (mean > 0) {
        const relativeChange = Math.abs(currentValue - mean) / mean;
        if (relativeChange > spikeThreshold) {
          result[index] = {
            ...result[index],
            [key]: null,
          };
        }
      } else if (Math.abs(currentValue) > 10) {
        result[index] = {
          ...result[index],
          [key]: null,
        };
      }
    }

    let ewma: number | null = null;
    for (let index = 0; index < result.length; index += 1) {
      const currentValue = result[index][key];
      if (currentValue != null && typeof currentValue === "number" && Number.isFinite(currentValue)) {
        ewma = ewma == null ? currentValue : alpha * currentValue + (1 - alpha) * ewma;
        result[index] = {
          ...result[index],
          [key]: ewma,
        };
      } else if (ewma != null) {
        result[index] = {
          ...result[index],
          [key]: ewma,
        };
      }
    }
  }

  return result;
}
