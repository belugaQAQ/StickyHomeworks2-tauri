<script setup lang="ts">
import { ref, watch } from "vue";
import SettingsPage from "../components/SettingsPage.vue";
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import { logInfo } from "../services/logging";
type SwitchElement = HTMLElement & { checked: boolean };

const { appData, save, settingsError } = useSettingsAutosave();
const title = ref(appData.value.settings.title);

watch(() => appData.value.settings.title, (value) => {
  title.value = value;
});

function saveTitle() {
  logInfo("settings.title.change", "应用标题已修改");
  void save({ title: title.value });
}

function updateAlwaysOnBottom(event: Event) {
  logInfo("settings.always-on-bottom.change", "窗口置底设置已修改");
  void save({ alwaysOnBottom: (event.currentTarget as SwitchElement).checked });
}
</script>

<template>
  <SettingsPage title="通用" heading-id="settings-general-title" :error="settingsError" show-back>
    <m3e-list class="settings-control-list">
      <m3e-list-item class="settings-control-list__item">
        应用标题
        <span slot="supporting-text">显示在应用栏中的名称。</span>
        <m3e-form-field slot="trailing" variant="outlined" hide-subscript="always">
          <input id="settings-title" v-model="title" @change="saveTitle" />
        </m3e-form-field>
      </m3e-list-item>
      <m3e-divider inset></m3e-divider>
      <m3e-list-item class="settings-control-list__item">
        置底
        <span slot="supporting-text">开启后，桌面端窗口始终显示在其他窗口下方</span>
        <m3e-switch slot="trailing" icons="selected" :checked="appData.settings.alwaysOnBottom" @change="updateAlwaysOnBottom"></m3e-switch>
      </m3e-list-item>
    </m3e-list>
  </SettingsPage>
</template>
