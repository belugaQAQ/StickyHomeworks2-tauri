<script setup lang="ts">
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import SettingsPage from "../components/SettingsPage.vue";
import { logInfo } from "../services/logging";

const { appData, save, settingsError } = useSettingsAutosave();
const PANEL_WIDTH_MIN = 160;
const PANEL_WIDTH_MAX = 2000;
const PANEL_WIDTH_STEP = 10;
const PANEL_WIDTH_HINT = "区间160~2000，须为10的倍数。";

/** 与 normalizeSettings 的 maxPanelWidth 归一化保持一致。 */
function normalizePanelWidth(value: number): number {
  return Math.round(Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, value)) / PANEL_WIDTH_STEP) * PANEL_WIDTH_STEP;
}

function updatePanelWidth(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const raw = Number(input.value);
  const width =
    input.value.trim() && Number.isFinite(raw) ? normalizePanelWidth(raw) : appData.value.settings.maxPanelWidth;
  // 静默归一化：非法、越界或非步长的值直接写回输入框，不额外提示用户。
  input.value = String(width);
  logInfo("settings.panel.width.change", "看板最大宽度已修改");
  void save({ maxPanelWidth: width });
}
</script>

<template>
  <SettingsPage title="看板" heading-id="settings-board-title" :error="settingsError" show-back>
    <m3e-list class="settings-control-list">
      <m3e-list-item class="settings-control-list__item">
        最大面板宽度
        <span slot="supporting-text">{{ PANEL_WIDTH_HINT }}</span>
        <m3e-form-field slot="trailing" variant="outlined" hide-subscript="always">
          <input
            id="settings-panel-width"
            aria-label="最大面板宽度"
            type="number"
            placeholder="0"
            min="160"
            max="2000"
            step="10"
            :value="appData.settings.maxPanelWidth"
            @change="updatePanelWidth"
          />
          <span slot="suffix">px</span>
        </m3e-form-field>
      </m3e-list-item>
    </m3e-list>
  </SettingsPage>
</template>
