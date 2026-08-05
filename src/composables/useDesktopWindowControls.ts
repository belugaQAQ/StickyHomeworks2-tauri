import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { onUnmounted, ref } from "vue";
import { logError } from "../services/logging";
export function useDesktopWindowControls() {
  const isDesktopWindow = ref(false);
  const isUnlocked = ref(false);
  const isMaximized = ref(false);
  const error = ref("");
  let unlistenResized: (() => void) | undefined;

  function reportFailure(reason?: unknown) {
    logError("window-control", reason ?? "窗口操作失败");
    error.value = "窗口操作失败，请重试。";
  }

  async function syncMaximized(window: Window) {
    isMaximized.value = await window.isMaximized();
  }

  async function runWindowAction(action: (window: Window) => Promise<void>) {
    if (!isDesktopWindow.value) return false;

    try {
      await action(getCurrentWindow());
      error.value = "";
      return true;
    } catch (reason) {
      reportFailure(reason);
      return false;
    }
  }

  async function initialize(isMobileRuntime: boolean) {
    isDesktopWindow.value = isTauri() && !isMobileRuntime;
    if (!isDesktopWindow.value) return;

    try {
      const appWindow = getCurrentWindow();
      await appWindow.setResizable(false);
      await syncMaximized(appWindow);
      unlistenResized?.();
      unlistenResized = await appWindow.onResized(() => {
        void syncMaximized(appWindow).catch(reportFailure);
      });
    } catch (reason) {
      reportFailure(reason);
    }
  }

  async function close() {
    await runWindowAction((window) => window.close());
  }

  async function minimize() {
    await runWindowAction((window) => window.minimize());
  }

  async function toggleMaximize() {
    await runWindowAction(async (window) => {
      await window.toggleMaximize();
      await syncMaximized(window);
    });
  }

  async function toggleUnlocked() {
    await runWindowAction(async (window) => {
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
    minimize,
    toggleMaximize,
    toggleUnlocked,
  };
}
