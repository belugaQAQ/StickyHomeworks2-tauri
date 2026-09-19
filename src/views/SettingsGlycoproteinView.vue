<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAppContext } from "../app-context";
import SettingsPage from "../components/SettingsPage.vue";
import { glycoproteinNodeIdError } from "../domain/settings";
import { useSettingsAutosave } from "../composables/useSettingsAutosave";
import {
  getGlycoproteinStatus,
  listenGlycoproteinStatus,
  type GlycoproteinStatus,
} from "../services/glycoprotein";
import { logError, logInfo } from "../services/logging";
import { createGlycoproteinNodeId } from "../types/app-data";
import "../styles/settings-view.css";

type SwitchElement = HTMLElement & { checked: boolean };

const { isMobileRuntime } = useAppContext();
const { appData, save, settingsError } = useSettingsAutosave();
const nodeId = ref(appData.value.settings.glycoproteinNodeId);
const localError = ref("");
const isSaving = ref(false);
const status = ref<GlycoproteinStatus>({
  supported: false,
  enabled: appData.value.settings.glycoproteinEnabled,
  running: false,
  nodeId: appData.value.settings.glycoproteinNodeId,
  socketDirectory: null,
  lastError: null,
});
let unlistenStatus: (() => void) | undefined;

const unavailable = computed(() => isMobileRuntime.value || !status.value.supported);
const pageError = computed(() => localError.value || settingsError.value);
const socketDirectoryParts = computed(() => {
  const socketDirectory = status.value.socketDirectory;
  if (!socketDirectory) return [];
  return socketDirectory.match(/[^\\/]*[\\/]|[^\\/]+$/g) ?? [socketDirectory];
});
const statusLabel = computed(() => {
  if (unavailable.value) return "当前平台不可用";
  if (status.value.running) return "运行中";
  if (!status.value.enabled) return "未启用";
  return status.value.lastError ? "启动失败" : "已停止";
});

watch(() => appData.value.settings.glycoproteinNodeId, (value) => {
  nodeId.value = value;
});

async function refreshStatus() {
  try {
    status.value = await getGlycoproteinStatus();
  } catch (error) {
    localError.value = "无法读取 Glycoprotein 状态。";
    void logError("glycoprotein.status.failure", error);
  }
}

async function updateEnabled(event: Event) {
  const enabled = (event.currentTarget as SwitchElement).checked;
  isSaving.value = true;
  localError.value = "";
  try {
    await save({ glycoproteinEnabled: enabled });
    if (settingsError.value) return;
    await refreshStatus();
    void logInfo("settings.glycoprotein.enabled.change", `Glycoprotein 已${enabled ? "启用" : "停用"}`);
  } finally {
    isSaving.value = false;
  }
}

async function saveNodeId() {
  const trimmedNodeId = nodeId.value.trim();
  const validationError = glycoproteinNodeIdError(trimmedNodeId);
  if (validationError) {
    localError.value = validationError;
    return;
  }

  isSaving.value = true;
  localError.value = "";
  try {
    await save({ glycoproteinNodeId: trimmedNodeId });
    if (settingsError.value) return;
    nodeId.value = appData.value.settings.glycoproteinNodeId;
    await refreshStatus();
    void logInfo("settings.glycoprotein.node-id.change", "Glycoprotein 节点 ID 已修改");
  } finally {
    isSaving.value = false;
  }
}

async function generateNodeId() {
  nodeId.value = createGlycoproteinNodeId();
  await saveNodeId();
}

onMounted(async () => {
  if (isMobileRuntime.value) return;
  try {
    unlistenStatus = await listenGlycoproteinStatus((nextStatus) => {
      status.value = nextStatus;
    });
  } catch (error) {
    void logError("glycoprotein.status.listen.failure", error);
  }
  await refreshStatus();
});

onBeforeUnmount(() => unlistenStatus?.());
</script>

<template>
  <SettingsPage title="Glycoprotein" heading-id="settings-glycoprotein-title" :error="pageError" show-back>
    <m3e-card v-if="unavailable" variant="outlined" class="settings-glycoprotein__notice">
      <m3e-heading slot="header" variant="title" size="medium" level="2">仅支持桌面端</m3e-heading>
      <p slot="content">Glycoprotein 节点仅在 Windows、Linux 和 macOS 桌面应用中运行。</p>
    </m3e-card>

    <m3e-list class="settings-control-list settings-glycoprotein__settings-list">
      <m3e-list-item class="settings-control-list__item">
        Glycoprotein 节点
        <span slot="supporting-text">通过本机 Unix Domain Socket 向其他 Glycoprotein 节点公开窗口控制与作业变更事件。</span>
        <m3e-switch
          slot="trailing"
          icons="selected"
          :checked="appData.settings.glycoproteinEnabled"
          :disabled="unavailable || isSaving"
          @change="updateEnabled"
        ></m3e-switch>
      </m3e-list-item>
      <m3e-divider inset></m3e-divider>
      <div class="settings-glycoprotein__node-id-item" role="group" aria-labelledby="settings-glycoprotein-node-id-label">
        <div class="settings-glycoprotein__node-id-copy">
          <label
            id="settings-glycoprotein-node-id-label"
            class="settings-glycoprotein__node-id-label"
            for="settings-glycoprotein-node-id"
          >节点 ID</label>
          <p id="settings-glycoprotein-node-id-help" class="settings-glycoprotein__node-id-supporting-text">
            修改后会重建运行中的节点；同一设备上的 ID 必须唯一。
          </p>
        </div>
        <div class="settings-glycoprotein__node-id-controls">
          <m3e-form-field variant="outlined" hide-subscript="always">
            <input
              id="settings-glycoprotein-node-id"
              v-model="nodeId"
              aria-describedby="settings-glycoprotein-node-id-help"
              :disabled="unavailable || isSaving"
              @change="saveNodeId"
            />
          </m3e-form-field>
          <m3e-button variant="text" :disabled="unavailable || isSaving" @click="generateNodeId">重新生成</m3e-button>
        </div>
      </div>
    </m3e-list>

    <section class="settings-group settings-glycoprotein" aria-labelledby="settings-glycoprotein-status-title">
      <m3e-heading id="settings-glycoprotein-status-title" variant="title" size="large" level="2">运行状态</m3e-heading>
      <m3e-card variant="outlined">
        <div slot="content" class="settings-glycoprotein__status-content">
          <dl class="settings-glycoprotein__status-list">
            <div class="settings-glycoprotein__status-row">
              <dt>状态</dt>
              <dd><strong :class="{ 'settings-glycoprotein__running': status.running }">{{ statusLabel }}</strong></dd>
            </div>
            <div class="settings-glycoprotein__status-row">
              <dt>当前节点 ID</dt>
              <dd><code>{{ status.nodeId || appData.settings.glycoproteinNodeId }}</code></dd>
            </div>
            <div v-if="status.socketDirectory" class="settings-glycoprotein__status-row settings-glycoprotein__status-row--path">
              <dt>Socket 目录</dt>
              <dd>
                <code :title="status.socketDirectory">
                  <span v-for="(part, index) in socketDirectoryParts" :key="`${index}-${part}`">{{ part }}<wbr /></span>
                </code>
              </dd>
            </div>
          </dl>
          <p v-if="status.lastError" class="settings-glycoprotein__error" role="alert">{{ status.lastError }}</p>
        </div>
      </m3e-card>
    </section>
  </SettingsPage>
</template>
