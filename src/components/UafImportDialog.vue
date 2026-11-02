<script setup lang="ts">
import { computed, ref } from "vue";
import { M3eSnackbar } from "@m3e/web/all";
import { hideWebKitGtkDialog, useWebKitGtkDialogExit } from "../composables/useWebKitGtkDialogExit";
import { useAppContext } from "../app-context";
import { logError, logInfo } from "../services/logging";
import { readUafAssignmentsFromFile } from "../services/uaf-import";
import type { ImportedAssignment } from "../domain/homework";

type DialogElement = HTMLElement & {
  show: () => void | Promise<void>;
  hide: () => void | Promise<void>;
};

const { importUafAssignments } = useAppContext();
const dialog = ref<DialogElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const file = ref<File | null>(null);
const assignments = ref<ImportedAssignment[]>([]);
const errorMessage = ref("");
const isReading = ref(false);
const isImporting = ref(false);

useWebKitGtkDialogExit(dialog);

const canImport = computed(() => assignments.value.length > 0 && !isReading.value && !isImporting.value);
const subjectCount = computed(() => new Set(assignments.value.map((item) => item.subject.trim() || "其它")).size);
const statusText = computed(() => {
  if (isReading.value) return "正在读取…";
  if (errorMessage.value) return errorMessage.value;
  if (assignments.value.length > 0)
    return `识别到 ${assignments.value.length} 项作业，${subjectCount.value} 个科目`;
  return "支持 UAF 的 PDF 文件";
});

function show() {
  resetSelection();
  void Promise.resolve(dialog.value?.show());
}

async function hide() {
  if (isImporting.value) return;
  await hideWebKitGtkDialog(dialog.value);
}

function resetSelection() {
  file.value = null;
  assignments.value = [];
  errorMessage.value = "";
  if (fileInput.value) fileInput.value.value = "";
}

function chooseFile() {
  if (isReading.value || isImporting.value) return;
  logInfo("uaf.import.select", "已请求选择 UAF 文件");
  fileInput.value?.click();
}

async function updateFile(event: Event) {
  const selected = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  file.value = selected;
  assignments.value = [];
  errorMessage.value = "";
  if (!selected) return;

  isReading.value = true;
  try {
    assignments.value = await readUafAssignmentsFromFile(selected);
    logInfo("uaf.import.parsed", "已解析 UAF 文件", undefined, {
      fileName: selected.name,
      assignmentCount: assignments.value.length,
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法解析这个文件。";
    logError("uaf.import.parse", error);
  } finally {
    isReading.value = false;
  }
}

async function confirmImport() {
  if (!canImport.value) return;
  const count = assignments.value.length;
  isImporting.value = true;
  try {
    await hideWebKitGtkDialog(dialog.value);
    await importUafAssignments(assignments.value);
    logInfo("uaf.import.success", "UAF 作业导入完成", undefined, { assignmentCount: count });
    M3eSnackbar.open(`已导入 ${count} 项作业`);
    resetSelection();
  } catch (error) {
    logError("uaf.import.failure", error);
    M3eSnackbar.open("导入失败，请重试。");
  } finally {
    isImporting.value = false;
  }
}

defineExpose({ show, hide });
</script>

<template>
  <div class="uaf-import-dialog-root">
    <m3e-dialog ref="dialog" class="uaf-import-dialog" dismissible :disable-close="isImporting">
      <m3e-heading slot="header" variant="headline" size="small" level="2">导入 UAF 作业</m3e-heading>
      <div class="uaf-import-dialog__content">
        <input
          ref="fileInput"
          class="uaf-import-dialog__input"
          type="file"
          accept=".pdf,application/pdf"
          @change="updateFile"
        />
        <m3e-list>
          <m3e-list-item>
            {{ file?.name ?? "UAF PDF" }}
            <span slot="supporting-text">{{ statusText }}</span>
            <m3e-button slot="trailing" variant="outlined" :disabled="isReading || isImporting" @click="chooseFile">
              <m3e-icon slot="icon" name="folder_open"></m3e-icon>
              选择
            </m3e-button>
          </m3e-list-item>
        </m3e-list>
      </div>
      <div slot="actions" end>
        <m3e-button variant="text" :disabled="isImporting" @click="hide">取消</m3e-button>
        <m3e-button variant="filled" :disabled="!canImport" @click="confirmImport">
          <m3e-icon slot="icon" name="file_upload"></m3e-icon>
          {{ assignments.length ? `导入 ${assignments.length} 项` : "导入" }}
        </m3e-button>
      </div>
    </m3e-dialog>
  </div>
</template>

<style scoped>
.uaf-import-dialog__content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  --m3e-list-item-container-color: transparent;
  --m3e-list-item-leading-space: 0px;
  --m3e-list-item-trailing-space: 0px;
}

.uaf-import-dialog__input {
  display: none;
}

.uaf-import-dialog__hint {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 0.8125rem;
  line-height: 1.5;
}
</style>
