<script setup lang="ts">
import { computed, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { M3eSnackbar } from "@m3e/web/snackbar";
import SettingsPage from "../components/SettingsPage.vue";
import { useAppContext } from "../app-context";
import { logError, logInfo } from "../services/logging";
import "../styles/settings-view.css";

type DialogElement = HTMLElement & {
  show: () => void;
  hide: () => void;
};

const { importLegacyData, settingsError } = useAppContext();
const profileInput = ref<HTMLInputElement | null>(null);
const settingsInput = ref<HTMLInputElement | null>(null);
const confirmDialog = ref<DialogElement | null>(null);
const profileFile = ref<File | null>(null);
const settingsFile = ref<File | null>(null);
const isImporting = ref(false);
const canImport = computed(() => isTauri() && settingsFile.value && !isImporting.value);

function selectProfile() {
  if (!isTauri()) {
    logInfo("legacy.import.select.profile.blocked", "浏览器模式下选择 Profile.json 被阻止");
    return;
  }
  logInfo("legacy.import.select.profile", "已请求选择 Profile.json");
  profileInput.value?.click();
}

function selectSettings() {
  if (!isTauri()) {
    logInfo("legacy.import.select.settings.blocked", "浏览器模式下选择 Settings.json 被阻止");
    return;
  }
  logInfo("legacy.import.select.settings", "已请求选择 Settings.json");
  settingsInput.value?.click();
}

function updateProfile(event: Event) {
  profileFile.value = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  logInfo(profileFile.value ? "legacy.import.profile.selected" : "legacy.import.profile.cleared", profileFile.value ? "已选择 Profile.json" : "已清除 Profile.json 选择");
}

function updateSettings(event: Event) {
  settingsFile.value = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  logInfo(settingsFile.value ? "legacy.import.settings.selected" : "legacy.import.settings.cleared", settingsFile.value ? "已选择 Settings.json" : "已清除 Settings.json 选择");
}

function requestImport() {
  if (!canImport.value) {
    logInfo("legacy.import.request.blocked", "未选择必要文件或导入正在进行");
    return;
  }
  logInfo("legacy.import.confirm.open", "已打开导入确认");
  confirmDialog.value?.show();
}

function closeConfirmDialog() {
  confirmDialog.value?.hide();
  if (!isImporting.value) logInfo("legacy.import.cancel", "导入已取消");
}

async function confirmImport() {
  if (!settingsFile.value || isImporting.value) return;

  isImporting.value = true;
  let profileContents: string | undefined;
  let settingsContents: string;
  try {
    [profileContents, settingsContents] = await Promise.all([
      profileFile.value?.text(),
      settingsFile.value.text(),
    ]);
  } catch (error) {
    logError("legacy.import.file.read", error);
    M3eSnackbar.open("无法读取所选文件，请确认文件可访问后重试。");
    isImporting.value = false;
    return;
  }

  try {
    const result = await importLegacyData(profileContents, settingsContents);
    const changes = [
      result.legacyRichTextCount ? `${result.legacyRichTextCount} 项旧版富文本将按纯文本降级显示` : "",
      result.removedTagReferenceCount ? `已覆盖 ${result.removedTagReferenceCount} 个词库外标签` : "",
      result.replacedSubjectCount ? `${result.replacedSubjectCount} 项作业科目被移除` : "",
    ].filter(Boolean);
    const changeMessage = changes.length ? `${changes.join("；")}。` : "";
    const message = profileFile.value
      ? `已导入 ${result.data.homeworks.length} 项作业和设置。${changeMessage}`
      : `已导入旧版设置，保留当前作业。${changeMessage}`;
    M3eSnackbar.open(message);
    closeConfirmDialog();
  } catch (error) {
    logError("legacy.import.data", error);
    M3eSnackbar.open("导入失败，请检查所选文件后重试。");
  } finally {
    isImporting.value = false;
  }
}
</script>

<template>
  <SettingsPage title="导入旧版数据" heading-id="settings-import-title" :error="settingsError" show-back>
    <section class="settings-group settings-import" aria-labelledby="settings-import-files-title">
      <m3e-heading id="settings-import-files-title" variant="title" size="large" level="2">选择文件</m3e-heading>
      <input ref="profileInput" class="settings-file-input" type="file" accept="application/json,.json" @change="updateProfile" />
      <input ref="settingsInput" class="settings-file-input" type="file" accept="application/json,.json" @change="updateSettings" />
      <div class="settings-import__file">
        <div>
          <strong>Profile.json（可选）</strong>
          <small>{{ profileFile?.name ?? "保留当前作业" }}</small>
        </div>
        <m3e-button variant="outlined" :disabled="!isTauri()" @click="selectProfile">
          <m3e-icon slot="icon" name="folder_open"></m3e-icon>
          选择
        </m3e-button>
      </div>
      <div class="settings-import__file">
        <div>
          <strong>Settings.json</strong>
          <small>{{ settingsFile?.name ?? "必须选择" }}</small>
        </div>
        <m3e-button variant="outlined" :disabled="!isTauri()" @click="selectSettings">
          <m3e-icon slot="icon" name="folder_open"></m3e-icon>
          选择
        </m3e-button>
      </div>
    </section>

    <p v-if="!isTauri()" class="settings-import__notice" role="status">旧版数据导入仅可在 Tauri 应用中使用。</p>
    <m3e-button variant="filled" :disabled="!canImport" @click="requestImport">
      <m3e-icon slot="icon" name="file_upload"></m3e-icon>
      导入
    </m3e-button>

    <m3e-dialog ref="confirmDialog" alert disable-close>
      <m3e-heading slot="header" variant="headline" size="small" level="2">导入旧版数据？</m3e-heading>
      {{ profileFile ? "导入会替换当前的作业和设置，并导入标签和科目，无法撤销。" : "导入会覆盖当前设置，保留现有作业，并导入标签和科目。" }}
      <div slot="actions" end>
        <m3e-button variant="text" :disabled="isImporting" @click="closeConfirmDialog">取消</m3e-button>
        <m3e-button variant="filled" :disabled="isImporting" @click="confirmImport">导入并替换</m3e-button>
      </div>
    </m3e-dialog>
  </SettingsPage>
</template>
