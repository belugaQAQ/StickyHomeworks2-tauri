<script setup lang="ts">
import { ref, watch } from "vue";
import { useAppContext } from "../app-context";
import SettingsPage from "../components/SettingsPage.vue";
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import { logInfo, logError } from "../services/logging";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { isTauri } from "@tauri-apps/api/core";
type SwitchElement = HTMLElement & { checked: boolean };
type SliderThumbElement = HTMLElement & { value?: string | number };
const { isMobileRuntime } = useAppContext();
const { appData, save, settingsError } = useSettingsAutosave();
const title = ref(appData.value.settings.title);
const backgroundOpacity = ref(appData.value.settings.backgroundOpacity);
const homeworkScale = ref(appData.value.settings.homeworkScale);
const backgroundOpacitySlider = ref<HTMLElement | null>(null);
const backgroundOpacityThumb = ref<SliderThumbElement | null>(null);
const homeworkScaleSlider = ref<HTMLElement | null>(null);
const homeworkScaleThumb = ref<SliderThumbElement | null>(null);
watch(() => appData.value.settings.title, (value) => { title.value = value; });
function saveTitle() { logInfo("settings.title.change", "应用标题已修改"); void save({ title: title.value }); }
function updateAlwaysOnBottom(event: Event) {
  const alwaysOnBottom = (event.currentTarget as SwitchElement).checked;
  logInfo("settings.always-on-bottom.change", "窗口置底设置已修改");
  void save({ alwaysOnBottom, ...(alwaysOnBottom ? { windowTopmost: false } : {}) });
}
async function updateAutoStart(event: Event) {
  const checked = (event.currentTarget as SwitchElement).checked;
  try {
    if (isTauri()) { if (checked) await enable(); else await disable(); }
    await save({ autoStart: checked });
    await logInfo("settings.auto-start.change", "开机自启动设置已修改");
  } catch (error) { await logError("settings.auto-start.failure", error); }
}
function updateBackgroundOpacityPreview(event: Event) { const thumb = (event.target instanceof HTMLElement ? event.target : event.currentTarget) as SliderThumbElement; const value = Number(thumb.value ?? thumb.getAttribute("value") ?? thumb.getAttribute("aria-valuenow")); if (Number.isFinite(value)) backgroundOpacity.value = value; }
function saveBackgroundOpacity(event: Event) { const thumb = (event.target instanceof HTMLElement ? event.target : event.currentTarget) as SliderThumbElement; const value = Number(thumb.value ?? thumb.getAttribute("value") ?? thumb.getAttribute("aria-valuenow")); if (!Number.isFinite(value)) return; backgroundOpacity.value = value; logInfo("settings.background-opacity.change", "背景透明度已修改"); void save({ backgroundOpacity: value }); }
function updateHomeworkScalePreview(event: Event) { const thumb = (event.target instanceof HTMLElement ? event.target : event.currentTarget) as SliderThumbElement; const value = Number(thumb.value ?? thumb.getAttribute("value") ?? thumb.getAttribute("aria-valuenow")); if (Number.isFinite(value)) homeworkScale.value = value; }
function saveHomeworkScale(event: Event) { const thumb = (event.target instanceof HTMLElement ? event.target : event.currentTarget) as SliderThumbElement; const value = Number(thumb.value ?? thumb.getAttribute("value") ?? thumb.getAttribute("aria-valuenow")); if (!Number.isFinite(value)) return; homeworkScale.value = value; logInfo("settings.homework-scale.change", "作业界面缩放已修改"); void save({ homeworkScale: value }); }
function setHomeworkScaleFromPointer(event: PointerEvent) { const slider = homeworkScaleSlider.value; const thumb = homeworkScaleThumb.value; if (!slider || !thumb) return; const rect = slider.getBoundingClientRect(); const value = Math.round((75 + Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 125) / 5) * 5; thumb.value = String(value); thumb.setAttribute("value", String(value)); thumb.dispatchEvent(new Event("input", { bubbles: true })); }
function beginHomeworkScalePointer(event: PointerEvent) { if (event.button !== 0 || !homeworkScaleSlider.value) return; event.preventDefault(); const slider = homeworkScaleSlider.value; slider.setPointerCapture(event.pointerId); setHomeworkScaleFromPointer(event); slider.addEventListener("pointermove", setHomeworkScaleFromPointer as EventListener); slider.addEventListener("pointerup", endHomeworkScalePointer as EventListener, { once: true }); slider.addEventListener("pointercancel", endHomeworkScalePointer as EventListener, { once: true }); }
function endHomeworkScalePointer(event: PointerEvent) { const slider = homeworkScaleSlider.value; if (!slider) return; slider.removeEventListener("pointermove", setHomeworkScaleFromPointer as EventListener); if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId); homeworkScaleThumb.value?.dispatchEvent(new Event("change", { bubbles: true })); }
function setBackgroundOpacityFromPointer(event: PointerEvent) { const slider = backgroundOpacitySlider.value; const thumb = backgroundOpacityThumb.value; if (!slider || !thumb) return; const rect = slider.getBoundingClientRect(); const value = Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 100); thumb.value = String(value); thumb.setAttribute("value", String(value)); thumb.dispatchEvent(new Event("input", { bubbles: true })); }
function beginBackgroundOpacityPointer(event: PointerEvent) { if (event.button !== 0 || !backgroundOpacitySlider.value) return; event.preventDefault(); const slider = backgroundOpacitySlider.value; slider.setPointerCapture(event.pointerId); setBackgroundOpacityFromPointer(event); slider.addEventListener("pointermove", setBackgroundOpacityFromPointer as EventListener); slider.addEventListener("pointerup", endBackgroundOpacityPointer as EventListener, { once: true }); slider.addEventListener("pointercancel", endBackgroundOpacityPointer as EventListener, { once: true }); }
function endBackgroundOpacityPointer(event: PointerEvent) { const slider = backgroundOpacitySlider.value; if (!slider) return; slider.removeEventListener("pointermove", setBackgroundOpacityFromPointer as EventListener); if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId); backgroundOpacityThumb.value?.dispatchEvent(new Event("change", { bubbles: true })); }
 </script>

