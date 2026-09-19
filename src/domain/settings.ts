import { createGlycoproteinNodeId, type AppData, type AppSettings } from "../types/app-data";
import { uniqueVocabulary } from "./vocabulary.ts";

export type SettingsMutator = (settings: AppSettings) => AppSettings;

export function normalizeSettings(settings: AppSettings): AppSettings {
  const maxPanelWidth = Number.isFinite(settings.maxPanelWidth) ? settings.maxPanelWidth : 350;
  const windowTopmost = Boolean(settings.windowTopmost);

  return {
    ...settings,
    title: settings.title.trim() || "作业",
    subjects: uniqueVocabulary(settings.subjects),
    tags: uniqueVocabulary(settings.tags),
    maxPanelWidth: Math.round(Math.max(160, Math.min(2000, maxPanelWidth)) / 10) * 10,
    backgroundOpacity: normalizeBackgroundOpacity(settings.backgroundOpacity),
    homeworkScale: normalizeHomeworkScale(settings.homeworkScale),
    alwaysOnBottom: windowTopmost ? false : Boolean(settings.alwaysOnBottom),
    glycoproteinEnabled: Boolean(settings.glycoproteinEnabled),
    glycoproteinNodeId: settings.glycoproteinNodeId.trim() || createGlycoproteinNodeId(),
    windowVisible: Boolean(settings.windowVisible),
    windowTopmost,
    windowX: normalizeWindowCoordinate(settings.windowX),
    windowY: normalizeWindowCoordinate(settings.windowY),
    windowWidth: normalizeWindowDimension(settings.windowWidth),
    windowHeight: normalizeWindowDimension(settings.windowHeight),
  };
}

export function normalizeBackgroundOpacity(value: number): number {
  const opacity = Number.isFinite(value) ? value : 100;
  return Math.round(Math.max(0, Math.min(100, opacity)));
}
export function normalizeHomeworkScale(value: number): number {
  const scale = Number.isFinite(value) ? value : 100;
  return Math.round(Math.max(75, Math.min(200, scale)) / 5) * 5;
}

export function glycoproteinNodeIdError(value: string): string {
  const nodeId = value.trim();
  if (!nodeId) return "节点 ID 不能为空。";
  if (nodeId === "." || nodeId === "..") return "节点 ID 不能是 . 或 ..。";
  const hasInvalidCharacter = [...nodeId].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /[<>:"/\\|?*]/.test(character) || codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  if (hasInvalidCharacter) {
    return "节点 ID 不能包含控制字符或 < > : \" / \\ | ? *。";
  }
  return "";
}

function normalizeWindowCoordinate(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < -2147483648 || value > 2147483647) return null;
  return Math.round(value);
}

function normalizeWindowDimension(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 4294967295) return null;
  return rounded;
}

export function updateAppSettings(data: AppData, mutate: SettingsMutator): AppData {
  return { ...data, settings: normalizeSettings(mutate(data.settings)) };
}

export function removeGlobalTag(data: AppData, tag: string): AppData {
  return {
    ...data,
    homeworks: data.homeworks.map((homework) => ({
      ...homework,
      tags: homework.tags.filter((homeworkTag) => homeworkTag !== tag),
    })),
    settings: {
      ...data.settings,
      tags: data.settings.tags.filter((settingTag) => settingTag !== tag),
    },
  };
}
