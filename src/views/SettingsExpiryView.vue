<script setup lang="ts">
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import SettingsPage from "../components/SettingsPage.vue";
import { logInfo } from "../services/logging";
import "../styles/settings-view.css";
type SwitchElement = HTMLElement & { checked: boolean };

const { appData, save, settingsError } = useSettingsAutosave();

function updateSwitch(key: "autoOutwork" | "delayedCleanupEnabled" | "isExpiredMarkEnabled", event: Event) {
  logInfo(`settings.${key}.change`, "过期设置开关已修改");
  void save({ [key]: (event.currentTarget as SwitchElement).checked });
}

function updateColor(event: Event) {
  logInfo("settings.expired.mark.color.change", "过期标记颜色已修改");
  void save({ expiredMarkColor: (event.currentTarget as HTMLInputElement).value });
}
</script>

<template>
  <SettingsPage title="过期作业" heading-id="settings-expiry-title" :error="settingsError" show-back>
    <label class="settings-switch-row">
      <span><strong>自动清理</strong><small>过期作业将在后续生命周期实现中按此设置处理。</small></span>
      <m3e-switch icons="selected" :checked="appData.settings.autoOutwork" @change="updateSwitch('autoOutwork', $event)"></m3e-switch>
    </label>
    <label class="settings-switch-row" :class="{ 'settings-switch-row--disabled': !appData.settings.autoOutwork }">
      <span><strong>延迟清理</strong><small>启用后，过期作业将额外保留一天。</small></span>
      <m3e-switch
        icons="selected"
        :checked="appData.settings.delayedCleanupEnabled"
        :disabled="!appData.settings.autoOutwork"
        @change="updateSwitch('delayedCleanupEnabled', $event)"
      ></m3e-switch>
    </label>
    <label class="settings-switch-row">
      <span><strong>过期标记</strong><small>在看板中用指定颜色标识过期作业。</small></span>
      <m3e-switch icons="selected" :checked="appData.settings.isExpiredMarkEnabled" @change="updateSwitch('isExpiredMarkEnabled', $event)"></m3e-switch>
    </label>
    <m3e-form-field variant="outlined" :class="{ 'settings-control--disabled': !appData.settings.isExpiredMarkEnabled }">
      <label slot="label" for="settings-expired-color">标记颜色</label>
      <input
        id="settings-expired-color"
        type="color"
        :value="appData.settings.expiredMarkColor"
        :disabled="!appData.settings.isExpiredMarkEnabled"
        @change="updateColor"
      />
    </m3e-form-field>
  </SettingsPage>
</template>
