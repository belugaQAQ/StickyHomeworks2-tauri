import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion, getTauriVersion } from "@tauri-apps/api/app";
import packageJson from "../../package.json";
import type { AppData } from "../types/app-data";
import { createRequestId, getBrowserLogEntries, type LogEntry } from "./logging";

export type DiagnosticDisclosure = "standard" | "extended" | "full";

export type DiagnosticEnvironment = {
  appVersion: string;
  operatingSystem: string;
  tauriRuntime: string;
  webView: string;
  viewport: string;
  schemaVersion: number;
};

export async function collectDiagnosticEnvironment(appData: AppData): Promise<DiagnosticEnvironment> {
  const appVersion = isTauri() ? await getVersion() : packageJson.version;
  return {
    appVersion,
    operatingSystem: navigator.platform || "unknown",
    tauriRuntime: isTauri() ? await getTauriVersion() : "不适用",
    webView: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    schemaVersion: appData.schemaVersion,
  };
}

export async function buildDiagnosticReport(
  appData: AppData,
  disclosure: DiagnosticDisclosure = "standard",
): Promise<string> {
  const environment = await collectDiagnosticEnvironment(appData);
  if (isTauri()) {
    try {
      return await invoke<string>("diagnostic_report", {
        environment,
        disclosure,
        appData: disclosure === "full" ? appData : null,
        requestId: createRequestId("diagnostic-report.build"),
      });
    } catch (error) {
      throw new Error("诊断报告生成失败");
    }
  }
  return formatDiagnosticReport(
    environment,
    getBrowserLogEntries().filter((entry) => entry.level === "warn" || entry.level === "error"),
    disclosure,
    disclosure === "full" ? appData : undefined,
  );
}
export function formatEnvironment(environment: DiagnosticEnvironment): string {
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

export function formatDiagnosticReport(
  environment: DiagnosticEnvironment,
  entries: readonly LogEntry[],
  disclosure: DiagnosticDisclosure,
  appData?: AppData,
): string {
  const lines = [formatEnvironment(environment), `诊断级别：${disclosure}`, `日志条目：${entries.length}`, ""];
  if (entries.length === 0) {
    lines.push("诊断日志：暂无 WARN/ERROR 记录");
  } else {
    lines.push("诊断日志：");
    for (const entry of entries) {
      const requestId = disclosure === "standard" || !entry.requestId ? "" : ` [${entry.requestId}]`;
      const details = disclosure === "standard" || !entry.details ? "" : ` ${JSON.stringify(entry.details)}`;
      lines.push(`${entry.timestamp} ${entry.level} ${entry.operation}${requestId}：${entry.message}${details}`);
    }
  }
  if (disclosure === "full" && appData) {
    lines.push("", "当前 AppData：", JSON.stringify(appData, null, 2));
  }
  return lines.join("\n");
}

