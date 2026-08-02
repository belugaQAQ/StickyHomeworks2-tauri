import { computed, ref, type Ref } from "vue";
import { formatLocalDate, localDateValue, toDateInputValue, uniqueVocabulary } from "../domain/homework";
import type { AppData, HomeworkRecord } from "../types/app-data";

type HomeworkEditorOptions = {
  appData: Ref<AppData>;
  saveHomework: (homework: HomeworkRecord) => Promise<void>;
};

export function useHomeworkEditor({ appData, saveHomework }: HomeworkEditorOptions) {
  const editingHomework = ref<HomeworkRecord | null>(null);
  const newTag = ref("");
  const saveError = ref("");
  const editorSubjects = computed(() => uniqueVocabulary([
    ...appData.value.settings.subjects,
    editingHomework.value?.subject ?? "",
    "其它",
  ]));

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
      tags: [...homework.tags],
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

  function addTag() {
    const tag = newTag.value.trim();
    if (!editingHomework.value || !tag || editingHomework.value.tags.includes(tag)) return;
    editingHomework.value.tags.push(tag);
    newTag.value = "";
  }

  function removeTag(tag: string) {
    if (!editingHomework.value) return;
    editingHomework.value.tags = editingHomework.value.tags.filter((item) => item !== tag);
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
    newTag.value = "";
    saveError.value = "";
  }

  return {
    editingHomework,
    newTag,
    saveError,
    editorSubjects,
    openCreate,
    openEdit,
    updateContent,
    updateSubject,
    updateDueDate,
    addTag,
    removeTag,
    save,
    reset,
  };
}

function createHomeworkId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `homework-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
