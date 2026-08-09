<script setup lang="ts">
import { computed, ref } from "vue";
import { M3eSnackbar } from "@m3e/web/snackbar";
import { openUrl } from "@tauri-apps/plugin-opener";
import SettingsPage from "../components/SettingsPage.vue";
import { useAppContext } from "../app-context";
import { buildDiagnosticReport, type DiagnosticDisclosure } from "../services/diagnostic-report";
import { clearDiagnosticLogs, copyDiagnosticReport, DiagnosticError, exportDiagnosticBundle } from "../services/diagnostic-export";
import { clearBrowserLogEntries, flushLogs, getLoggingStatus, logError, logInfo } from "../services/logging";
import "../styles/settings-view.css";

type DialogElement = HTMLElement & { open: boolean; returnValue: string; show: () => void; hide: (returnValue?: string) => Promise<void> };
const { appData } = useAppContext();
const reportDialog = ref<DialogElement | null>(null);
const exportConfirmDialog = ref<DialogElement | null>(null);
const report = ref("");
const isBuildingReport = ref(false);
let reportBuildSequence = 0;
const isExportingBundle = ref(false);
const isClearingLogs = ref(false);
const selectedDisclosure = ref<DiagnosticDisclosure>("standard");
const disclosureControlKey = ref(0);
const disclosureHelp = computed(() => {
  switch (selectedDisclosure.value) {
    case "extended":
      return "扩展：环境、脱敏错误摘要、请求标识和诊断上下文。";
    case "full":
      return "完整：环境、错误摘要、请求标识、诊断上下文、作业、设置和完整轮转日志。";
    default:
      return "标准：环境和脱敏错误摘要。";
  }
});
const pendingDisclosure = ref<DiagnosticDisclosure | null>(null);
const pendingDisclosureAction = ref<"select" | "export" | null>(null);
const previousDisclosure = ref<DiagnosticDisclosure>("standard");
const confirmationAccepted = ref(false);
const disclosureConfirmationTitle = computed(() => pendingDisclosureAction.value === "select" ? "确认查看更多诊断内容？" : "确认导出更多诊断内容？");
const disclosureConfirmationAction = computed(() => pendingDisclosureAction.value === "select" ? "确认切换" : "确认导出");
const loggingStatus = getLoggingStatus();
function loggingStatusText(): string {
  return loggingStatus.persistenceAvailable ? "日志持久化正常" : `日志持久化异常：${loggingStatus.lastError || "未知错误"}`;
}

function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof DiagnosticError) {
    if (reason.code === "clipboard-unavailable") return "当前环境无法访问剪贴板，请检查权限后重试。";
    if (reason.code === "cancelled") return "操作已取消。";
    if (reason.code === "export-failed") return "诊断包导出失败，请检查目标位置后重试。";
  }
  return fallback;
}

async function showReport() {
  isBuildingReport.value = true;
  logInfo("diagnostic.report.open", "已请求打开标准诊断报告");
  try {
    selectedDisclosure.value = "standard";
    report.value = await buildDiagnosticReport(appData.value, "standard");
    reportDialog.value?.show();
    logInfo("diagnostic.report.open.success", "诊断报告已打开");
  } catch (reason) {
    logError("diagnostic.report.build", reason);
    M3eSnackbar.open(errorMessage(reason, "无法生成诊断信息，请重试。"));
  } finally {
    isBuildingReport.value = false;
  }
}

async function closeAndNotify(message: string) {
  await reportDialog.value?.hide();
  logInfo("diagnostic.report.close", "诊断报告已关闭");
  M3eSnackbar.open(message);
}

async function copyReport() {
  try {
    await copyDiagnosticReport(report.value);
    logInfo("diagnostic.report.copy.success", "诊断报告已复制");
  } catch (reason) {
    logError("diagnostic.report.copy", reason);
    await closeAndNotify(errorMessage(reason, "复制失败，请重试。"));
  }
}

async function updateDisclosure(value: DiagnosticDisclosure) {
  selectedDisclosure.value = value;
  const buildSequence = ++reportBuildSequence;
  isBuildingReport.value = true;
  try {
    const nextReport = await buildDiagnosticReport(appData.value, value);
    if (buildSequence === reportBuildSequence) report.value = nextReport;
  } catch (reason) {
    if (buildSequence === reportBuildSequence) {
      logError("diagnostic.report.build", reason, undefined, { disclosure: value });
      M3eSnackbar.open(errorMessage(reason, "无法更新诊断报告，请重试。"));
    }
  } finally {
    if (buildSequence === reportBuildSequence) isBuildingReport.value = false;
  }
}
async function selectDisclosure(value: DiagnosticDisclosure) {
  if (value === "full") {
    previousDisclosure.value = selectedDisclosure.value;
    pendingDisclosure.value = value;
    pendingDisclosureAction.value = "select";
    confirmationAccepted.value = false;
    disclosureControlKey.value += 1;
    exportConfirmDialog.value?.show();
    return;
  }
  await updateDisclosure(value);
}

function cancelDisclosureConfirmation() {
  if (pendingDisclosureAction.value === "select") {
    selectedDisclosure.value = previousDisclosure.value;
    disclosureControlKey.value += 1;
  }
  pendingDisclosure.value = null;
  pendingDisclosureAction.value = null;
}

async function handleDisclosureConfirmationClosed() {
  if (!confirmationAccepted.value) {
    cancelDisclosureConfirmation();
  }
  confirmationAccepted.value = false;
}

