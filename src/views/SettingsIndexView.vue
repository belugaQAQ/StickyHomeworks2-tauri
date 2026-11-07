<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { settingsSections } from "../settings/sections";
import { SETTINGS_DETAIL_MIN_WIDTH } from "../ui/breakpoints";
import "../styles/settings-view.css";

const router = useRouter();

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
</script>

<template>
  <m3e-action-list variant="segmented" class="settings-action-list">
    <m3e-list-action v-for="section in settingsSections" :key="section.path" :href="`#${section.path}`">
      <m3e-icon slot="leading" :name="section.icon"></m3e-icon>
      {{ section.title }}
      <span slot="supporting-text">{{ section.detail }}</span>
      <span slot="trailing" class="settings-index__trailing">
        <m3e-chip-set v-if="section.experimental">
          <m3e-chip variant="outlined">
            <m3e-icon slot="icon" name="science"></m3e-icon>
            实验性
          </m3e-chip>
        </m3e-chip-set>
        <m3e-icon name="chevron_right"></m3e-icon>
      </span>
    </m3e-list-action>
  </m3e-action-list>
</template>

<style scoped>
.settings-index__trailing {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
