import { computed, ref, type Ref } from "vue";
import { formatLocalDate, localDateValue, toDateInputValue, uniqueVocabulary } from "../domain/homework";
import type { AppData, HomeworkRecord } from "../types/app-data";

type HomeworkEditorOptions = {
  appData: Ref<AppData>;
  saveHomework: (homework: HomeworkRecord) => Promise<void>;
};

export function useHomeworkEditor({ appData, saveHomework }: HomeworkEditorOptions) {
  const editingHomework = ref<HomeworkRecord | null>(null);
  const saveError = ref("");
  const editorSubjects = computed(() => uniqueVocabulary([
    ...appData.value.settings.subjects,
    editingHomework.value?.subject ?? "",
    "其它",
  ]));
  const editorTags = computed(() => appData.value.settings.tags);

  function openCreate() {
    const lastHomework = appData.value.homeworks[appData.value.homeworks.length - 1];
    editingHomework.value = {
      id: createHomeworkId(),
      content: "",
      subject: lastHomework?.subject ?? appData.value.settings.subjects[0] ?? "其它",
      dueTime: localDateValue(),
      tags: [],
      firstExpiredShowTime: null,
    };
    resetFormMessages();
  }

  function openEdit(id: string) {
    const homework = appData.value.homeworks.find((item) => item.id === id);
    if (!homework) return false;

    editingHomework.value = {
      ...homework,
      dueTime: toDateInputValue(homework.dueTime),
      tags: homework.tags.filter((tag) => editorTags.value.includes(tag)),
    };
    resetFormMessages();
    return true;
  }

  function updateContent(content: string) {
    if (editingHomework.value) editingHomework.value.content = content;
  }

  function updateSubject(subject: string) {
    if (editingHomework.value) editingHomework.value.subject = subject;
  }

  function updateDueDate(date: Date) {
    if (editingHomework.value) editingHomework.value.dueTime = formatLocalDate(date);
  }

  function updateTagSelection(tag: string, selected: boolean) {
    if (!editingHomework.value) return;
    editingHomework.value.tags = selected
      ? uniqueVocabulary([...editingHomework.value.tags, tag])
      : editingHomework.value.tags.filter((item) => item !== tag);
  }

  async function save() {
    if (!editingHomework.value) return false;

    try {
      await saveHomework(editingHomework.value);
      return true;
    } catch {
      saveError.value = "保存失败，请重试。";
      return false;
    }
  }

  function reset() {
    editingHomework.value = null;
    resetFormMessages();
  }

  function resetFormMessages() {
    saveError.value = "";
  }

  return {
    editingHomework,
    saveError,
    editorSubjects,
    editorTags,
    openCreate,
    openEdit,
    updateContent,
    updateSubject,
    updateDueDate,
    updateTagSelection,
    save,
    reset,
  };
}

function createHomeworkId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `homework-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
