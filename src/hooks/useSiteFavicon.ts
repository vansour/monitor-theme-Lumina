import { useEffect } from "react";
import { useThemeConfig } from "@/hooks/useThemeConfig";

/** 没上传过图标时用的默认值，与 index.html 里那条 link 一致。 */
const DEFAULT_ICON_HREF = "/favicon.ico";

/**
 * 把站长上传的站点图标（hub 主题设置里的 `favicon`）挂到 `<link rel="icon">` 上。
 *
 * 有就换成 data URL，没有就恢复 index.html 里的默认值 —— 改的是同一只 link，
 * DOM 里从始至终只有一条，不会留下互相覆盖的多条记录。图标是文档级的，
 * 与路由无关，所以由 `AppShell` 挂一次。
 */
export function useSiteFavicon(): void {
  const favicon = useThemeConfig().data?.favicon || null;

  useEffect(() => {
    ensureIconLink().href = favicon ?? DEFAULT_ICON_HREF;
  }, [favicon]);
}

/** index.html 里就有一条；万一没有（独立使用时）补一条，反正属性都在这里。 */
function ensureIconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (existing) return existing;
  const link = document.createElement("link");
  link.rel = "icon";
  document.head.append(link);
  return link;
}
