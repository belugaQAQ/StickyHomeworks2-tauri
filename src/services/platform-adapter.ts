import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { AppData } from "../types/app-data";
import type { DiagnosticDisclosure, DiagnosticEnvironment } from "./diagnostic-report";

export async function exportDiagnosticBundleToFile(
  environment: DiagnosticEnvironment,
  disclosure: DiagnosticDisclosure,
  appData: AppData,
  requestId: string,
): Promise<boolean> {
  if (!isTauri()) return false;
  const destination = await save({
    title: "导出诊断信息",
    defaultPath: "stickyhomeworks2-diagnostics.zip",
    filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
  });
  if (!destination) return false;
  const bundle = await invoke<number[]>("export_diagnostic_bundle", {
    environment,
    disclosure,
    appData: disclosure === "full" ? appData : null,
    requestId,
  });
  await writeFile(destination, new Uint8Array(bundle));
  return true;
}

export async function clearPersistedDiagnosticLogs(requestId: string): Promise<void> {
  await invoke("clear_diagnostic_logs", { requestId });
}
