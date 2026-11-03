<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { M3eSnackbar } from "@m3e/web/all";
import { hideWebKitGtkDialog, useWebKitGtkDialogExit } from "../composables/useWebKitGtkDialogExit";
import { prepareM3eDialog } from "../m3e-internals";
import { useAppContext } from "../app-context";
import {
  createHomeworkExportFilename,
  exportHomeworkImage,
  exportHomeworkUafPdf,
  saveHomeworkExport,
  saveHomeworkUafPdf,
} from "../services/homework-export";
import { logError, logInfo } from "../services/logging";
import { readUafAssignmentsFromFile } from "../services/uaf-import";
import type { ImportedAssignment } from "../domain/homework";
import type { SubjectGroup } from "../types/homework-board";
import type { HomeworkExportLayout, HomeworkExportPixelRatio } from "../types/homework-export";

type DialogElement = HTMLElement & {
  show: () => void | Promise<void>;
  hide: () => void | Promise<void>;
};

const props = defineProps<{
  groups: SubjectGroup[];
  title: string;
  mobileLayout: boolean;
  maxPanelWidth: number;
}>();

const { importUafAssignments } = useAppContext();

const dialog = ref<DialogElement | null>(null);
const layout = ref<HomeworkExportLayout>("board");
const pixelRatio = ref<HomeworkExportPixelRatio>(2);
const isExporting = ref(false);
const isClosing = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const uafFile = ref<File | null>(null);
const uafAssignments = ref<ImportedAssignment[]>([]);
const uafError = ref("");
const isReadingUaf = ref(false);
const isImportingUaf = ref(false);

const layoutOptions = [
  { value: "board" as const, label: "横板宽图" },
  { value: "long-image" as const, label: "纵版长图" },
  { value: "uaf-pdf" as const, label: "UAF PDF" },
];

useWebKitGtkDialogExit(dialog);

const isUafLayout = computed(() => layout.value === "uaf-pdf");
const isBusy = computed(() => isExporting.value || isClosing.value || isImportingUaf.value || isReadingUaf.value);
const uafSubjectCount = computed(() => new Set(uafAssignments.value.map((item) => item.subject.trim() || "其它")).size);
const canImportUaf = computed(() => uafAssignments.value.length > 0 && !isBusy.value);
const uafStatus = computed(() => {
  if (isReadingUaf.value) return "正在读取…";
  if (uafError.value) return uafError.value;
  if (uafAssignments.value.length > 0)
    return `识别到 ${uafAssignments.value.length} 项作业，${uafSubjectCount.value} 个科目`;
  return "支持 UAF 的 PDF 文件";
});

/**
 * 导出渲染期间不读实时数据。
 */
function cloneGroups(groups: SubjectGroup[]): SubjectGroup[] {
  return JSON.parse(JSON.stringify(groups)) as SubjectGroup[];
}

function show() {
  layout.value = props.mobileLayout ? "long-image" : "board";
  pixelRatio.value = 2;
  resetUafSelection();
  void nextTick(() => {
    void Promise.resolve(dialog.value?.show()).then(() => prepareM3eDialog(dialog.value));
  });
}

async function hide() {
  if (isExporting.value || isClosing.value) return;
  await hideWebKitGtkDialog(dialog.value);
}

function selectLayout(value: HomeworkExportLayout) {
  if (!isExporting.value && !isClosing.value) layout.value = value;
}

async function closeForExport() {
  isClosing.value = true;
  try {
    await hideWebKitGtkDialog(dialog.value);
    await nextTick();
  } finally {
    isClosing.value = false;
  }
}

