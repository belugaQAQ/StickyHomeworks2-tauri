import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { onUnmounted, ref } from "vue";
import { flushLogs, logError, logInfo } from "../services/logging";

export type WindowGeometryPatch = {
  windowX?: number;
  windowY?: number;
  windowWidth?: number;
  windowHeight?: number;
};

export function useDesktopWindowControls() {
  const isDesktopWindow = ref(false);
  const isUnlocked = ref(false);
  const isMaximized = ref(false);
  const error = ref("");
  let unlistenResized: (() => void) | undefined;
  let unlistenMoved: (() => void) | undefined;
  let geometryTimer: number | undefined;
  let pendingGeometry: WindowGeometryPatch = {};
  let geometrySaveHandler: ((patch: WindowGeometryPatch) => void | Promise<void>) | undefined;

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

  function scheduleGeometrySave(
    patch: WindowGeometryPatch,
    onGeometryChanged?: (patch: WindowGeometryPatch) => void | Promise<void>,
  ) {
    if (!onGeometryChanged) return;
    geometrySaveHandler = onGeometryChanged;
    pendingGeometry = { ...pendingGeometry, ...patch };
    if (geometryTimer !== undefined) window.clearTimeout(geometryTimer);
    geometryTimer = window.setTimeout(() => {
      geometryTimer = undefined;
      void flushGeometrySave().catch(reportFailure);
    }, 250);
  }

  async function flushGeometrySave() {
    if (geometryTimer !== undefined) {
      window.clearTimeout(geometryTimer);
      geometryTimer = undefined;
    }
    if (!geometrySaveHandler || Object.keys(pendingGeometry).length === 0) return;
    const geometry = pendingGeometry;
    pendingGeometry = {};
    await geometrySaveHandler(geometry);
  }

  async function initialize(
    isMobileRuntime: boolean,
    alwaysOnBottom: boolean,
    onGeometryChanged?: (patch: WindowGeometryPatch) => void | Promise<void>,
  ) {
    isDesktopWindow.value = isTauri() && !isMobileRuntime;
    if (!isDesktopWindow.value) return;

    try {
      const appWindow = getCurrentWindow();
      await appWindow.setResizable(false);
      await appWindow.setAlwaysOnBottom(alwaysOnBottom);
      await syncMaximized(appWindow);
      unlistenResized?.();
      unlistenMoved?.();
      unlistenResized = await appWindow.onResized(({ payload }) => {
        logInfo("window.resize", "窗口尺寸已变化");
        void syncMaximized(appWindow)
          .then(() => {
            if (!isMaximized.value) {
              scheduleGeometrySave({ windowWidth: payload.width, windowHeight: payload.height }, onGeometryChanged);
            }
          })
          .catch(reportFailure);
      });
      unlistenMoved = await appWindow.onMoved(({ payload }) => {
        void appWindow.isMaximized()
          .then((maximized) => {
            if (!maximized) scheduleGeometrySave({ windowX: payload.x, windowY: payload.y }, onGeometryChanged);
          })
          .catch(reportFailure);
      });
      if (!isMaximized.value) {
        const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);
        scheduleGeometrySave({
          windowX: position.x,
          windowY: position.y,
          windowWidth: size.width,
          windowHeight: size.height,
        }, onGeometryChanged);
      }
    } catch (reason) {
      reportFailure(reason);
    }
  }

  async function close() {
    await flushGeometrySave().catch(reportFailure);
    await flushLogs();
    await runWindowAction("window.close", (window) => window.close());
  }

async function startDragging() {
  return runWindowAction("window.drag-start", (window) => window.startDragging());
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

  onUnmounted(() => {
    unlistenResized?.();
    unlistenMoved?.();
    void flushGeometrySave().catch(reportFailure);
  });

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
    startDragging,
  };
}
