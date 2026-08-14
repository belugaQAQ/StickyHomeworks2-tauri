import { computed, ref, type Ref } from "vue";
import { formatLocalDate, localDateValue, toDateInputValue, uniqueVocabulary } from "../domain/homework";
import type { AppData, HomeworkRecord } from "../types/app-data";
import { parseHomeworkContent } from "../types/homework-content";
import { logError, logInfo } from "../services/logging";
type HomeworkEditorOptions = {
  appData: Ref<AppData>;
  isHomeworkFrozen: Ref<boolean>;
  saveHomework: (homework: HomeworkRecord) => Promise<void>;
};

export function useHomeworkEditor({ appData, isHomeworkFrozen, saveHomework }: HomeworkEditorOptions) {
  const editingHomework = ref<HomeworkRecord | null>(null);
  const saveError = ref("");
  const editorSubjects = computed(() => uniqueVocabulary([
    ...appData.value.settings.subjects,
    editingHomework.value?.subject ?? "",
    "其它",
  ]));
  const editorTags = computed(() => appData.value.settings.tags);

  function openCreate() {
    if (isHomeworkFrozen.value) {
      logInfo("homework.create.blocked", "冻结状态下新建作业被阻止");
      return false;
    }

    const lastHomework = appData.value.homeworks[appData.value.homeworks.length - 1];
    editingHomework.value = {
      id: createHomeworkId(),
      content: { kind: "plain-text", text: "" },
      subject: lastHomework?.subject ?? appData.value.settings.subjects[0] ?? "其它",
      dueTime: localDateValue(),
      tags: [],
      firstExpiredShowTime: null,
    };
    resetFormMessages();
    logInfo("homework.create.open", "新建作业编辑器已打开");
    return true;
  }

  function openEdit(id: string) {
    if (isHomeworkFrozen.value) {
      logInfo("homework.edit.blocked", "冻结状态下编辑作业被阻止");
      return false;
    }

    const homework = appData.value.homeworks.find((item) => item.id === id);
    if (!homework) {
      logInfo("homework.edit.missing", "请求编辑的作业不存在");
      return false;
    }

    editingHomework.value = {
      ...homework,
      content: parseHomeworkContent(homework.content),
      dueTime: toDateInputValue(homework.dueTime),
      tags: homework.tags.filter((tag) => editorTags.value.includes(tag)),
    };
    resetFormMessages();
    logInfo("homework.edit.open", "作业编辑器已打开");
    return true;
  }

  function updateContent(content: string) {
    if (editingHomework.value) {
      let nextContent: HomeworkRecord["content"];
      try {
        nextContent = parseHomeworkContent(content);
      } catch {
        nextContent = { kind: "plain-text", text: content };
      }
      editingHomework.value.content = nextContent;
      logInfo("homework.edit.content.change", `作业内容已修改，长度：${content.length}`);
    }
  }

  function updateSubject(subject: string) {
    if (editingHomework.value) {
      editingHomework.value.subject = subject;
      logInfo("homework.edit.subject.change", "作业科目已修改");
    }
  }

  function updateDueDate(date: Date) {
    if (editingHomework.value) {
      editingHomework.value.dueTime = formatLocalDate(date);
      logInfo("homework.edit.due.date.change", "作业截止日期已修改");
    }
  }

  function updateTagSelection(tag: string, selected: boolean) {
    if (!editingHomework.value) return;
    editingHomework.value.tags = selected
      ? uniqueVocabulary([...editingHomework.value.tags, tag])
      : editingHomework.value.tags.filter((item) => item !== tag);
    logInfo(selected ? "homework.edit.tag.add" : "homework.edit.tag.remove", "作业标签选择已变化");
  }


  async function save() {
    if (!editingHomework.value) return false;
    if (isHomeworkFrozen.value) {
      saveError.value = "作业操作已冻结。";
      logInfo("homework.save.blocked", "冻结状态下保存作业被阻止");
      return false;
    }

    logInfo("homework.save.start", "作业保存已开始");
    try {
      await saveHomework(editingHomework.value);
      logInfo("homework.save.success", "作业保存成功");
      return true;
    } catch (error) {
      saveError.value = "保存失败，请重试。";
      void logError("homework.save.failure", error);
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
