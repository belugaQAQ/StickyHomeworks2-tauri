import { computed, ref } from "vue";
import { groupHomeworks, removeHomeworkRecord, saveHomeworkRecord } from "../domain/homework";
import { removeGlobalTag, type SettingsMutator, updateAppSettings } from "../domain/settings";
import { loadAppData, saveAppData } from "../services/app-data";
import { createDefaultAppData, type AppData, type HomeworkRecord } from "../types/app-data";
import { createSerialCommitQueue } from "./serialCommitQueue";

type AppDataMutator = (data: AppData) => AppData;

type HomeworkStoreDependencies = {
  loadData: () => Promise<AppData>;
  saveData: (data: AppData) => Promise<void>;
};

export function useHomeworkStore(dependencies: Partial<HomeworkStoreDependencies> = {}) {
  const loadData = dependencies.loadData ?? loadAppData;
  const saveData = dependencies.saveData ?? saveAppData;
  const appData = ref(createDefaultAppData());
  const homeworkGroups = computed(() => groupHomeworks(appData.value.homeworks, appData.value.settings));
  const enqueueCommit = createSerialCommitQueue();

  async function load() {
    appData.value = await loadData();
  }

  function commit(mutate: AppDataMutator) {
    return enqueueCommit(async () => {
      const nextData = mutate(appData.value);
      await saveData(nextData);
      appData.value = nextData;
    });
  }

  function saveHomework(homework: HomeworkRecord) {
    return commit((data) => saveHomeworkRecord(data, homework));
  }

  function deleteHomework(homeworkId: string) {
    return commit((data) => removeHomeworkRecord(data, homeworkId));
  }

  function updateSettings(mutate: SettingsMutator) {
    return commit((data) => updateAppSettings(data, mutate));
  }

  function deleteGlobalTag(tag: string) {
    return commit((data) => removeGlobalTag(data, tag));
  }

  return { appData, homeworkGroups, load, saveHomework, deleteHomework, updateSettings, deleteGlobalTag };
}
