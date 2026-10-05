<script setup lang="ts">
import { nextTick, ref } from "vue";
import { hideWebKitGtkDialog, useWebKitGtkDialogExit } from "../composables/useWebKitGtkDialogExit";
import {
  createHomeworkExportFilename,
  exportHomeworkImage,
  saveHomeworkExport,
} from "../services/homework-export";
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

const dialog = ref<DialogElement | null>(null);
const layout = ref<HomeworkExportLayout>("board");
const pixelRatio = ref<HomeworkExportPixelRatio>(2);
const isClosing = ref(false);
const isExporting = ref(false);

const layoutOptions = [
  { value: "board" as const, label: "横板宽图" },
  { value: "long-image" as const, label: "纵版长图" },
];

useWebKitGtkDialogExit(dialog);

function prepareDialog() {
  const root = dialog.value?.shadowRoot;
  const base = root?.querySelector<HTMLDialogElement>(".base");
  const content = root?.querySelector<HTMLElement>(".content");
  if (!base || !content) return;
  base.style.maxHeight = "calc(100dvh - 2rem)";
  content.style.flex = "1 1 auto";
  content.style.minHeight = "0";
  content.style.overflow = "auto";
}

function show() {
  layout.value = props.mobileLayout ? "long-image" : "board";
  pixelRatio.value = 2;
  if (!props.groups.length) M3eSnackbar.open("没有可导出的作业。");
  void nextTick(() => {
    void Promise.resolve(dialog.value?.show()).then(prepareDialog);
  });
}

function selectLayout(value: HomeworkExportLayout) {
  if (!isExporting.value && !isClosing.value) layout.value = value;
}

async function hide() {
  if (isExporting.value || isClosing.value) return;
  isClosing.value = true;
  try {
    await hideWebKitGtkDialog(dialog.value);
  } finally {
    isClosing.value = false;
  }
}

async function exportImage() {
  if (isExporting.value || isClosing.value) return;
  if (!props.groups.length) {
    M3eSnackbar.open("没有可导出的作业。");
    return;
  }

  isClosing.value = true;
  try {
    await hideWebKitGtkDialog(dialog.value);
    await nextTick();
  } finally {
    isClosing.value = false;
  }

  isExporting.value = true;
  try {
    M3eSnackbar.open("准备中");
    await nextTick();
    M3eSnackbar.open("渲染中");
    const exportGroups = JSON.parse(JSON.stringify(props.groups)) as SubjectGroup[];
    const result = await exportHomeworkImage({
      layout: layout.value,
      pixelRatio: pixelRatio.value,
      title: props.title,
      groups: exportGroups,
      maxPanelWidth: props.maxPanelWidth,
    });
    M3eSnackbar.open("保存中");
    const saved = await saveHomeworkExport(result, createHomeworkExportFilename(props.title));
    M3eSnackbar.open(saved ? "作业图片已保存" : "已取消保存");
  } catch (reason) {
    M3eSnackbar.open(reason instanceof Error ? reason.message : String(reason) || "导出失败，请重试。");
  } finally {
    isExporting.value = false;
  }
}

defineExpose({ show, hide });
</script>

<template>
  <div class="homework-export-dialog-root">
    <m3e-dialog ref="dialog" class="homework-export-dialog" dismissible :disable-close="isExporting">
      <m3e-heading slot="header" variant="headline" size="small" level="2">导出作业图片</m3e-heading>
      <div class="homework-export-dialog__content">
        <div class="homework-export-dialog__control" aria-labelledby="homework-export-layout-label">
          <m3e-heading id="homework-export-layout-label" variant="label" size="large" level="3">图片布局</m3e-heading>
          <m3e-segmented-button :disabled="isExporting">
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
        <div class="homework-export-dialog__control" aria-labelledby="homework-export-ratio-label">
          <m3e-heading id="homework-export-ratio-label" variant="label" size="large" level="3">图片倍率</m3e-heading>
          <m3e-segmented-button :disabled="isExporting">
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
      </div>
      <div slot="actions" end>
        <m3e-button variant="text" :disabled="isExporting" @click="hide">取消</m3e-button>
        <m3e-button variant="filled" :disabled="isExporting || !groups.length" @click="exportImage">
          <m3e-icon slot="icon" name="download"></m3e-icon>
          导出 PNG
        </m3e-button>
      </div>
    </m3e-dialog>
    <div
      v-if="isExporting"
      class="homework-export-dialog__scrim"
      role="status"
      aria-live="polite"
      aria-label="正在导出作业图片"
      aria-busy="true"
    >
      <m3e-loading-indicator variant="contained"></m3e-loading-indicator>
    </div>
  </div>
</template>
