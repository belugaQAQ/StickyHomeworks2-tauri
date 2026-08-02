<script setup lang="ts">
import SettingsPage from "../components/SettingsPage.vue";
import "../styles/settings-view.css";

const settingsSections = [
  { path: "/settings/general", icon: "tune", title: "通用", detail: "应用标题" },
  { path: "/settings/vocabulary", icon: "category", title: "作业词库", detail: "科目和标签" },
  { path: "/settings/expiry", icon: "event_busy", title: "过期作业", detail: "清理和标记" },
  { path: "/settings/board", icon: "view_column", title: "看板", detail: "最大面板宽度" },
];
</script>

<template>
  <SettingsPage title="设置" heading-id="settings-index-title">
    <m3e-action-list variant="segmented" class="settings-action-list">
      <m3e-list-action v-for="section in settingsSections" :key="section.path" :href="`#${section.path}`">
        <m3e-icon slot="leading" :name="section.icon"></m3e-icon>
        {{ section.title }}
        <span slot="supporting-text">{{ section.detail }}</span>
        <m3e-icon slot="trailing" name="chevron_right"></m3e-icon>
      </m3e-list-action>
    </m3e-action-list>
  </SettingsPage>
</template>
