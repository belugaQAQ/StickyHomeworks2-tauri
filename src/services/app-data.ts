import { invoke, isTauri } from "@tauri-apps/api/core";
import { normalizeSettings } from "../domain/settings";
import { createRequestId, logError } from "./logging";
import { createDefaultAppData, type AppData, type LegacyImportResult } from "../types/app-data";
import { parseHomeworkContent, serializeHomeworkContent } from "../types/homework-content";
const browserStorageKey = "stickyhomeworks2.app-data.v1";

export async function loadAppData(): Promise<AppData> {
  const requestId = createRequestId("app-data.load");
  if (isTauri()) {
    const data = await invoke<unknown>("load_app_data", { requestId });
    return normalizeAppData(data);
  }
  return loadBrowserFallback(requestId);
}

export async function saveAppData(data: AppData, requestId = createRequestId("app-data.save")): Promise<void> {
  if (isTauri()) {
    await invoke("save_app_data", { data: serializeAppDataForTauri(data), requestId });
    return;
  }
  try {
    window.localStorage.setItem(browserStorageKey, JSON.stringify(data));
  } catch (error) {
    logError("browser.data.save", error, requestId);
    throw error;
  }
}


export async function importLegacyData(
  profileContents: string | undefined,
  settingsContents: string,
  requestId = createRequestId("legacy-import"),
): Promise<LegacyImportResult> {
  if (!isTauri()) throw new Error("旧版数据导入仅可在 Tauri 应用中使用。");
  return invoke<LegacyImportResult>("import_legacy_data_contents", {
    profileContents,
    settingsContents,
    requestId,
  });
}

function loadBrowserFallback(requestId: string): AppData {
  try {
    const saved = window.localStorage.getItem(browserStorageKey);
    if (!saved) return createDefaultAppData();
    return normalizeAppData(JSON.parse(saved));
  } catch (error) {
    logError("browser.data.load", error, requestId);
    return createDefaultAppData();
  }
}

function serializeAppDataForTauri(data: AppData): AppData {
  return {
    ...data,
    homeworks: data.homeworks.map((homework) => ({
      ...homework,
      content: JSON.parse(serializeHomeworkContent(parseHomeworkContent(homework.content))),
    })),
  };
}

function normalizeHomeworkContent(data: unknown): AppData {
  const defaults = createDefaultAppData();
  if (!data || typeof data !== "object") return defaults;

  const candidate = data as Partial<AppData>;
  return {
    schemaVersion: 1,
    homeworks: Array.isArray(candidate.homeworks)
      ? candidate.homeworks.map((homework) => ({
          ...(homework as AppData["homeworks"][number]),
          content: parseHomeworkContent((homework as { content?: unknown }).content ?? ""),
        }))
      : [],
    settings: normalizeSettings({ ...defaults.settings, ...candidate.settings }),
  };
}

function normalizeAppData(value: unknown): AppData {
  return normalizeHomeworkContent(value);
}
