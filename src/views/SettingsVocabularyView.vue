<script setup lang="ts">
import { ref } from "vue";
import SettingsPage from "../components/SettingsPage.vue";
import { uniqueVocabulary } from "../domain/vocabulary";
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import "../styles/settings-view.css";

const { appData, update, deleteGlobalTag, settingsError } = useSettingsAutosave();
const newSubject = ref("");
const newTag = ref("");

function addVocabulary(key: "subjects" | "tags") {
  const input = key === "subjects" ? newSubject : newTag;
  const value = input.value.trim();
  if (!value) return;

  input.value = "";
  void update((settings) => ({
    ...settings,
    [key]: uniqueVocabulary([...settings[key], value]),
  }));
}

function removeVocabulary(key: "subjects" | "tags", value: string) {
  if (key === "tags") {
    void deleteGlobalTag(value);
    return;
  }

  void update((settings) => ({
    ...settings,
    subjects: settings.subjects.filter((item) => item !== value),
  }));
}
</script>

<template>
  <SettingsPage title="作业词库" heading-id="settings-vocabulary-title" :error="settingsError" show-back>

    <section class="settings-group" aria-labelledby="settings-subjects-title">
      <m3e-heading id="settings-subjects-title" variant="title" size="large" level="2">科目</m3e-heading>
      <m3e-form-field variant="outlined">
        <label slot="label" for="settings-subjects">新增科目</label>
        <input id="settings-subjects" v-model="newSubject" @keydown.enter.prevent="addVocabulary('subjects')" />
        <m3e-icon-button slot="suffix" aria-label="添加科目" @click="addVocabulary('subjects')">
          <m3e-icon name="add"></m3e-icon>
        </m3e-icon-button>
      </m3e-form-field>
      <m3e-chip-set v-if="appData.settings.subjects.length" class="settings-chip-set">
        <m3e-input-chip
          v-for="subject in appData.settings.subjects"
          :key="subject"
          removable
          :remove-label="`移除科目 ${subject}`"
          @remove="removeVocabulary('subjects', subject)"
        >
          {{ subject }}
        </m3e-input-chip>
      </m3e-chip-set>
    </section>

    <section class="settings-group" aria-labelledby="settings-tags-title">
      <m3e-heading id="settings-tags-title" variant="title" size="large" level="2">标签</m3e-heading>
      <m3e-form-field variant="outlined">
        <label slot="label" for="settings-tags">新增标签</label>
        <input id="settings-tags" v-model="newTag" @keydown.enter.prevent="addVocabulary('tags')" />
        <m3e-icon-button slot="suffix" aria-label="添加标签" @click="addVocabulary('tags')">
          <m3e-icon name="add"></m3e-icon>
        </m3e-icon-button>
      </m3e-form-field>
      <m3e-chip-set v-if="appData.settings.tags.length" class="settings-chip-set">
        <m3e-input-chip
          v-for="tag in appData.settings.tags"
          :key="tag"
          removable
          :remove-label="`移除标签 ${tag}`"
          @remove="removeVocabulary('tags', tag)"
        >
          {{ tag }}
        </m3e-input-chip>
      </m3e-chip-set>
    </section>
  </SettingsPage>
</template>
