<script setup lang="ts">
defineProps<{
  title: string;
  headingId: string;
  error?: string;
  showBack?: boolean;
}>();
</script>

<template>
  <section class="settings-page" :aria-labelledby="headingId">
    <header class="settings-page__header">
      <RouterLink v-if="showBack" class="settings-back-link" to="/settings" aria-label="返回设置">
        <m3e-icon name="arrow_back"></m3e-icon>
      </RouterLink>
      <m3e-heading :id="headingId" variant="headline" size="large" level="1">{{ title }}</m3e-heading>
    </header>
    <slot />
    <p v-if="error" class="editor-error" role="alert">{{ error }}</p>
  </section>
</template>
