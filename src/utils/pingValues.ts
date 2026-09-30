/**
 * 样本值的约定：非负是延迟毫秒数，负值是「这个桶整个超时」。
 *
 * hub 的原生表达是 `latency: null` 加一个单独的 `loss` 百分比；适配层把 null 收敛成
 * 负值，于是分桶、着色、图表断口这些下游逻辑都不用关心两种表达的区别。
 * 见 `usePingMini` 里的 `itemFromResponse`。
 */
export function isValidPingLatency(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

export function isLostPingSample(v: number | null | undefined): boolean {
  return typeof v === "number" && Number.isFinite(v) && v < 0;
}