async function exportSelected() {
  if (isExporting.value || isClosing.value || isImportingUaf.value) return;
  if (!props.groups.length) {
    M3eSnackbar.open("没有可导出的作业。");
    return;
  }

  const uaf = isUafLayout.value;
  await closeForExport();

  isExporting.value = true;
  try {
    M3eSnackbar.open("渲染中");
    await nextTick();
    const options = {
      layout: layout.value,
      pixelRatio: pixelRatio.value,
      title: props.title,
      groups: cloneGroups(props.groups),
      maxPanelWidth: props.maxPanelWidth,
    };
    M3eSnackbar.open("保存中");
    if (uaf) {
      const result = await exportHomeworkUafPdf(options);
      const saved = await saveHomeworkUafPdf(result, createHomeworkExportFilename(props.title, new Date(), "uaf.pdf"));
      M3eSnackbar.open(saved ? `UAF 已保存（${result.pageCount} 页）` : "已取消保存");
    } else {
      const result = await exportHomeworkImage(options);
      const saved = await saveHomeworkExport(result, createHomeworkExportFilename(props.title));
      M3eSnackbar.open(saved ? "作业图片已保存" : "已取消保存");
    }
  } catch (reason) {
    M3eSnackbar.open(reason instanceof Error ? reason.message : String(reason) || "导出失败，请重试。");
  } finally {
    isExporting.value = false;
  }
}

function resetUafSelection() {
  uafFile.value = null;
  uafAssignments.value = [];
  uafError.value = "";
  if (fileInput.value) fileInput.value.value = "";
}

function chooseUafFile() {
  if (isBusy.value) return;
  logInfo("uaf.import.select", "已请求选择 UAF 文件");
  fileInput.value?.click();
}

async function updateUafFile(event: Event) {
  const selected = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  uafFile.value = selected;
  uafAssignments.value = [];
  uafError.value = "";
  if (!selected) return;

  isReadingUaf.value = true;
  try {
    uafAssignments.value = await readUafAssignmentsFromFile(selected);
    logInfo("uaf.import.parsed", "已解析 UAF 文件", undefined, {
      fileName: selected.name,
      assignmentCount: uafAssignments.value.length,
    });
  } catch (error) {
    uafError.value = error instanceof Error ? error.message : "无法解析这个文件。";
    logError("uaf.import.parse", error);
  } finally {
    isReadingUaf.value = false;
  }
}

async function importUaf() {
  if (!canImportUaf.value) return;
  const count = uafAssignments.value.length;
  isImportingUaf.value = true;
  try {
    await importUafAssignments(uafAssignments.value);
    logInfo("uaf.import.success", "UAF 作业导入完成", undefined, { assignmentCount: count });
    M3eSnackbar.open(`已导入 ${count} 项作业`);
    resetUafSelection();
  } catch (error) {
    logError("uaf.import.failure", error);
    M3eSnackbar.open("导入失败，请重试。");
  } finally {
    isImportingUaf.value = false;
  }
}

defineExpose({ show, hide });
</script>

