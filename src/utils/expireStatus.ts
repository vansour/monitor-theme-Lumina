const EXPIRE_FULL_DAYS = 180;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toHsl(h: number, s: number, l: number) {
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

function expireHeatColor(daysRemaining: number): string {
  if (daysRemaining > 36500) {
    return "var(--status-success)";
  }

  if (daysRemaining <= 0) {
    return toHsl(6, 84, 53);
  }

  if (daysRemaining <= 7) {
    const t = clamp(daysRemaining / 7, 0, 1);
    return toHsl(8 + 24 * t, 84 - 4 * t, 53 - 1 * t);
  }

  if (daysRemaining <= 30) {
    const t = clamp((daysRemaining - 7) / 23, 0, 1);
    return toHsl(32 + 18 * t, 80 - 4 * t, 52);
  }

  const t = clamp((Math.min(daysRemaining, EXPIRE_FULL_DAYS) - 30) / (EXPIRE_FULL_DAYS - 30), 0, 1);
  return toHsl(50 + 94 * t, 76 - 10 * t, 52 - 4 * t);
}

/** 取的是剩余天数而不是日期 —— hub 按自己的日历算，见 `formatExpireDays`。 */
export function getExpireTextColor(daysRemaining: number | null | undefined): string {
  if (daysRemaining == null || !Number.isFinite(daysRemaining)) return "var(--text-tertiary)";
  return expireHeatColor(daysRemaining);
}