<template>
  <SettingsPage title="通用" heading-id="settings-general-title" :error="settingsError" show-back>
    <m3e-list class="settings-control-list">
      <m3e-list-item class="settings-control-list__item">应用标题<span slot="supporting-text">显示在应用栏中的名称。</span><m3e-form-field slot="trailing" variant="outlined" hide-subscript="always"><input id="settings-title" v-model="title" @change="saveTitle" /></m3e-form-field></m3e-list-item>
      <template v-if="!isMobileRuntime">
        <m3e-divider inset></m3e-divider>
        <m3e-list-item class="settings-control-list__item">背景透明度<span slot="supporting-text">调整背景和作业列表表面的透明度，不影响应用栏。</span><m3e-slider ref="backgroundOpacitySlider" slot="trailing" min="0" max="100" step="5" labelled @pointerdown="beginBackgroundOpacityPointer"><m3e-slider-thumb ref="backgroundOpacityThumb" :value="backgroundOpacity" aria-label="背景透明度百分比" @input="updateBackgroundOpacityPreview" @change="saveBackgroundOpacity"></m3e-slider-thumb></m3e-slider></m3e-list-item>
        <m3e-divider inset></m3e-divider>
        <m3e-list-item class="settings-control-list__item">作业界面缩放<span slot="supporting-text">仅调整主界面的作业内容，不影响设置、应用栏和对话框。</span><m3e-slider ref="homeworkScaleSlider" slot="trailing" min="75" max="200" step="5" labelled @pointerdown="beginHomeworkScalePointer"><m3e-slider-thumb ref="homeworkScaleThumb" :value="homeworkScale" :aria-label="`作业界面缩放百分比 ${homeworkScale}`" @input="updateHomeworkScalePreview" @change="saveHomeworkScale"></m3e-slider-thumb></m3e-slider></m3e-list-item>
        <m3e-divider inset></m3e-divider>
        <m3e-list-item class="settings-control-list__item">置底<span slot="supporting-text">开启后，桌面端窗口始终显示在其他窗口下方</span><m3e-switch slot="trailing" icons="selected" :checked="appData.settings.alwaysOnBottom" @change="updateAlwaysOnBottom"></m3e-switch></m3e-list-item>
        <m3e-divider inset></m3e-divider>
        <m3e-list-item class="settings-control-list__item">开机自启动<span slot="supporting-text">登录系统后自动启动应用。</span><m3e-switch slot="trailing" icons="selected" :checked="appData.settings.autoStart" @change="updateAutoStart"></m3e-switch></m3e-list-item>
      </template>
    </m3e-list>
  </SettingsPage>
</template>
