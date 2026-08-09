import { isTauri } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppData } from "../types/app-data";
import { createRequestId, getBrowserLogEntries } from "./logging";
import { clearPersistedDiagnosticLogs, exportDiagnosticBundleToFile } from "./platform-adapter";
import {
  collectDiagnosticEnvironment,
  formatDiagnosticReport,
  type DiagnosticDisclosure,
} from "./diagnostic-report";

export type DiagnosticErrorCode =
  | "cancelled"
  | "clipboard-unavailable"
  | "report-failed"
  | "export-failed";

export class DiagnosticError extends Error {
  readonly cause?: unknown;
  constructor(public readonly code: DiagnosticErrorCode, message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
    this.name = "DiagnosticError";
  }
}

export async function copyDiagnosticReport(report: string): Promise<void> {
  try {
    if (isTauri()) {
      await writeText(report);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(report);
    } else {
      throw new DiagnosticError("clipboard-unavailable", "当前运行环境不支持剪贴板");
    }
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    throw new DiagnosticError("clipboard-unavailable", "诊断信息复制失败", error);
  }
}

export async function clearDiagnosticLogs(): Promise<void> {
  if (isTauri()) {
    await clearPersistedDiagnosticLogs(createRequestId("diagnostic.log.clear"));
  }
}

export async function exportDiagnosticBundle(
  appData: AppData,
  disclosure: DiagnosticDisclosure = "standard",
): Promise<boolean> {
  const requestId = createRequestId("diagnostic.bundle.export");
  const environment = await collectDiagnosticEnvironment(appData);
  if (!isTauri()) {
    const report = formatDiagnosticReport(
      environment,
      getBrowserLogEntries().filter((entry) => entry.level === "warn" || entry.level === "error"),
      disclosure,
      disclosure === "full" ? appData : undefined,
    );
    const bundle = {
      exportedAt: new Date().toISOString(),
      runtime: "browser-preview",
      report,
      ...(disclosure === "full" ? { appData } : {}),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = "stickyhomeworks2-diagnostics.json";
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    return true;
  }
  try {
    return await exportDiagnosticBundleToFile(environment, disclosure, appData, requestId);
  } catch (error) {
    throw new DiagnosticError("export-failed", "诊断包导出失败", error);
  }
}
