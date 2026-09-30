import { createBrowserRouter, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Spinner } from "@/components/ui/Spinner";

const Home = lazy(() => import("@/pages/Home").then((m) => ({ default: m.Home })));
const Instance = lazy(() =>
  import("@/pages/Instance").then((m) => ({ default: m.Instance })),
);
const NotFound = lazy(() =>
  import("@/pages/NotFound").then((m) => ({ default: m.NotFound })),
);

function Loading() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<Loading />}>
            <Home />
          </Suspense>
        ),
      },
      {
        // 这个前缀在 README 里列出来了：按路径做白名单的反代或 WAF 要放行它，
        // 否则从列表点进去正常（只是 pushState），刷新详情页却会被拦。
        path: "instance/:id",
        element: (
          <Suspense fallback={<Loading />}>
            <Instance />
          </Suspense>
        ),
      },
      {
        path: "404",
        element: (
          <Suspense fallback={<Loading />}>
            <NotFound />
          </Suspense>
        ),
      },
      { path: "*", element: <Navigate to="/404" replace /> },
    ],
  },
]);
