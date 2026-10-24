import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { AppData } from "../types/app-data";
import { serializeAppDataForTauri } from "./app-data";
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
  const base64Bundle = await invoke<string>("export_diagnostic_bundle", {
    environment,
    disclosure,
    appData: disclosure === "full" ? serializeAppDataForTauri(appData) : null,
    requestId,
  });
  // 后端返回标准 Base64 字符串，这里解码为二进制后再写入文件。
  const bundle = Uint8Array.from(atob(base64Bundle), (character) => character.charCodeAt(0));
  await writeFile(destination, bundle);
  return true;
}
export async function saveHomeworkExportToFile(blob: Blob, filename: string): Promise<boolean | null> {
  if (!isTauri()) return null;
  const destination = await save({
    title: "导出作业图片",
    defaultPath: filename,
    filters: [{ name: "PNG 图片", extensions: ["png"] }],
  });
  if (!destination) return false;
  await writeFile(destination, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

export async function clearPersistedDiagnosticLogs(requestId: string): Promise<void> {
  await invoke("clear_diagnostic_logs", { requestId });
}
