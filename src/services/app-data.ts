import { invoke, isTauri } from "@tauri-apps/api/core";
import { normalizeSettings } from "../domain/settings";
import { createRequestId, logError } from "./logging";
import {
  createDefaultAppData,
  type AppData,
  type AppSettings,
  type HomeworkRecord,
  type LegacyImportResult,
} from "../types/app-data";
import { parseHomeworkContent, serializeHomeworkContent, type HomeworkContent } from "../types/homework-content";
const browserStorageKey = "stickyhomeworks2.app-data.v1";

export async function loadAppData(): Promise<AppData> {
  const requestId = createRequestId("app-data.load");
  if (isTauri()) {
    const data = await invoke<unknown>("load_app_data", { requestId });
    return normalizeAppData(data);
  }
  return loadBrowserFallback(requestId);
}

export async function saveAppData(data: AppData, requestId = createRequestId("app-data.save")): Promise<AppData> {
  if (isTauri()) {
    const saved = await invoke<unknown>("save_app_data", { data: serializeAppDataForTauri(data), requestId });
    return normalizeAppData(saved);
  }
  try {
    const normalized = normalizeAppData(data);
    window.localStorage.setItem(browserStorageKey, JSON.stringify(normalized));
    return normalized;
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
  const result = await invoke<LegacyImportResult>("import_legacy_data_contents", {
    profileContents,
    settingsContents,
    requestId,
  });
  return { ...result, data: normalizeAppData(result.data) };
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

export function serializeAppDataForTauri(data: AppData): AppData {
  return {
    ...data,
    homeworks: data.homeworks.map((homework) => ({
      ...homework,
      content: JSON.parse(serializeHomeworkContent(parseHomeworkContent(homework.content))),
    })),
  };
}

function normalizeHomeworkRecord(value: unknown, index: number): HomeworkRecord {
  const record = isRecord(value) ? value : {};

  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : `homework-${index}`,
    content: normalizeHomeworkContentValue(record.content),
    subject: typeof record.subject === "string" ? record.subject : "",
    dueTime: typeof record.dueTime === "string" ? record.dueTime : "",
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    firstExpiredShowTime: typeof record.firstExpiredShowTime === "string" ? record.firstExpiredShowTime : null,
  };
}

function normalizeHomeworkContentValue(value: unknown): HomeworkContent {
  try {
    return parseHomeworkContent(value);
  } catch {
    // 单条内容格式异常时降级为纯文本，避免让整份数据加载失败。
    return { kind: "plain-text", text: typeof value === "string" ? value : "" };
  }
}

function normalizeSettingsFields(value: unknown): AppSettings {
  const defaults = createDefaultAppData().settings;
  const record = isRecord(value) ? value : {};
  const readString = (key: "title" | "expiredMarkColor" | "glycoproteinNodeId"): string =>
    typeof record[key] === "string" ? (record[key] as string) : defaults[key];
  const readBoolean = (
    key:
      | "autoOutwork"
      | "delayedCleanupEnabled"
      | "isExpiredMarkEnabled"
      | "alwaysOnBottom"
      | "autoStart"
      | "glycoproteinEnabled"
      | "windowVisible"
      | "windowTopmost",
  ): boolean => (typeof record[key] === "boolean" ? (record[key] as boolean) : defaults[key]);
  const readNumber = (key: "maxPanelWidth" | "backgroundOpacity" | "homeworkScale"): number =>
    typeof record[key] === "number" ? (record[key] as number) : defaults[key];
  const readStringList = (key: "subjects" | "tags"): string[] =>
    Array.isArray(record[key])
      ? (record[key] as unknown[]).filter((item): item is string => typeof item === "string")
      : [];

  return {
    title: readString("title"),
    subjects: readStringList("subjects"),
    tags: readStringList("tags"),
    autoOutwork: readBoolean("autoOutwork"),
    delayedCleanupEnabled: readBoolean("delayedCleanupEnabled"),
    isExpiredMarkEnabled: readBoolean("isExpiredMarkEnabled"),
    expiredMarkColor: readString("expiredMarkColor"),
    maxPanelWidth: readNumber("maxPanelWidth"),
    alwaysOnBottom: readBoolean("alwaysOnBottom"),
    autoStart: readBoolean("autoStart"),
    backgroundOpacity: readNumber("backgroundOpacity"),
    homeworkScale: readNumber("homeworkScale"),
    glycoproteinEnabled: readBoolean("glycoproteinEnabled"),
    glycoproteinNodeId: readString("glycoproteinNodeId"),
    windowVisible: readBoolean("windowVisible"),
    windowTopmost: readBoolean("windowTopmost"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAppData(value: unknown): AppData {
  const defaults = createDefaultAppData();
  if (!isRecord(value)) return defaults;

  return {
    schemaVersion: 1,
    homeworks: Array.isArray(value.homeworks)
      ? value.homeworks.map((homework, index) => normalizeHomeworkRecord(homework, index))
      : [],
    // 先做字段级类型兜底，再交给严格模式的 normalizeSettings。
    settings: normalizeSettings(normalizeSettingsFields(value.settings)),
  };
}
