import { inject, type ComputedRef, type InjectionKey, type Ref } from "vue";
import type { AppData, AppSettings, LegacyImportResult } from "./types/app-data";
import type { SubjectGroup } from "./types/homework-board";

export type AppContext = {
  appData: Ref<AppData>;
  homeworkGroups: ComputedRef<SubjectGroup[]>;
  isMobileRuntime: Ref<boolean>;
  isHomeworkFrozen: Ref<boolean>;
  settingsError: Ref<string>;
  openEditHomework: (id: string) => void;
  requestDeleteHomework: (id: string) => void;
  updateAppSettings: (mutate: (settings: AppSettings) => AppSettings) => Promise<void>;
  deleteGlobalTag: (tag: string) => Promise<void>;
  importLegacyData: (profileContents: string | undefined, settingsContents: string) => Promise<LegacyImportResult>;
};

export const appContextKey: InjectionKey<AppContext> = Symbol("StickyHomeworks2 app context");

export function useAppContext() {
  const context = inject(appContextKey);
  if (!context) throw new Error("StickyHomeworks2 app context is unavailable");
  return context;
}
