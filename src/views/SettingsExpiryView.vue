<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import SettingsPage from "../components/SettingsPage.vue";
import { logInfo } from "../services/logging";
import "../styles/settings-view.css";
type SwitchElement = HTMLElement & { checked: boolean };
type ExpansionPanelElement = HTMLElement & { updateComplete: Promise<boolean> };

const { appData, save, settingsError } = useSettingsAutosave();
const expiryControls = ref<HTMLElement | null>(null);

function updateSwitch(key: "autoOutwork" | "delayedCleanupEnabled" | "isExpiredMarkEnabled", event: Event) {
  const checked = (event.currentTarget as SwitchElement).checked;
  logInfo(`settings.${key}.change`, "过期设置开关已修改");
  void save({ [key]: checked });
}

function updateColor(event: Event) {
  logInfo("settings.expired.mark.color.change", "过期标记颜色已修改");
  void save({ expiredMarkColor: (event.currentTarget as HTMLInputElement).value });
}

function preventExpansionToggle(event: Event) {
  const path = event.composedPath();
  const isPanelHeaderEvent = path.some((node) => node instanceof HTMLElement && node.localName === "m3e-expansion-header");
  const isSwitchEvent = path.some((node) => node instanceof HTMLElement && node.localName === "m3e-switch");
  if (isPanelHeaderEvent && !isSwitchEvent) event.stopPropagation();
}

async function removePanelHeadersFromTabOrder() {
  await nextTick();
  const panels = [...(expiryControls.value?.querySelectorAll("m3e-expansion-panel") ?? [])] as ExpansionPanelElement[];
  await Promise.all(panels.map((panel) => panel.updateComplete));
  panels.forEach((panel) => {
    const header = panel.shadowRoot?.querySelector<HTMLElement>("m3e-expansion-header");
    if (header) header.tabIndex = -1;
  });
}

onMounted(() => void removePanelHeadersFromTabOrder());
</script>

<template>
  <SettingsPage title="过期作业" heading-id="settings-expiry-title" :error="settingsError" show-back>
    <div ref="expiryControls" class="settings-expiry-controls" @click.capture="preventExpansionToggle" @keydown.capture="preventExpansionToggle">
    <m3e-expansion-panel
      class="settings-expiry-panel"
      hide-toggle
      :open="appData.settings.autoOutwork"
    >
      <div slot="header" class="settings-expiry-panel__header" @click.stop @keydown.stop>
        <span class="settings-expiry-panel__title">自动清理</span>
        <small>过期作业将在后续生命周期实现中按此设置处理。</small>
        <m3e-switch
          aria-label="自动清理"
          icons="selected"
          :checked="appData.settings.autoOutwork"
          @click.stop
          @keydown.stop
          @change="updateSwitch('autoOutwork', $event)"
        ></m3e-switch>
      </div>
      <m3e-list class="settings-control-list settings-expiry-panel__list">
        <m3e-list-item class="settings-control-list__item">
          延迟清理
          <span slot="supporting-text">启用后，过期作业将额外保留一天。</span>
          <m3e-switch slot="trailing" aria-label="延迟清理" icons="selected" :checked="appData.settings.delayedCleanupEnabled" @change="updateSwitch('delayedCleanupEnabled', $event)"></m3e-switch>
        </m3e-list-item>
      </m3e-list>
    </m3e-expansion-panel>
    <m3e-divider inset></m3e-divider>

    <m3e-expansion-panel
      class="settings-expiry-panel"
      hide-toggle
      :open="appData.settings.isExpiredMarkEnabled"
    >
      <div slot="header" class="settings-expiry-panel__header" @click.stop @keydown.stop>
        <span class="settings-expiry-panel__title">过期标记</span>
        <small>在看板中用指定颜色标识过期作业。</small>
        <m3e-switch
          aria-label="过期标记"
          icons="selected"
          :checked="appData.settings.isExpiredMarkEnabled"
          @click.stop
          @keydown.stop
          @change="updateSwitch('isExpiredMarkEnabled', $event)"
        ></m3e-switch>
      </div>
      <m3e-list class="settings-control-list settings-expiry-panel__list">
        <m3e-list-item class="settings-control-list__item">
          标记颜色
          <span slot="supporting-text">选择在看板中显示的过期标记颜色。</span>
          <m3e-form-field slot="trailing" variant="outlined" hide-subscript="always">
            <input id="settings-expired-color" aria-label="标记颜色" type="color" :value="appData.settings.expiredMarkColor" @change="updateColor" />
          </m3e-form-field>
        </m3e-list-item>
      </m3e-list>
    </m3e-expansion-panel>
    </div>
  </SettingsPage>
</template>

