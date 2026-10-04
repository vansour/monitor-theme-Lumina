/**
 * 站点图标的编码与判定。纯函数，`favicon.test.ts` 盯着它们。
 *
 * 图标由站长在右上角菜单里上传（见 `FloatingControls`），转成 data URL 存进 hub 的
 * 主题设置 `favicon` 键，所有访客加载时应用。这个键刻意**不写进 `theme.json`**：
 * hub 的设置表单只有 string / text 几种类型，声明成 string 会在后台渲染出一个装着
 * 几十 KB base64 的输入框。
 */

/**
 * 单个图标文件的字节上限。
 *
 * hub 对 `/api/themes/{short}/config` 的 PUT 有 64 KiB 的请求体上限，data URL 的
 * base64 还要膨胀 4/3，32 KiB 的图标编出来约 43 KiB，剩下的留给同一份设置里的其它键。
 */
export const MAX_FAVICON_BYTES = 32 * 1024;

/** 写入与读取都用这一种形状：ICO 的 MIME 类型 + base64。 */
export const FAVICON_PREFIX = "data:image/x-icon;base64,";

/** 读取时的长度兜底：hub 的上限是 64 KiB，比这更长的值只可能来自被改过的库。 */
const MAX_FAVICON_CHARS = 64 * 1024;

/** ICO 的文件头：2 字节保留字段 0、2 字节类型 1（图标）。 */
export function looksLikeIco(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
}

/** 字节 → `data:image/x-icon;base64,…`；不是 ICO 时返回 null，让调用方把理由说清楚。 */
export function icoToDataUrl(bytes: Uint8Array): string | null {
  if (!looksLikeIco(bytes)) return null;
  let binary = "";
  // 逐字节拼、不用 String.fromCharCode(...bytes)：上限 32 KiB 的展开会撞上
  // 各引擎的参数个数限制。
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${FAVICON_PREFIX}${btoa(binary)}`;
}

/** 设置里存下来的值能不能当图标用。不是这个形状一律当作没设置过。 */
export function isFaviconDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_FAVICON_CHARS &&
    value.startsWith(FAVICON_PREFIX)
  );
}
