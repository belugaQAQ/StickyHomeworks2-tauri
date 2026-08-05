import { invoke, isTauri } from "@tauri-apps/api/core";
import { getTauriVersion } from "@tauri-apps/api/app";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import type { AppData } from "../types/app-data";
import { createRequestId, getBrowserLogEntries } from "./logging";

export type DiagnosticEnvironment = {
  appVersion: string;
  operatingSystem: string;
  tauriRuntime: string;
  webView: string;
  viewport: string;
  schemaVersion: number;
};

export async function buildDiagnosticReport(appData: AppData): Promise<string> {
  const environment = await collectDiagnosticEnvironment(appData);
  const requestId = createRequestId("diagnostic-report.build");
  if (isTauri()) {
    return invoke<string>("diagnostic_report", { environment, requestId });
  }
  return [formatEnvironment(environment), formatBrowserLogReport()].join("\n");
}

export async function copyDiagnosticReport(report: string): Promise<void> {
  if (isTauri()) await writeText(report);
  else await navigator.clipboard.writeText(report);
}

export async function exportDiagnosticBundle(appData: AppData): Promise<boolean> {
  const requestId = createRequestId("diagnostic-bundle.export");
  const environment = await collectDiagnosticEnvironment(appData);
  if (!isTauri()) {
    const report = [formatEnvironment(environment), formatBrowserLogReport()].join("\n");
    const bundle = { exportedAt: new Date().toISOString(), runtime: "browser-preview", appData, report, logs: getBrowserLogEntries() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "stickyhomeworks2-diagnostics.json";
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }

  const destination = await save({ title: "导出诊断信息", defaultPath: "stickyhomeworks2-diagnostics.zip", filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }] });
  if (!destination) return false;
  await invoke("export_diagnostic_bundle_to_path", { destination, environment, requestId });
  return true;
}

async function collectDiagnosticEnvironment(appData: AppData): Promise<DiagnosticEnvironment> {
  return {
    appVersion: "0.1.0",
    operatingSystem: navigator.platform || "unknown",
    tauriRuntime: isTauri() ? await getTauriVersion() : "不适用",
    webView: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    schemaVersion: appData.schemaVersion,
  };
}

function formatEnvironment(environment: DiagnosticEnvironment): string {
  return [
    "StickyHomeworks2 诊断信息",
    `应用版本：${environment.appVersion}`,
    `操作系统：${environment.operatingSystem}`,
    `Tauri 运行时：${environment.tauriRuntime}`,
    `WebView 运行时：${environment.webView}`,
    `视口：${environment.viewport}`,
    `schemaVersion：${environment.schemaVersion}`,
  ].join("\n");
}

function formatBrowserLogReport(): string {
  const entries = getBrowserLogEntries();
  if (entries.length === 0) return "浏览器预览日志：暂无记录（仅保存在当前页面内存）";
  return ["浏览器预览日志（仅保存在当前页面内存，刷新后清空）：", ...entries.map((entry) => JSON.stringify(entry))].join("\n");
}
