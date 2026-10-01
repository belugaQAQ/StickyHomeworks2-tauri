<script setup lang="ts">
import AppShell from "./layouts/AppShell.vue";
import TrayMenuView from "./views/TrayMenuView.vue";

const isTrayMenu = window.location.hash.startsWith("#/tray-menu");
</script>

<template>
  <TrayMenuView v-if="isTrayMenu" />
  <AppShell v-else />
</template>
