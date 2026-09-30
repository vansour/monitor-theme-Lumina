import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 三个第三方包各切一块：主题更新时变的多半只有应用代码，
// 那几块的哈希不变，浏览器就不用重新下载。
//
// 必须写成函数：vite 8 换了打包器，对象形式的 manualChunks 不再被接受。
function manualChunks(id: string) {
  if (!id.includes("node_modules")) return undefined;
  if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
    return "react-vendor";
  }
  if (/node_modules\/(uplot|uplot-react)\//.test(id)) return "uplot";
  if (id.includes("node_modules/@tanstack/react-query")) return "query";
  return undefined;
}

// https://vite.dev/config/
export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // import.meta.dirname 而不是 new URL(...).pathname：后者会做 URL 编码，
      // 检出路径里有空格或非 ASCII 字符时会解析成 %20，别名就悄悄指歪了。
      "@": `${import.meta.dirname}/src`,
    },
  },
  build: {
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/entry-[name]-[hash].js",
        chunkFileNames: "assets/chunk-[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks,
      },
    },
  },
  // 主题只读公开数据，所以任何一个开着状态页的 hub 都能当数据源：
  // MONITOR_HUB=https://hub.example.com npm run dev
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.MONITOR_HUB || "http://127.0.0.1:9911",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
