import { computed, ref } from "vue";
import { groupHomeworks, removeHomeworkRecord, saveHomeworkRecord } from "../domain/homework";
import { loadAppData, saveAppData } from "../services/app-data";
import { createDefaultAppData, type HomeworkRecord } from "../types/app-data";

export function useHomeworkStore() {
  const appData = ref(createDefaultAppData());
  const homeworkGroups = computed(() => groupHomeworks(appData.value.homeworks));

  async function load() {
    appData.value = await loadAppData();
  }

  async function saveHomework(homework: HomeworkRecord) {
    const nextData = saveHomeworkRecord(appData.value, homework);
    await saveAppData(nextData);
    appData.value = nextData;
  }

  async function deleteHomework(homeworkId: string) {
    const nextData = removeHomeworkRecord(appData.value, homeworkId);
    await saveAppData(nextData);
    appData.value = nextData;
  }

  return { appData, homeworkGroups, load, saveHomework, deleteHomework };
}