<template>
  <div class="homework-transfer-root">
    <m3e-dialog ref="dialog" class="homework-transfer-dialog" dismissible :disable-close="isBusy">
      <m3e-heading slot="header" variant="headline" size="small" level="2">导入 / 导出作业</m3e-heading>
      <div class="homework-transfer-dialog__content">
        <section class="homework-transfer-dialog__section" aria-labelledby="homework-transfer-export-title">
          <m3e-heading id="homework-transfer-export-title" variant="label" size="large" level="3">
            导出作业
          </m3e-heading>
          <div class="homework-transfer-dialog__control">
            <span class="homework-transfer-dialog__label">布局</span>
            <m3e-segmented-button :disabled="isBusy">
              <m3e-button-segment
                v-for="option in layoutOptions"
                :key="option.value"
                :checked="layout === option.value"
                @click="selectLayout(option.value)"
              >
                {{ option.label }}
              </m3e-button-segment>
            </m3e-segmented-button>
          </div>
          <div class="homework-transfer-dialog__control">
            <span class="homework-transfer-dialog__label">图片倍率</span>
            <m3e-segmented-button :disabled="isBusy">
              <m3e-button-segment
                v-for="ratio in [2, 4, 8]"
                :key="ratio"
                :checked="pixelRatio === ratio"
                @click="pixelRatio = ratio as HomeworkExportPixelRatio"
              >
                {{ ratio }}×
              </m3e-button-segment>
            </m3e-segmented-button>
          </div>
          <m3e-button variant="filled" :disabled="isBusy || !groups.length" @click="exportSelected">
            <m3e-icon slot="icon" name="download"></m3e-icon>
            {{ isUafLayout ? "导出 UAF PDF" : "导出 PNG" }}
          </m3e-button>
        </section>

        <section class="homework-transfer-dialog__section" aria-labelledby="homework-transfer-import-title">
          <m3e-heading id="homework-transfer-import-title" variant="label" size="large" level="3">
            导入 UAF 作业
          </m3e-heading>
          <input
            ref="fileInput"
            class="homework-transfer-dialog__input"
            type="file"
            accept=".pdf,application/pdf"
            @change="updateUafFile"
          />
          <m3e-list>
            <m3e-list-item>
              {{ uafFile?.name ?? "UAF PDF" }}
              <span slot="supporting-text">{{ uafStatus }}</span>
              <m3e-button slot="trailing" variant="outlined" :disabled="isBusy" @click="chooseUafFile">
                <m3e-icon slot="icon" name="folder_open"></m3e-icon>
                选择
              </m3e-button>
            </m3e-list-item>
          </m3e-list>
          <m3e-button variant="filled" :disabled="!canImportUaf" @click="importUaf">
            <m3e-icon slot="icon" name="file_upload"></m3e-icon>
            {{ uafAssignments.length ? `导入 ${uafAssignments.length} 项` : "导入" }}
          </m3e-button>
          <p class="homework-transfer-dialog__hint">导入的作业会追加到列表</p>
        </section>
      </div>
      <div slot="actions" end>
        <m3e-button variant="text" :disabled="isBusy" @click="hide">关闭</m3e-button>
      </div>
    </m3e-dialog>
    <div
      v-if="isExporting || isImportingUaf || isReadingUaf"
      class="homework-transfer-dialog__scrim"
      role="status"
      aria-live="polite"
      :aria-label="isExporting ? '正在导出作业' : '正在处理 UAF 文件'"
      aria-busy="true"
    >
      <m3e-loading-indicator variant="contained"></m3e-loading-indicator>
    </div>
  </div>
</template>

<style scoped>
.homework-transfer-root {
  display: contents;
}

.homework-transfer-dialog {
  --m3e-dialog-max-width: min(920px, 100% - 48px);
  --m3e-dialog-max-height: min(80vh, 100% - 48px);
}

.homework-transfer-dialog__content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  padding-block-end: 12px;
  --m3e-list-item-container-color: transparent;
  --m3e-list-item-leading-space: 0px;
  --m3e-list-item-trailing-space: 0px;
}

.homework-transfer-dialog__content m3e-list {
  overflow: visible;
}

.homework-transfer-dialog__content m3e-list-item [slot="supporting-text"] {
  white-space: normal;
  overflow-wrap: anywhere;
}

.homework-transfer-dialog__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.homework-transfer-dialog__section + .homework-transfer-dialog__section {
  padding-block-start: 20px;
  border-block-start: 1px solid var(--md-sys-color-outline-variant);
}

.homework-transfer-dialog__control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.homework-transfer-dialog__control m3e-segmented-button {
  display: flex;
  width: 100%;
  min-width: 0;
}

.homework-transfer-dialog__label {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 0.75rem;
}

.homework-transfer-dialog__input {
  display: none;
}

.homework-transfer-dialog__hint {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 0.8125rem;
  line-height: 1.5;
}

@media (min-width: 900px) {
  .homework-transfer-dialog__content {
    flex-direction: row;
    align-items: flex-start;
    gap: 24px;
  }

  .homework-transfer-dialog__section {
    flex: 1 1 auto;
    min-width: 18rem;
  }

  .homework-transfer-dialog__section + .homework-transfer-dialog__section {
    padding-block-start: 0;
    padding-inline-start: 24px;
    border-block-start: 0;
    border-inline-start: 1px solid var(--md-sys-color-outline-variant);
  }
}

.homework-transfer-dialog__scrim {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--md-sys-color-scrim, #000) 52%, transparent);
  cursor: wait;
  pointer-events: all;
}
</style>
