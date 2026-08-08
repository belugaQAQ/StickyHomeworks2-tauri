import { invoke, isTauri } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import type { AppData } from "../types/app-data";
import { createRequestId, getBrowserLogEntries } from "./logging";
import {
  buildDiagnosticReport,
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
    await invoke("clear_diagnostic_logs", { requestId: createRequestId("diagnostic.log.clear") });
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
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    const report = await buildDiagnosticReport(appData, disclosure);
    if (navigator.share) {
      try {
        await navigator.share({ text: report, title: "StickyHomeworks2 诊断信息" });
        return true;
      } catch (error) {
        throw new DiagnosticError("cancelled", "用户取消了诊断信息分享", error);
      }
    }
    await copyDiagnosticReport(report);
    return true;
  }
  const destination = await save({ title: "导出诊断信息", defaultPath: "stickyhomeworks2-diagnostics.zip", filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }] });
  if (!destination) return false;
  try {
    await invoke("export_diagnostic_bundle_to_path", {
      destination,
      environment,
      disclosure,
      appData: disclosure === "full" ? appData : null,
      requestId,
    });
    return true;
  } catch (error) {
    throw new DiagnosticError("export-failed", "诊断包导出失败", error);
  }
}
