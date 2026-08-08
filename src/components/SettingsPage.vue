<script setup lang="ts">
import { useRouter } from "vue-router";

defineProps<{
  title: string;
  headingId: string;
  error?: string;
  showBack?: boolean;
}>();

const router = useRouter();

function backToSettings() {
  void router.replace("/settings");
}
</script>

<template>
  <section class="settings-page" :aria-labelledby="headingId">
    <header class="settings-page__header">
      <m3e-icon-button v-if="showBack" aria-label="返回设置" title="返回设置" @click="backToSettings">
        <m3e-icon name="arrow_back"></m3e-icon>
      </m3e-icon-button>
      <m3e-heading :id="headingId" variant="headline" size="large" level="1">{{ title }}</m3e-heading>
    </header>
    <slot />
    <p v-if="error" class="editor-error" role="alert">{{ error }}</p>
  </section>
</template>
