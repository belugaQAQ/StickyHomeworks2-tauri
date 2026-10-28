#!/usr/bin/env node
/**
 * `pnpm tauri <args>` 的包装。
 *
 * 本机（VS 2026 / MSVC 14.51）的 lib.exe 与 cl.exe 会在系统 %TEMP% 里写
 * lnk{GUID}.tmp 和调试记录，而这个目录在本机写不进去，于是编译报：
 *   LINK : fatal error LNK1104: 无法打开文件 "...\Temp\lnk{...}.tmp"
 *   cl: 命令行 error D8050 :无法执行 c1.dll：未能将命令行放入调试记录中
 * 这里把子进程的临时目录换到项目内（构建产物之外），绕开这个问题；
 * 其他平台上 TMP/TEMP 指向项目内也无害。
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tempDir = fileURLToPath(new URL("../.cargo-tmp", import.meta.url));
const cliEntry = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
mkdirSync(tempDir, { recursive: true });

// 直接用 node 跑 CLI 入口、参数走数组：不经 shell，路径里有空格或特殊字符也不会被拆开。
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
