import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tempDir = fileURLToPath(new URL("../.cargo-tmp", import.meta.url));
const cliEntry = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
mkdirSync(tempDir, { recursive: true });

const child = spawn(process.execPath, [cliEntry, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
  },
});

child.on("error", (error) => {
  console.error(`无法启动 Tauri CLI：${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
