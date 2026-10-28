import { computed, ref } from "vue";
import {
  groupHomeworks,
  pruneExpiredHomeworks,
  removeHomeworkRecord,
  restoreRemovedHomeworks,
  saveHomeworkRecord,
  type RemovedHomework,
} from "../domain/homework";
import { removeGlobalTag, type SettingsMutator, updateAppSettings } from "../domain/settings";
import { importLegacyData as importLegacyAppData, loadAppData, saveAppData } from "../services/app-data";
import { createRequestId, logError, logInfo } from "../services/logging";
import { createDefaultAppData, type AppData, type HomeworkRecord, type LegacyImportResult } from "../types/app-data";
import { COMMIT_TIMEOUT_MESSAGE, createSerialCommitQueue } from "./serialCommitQueue";

type AppDataMutator = (data: AppData) => AppData;

type HomeworkStoreDependencies = {
  loadData: () => Promise<AppData>;
  saveData: (data: AppData, requestId?: string) => Promise<AppData | void>;
  importData: (
    profileContents: string | undefined,
    settingsContents: string,
    requestId?: string,
  ) => Promise<LegacyImportResult>;
};

export function useHomeworkStore(dependencies: Partial<HomeworkStoreDependencies> = {}) {
  const loadData = dependencies.loadData ?? loadAppData;
  const saveData = dependencies.saveData ?? saveAppData;
  const importData = dependencies.importData ?? importLegacyAppData;
  const appData = ref(createDefaultAppData());
  const homeworkGroups = computed(() => groupHomeworks(appData.value.homeworks, appData.value.settings));
  const enqueueCommit = createSerialCommitQueue({ timeoutMs: 20000 });

  async function load() {
    appData.value = await loadData();
  }

  function commit(operation: string, mutate: AppDataMutator) {
    const requestId = createRequestId(operation);
    return enqueueCommit(async () => {
      const before = appData.value;
      await logInfo(`${operation}.start`, "应用数据变更开始", requestId);
      try {
        const nextData = mutate(before);
        if (nextData === before) {
          await logInfo(`${operation}.noop`, "应用数据无需变更", requestId);
          return;
        }
        const savedData = (await saveData(nextData, requestId)) ?? nextData;
        appData.value = savedData;
        await logInfo(`${operation}.success`, "应用数据变更已提交", requestId, {
          homeworkCountBefore: before.homeworks.length,
          homeworkCountAfter: savedData.homeworks.length,
        });
      } catch (error) {
        await logError(`${operation}.failure`, error, requestId);
        throw error;
      }
    }).catch(async (error) => {
      if (error instanceof Error && error.message === COMMIT_TIMEOUT_MESSAGE) {
        await logError(`${operation}.timeout`, error, requestId);
      }
      throw error;
    });
  }

  function saveHomework(homework: HomeworkRecord, isNew = false) {
    return commit("homework.save", (data) => saveHomeworkRecord(data, homework, isNew ? "create" : "update"));
  }

  function deleteHomework(homeworkId: string) {
    return commit("homework.delete", (data) => removeHomeworkRecord(data, homeworkId));
  }

  function updateSettings(mutate: SettingsMutator) {
    return commit("settings.save", (data) => {
      const settings = mutate(data.settings);
      return settings === data.settings ? data : updateAppSettings(data, () => settings);
    });
  }

  function deleteGlobalTag(tag: string) {
    return commit("settings.tag-delete", (data) => removeGlobalTag(data, tag));
  }

  /**
   * 自动清理过期作业（纯前端，不依赖任何后端命令）。
   *
   * 同一趟里还会给刚过期的作业补写 `firstExpiredShowTime`——这是「延迟清理」判断
   * “是否已展示过期满一天”的依据，所以即使没有删除也要落盘。
   * 返回被删掉的作业（带原下标，便于撤回）。
   */
  async function cleanupExpiredHomeworks(
    reason = "manual",
    protectedId: string | null = null,
  ): Promise<RemovedHomework[]> {
    if (!appData.value.settings.autoOutwork) return [];
    // 先纯算一遍：既没有要删的也没有要标记的，就不进保存队列，免得每次数据变动都写一次 noop。
    const preview = pruneExpiredHomeworks(appData.value, new Date(), protectedId);
    if (preview.removed.length === 0 && preview.markedCount === 0) return [];

    let removed: RemovedHomework[] = [];
    let markedCount = 0;
    let delayedCleanupEnabled = false;

    await commit("homework.cleanup", (data) => {
      const result = pruneExpiredHomeworks(data, new Date(), protectedId);
      if (result.removed.length === 0 && result.markedCount === 0) return data;
      removed = result.removed;
      markedCount = result.markedCount;
      delayedCleanupEnabled = data.settings.delayedCleanupEnabled;
      return result.data;
    });

    if (markedCount > 0) {
      await logInfo("homework.cleanup.mark", `记录了 ${markedCount} 条过期作业的首次展示时间`, undefined, {
        reason,
      });
    }
    if (removed.length > 0) {
      await logInfo("homework.cleanup.remove", `自动清理了 ${removed.length} 条过期作业`, undefined, {
        reason,
        removedHomeworkIds: removed.map((entry) => entry.homework.id),
        delayedCleanupEnabled,
      });
    }
    return removed;
  }

  /** 撤回一次自动清理：把作业按原位置插回去。 */
  function restoreHomeworks(removed: readonly RemovedHomework[]) {
    return commit("homework.cleanup.restore", (data) => restoreRemovedHomeworks(data, removed));
  }

  function importLegacyData(profileContents: string | undefined, settingsContents: string) {
    return enqueueCommit(async () => {
      const requestId = createRequestId("legacy-import");
      try {
        const result = await importData(profileContents, settingsContents, requestId);
        appData.value = result.data;
        await logInfo("legacy-import.success", "旧版数据导入完成", requestId);
        return result;
      } catch (error) {
        await logError("legacy-import.failure", error, requestId);
        throw error;
      }
    });
  }

  return {
    appData,
    homeworkGroups,
    load,
    saveHomework,
    deleteHomework,
    updateSettings,
    deleteGlobalTag,
    importLegacyData,
    cleanupExpiredHomeworks,
    restoreHomeworks,
  };
}
