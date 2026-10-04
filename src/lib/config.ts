import manifest from "../../theme.json";
import { api } from "@/lib/api";
import { isFaviconDataUrl } from "@/utils/favicon";

/** `theme.json` 里声明的一项设置。 */
type ConfigField = {
  key: string;
  type: "string" | "text" | "number" | "boolean" | "select";
  label?: string;
  help?: string;
  default: unknown;
  options?: { value: string; label?: string }[];
  min?: number;
  max?: number;
};

export type Config = {
  default_appearance: "system" | "light" | "dark";
  enable_admin_button: boolean;
  show_overview: boolean;
  group_nodes: boolean;
  offline_nodes_behind: boolean;
  show_ping_chart: boolean;
  /** select 的值是字符串，用的时候 `Number()` 一下。 */
  default_range_hours: string;
  /**
   * 站长在右上角菜单里上传的站点图标（data URL），空串是没传过、用 index.html 的默认。
   *
   * 唯一一项不在 `theme.json` 里的设置：hub 的表单没有文件类型，声明成 string 会在
   * 后台渲染出一个装着几十 KB base64 的输入框。代价是后台点「恢复默认」时它也会被
   * 清掉（那里会删掉表单不认识的键）。
   */
  favicon: string;
};

const fields = (manifest.config as ConfigField[]).filter((f) => f.type !== undefined && "key" in f);

const defaults = {
  ...Object.fromEntries(fields.map((f) => [f.key, f.default])),
  favicon: "",
} as Config;

/**
 * 存下来的值能不能被这一项接住。
 *
 * hub 保存时不校验 —— 它按 `theme.json` 画完表单就存了 —— 所以读的时候必须自己判：
 * 一个在旧版本主题下存的值会遇到新版本的读取方。类型不符就当作没设置过。
 */
function fits(field: ConfigField, value: unknown): boolean {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max)
      );
    case "select":
      return !!field.options?.some((option) => option.value === value);
    default:
      return typeof value === "string";
  }
}

/**
 * 站长改过的设置，其余走 `theme.json` 里声明的默认值。
 *
 * 任何失败 —— 还没装这个主题（404）、公开页关着（401）、网络不通 —— 都静默回落到
 * 默认值：设置读不到不该让整页打不开，也不该弹一个访客看不懂的错。
 */
export function loadConfig(): Promise<Config> {
  return api<Record<string, unknown>>(`/themes/${manifest.short}/config`)
    .then((saved) => {
      const picked: Record<string, unknown> = { ...defaults };
      for (const field of fields) {
        const value = saved?.[field.key];
        if (value !== undefined && fits(field, value)) picked[field.key] = value;
      }
      if (isFaviconDataUrl(saved?.favicon)) picked.favicon = saved.favicon;
      return picked as Config;
    })
    .catch(() => defaults);
}

/**
 * 存下来的那一份原始设置，未与默认值合并 —— 写入前先读回它，不能拿 `loadConfig`
 * 的结果去写：PUT 是整体替换，只合并过默认值的对象写回去等于把站长的改动抹平。
 *
 * 读失败按原样抛（不像 `loadConfig` 那样吞掉）：调用方要能因此放弃写入。
 */
export function loadRawConfig(): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>(`/themes/${manifest.short}/config`);
}

/**
 * 写入或清除站点图标（`null` 清除）。只有登录着后台的站长会走到这里 ——
 * 这个 PUT 在 hub 那边要管理员会话，失败时 `api` 会把 hub 给的理由抛出来。
 */
export async function saveFavicon(dataUrl: string | null): Promise<void> {
  if (dataUrl !== null && !isFaviconDataUrl(dataUrl)) {
    throw new Error("图标数据不是受支持的形状");
  }
  const saved = await loadRawConfig();
  if (dataUrl === null) delete saved.favicon;
  else saved.favicon = dataUrl;
  await api(`/themes/${manifest.short}/config`, {
    method: "PUT",
    body: JSON.stringify(saved),
  });
}
