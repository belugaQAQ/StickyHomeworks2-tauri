<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAppContext } from "../app-context";
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import { useRangeSliderDrag } from "../composables/useRangeSliderDrag";
import { logInfo, logError } from "../services/logging";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { isTauri } from "@tauri-apps/api/core";
type SwitchElement = HTMLElement & { checked: boolean };
type SliderThumbElement = HTMLElement & { value?: string | number };
const { isMobileRuntime } = useAppContext();
const isDesktopApp = computed(() => !isMobileRuntime.value && isTauri());
const { appData, save } = useSettingsAutosave();
const title = ref(appData.value.settings.title);
const backgroundOpacity = ref(appData.value.settings.backgroundOpacity);
const homeworkScale = ref(appData.value.settings.homeworkScale);
const backgroundOpacitySlider = ref<HTMLElement | null>(null);
const backgroundOpacityThumb = ref<SliderThumbElement | null>(null);
const homeworkScaleSlider = ref<HTMLElement | null>(null);
const homeworkScaleThumb = ref<SliderThumbElement | null>(null);
watch(
  () => appData.value.settings.title,
  (value) => {
    title.value = value;
  },
);
function saveTitle() {
  logInfo("settings.title.change", "应用标题已修改");
  void save({ title: title.value });
}
function updateAlwaysOnBottom(event: Event) {
  const alwaysOnBottom = (event.currentTarget as SwitchElement).checked;
  logInfo("settings.always-on-bottom.change", "窗口置底设置已修改");
  void save({ alwaysOnBottom, ...(alwaysOnBottom ? { windowTopmost: false } : {}) });
}
function updateHideTaskbarIcon(event: Event) {
  const hideTaskbarIcon = (event.currentTarget as SwitchElement).checked;
  logInfo("settings.hide-taskbar-icon.change", "隐藏任务栏图标设置已修改");
  void save({ hideTaskbarIcon });
}
async function updateAutoStart(event: Event) {
  const checked = (event.currentTarget as SwitchElement).checked;
  try {
    if (isTauri()) {
      if (checked) await enable();
      else await disable();
    }
    await save({ autoStart: checked });
    await logInfo("settings.auto-start.change", "开机自启动设置已修改");
  } catch (error) {
    await logError("settings.auto-start.failure", error);
  }
}
function updateBackgroundOpacityPreview(event: Event) {
  const thumb = (event.target instanceof HTMLElement ? event.target : event.currentTarget) as SliderThumbElement;
  const value = Number(thumb.value ?? thumb.getAttribute("value") ?? thumb.getAttribute("aria-valuenow"));
  if (Number.isFinite(value)) backgroundOpacity.value = value;
}
function saveBackgroundOpacity(event: Event) {
  const thumb = (event.target instanceof HTMLElement ? event.target : event.currentTarget) as SliderThumbElement;
  const value = Number(thumb.value ?? thumb.getAttribute("value") ?? thumb.getAttribute("aria-valuenow"));
  if (!Number.isFinite(value)) return;
  backgroundOpacity.value = value;
  logInfo("settings.background-opacity.change", "背景透明度已修改");
  void save({ backgroundOpacity: value });
}
function updateHomeworkScalePreview(event: Event) {
  const thumb = (event.target instanceof HTMLElement ? event.target : event.currentTarget) as SliderThumbElement;
  const value = Number(thumb.value ?? thumb.getAttribute("value") ?? thumb.getAttribute("aria-valuenow"));
  if (Number.isFinite(value)) homeworkScale.value = value;
}
function saveHomeworkScale(event: Event) {
  const thumb = (event.target instanceof HTMLElement ? event.target : event.currentTarget) as SliderThumbElement;
  const value = Number(thumb.value ?? thumb.getAttribute("value") ?? thumb.getAttribute("aria-valuenow"));
  if (!Number.isFinite(value)) return;
  homeworkScale.value = value;
  logInfo("settings.homework-scale.change", "作业界面缩放已修改");
  void save({ homeworkScale: value });
}
function applySliderThumbValue(thumb: SliderThumbElement | null, value: number): void {
  if (!thumb) return;
  thumb.value = String(value);
  thumb.setAttribute("value", String(value));
  thumb.dispatchEvent(new Event("input", { bubbles: true }));
}
function commitSliderThumb(thumb: SliderThumbElement | null): void {
  thumb?.dispatchEvent(new Event("change", { bubbles: true }));
}
const backgroundOpacityDrag = useRangeSliderDrag({
  slider: () => backgroundOpacitySlider.value,
  resolveValue: (event, rect) => Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 100),
  onPreview: (value) => applySliderThumbValue(backgroundOpacityThumb.value, value),
  onCommit: () => commitSliderThumb(backgroundOpacityThumb.value),
});
const homeworkScaleDrag = useRangeSliderDrag({
  slider: () => homeworkScaleSlider.value,
  resolveValue: (event, rect) =>
    Math.round((75 + Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 125) / 5) * 5,
  onPreview: (value) => applySliderThumbValue(homeworkScaleThumb.value, value),
  onCommit: () => commitSliderThumb(homeworkScaleThumb.value),
});
</script>

