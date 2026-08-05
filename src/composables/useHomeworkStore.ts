import { computed, ref } from "vue";
import { groupHomeworks, removeHomeworkRecord, saveHomeworkRecord } from "../domain/homework";
import { removeGlobalTag, type SettingsMutator, updateAppSettings } from "../domain/settings";
import { importLegacyData as importLegacyAppData, loadAppData, saveAppData } from "../services/app-data";
import { createRequestId, logError, logInfo } from "../services/logging";
import { createDefaultAppData, type AppData, type HomeworkRecord, type LegacyImportResult } from "../types/app-data";
import { createSerialCommitQueue } from "./serialCommitQueue";

type AppDataMutator = (data: AppData) => AppData;

type HomeworkStoreDependencies = {
  loadData: () => Promise<AppData>;
  saveData: (data: AppData, requestId?: string) => Promise<void>;
  importData: (profileContents: string | undefined, settingsContents: string, requestId?: string) => Promise<LegacyImportResult>;
};

export function useHomeworkStore(dependencies: Partial<HomeworkStoreDependencies> = {}) {
  const loadData = dependencies.loadData ?? loadAppData;
  const saveData = dependencies.saveData ?? saveAppData;
  const importData = dependencies.importData ?? importLegacyAppData;
  const appData = ref(createDefaultAppData());
  const homeworkGroups = computed(() => groupHomeworks(appData.value.homeworks, appData.value.settings));
  const enqueueCommit = createSerialCommitQueue();

  async function load() {
    appData.value = await loadData();
  }

  function commit(operation: string, mutate: AppDataMutator) {
    return enqueueCommit(async () => {
      const requestId = createRequestId(operation);
      try {
        const nextData = mutate(appData.value);
        await saveData(nextData, requestId);
        appData.value = nextData;
        logInfo(operation, "应用数据变更已提交", requestId);
      } catch (error) {
        logError(operation, error, requestId);
        throw error;
      }
    });
  }

  function saveHomework(homework: HomeworkRecord) {
    return commit("homework.save", (data) => saveHomeworkRecord(data, homework));
  }

  function deleteHomework(homeworkId: string) {
    return commit("homework.delete", (data) => removeHomeworkRecord(data, homeworkId));
  }

  function updateSettings(mutate: SettingsMutator) {
    return commit("settings.save", (data) => updateAppSettings(data, mutate));
  }

  function deleteGlobalTag(tag: string) {
    return commit("settings.tag-delete", (data) => removeGlobalTag(data, tag));
  }

  function importLegacyData(profileContents: string | undefined, settingsContents: string) {
    return enqueueCommit(async () => {
      const requestId = createRequestId("legacy-import");
      try {
        const result = await importData(profileContents, settingsContents, requestId);
        appData.value = result.data;
        logInfo("legacy-import.complete", "旧版数据导入完成", requestId);
        return result;
      } catch (error) {
        logError("legacy-import.failed", error, requestId);
        throw error;
      }
    });
  }

  return { appData, homeworkGroups, load, saveHomework, deleteHomework, updateSettings, deleteGlobalTag, importLegacyData };
}
