import { invoke, isTauri } from "@tauri-apps/api/core";
import { createDefaultAppData, type AppData } from "../types/app-data";

const browserStorageKey = "stickyhomeworks2.app-data.v1";

export async function loadAppData(): Promise<AppData> {
  if (!isTauri()) return loadBrowserFallback();
  return invoke<AppData>("load_app_data");
}

export async function saveAppData(data: AppData): Promise<void> {
  if (isTauri()) return invoke("save_app_data", { data });
  window.localStorage.setItem(browserStorageKey, JSON.stringify(data));
}

function loadBrowserFallback(): AppData {
  try {
    const saved = window.localStorage.getItem(browserStorageKey);
    if (!saved) return createDefaultAppData();

    return normalizeAppData(JSON.parse(saved));
  } catch {
    return createDefaultAppData();
  }
}

function normalizeAppData(value: unknown): AppData {
  const defaults = createDefaultAppData();
  if (!value || typeof value !== "object") return defaults;

  const candidate = value as Partial<AppData>;
  return {
    schemaVersion: 1,
    homeworks: Array.isArray(candidate.homeworks) ? candidate.homeworks : [],
    settings: { ...defaults.settings, ...candidate.settings },
  };
}
