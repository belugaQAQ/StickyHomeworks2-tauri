import { computed, ref } from "vue";
import {
  appendImportedAssignments,
  groupHomeworks,
  pruneExpiredHomeworks,
  removeHomeworkRecord,
  restoreRemovedHomeworks,
  saveHomeworkRecord,
  type ImportedAssignment,
  type RemovedHomework,
} from "../domain/homework";
import { removeGlobalTag, type SettingsMutator, updateAppSettings } from "../domain/settings";
import { importLegacyData as importLegacyAppData, loadAppData, saveAppData } from "../services/app-data";
import { restoreSnapshot as restoreTimeMachineData } from "../services/time-machine";
import { createRequestId, logError, logInfo } from "../services/logging";
import { createDefaultAppData, type AppData, type HomeworkRecord, type LegacyImportResult } from "../types/app-data";
import type { SnapshotSource } from "../types/time-machine";
import { COMMIT_TIMEOUT_MESSAGE, createSerialCommitQueue } from "./serialCommitQueue";

type AppDataMutator = (data: AppData) => AppData;

type HomeworkStoreDependencies = {
  loadData: () => Promise<AppData>;
  saveData: (data: AppData, requestId: string | undefined, source: SnapshotSource) => Promise<AppData | void>;
  importData: (
    profileContents: string | undefined,
    settingsContents: string | undefined,
    requestId?: string,
  ) => Promise<LegacyImportResult>;
  restoreData: (id: string, requestId?: string) => Promise<AppData>;
};

export function useHomeworkStore(dependencies: Partial<HomeworkStoreDependencies> = {}) {
  const loadData = dependencies.loadData ?? loadAppData;
  const saveData = dependencies.saveData ?? saveAppData;
  const importData = dependencies.importData ?? importLegacyAppData;
  const restoreData = dependencies.restoreData ?? restoreTimeMachineData;
  const appData = ref(createDefaultAppData());
  const homeworkGroups = computed(() => groupHomeworks(appData.value.homeworks, appData.value.settings));
  const enqueueCommit = createSerialCommitQueue({ timeoutMs: 20000 });

  async function load() {
    appData.value = await loadData();
  }

  function commit(operation: string, mutate: AppDataMutator, source: SnapshotSource | (() => SnapshotSource)) {
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
        const resolvedSource = typeof source === "function" ? source() : source;
        const savedData = (await saveData(nextData, requestId, resolvedSource)) ?? nextData;
        appData.value = savedData;
        await logInfo(`${operation}.success`, "应用数据变更已提交", requestId, {
          homeworkCountBefore: before.homeworks.length,
          homeworkCountAfter: savedData.homeworks.length,
          snapshotSource: resolvedSource,
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
    return commit(
      "homework.save",
      (data) => saveHomeworkRecord(data, homework, isNew ? "create" : "update"),
      isNew ? "homework-create" : "homework-update",
    );
  }

  function deleteHomework(homeworkId: string) {
    return commit("homework.delete", (data) => removeHomeworkRecord(data, homeworkId), "homework-delete");
  }

  function updateSettings(mutate: SettingsMutator) {
    return commit(
      "settings.save",
      (data) => {
        const settings = mutate(data.settings);
        return settings === data.settings ? data : updateAppSettings(data, () => settings);
      },
      "vocabulary-update",
    );
  }

  function deleteGlobalTag(tag: string) {
    return commit("settings.tag-delete", (data) => removeGlobalTag(data, tag), "vocabulary-update");
  }

  async function cleanupExpiredHomeworks(
    reason = "manual",
    protectedId: string | null = null,
    shouldSkip: () => boolean = () => false,
  ): Promise<RemovedHomework[]> {
    if (!appData.value.settings.autoOutwork) return [];
    const preview = pruneExpiredHomeworks(appData.value, new Date(), protectedId);
    if (preview.removed.length === 0 && preview.markedCount === 0) return [];

    let removed: RemovedHomework[] = [];
    let markedCount = 0;
    let delayedCleanupEnabled = false;
    let source: SnapshotSource = "expiry-mark";

    await commit(
      "homework.cleanup",
      (data) => {
        if (shouldSkip()) return data;
        const result = pruneExpiredHomeworks(data, new Date(), protectedId);
        if (result.removed.length === 0 && result.markedCount === 0) return data;
        removed = result.removed;
        markedCount = result.markedCount;
        delayedCleanupEnabled = data.settings.delayedCleanupEnabled;
        source = result.removed.length > 0 ? "homework-cleanup" : "expiry-mark";
        return result.data;
      },
      () => source,
    );

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

  /** 撤回一次自动清理 */
  function restoreHomeworks(removed: readonly RemovedHomework[]) {
    return commit("homework.cleanup.restore", (data) => restoreRemovedHomeworks(data, removed), "cleanup-undo");
  }

  function importLegacyData(profileContents: string | undefined, settingsContents: string | undefined) {
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

  function importUafAssignments(assignments: readonly ImportedAssignment[]) {
    if (assignments.length === 0) return Promise.resolve();
    return commit("homework.uaf-import", (data) => appendImportedAssignments(data, assignments), "uaf-import");
  }

  function restoreFromSnapshot(id: string) {
    return enqueueCommit(async () => {
      const requestId = createRequestId("time-machine.restore");
      try {
        appData.value = await restoreData(id, requestId);
        await logInfo("time-machine.restore.success", "时间机器快照已恢复", requestId);
      } catch (error) {
        await logError("time-machine.restore.failure", error, requestId);
        try {
          appData.value = await loadData();
        } catch (reloadError) {
          await logError("time-machine.restore.reload-failure", reloadError, requestId);
        }
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
    importUafAssignments,
    cleanupExpiredHomeworks,
    restoreHomeworks,
    restoreFromSnapshot,
  };
}
