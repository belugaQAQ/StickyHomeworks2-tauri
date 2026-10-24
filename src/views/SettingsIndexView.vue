<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useAppContext } from "../app-context";
import SettingsPage from "../components/SettingsPage.vue";
import { visibleSettingsSections } from "../settings/sections";
import { SETTINGS_DETAIL_MIN_WIDTH } from "../ui/breakpoints";
import "../styles/settings-view.css";

const router = useRouter();
const { isMobileRuntime } = useAppContext();

function redirectToGeneralOnWideWindow() {
  if (window.innerWidth > SETTINGS_DETAIL_MIN_WIDTH) {
    void router.replace("/settings/general");
  }
}

onMounted(() => {
  window.addEventListener("resize", redirectToGeneralOnWideWindow);
});

onUnmounted(() => {
  window.removeEventListener("resize", redirectToGeneralOnWideWindow);
});

const visibleSections = computed(() => visibleSettingsSections(isMobileRuntime.value));
</script>

<template>
  <SettingsPage title="设置" heading-id="settings-index-title">
    <m3e-action-list variant="segmented" class="settings-action-list">
      <m3e-list-action v-for="section in visibleSections" :key="section.path" :href="`#${section.path}`">
        <m3e-icon slot="leading" :name="section.icon"></m3e-icon>
        {{ section.title }}
        <span slot="supporting-text">{{ section.detail }}</span>
        <m3e-icon slot="trailing" name="chevron_right"></m3e-icon>
      </m3e-list-action>
    </m3e-action-list>
  </SettingsPage>
</template>
