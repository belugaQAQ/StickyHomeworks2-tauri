<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref } from "vue";
const visible = ref(true);

async function sync() {
  visible.value = await invoke<boolean>("window_visibility");
}

async function toggle() {
  const nextVisible = !visible.value;
  await invoke("set_window_visibility", { visible: nextVisible });
  visible.value = nextVisible;
}

async function openSettings() {
  if (!visible.value) return;
  await invoke("show_main_window");
  await invoke("navigate_main_window", { path: "/settings/general" });
  await invoke("hide_tray_menu");
}

async function quit() {
  await invoke("quit_application");
}

function closeOnBlur() {
  void invoke("hide_tray_menu");
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") closeOnBlur();
}

onMounted(() => {
  document.documentElement.classList.add("tray-menu-window");
  document.body.classList.add("tray-menu-window");
  window.addEventListener("blur", closeOnBlur);
  window.addEventListener("keydown", closeOnEscape);
  void sync();
});

onUnmounted(() => {
  window.removeEventListener("blur", closeOnBlur);
  window.removeEventListener("keydown", closeOnEscape);
});
</script>
<template>
  <main class="tray-menu" @contextmenu.prevent>
    <m3e-card class="tray-menu__card" variant="filled">
      <div class="tray-menu__content">
        <m3e-heading variant="headline" size="small" level="1">StickyHomeworks2 · N</m3e-heading>
        <m3e-list variant="segmented" class="tray-menu__list">
          <m3e-list-item>
            显示主窗口
            <span slot="supporting-text">控制主窗口显示状态</span>
            <m3e-switch slot="trailing" icons="selected" :checked="visible" aria-label="显示主窗口" @change="toggle"></m3e-switch>
          </m3e-list-item>
        </m3e-list>
        <m3e-action-list variant="segmented" class="tray-menu__actions">
          <m3e-list-action :disabled="!visible" @click="openSettings">
            <m3e-icon slot="leading" name="settings"></m3e-icon>
            打开设置
          </m3e-list-action>
          <m3e-list-action @click="quit">
            <m3e-icon slot="leading" name="power_settings_new"></m3e-icon>
            退出应用
          </m3e-list-action>
        </m3e-action-list>
      </div>
    </m3e-card>
  </main>
</template>

<style scoped>
:global(html.tray-menu-window),
:global(body.tray-menu-window),
:global(body.tray-menu-window #app) {
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  background: transparent !important;
}

.tray-menu {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
}

.tray-menu__card {
  width: 100%;
  height: 100%;
  --m3e-filled-card-container-color: var(--md-sys-color-surface-container);
  --m3e-filled-card-text-color: var(--md-sys-color-on-surface);
}

.tray-menu__content {
  display: grid;
  gap: 0.25rem;
  height: 100%;
  padding: 0.75rem;
  box-sizing: border-box;
}

.tray-menu__content > m3e-heading {
  margin: 0;
}

.tray-menu__list,
.tray-menu__actions {
  --m3e-list-container-color: var(--md-sys-color-surface-container-high);
  --m3e-list-item-container-color: var(--md-sys-color-surface-container-high);
  --m3e-segmented-list-container-color: var(--md-sys-color-surface-container-high);
  --m3e-segmented-list-item-container-color: var(--md-sys-color-surface-container-high);
}
</style>
