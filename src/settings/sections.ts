import type { Component } from "vue";
import SettingsAboutView from "../views/SettingsAboutView.vue";
import SettingsBoardView from "../views/SettingsBoardView.vue";
import SettingsDiagnosticsView from "../views/SettingsDiagnosticsView.vue";
import SettingsExpiryView from "../views/SettingsExpiryView.vue";
import SettingsGeneralView from "../views/SettingsGeneralView.vue";
import SettingsGlycoproteinView from "../views/SettingsGlycoproteinView.vue";
import SettingsImportView from "../views/SettingsImportView.vue";
import SettingsVocabularyView from "../views/SettingsVocabularyView.vue";

export type SettingsSection = {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly detail: string;
  readonly icon: string;
  readonly desktopOnly?: boolean;
  readonly experimental?: boolean;
  readonly depth: number;
};

export const settingsSections: readonly SettingsSection[] = [
  { 
    id: "general",
    path: "/settings/general",
    title: "通用",
    detail: "关于软件基础的一些配置项",
    icon: "tune",
    depth: 1 
  },
  {
    id: "vocabulary",
    path: "/settings/vocabulary",
    title: "作业词库",
    detail: "编辑科目和标签",
    icon: "category",
    depth: 1,
  },
  { id: "expiry",
    path: "/settings/expiry",
    title: "作业处理",
    detail: "清理和标记过期作业",
    icon: "event_busy",
    depth: 1 
  },
  { id: "board",
    path: "/settings/board",
    title: "看板",
    detail: "面板大小配置",
    icon: "view_column",
    depth: 1 },
  {
    id: "glycoprotein",
    path: "/settings/glycoprotein",
    title: "Glycoprotein",
    detail: "Glycoprotein联动设置",
    icon: "hub",
    desktopOnly: true,
    experimental: true,
    depth: 1,
  },
  {
    id: "import",
    path: "/settings/import",
    title: "导入旧版数据",
    detail: "迁移StickyHomeworks2的一系列设置",
    icon: "upload_file",
    depth: 1,
  },
  {
    id: "diagnostics",
    path: "/settings/diagnostics",
    title: "诊断信息",
    detail: "导出反馈、诊断包与运行日志",
    icon: "content_copy",
    depth: 1,
  },
  { id: "about",
    path: "/settings/about",
    title: "关于",
    detail: "版本、项目与许可证",
    icon: "info",
    depth: 1
  },
];

export const settingsSectionByPath: ReadonlyMap<string, SettingsSection> = new Map(
  settingsSections.map((section) => [section.path, section]),
);

export const settingsSectionComponents: Readonly<Record<string, Component>> = {
  "/settings/general": SettingsGeneralView,
  "/settings/vocabulary": SettingsVocabularyView,
  "/settings/expiry": SettingsExpiryView,
  "/settings/board": SettingsBoardView,
  "/settings/glycoprotein": SettingsGlycoproteinView,
  "/settings/import": SettingsImportView,
  "/settings/diagnostics": SettingsDiagnosticsView,
  "/settings/about": SettingsAboutView,
};

export function settingsRouteName(section: SettingsSection): string {
  return `settings-${section.id}`;
}

export function visibleSettingsSections(isMobileRuntime: boolean): readonly SettingsSection[] {
  return settingsSections.filter((section) => !section.desktopOnly || !isMobileRuntime);
}
