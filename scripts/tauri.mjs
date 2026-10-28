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
mkdirSync(tempDir, { recursive: true });

// pnpm run 会把 node_modules/.bin 放进 PATH，这里直接按名字调，参数都是简单词，拼成一条命令即可。
const command = ["tauri", ...process.argv.slice(2)].join(" ");
const child = spawn(command, {
  cwd: projectRoot,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
