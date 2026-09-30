import { useQuery } from "@tanstack/react-query";
import { loadConfig, type Config } from "@/lib/config";

/**
 * 站长在后台「主题」页调过的设置。
 *
 * `loadConfig` 自己吞掉所有失败并回落到默认值，所以这个 query 不会 reject。
 * 与 `/api/me`、`/api/nodes` 并行发起，不排在它们后面。
 */
export function useThemeConfig() {
  return useQuery<Config>({
    queryKey: ["theme-config"],
    queryFn: loadConfig,
    staleTime: 60_000,
  });
}
