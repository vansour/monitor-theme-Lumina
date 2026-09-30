import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useMe } from "@/hooks/useMe";
import { FloatingControls } from "./FloatingControls";

/**
 * 公开页被关掉之后，hub 会拒绝匿名请求并主动断开 WebSocket。
 * 页面如果什么都不做，会停在最后一次收到的节点列表上 —— 看上去一切正常，
 * 其实早就不更新了。这里把人送去后台，那里才有登录入口。
 *
 * `/api/me` 永远匿名可读（公开页关着时也照答），所以它是判断这件事的唯一依据。
 */
function useClosedPageRedirect() {
  const { data: me } = useMe();
  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/";
  }, [me]);
}

export function AppShell() {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  useClosedPageRedirect();

  // 站名用 hub 的，没拿到之前不写死。详情页会在它之后覆盖成「节点名 · 站名」，
  // 所以这里回到首页时也要重设一次，否则标题会留着上一台机器的名字。
  useEffect(() => {
    document.title = me?.site_name || "Monitor";
  }, [me?.site_name, pathname]);

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloatingControls />
      <main className="flex-1 px-3 pb-8 pt-5 sm:px-5 md:px-6 lg:px-8 lg:pt-6">
        <div className="mx-auto w-full max-w-[1720px]">
          <Outlet />
        </div>
      </main>
      <footer className="site-footer">
        <div className="site-footer-inner">Powered by monitor.</div>
      </footer>
    </div>
  );
}
