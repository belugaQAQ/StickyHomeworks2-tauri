<script setup lang="ts">
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import SettingsPage from "../components/SettingsPage.vue";
import { logInfo } from "../services/logging";

const { appData, save, settingsError } = useSettingsAutosave();

function updatePanelWidth(event: Event) {
  const width = Number((event.currentTarget as HTMLInputElement).value);
  if (Number.isFinite(width)) {
    logInfo("settings.panel.width.change", "看板最大宽度已修改");
    void save({ maxPanelWidth: width });
  }
}
</script>

<template>
  <SettingsPage title="看板" heading-id="settings-board-title" :error="settingsError" show-back>
    <m3e-form-field variant="outlined" hide-subscript="never">
      <label slot="label" for="settings-panel-width">最大面板宽度</label>
        <input id="settings-panel-width" type="number" placeholder="0" min="160" max="2000" step="10" :value="appData.settings.maxPanelWidth" @change="updatePanelWidth"/>
        <span slot="suffix">px</span>
        <span slot="hint">区间160~2000，须为10的倍数</span>
      </m3e-form-field>
  </SettingsPage>
</template>
