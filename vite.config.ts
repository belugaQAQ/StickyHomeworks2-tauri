import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process is a nodejs global
const nodeProcess: { platform: string; env: Record<string, string | undefined> } = process;
// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

if (nodeProcess.platform === "win32") {
  const esbuildTempDir = fileURLToPath(new URL("./node_modules/.cache/esbuild-tmp", import.meta.url));
  mkdirSync(esbuildTempDir, { recursive: true });
  nodeProcess.env.TMPDIR = esbuildTempDir;
  nodeProcess.env.TMP = esbuildTempDir;
  nodeProcess.env.TEMP = esbuildTempDir;
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith("m3e-"),
        },
      },
    }),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
