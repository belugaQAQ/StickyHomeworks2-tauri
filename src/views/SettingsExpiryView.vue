<script setup lang="ts">
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import SettingsPage from "../components/SettingsPage.vue";
import SettingsExpandableSection from "../components/SettingsExpandableSection.vue";
import { logInfo } from "../services/logging";
const { appData, save, settingsError } = useSettingsAutosave();
function updateSwitch(key: "autoOutwork" | "delayedCleanupEnabled" | "isExpiredMarkEnabled", event: Event) {
  const checked = (event.currentTarget as HTMLElement & { checked: boolean }).checked;
  logInfo(`settings.${key}.change`, "过期设置开关已修改");
  void save({ [key]: checked });
}
function updateColor(event: Event) {
  logInfo("settings.expired.mark.color.change", "过期标记颜色已修改");
  void save({ expiredMarkColor: (event.currentTarget as HTMLInputElement).value });
}
</script>
<template>
  <SettingsPage title="过期作业" heading-id="settings-expiry-title" :error="settingsError" show-back>
    <div class="settings-expiry-controls">
      <SettingsExpandableSection
        :open="appData.settings.autoOutwork"
        @update:open="updateSwitch('autoOutwork', { currentTarget: { checked: $event } } as unknown as Event)"
      >
        <template #title>自动清理</template
        ><template #description>开启后，截止日期已过的作业会在启动、跨天或回到前台时自动移除。</template>
        <m3e-list class="settings-control-list settings-expiry-panel__list"
          ><m3e-list-item class="settings-control-list__item"
            >延迟清理<span slot="supporting-text">启用后，过期作业将额外保留一天。</span
            ><m3e-switch
              slot="trailing"
              aria-label="延迟清理"
              icons="selected"
              :disabled="!appData.settings.autoOutwork"
              :checked="appData.settings.delayedCleanupEnabled"
              @change="updateSwitch('delayedCleanupEnabled', $event)"
            ></m3e-switch></m3e-list-item
        ></m3e-list>
      </SettingsExpandableSection>
      <m3e-divider inset></m3e-divider>
      <SettingsExpandableSection
        :open="appData.settings.isExpiredMarkEnabled"
        @update:open="updateSwitch('isExpiredMarkEnabled', { currentTarget: { checked: $event } } as unknown as Event)"
      >
        <template #title>过期标记</template><template #description>在看板中用指定颜色标识过期作业。</template>
        <m3e-list class="settings-control-list settings-expiry-panel__list"
          ><m3e-list-item class="settings-control-list__item"
            >标记颜色<span slot="supporting-text">选择在看板中显示的过期标记颜色。</span
            ><m3e-form-field slot="trailing" variant="outlined" hide-subscript="always"
              ><input
                id="settings-expired-color"
                aria-label="标记颜色"
                type="color"
                :value="appData.settings.expiredMarkColor"
                @change="updateColor" /></m3e-form-field></m3e-list-item
        ></m3e-list>
      </SettingsExpandableSection>
    </div>
  </SettingsPage>
</template>
