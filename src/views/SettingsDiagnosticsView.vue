<script setup lang="ts">
import { ref } from "vue";
import { M3eSnackbar } from "@m3e/web/snackbar";
import { openUrl } from "@tauri-apps/plugin-opener";
import SettingsPage from "../components/SettingsPage.vue";
import { useAppContext } from "../app-context";
import { buildDiagnosticReport, copyDiagnosticReport, exportDiagnosticBundle } from "../services/diagnostics";
import { logError } from "../services/logging";
import "../styles/settings-view.css";

type DialogElement = HTMLElement & {
  open: boolean;
  show: () => void;
  hide: (returnValue?: string) => Promise<void>;
};

const { appData } = useAppContext();
const reportDialog = ref<DialogElement | null>(null);
const report = ref("");
const isBuildingReport = ref(false);
const isExportingBundle = ref(false);
async function showReport() {
  isBuildingReport.value = true;
  try {
    report.value = await buildDiagnosticReport(appData.value);
    reportDialog.value?.show();
  } catch (reason) {
    logError("diagnostic-report.build", reason);
    M3eSnackbar.open("无法生成诊断信息，请重试。");
  } finally {
    isBuildingReport.value = false;
  }
}

async function closeAndNotify(message: string) {
  await reportDialog.value?.hide();
  M3eSnackbar.open(message);
}

async function copyReport() {
  try {
    await copyDiagnosticReport(report.value);
    await closeAndNotify("诊断信息已复制。");
  } catch (reason) {
    logError("diagnostic-report.copy", reason);
    await closeAndNotify("复制失败，请检查剪贴板权限后重试。");
  }
}

async function exportBundle() {
  isExportingBundle.value = true;
  try {
    if (await exportDiagnosticBundle(appData.value)) await closeAndNotify("诊断包已导出。");
  } catch (reason) {
    logError("diagnostic-bundle.export", reason);
    await closeAndNotify("无法导出诊断包，请重试。");
  } finally {
    isExportingBundle.value = false;
  }
}

function joinQQgroup() {
  void openUrl("https://qm.qq.com/q/2VUfjJuVq8");
}

function openGitHub() {
  void openUrl("https://github.com/belugaQAQ/StickyHomeworks2-tauri/issues/new");
}
</script>

<template>
  <SettingsPage title="诊断信息" heading-id="settings-diagnostics-title" show-back>

    <section class="settings-group settings-diagnostics" aria-labelledby="settings-diagnostics-report-title">
      <m3e-heading id="settings-diagnostics-report-title" variant="title" size="large" level="2">诊断报告</m3e-heading>
      <m3e-card variant="outlined">
        <m3e-heading slot="header" variant="title" size="medium" level="3">用于排查应用问题</m3e-heading>
        <div slot="content" class="settings-diagnostics__content">
          <p>诊断包包含当前作业与设置数据、诊断报告和最近日志</p>
          <p>请只将它分享给受信任的支持人员，以防隐私泄露</p>
        </div>
        <div slot="actions" end class="settings-diagnostics__actions">
          <m3e-button variant="filled" :disabled="isBuildingReport" @click="showReport">
            <m3e-icon slot="icon" name="content_copy"></m3e-icon>
            {{ isBuildingReport ? "正在生成…" : "复制或导出诊断信息" }}
          </m3e-button>
        </div>
      </m3e-card>
    </section>

    <section class="settings-group settings-diagnostics" aria-labelledby="settings-diagnostics-feedback-title">
      <m3e-heading id="settings-diagnostics-feedback-title" variant="title" size="large" level="2">反馈渠道</m3e-heading>
      <m3e-card variant="outlined">
        <m3e-heading slot="header" variant="title" size="medium" level="3">提交问题或建议</m3e-heading>
        <div slot="actions" end class="settings-diagnostics__actions">
          <m3e-button variant="outlined" @click="joinQQgroup">
            <m3e-icon slot="icon" name="forum--outlined"></m3e-icon>
            加入QQ群
          </m3e-button>
          <m3e-button variant="outlined" @click="openGitHub">
            <m3e-icon slot="icon" name="open_in_new"></m3e-icon>
            打开 GitHub
          </m3e-button>
        </div>
      </m3e-card>
    </section>

    <m3e-dialog ref="reportDialog" dismissible>
      <span slot="header">查看诊断报告</span>
      <p class="settings-diagnostics__dialog-intro">预览包含最近错误日志<br/>打包会另外加入当前作业、设置和完整日志<br/>在反馈时建议提供诊断包</p>
      <pre class="settings-diagnostics__report">{{ report }}</pre>
      <div slot="actions" end class="settings-diagnostics__actions">
        <m3e-button variant="text"><m3e-dialog-action return-value="cancel">取消</m3e-dialog-action></m3e-button>
        <m3e-button variant="outlined" :disabled="isExportingBundle" @click="exportBundle">
          <m3e-icon slot="icon" name="folder_zip"></m3e-icon>
          {{ isExportingBundle ? "正在打包…" : "打包诊断信息" }}
        </m3e-button>
        <m3e-button variant="filled" @click="copyReport">
          <m3e-icon slot="icon" name="content_copy"></m3e-icon>
          复制诊断信息
        </m3e-button>
      </div>
    </m3e-dialog>
  </SettingsPage>
</template>
