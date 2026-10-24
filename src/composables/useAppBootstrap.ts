import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, nextTick, ref, watch, type Ref } from "vue";
import { setDrawerContentOverflow } from "../m3e-internals";
import { initializeGlycoprotein, listenGlycoproteinWindowSettings } from "../services/glycoprotein";
import { logInfo, logWarn } from "../services/logging";
import type { AppData, AppSettings } from "../types/app-data";
import { MOBILE_LAYOUT_MAX_WIDTH, isBelow } from "../ui/breakpoints";

type AppBootstrapOptions = {
  appData: Ref<AppData>;
  appDrawer: Ref<HTMLElement | null>;
  activeNavigation: () => string;
  load: () => Promise<void>;
  updateSettings: (mutate: (settings: AppSettings) => AppSettings) => Promise<void>;
  initializeWindowControls: (isMobileRuntime: boolean, alwaysOnBottom: boolean) => Promise<void>;
  setAlwaysOnBottom: (alwaysOnBottom: boolean) => Promise<boolean>;
  navigate: (path: string) => void;
};

const WINDOW_SHOW_FALLBACK_MS = 3000;

export function useAppBootstrap(options: AppBootstrapOptions) {
  const isMobileRuntime = ref(false);
  const viewportWidth = ref(0);
  const loadError = ref("");
  const isMobileLayout = computed(() => isMobileRuntime.value && isBelow(viewportWidth.value, MOBILE_LAYOUT_MAX_WIDTH));

  let stopAlwaysOnBottomWatch: (() => void) | undefined;
  let stopMainNavigate: (() => void) | undefined;
  let unlistenGlycoproteinWindowSettings: (() => void) | undefined;
  let showFallbackTimer: number | undefined;
  let disposed = false;

  function updateViewportWidth() {
    viewportWidth.value = window.innerWidth;
  }

  function syncDrawerContentOverflow() {
    const isHomeworkHome = options.activeNavigation() === "homeworks";
    setDrawerContentOverflow(options.appDrawer.value, {
      x: isHomeworkHome ? "hidden" : "",
      y: isHomeworkHome ? "hidden" : "",
    });
  }

  function preserveMobileScrollPosition() {
    if (!isMobileLayout.value) return;

    const scrollTargets = [
      document.scrollingElement,
      options.appDrawer.value?.shadowRoot?.querySelector<HTMLElement>(".content"),
    ].filter((target): target is HTMLElement => target instanceof HTMLElement);
    const positions = scrollTargets.map((target) => ({ target, left: target.scrollLeft, top: target.scrollTop }));
    const restore = () => positions.forEach(({ target, left, top }) => target.scrollTo(left, top));

    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }

  async function detectMobileRuntime() {
    const layoutOverride = new URLSearchParams(window.location.search).get("layout");
    if (import.meta.env.DEV && (layoutOverride === "mobile" || layoutOverride === "desktop")) {
      return layoutOverride === "mobile";
    }

    try {
      return (await invoke<"desktop" | "mobile">("runtime_layout")) === "mobile";
    } catch (error) {
      logWarn("runtime.layout.failure", error instanceof Error ? error.message : "runtime layout command failed");
      return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    }
  }

  function mergeSettingsPatch(settings: AppSettings, patch: Partial<AppSettings>): AppSettings {
    const isUnchanged = Object.entries(patch).every(([key, value]) => settings[key as keyof AppSettings] === value);
    return isUnchanged ? settings : { ...settings, ...patch };
  }

  function clearWindowShowFallback() {
    if (showFallbackTimer === undefined) return;
    window.clearTimeout(showFallbackTimer);
    showFallbackTimer = undefined;
  }

  async function revealMainWindow(source: "load-complete" | "load-fallback") {
    clearWindowShowFallback();
    if (isMobileRuntime.value || !isTauri()) return;
    if (!options.appData.value.settings.windowVisible) return;

    try {
      await getCurrentWindow().show();
      logInfo("window.show", `主窗口已显示（${source}）`);
    } catch (error) {
      logWarn("window.show.failure", error instanceof Error ? error.message : String(error));
    }
  }

  function scheduleWindowShowFallback() {
    if (isMobileRuntime.value || !isTauri()) return;
    clearWindowShowFallback();
    showFallbackTimer = window.setTimeout(() => {
      void revealMainWindow("load-fallback");
    }, WINDOW_SHOW_FALLBACK_MS);
  }

  async function registerRuntimeListeners() {
    try {
      unlistenGlycoproteinWindowSettings = await listenGlycoproteinWindowSettings((patch) => {
        void options
          .updateSettings((settings) => mergeSettingsPatch(settings, patch))
          .catch((error) => {
            logWarn(
              "glycoprotein.window-settings.save.failure",
              error instanceof Error ? error.message : String(error),
            );
          });
      });
    } catch (error) {
      logWarn("glycoprotein.window-settings.listen.failure", error instanceof Error ? error.message : String(error));
    }
    try {
      stopMainNavigate = await listen<string>("main-navigate", ({ payload }) => {
        options.navigate(payload);
      });
    } catch (error) {
      logWarn("navigation.listen.failure", error instanceof Error ? error.message : String(error));
    }
  }

  async function start() {
    if (disposed) return;

    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    isMobileRuntime.value = await detectMobileRuntime();
    await nextTick();
    syncDrawerContentOverflow();
    scheduleWindowShowFallback();

    try {
      await options.load();
      logInfo("app.start", "应用数据加载完成");
    } catch {
      loadError.value = "无法读取本地数据。请检查应用数据目录后重试。";
    }

    if (!isMobileRuntime.value) {
      await registerRuntimeListeners();
      try {
        await initializeGlycoprotein();
      } catch (error) {
        logWarn("glycoprotein.initialize.failure", error instanceof Error ? error.message : String(error));
      }
    }

    await revealMainWindow("load-complete");

    await options.initializeWindowControls(isMobileRuntime.value, options.appData.value.settings.alwaysOnBottom);
    stopAlwaysOnBottomWatch = watch(
      () => options.appData.value.settings.alwaysOnBottom,
      (alwaysOnBottom) => {
        void options.setAlwaysOnBottom(alwaysOnBottom);
      },
    );
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearWindowShowFallback();
    window.removeEventListener("resize", updateViewportWidth);
    stopAlwaysOnBottomWatch?.();
    stopAlwaysOnBottomWatch = undefined;
    stopMainNavigate?.();
    stopMainNavigate = undefined;
    unlistenGlycoproteinWindowSettings?.();
    unlistenGlycoproteinWindowSettings = undefined;
  }

  watch(
    () => options.activeNavigation(),
    () => nextTick(syncDrawerContentOverflow),
  );
  watch(isMobileLayout, () => nextTick(syncDrawerContentOverflow));

  return {
    isMobileRuntime,
    isMobileLayout,
    viewportWidth,
    loadError,
    syncDrawerContentOverflow,
    preserveMobileScrollPosition,
    start,
    dispose,
  };
}
