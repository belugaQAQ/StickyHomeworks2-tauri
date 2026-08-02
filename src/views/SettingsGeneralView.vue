<script setup lang="ts">
import { ref, watch } from "vue";
import SettingsPage from "../components/SettingsPage.vue";
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import "../styles/settings-view.css";

const { appData, save, settingsError } = useSettingsAutosave();
const title = ref(appData.value.settings.title);

watch(() => appData.value.settings.title, (value) => {
  title.value = value;
});

function saveTitle() {
  void save({ title: title.value });
}
</script>

<template>
  <SettingsPage title="通用" heading-id="settings-general-title" :error="settingsError" show-back>
    <m3e-form-field variant="outlined">
      <label slot="label" for="settings-title">应用标题</label>
      <input id="settings-title" v-model="title" @change="saveTitle" />
    </m3e-form-field>
  </SettingsPage>
</template>
