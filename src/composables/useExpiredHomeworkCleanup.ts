import { M3eSnackbar } from "@m3e/web/all";
import { onUnmounted, ref, watch, type Ref } from "vue";
import { pruneExpiredHomeworks, type RemovedHomework } from "../domain/homework";
import { logError, logInfo, logWarn } from "../services/logging";
import type { AppData } from "../types/app-data";

type ExpiredHomeworkCleanupOptions = {
  appData: Ref<AppData>;
  cleanup: (reason: string, protectedId: string | null) => Promise<RemovedHomework[]>;
  restore: (removed: readonly RemovedHomework[]) => Promise<void>;
  /** 正在编辑的作业 id：清理时跳过它，避免用户改到一半被删。 */
  getProtectedHomeworkId: () => string | null;
  /** 首次自动清理前的确认 */
  confirmFirstCleanup: (count: number) => Promise<boolean>;
};

const DATE_CHECK_INTERVAL_MS = 60_000;
const CLEANUP_SNACKBAR_DURATION_MS = 15_000;
const CONFIRMED_STORAGE_KEY = "stickyhomeworks2.expired-cleanup-confirmed.v1";

function localDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function hasConfirmedCleanup(): boolean {
  try {
    return window.localStorage.getItem(CONFIRMED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markCleanupConfirmed(): void {
  try {
    window.localStorage.setItem(CONFIRMED_STORAGE_KEY, "1");
  } catch (error) {
    logWarn("homework.cleanup.confirm", error instanceof Error ? error.message : String(error));
  }
}

export function useExpiredHomeworkCleanup({
  appData,
  cleanup,
  restore,
  getProtectedHomeworkId,
  confirmFirstCleanup,
}: ExpiredHomeworkCleanupOptions) {
  const lastCheckedDate = ref(localDateKey());
  const suppressedDate = ref<string | null>(null);
  let timerId: number | undefined;
  let isSweeping = false;
  let disposed = false;
  let declinedThisSession = false;
  let pendingSweepReason: string | null = null;

  function isSuppressedToday() {
    return suppressedDate.value !== null && suppressedDate.value === localDateKey();
  }

  function showCleanupSnackbar(removed: readonly RemovedHomework[]) {
    M3eSnackbar.open(`已自动清理 ${removed.length} 条过期作业`, "撤回", {
      duration: CLEANUP_SNACKBAR_DURATION_MS,
      actionCallback: () => {
        suppressedDate.value = localDateKey();
        void restore(removed)
          .then(async () => {
            await logInfo("homework.cleanup.undo", "已撤回自动清理，今天不再自动清理");
          })
          .catch(async (error) => {
            suppressedDate.value = null;
            await logError("homework.cleanup.undo.failure", error);
            M3eSnackbar.open("撤回失败，请重试。");
          });
      },
    });
  }

  async function sweep(reason: string) {
    if (disposed) return;
    if (isSweeping) {
      pendingSweepReason = reason;
      return;
    }
    if (!appData.value.settings.autoOutwork) return;
    if (isSuppressedToday() || declinedThisSession) return;

    isSweeping = true;
    try {
      const protectedId = getProtectedHomeworkId();
      const preview = pruneExpiredHomeworks(appData.value, new Date(), protectedId);
      if (preview.removed.length === 0 && preview.markedCount === 0) return;

      if (preview.removed.length > 0 && !hasConfirmedCleanup()) {
        const approved = await confirmFirstCleanup(preview.removed.length);
        if (!approved) {
          declinedThisSession = true;
          await logInfo("homework.cleanup.declined", "用户暂不清理过期作业");
          return;
        }
        markCleanupConfirmed();
      }

      const removed = await cleanup(reason, protectedId);
      if (removed.length === 0) return;
      await logInfo("homework.cleanup.sweep", `过期作业清理完成（${reason}）`);
      showCleanupSnackbar(removed);
    } catch (error) {
      await logWarn("homework.cleanup.failure", error instanceof Error ? error.message : String(error));
    } finally {
      isSweeping = false;
      const pending = pendingSweepReason;
      pendingSweepReason = null;
      if (pending !== null && !disposed) void sweep(pending);
    }
  }

  function checkDateChange() {
    const today = localDateKey();
    if (today === lastCheckedDate.value) return;
    lastCheckedDate.value = today;
    void sweep("date-change");
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") checkDateChange();
  }

  watch(
    () => [appData.value.settings.autoOutwork, appData.value.settings.delayedCleanupEnabled] as const,
    ([autoOutwork, delayedCleanupEnabled], previous) => {
      if (!autoOutwork) return;
      const justEnabled = !previous?.[0];
      const delayDisabled = Boolean(previous?.[1]) && !delayedCleanupEnabled;
      if (!justEnabled && !delayDisabled) return;
      if (justEnabled) suppressedDate.value = null;
      void sweep(justEnabled ? "auto-cleanup-enabled" : "delay-cleanup-disabled");
    },
  );

  watch(
    () => appData.value.homeworks,
    () => {
      void sweep("homeworks-change");
    },
  );

  function start() {
    if (disposed) return;
    lastCheckedDate.value = localDateKey();
    void sweep("startup");
    timerId = window.setInterval(checkDateChange, DATE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timerId !== undefined) window.clearInterval(timerId);
    timerId = undefined;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }

  onUnmounted(dispose);

  return { start, dispose, sweep, lastCheckedDate };
}
