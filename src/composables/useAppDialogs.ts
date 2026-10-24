import { nextTick, ref, watch, type Ref } from "vue";
import HomeworkExportDialog from "../components/HomeworkExportDialog.vue";
import { logInfo } from "../services/logging";
import { hideWebKitGtkDialog, useWebKitGtkDialogExit } from "./useWebKitGtkDialogExit";

/** M3E 对话框（`m3e-dialog` / `m3e-bottom-sheet`）在模板 ref 上的公共句柄。 */
export type DialogElement = HTMLElement & {
  show: () => void;
  hide: () => void | Promise<void>;
};

export type HomeworkEditorDialogElement = {
  show: () => void;
  hide: () => void | Promise<void>;
};

type AppDialogsOptions = {
  moreSheet: Ref<DialogElement | null>;
  isHomeworkFrozen: Ref<boolean>;
  saveHomeworkEditor: () => Promise<boolean>;
  resetHomeworkEditor: () => void;
  deleteHomework: (homeworkId: string) => Promise<void>;
};

export function useAppDialogs({
  moreSheet,
  isHomeworkFrozen,
  saveHomeworkEditor,
  resetHomeworkEditor,
  deleteHomework,
}: AppDialogsOptions) {
  const editorDialog = ref<HomeworkEditorDialogElement | null>(null);
  const exportDialog = ref<InstanceType<typeof HomeworkExportDialog> | null>(null);
  const exitDialog = ref<DialogElement | null>(null);
  const deleteDialog = ref<DialogElement | null>(null);
  const deleteHomeworkId = ref<string | null>(null);
  const deleteError = ref("");

  useWebKitGtkDialogExit(deleteDialog);
  useWebKitGtkDialogExit(exitDialog);

  function openMountedHomeworkEditor() {
    void nextTick(() => editorDialog.value?.show());
  }

  async function openHomeworkExport() {
    await hideWebKitGtkDialog(moreSheet.value);
    await nextTick();
    exportDialog.value?.show();
  }

  async function closeHomeworkEditor() {
    await hideWebKitGtkDialog(editorDialog.value);
    resetHomeworkEditor();
    logInfo("homework.editor.cancel", "作业编辑已取消");
  }

  async function saveEditedHomework() {
    if (await saveHomeworkEditor()) {
      await hideWebKitGtkDialog(editorDialog.value);
      resetHomeworkEditor();
      logInfo("homework.editor.close.after.save", "作业编辑已在保存后关闭");
    }
  }

  function requestDeleteHomework(id: string) {
    if (isHomeworkFrozen.value) {
      logInfo("homework.delete.blocked", "冻结状态下删除作业被阻止");
      return;
    }

    deleteHomeworkId.value = id;
    deleteError.value = "";
    logInfo("homework.delete.confirm.open", "已打开删除确认");
    void nextTick(() => deleteDialog.value?.show());
  }

  async function closeDeleteDialog(logCancellation = true) {
    await hideWebKitGtkDialog(deleteDialog.value);
    deleteHomeworkId.value = null;
    deleteError.value = "";
    if (logCancellation) logInfo("homework.delete.cancel", "删除作业已取消");
  }

  watch(isHomeworkFrozen, (frozen) => {
    if (!frozen) return;
    void closeHomeworkEditor();
    void closeDeleteDialog();
  });

  function requestCloseWindow() {
    exitDialog.value?.show();
    logInfo("window.close.request", "已打开关闭确认");
  }

  async function closeExitDialog() {
    await hideWebKitGtkDialog(exitDialog.value);
    logInfo("window.close.cancel", "关闭应用已取消");
  }

  async function confirmDeleteHomework() {
    if (!deleteHomeworkId.value) return;

    try {
      await deleteHomework(deleteHomeworkId.value);
      closeDeleteDialog(false);
    } catch {
      deleteError.value = "删除失败，请重试。";
    }
  }

  return {
    editorDialog,
    exportDialog,
    exitDialog,
    deleteDialog,
    deleteError,
    openMountedHomeworkEditor,
    openHomeworkExport,
    closeHomeworkEditor,
    saveEditedHomework,
    requestDeleteHomework,
    closeDeleteDialog,
    requestCloseWindow,
    closeExitDialog,
    confirmDeleteHomework,
  };
}
