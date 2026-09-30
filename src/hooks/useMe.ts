import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/api";
import type { Me } from "@/types/monitor";

/**
 * 站点名、登录状态、公开页开关。永远匿名可读，公开页关着时也照答，
 * 所以它同时也是「现在该不该把人送去后台」的依据。
 *
 * 不做缓存（`staleTime: 0`，每次挂载都重取）：公开页的开关状态会变，
 * 而顶栏的链接指哪儿全看它。
 */
export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
