import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// 两个测试 project：
//  - frontend: React 组件/页面，jsdom 环境
//  - sidecar:  Node 运行时脚本（node:sqlite / child_process 等），node 环境，
//              不走浏览器 bundling，避免 "Cannot bundle Node.js built-in node:sqlite"
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [tsconfigPaths(), react()],
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "sidecar",
          environment: "node",
          include: ["sidecar/**/*.test.mjs"],
        },
      },
    ],
  },
});
