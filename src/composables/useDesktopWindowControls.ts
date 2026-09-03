import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { onUnmounted, ref } from "vue";
import { flushLogs, logError, logInfo } from "../services/logging";
export function useDesktopWindowControls() {
  const isDesktopWindow = ref(false);
  const isUnlocked = ref(false);
  const isMaximized = ref(false);
  const error = ref("");
  let unlistenResized: (() => void) | undefined;

  function reportFailure(reason?: unknown) {
    logError("window.control.failure", reason ?? "窗口操作失败");
    error.value = "窗口操作失败，请重试。";
  }

  async function syncMaximized(window: Window) {
    isMaximized.value = await window.isMaximized();
  }

  async function runWindowAction(operation: string, action: (window: Window) => Promise<void>) {
    if (!isDesktopWindow.value) return false;

    try {
      await action(getCurrentWindow());
      error.value = "";
      logInfo(operation, "窗口操作完成");
      return true;
    } catch (reason) {
      reportFailure(reason);
      return false;
    }
  }

  async function setAlwaysOnBottom(alwaysOnBottom: boolean) {
    return runWindowAction("window.always-on-bottom", (window) => window.setAlwaysOnBottom(alwaysOnBottom));
  }

  async function initialize(isMobileRuntime: boolean, alwaysOnBottom: boolean) {
    isDesktopWindow.value = isTauri() && !isMobileRuntime;
    if (!isDesktopWindow.value) return;

    try {
      const appWindow = getCurrentWindow();
      await appWindow.setResizable(false);
      await appWindow.setAlwaysOnBottom(alwaysOnBottom);
      await syncMaximized(appWindow);
      unlistenResized?.();
      unlistenResized = await appWindow.onResized(() => {
        logInfo("window.resize", "窗口尺寸已变化");
        void syncMaximized(appWindow).catch(reportFailure);
      });
    } catch (reason) {
      reportFailure(reason);
    }
  }

  async function close() {
    await flushLogs();
    await runWindowAction("window.close", (window) => window.close());
  }

  async function minimize() {
    await runWindowAction("window.minimize", (window) => window.minimize());
  }

  async function toggleMaximize() {
    await runWindowAction("window.maximize-toggle", async (window) => {
      await window.toggleMaximize();
      await syncMaximized(window);
    });
  }

  async function toggleUnlocked() {
    await runWindowAction("window.unlock-toggle", async (window) => {
      const nextUnlocked = !isUnlocked.value;

      await window.setResizable(nextUnlocked);
      isUnlocked.value = nextUnlocked;
      await syncMaximized(window);
    });
  }

  onUnmounted(() => unlistenResized?.());

  return {
    isDesktopWindow,
    isUnlocked,
    isMaximized,
    error,
    initialize,
    close,
    setAlwaysOnBottom,
    minimize,
    toggleMaximize,
    toggleUnlocked,
  };
}