async function exportBundle() {
  const disclosure = selectedDisclosure.value;
  if (disclosure !== "standard") {
    pendingDisclosure.value = disclosure;
    pendingDisclosureAction.value = "export";
    confirmationAccepted.value = false;
    exportConfirmDialog.value?.show();
    return;
  }
  await performExport(disclosure);
}

async function confirmExport() {
  const disclosure = pendingDisclosure.value;
  const action = pendingDisclosureAction.value;
  confirmationAccepted.value = true;
  await exportConfirmDialog.value?.hide("confirm");
  pendingDisclosure.value = null;
  pendingDisclosureAction.value = null;
  if (!disclosure) return;
  if (action === "select") {
    await updateDisclosure(disclosure);
    return;
  }
  await performExport(disclosure);
}

async function performExport(disclosure: DiagnosticDisclosure) {
  isExportingBundle.value = true;
  logInfo("diagnostic.bundle.export.start", "诊断包导出已开始", undefined, { disclosure });
  try {
    if (await exportDiagnosticBundle(appData.value, disclosure)) {
      logInfo("diagnostic.bundle.export.success", "诊断包导出成功", undefined, { disclosure });
      await closeAndNotify("诊断包已导出。");
    } else {
      logInfo("diagnostic.bundle.export.cancel", "诊断包导出已取消", undefined, { disclosure });
    }
  } catch (reason) {
    logError("diagnostic.bundle.export", reason, undefined, { disclosure });
    await closeAndNotify(errorMessage(reason, "无法导出诊断包，请重试。"));
  } finally {
    isExportingBundle.value = false;
  }
}

async function clearLogs() {
  isClearingLogs.value = true;
  try {
    await flushLogs();
    await clearDiagnosticLogs();
    clearBrowserLogEntries();
    report.value = "";
    M3eSnackbar.open("诊断日志已清空。");
  } catch (reason) {
    logError("diagnostic.log.clear", reason);
    M3eSnackbar.open("清空诊断日志失败，请重试。");
  } finally {
    isClearingLogs.value = false;
  }
}

function joinQQgroup() {
  logInfo("diagnostic.feedback.qq", "已请求打开 QQ 群");
  void openUrl("https://qm.qq.com/q/2VUfjJuVq8");
}

function openGitHub() {
  logInfo("diagnostic.feedback.github", "已请求打开 GitHub");
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
          <p>标准报告只包含环境信息和脱敏后的警告/错误摘要；扩展和完整导出会在确认后加入更多诊断内容</p>
          <p>请只将它分享给受信任的支持人员，以防隐私泄露</p>
          <p class="settings-diagnostics__status">{{ loggingStatusText() }}<span v-if="loggingStatus.failedCount">，失败 {{ loggingStatus.failedCount }} 次</span></p>
        </div>
        <div slot="actions" end class="settings-diagnostics__actions">
          <m3e-button variant="filled" :disabled="isBuildingReport" @click="showReport">
            <m3e-icon slot="icon" name="content_copy"></m3e-icon>
            {{ isBuildingReport ? "正在生成…" : "复制或导出诊断信息" }}
          </m3e-button>
          <m3e-button variant="outlined" :disabled="isClearingLogs" @click="clearLogs">
            清空诊断日志
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
      <p class="settings-diagnostics__dialog-intro">预览包含最近错误日志<br/>切换导出内容级别将会控制你导出的信息多少,请谨慎修改<br/>完整的报告是对开发者最大的支持</p>

      <pre class="settings-diagnostics__report">{{ report }}</pre>
      <div class="settings-diagnostics__disclosure" aria-labelledby="diagnostic-disclosure-label">
        <m3e-heading id="diagnostic-disclosure-label" variant="label" size="large" level="3">导出内容级别</m3e-heading>
        <m3e-segmented-button :key="disclosureControlKey" aria-labelledby="diagnostic-disclosure-label">
          <m3e-button-segment value="standard" :checked="selectedDisclosure === 'standard'" @click="selectDisclosure('standard')">
            标准
          </m3e-button-segment>
          <m3e-button-segment value="extended" :checked="selectedDisclosure === 'extended'" @click="selectDisclosure('extended')">
            扩展
          </m3e-button-segment>
          <m3e-button-segment value="full" :checked="selectedDisclosure === 'full'" @click="selectDisclosure('full')">
            完整
          </m3e-button-segment>
        </m3e-segmented-button>
        <p class="settings-diagnostics__disclosure-help">{{ disclosureHelp }}</p>
      </div>
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
    <m3e-dialog ref="exportConfirmDialog" alert dismissible @closed="handleDisclosureConfirmationClosed">
      <m3e-heading slot="header" variant="headline" size="small" level="2">{{ disclosureConfirmationTitle }}</m3e-heading>
      <p>扩展级别包含请求标识和结构化诊断上下文；完整级别还包含当前作业、设置和完整轮转日志。请确认支持人员可信，并确认你要继续。</p>
      <div slot="actions" end class="settings-diagnostics__actions">
        <m3e-button variant="text" @click="cancelDisclosureConfirmation"><m3e-dialog-action return-value="cancel">取消</m3e-dialog-action></m3e-button>
        <m3e-button variant="filled" @click="confirmExport">{{ disclosureConfirmationAction }}</m3e-button>
      </div>
    </m3e-dialog>
  </SettingsPage>
</template>