<template>
  <m3e-list class="settings-control-list">
    <m3e-list-item class="settings-control-list__item"
      >应用标题<span slot="supporting-text">显示在应用栏中的名称。</span
      ><m3e-form-field slot="trailing" variant="outlined" hide-subscript="always"
        ><input id="settings-title" v-model="title" @change="saveTitle" /></m3e-form-field
    ></m3e-list-item>
    <template v-if="!isMobileRuntime">
      <m3e-divider inset></m3e-divider>
      <m3e-list-item class="settings-control-list__item"
        >主界面不透明度<span slot="supporting-text">调整背景和作业列表表面的不透明度</span
        ><m3e-slider
          ref="backgroundOpacitySlider"
          slot="trailing"
          min="0"
          max="100"
          step="5"
          labelled
          @pointerdown="backgroundOpacityDrag.onPointerDown"
          ><m3e-slider-thumb
            ref="backgroundOpacityThumb"
            :value="backgroundOpacity"
            aria-label="背景不透明度百分比"
            @input="updateBackgroundOpacityPreview"
            @change="saveBackgroundOpacity"
          ></m3e-slider-thumb></m3e-slider
      ></m3e-list-item>
      <m3e-divider inset></m3e-divider>
      <m3e-list-item class="settings-control-list__item"
        >主界面缩放<span slot="supporting-text">调整主界面的作业内容大小</span
        ><m3e-slider
          ref="homeworkScaleSlider"
          slot="trailing"
          min="75"
          max="200"
          step="5"
          labelled
          @pointerdown="homeworkScaleDrag.onPointerDown"
          ><m3e-slider-thumb
            ref="homeworkScaleThumb"
            :value="homeworkScale"
            :aria-label="`作业界面缩放百分比 ${homeworkScale}`"
            @input="updateHomeworkScalePreview"
            @change="saveHomeworkScale"
          ></m3e-slider-thumb></m3e-slider
      ></m3e-list-item>
    </template>
    <template v-if="isDesktopApp">
      <m3e-divider inset></m3e-divider>
      <m3e-list-item class="settings-control-list__item"
        >置底<span slot="supporting-text">开启后，桌面端窗口始终显示在其他窗口下方</span
        ><m3e-switch
          slot="trailing"
          icons="selected"
          :checked="appData.settings.alwaysOnBottom"
          @change="updateAlwaysOnBottom"
        ></m3e-switch
      ></m3e-list-item>
      <m3e-divider inset></m3e-divider>
      <m3e-list-item class="settings-control-list__item"
        >隐藏任务栏图标<span slot="supporting-text">开启后，桌面端窗口不再显示任务栏图标</span
        ><m3e-switch
          slot="trailing"
          icons="selected"
          :checked="appData.settings.hideTaskbarIcon"
          @change="updateHideTaskbarIcon"
        ></m3e-switch
      ></m3e-list-item>
    </template>
    <template v-if="isDesktopApp">
      <m3e-divider inset></m3e-divider>
      <m3e-list-item class="settings-control-list__item"
        >开机自启动<span slot="supporting-text">登录系统后自动启动应用。</span
        ><m3e-switch
          slot="trailing"
          icons="selected"
          :checked="appData.settings.autoStart"
          @change="updateAutoStart"
        ></m3e-switch
      ></m3e-list-item>
    </template>
  </m3e-list>
</template>
