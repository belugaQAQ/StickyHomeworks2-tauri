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
  /** 首次自动清理前的确认；返回 false 表示本次不清理。 */
  confirmFirstCleanup: (count: number) => Promise<boolean>;
};

/** 每分钟对一次日期即可：跨天最多晚一分钟清理，代价可以忽略。 */
const DATE_CHECK_INTERVAL_MS = 60_000;
/** Material 建议带操作按钮的 snackbar 停留更久，这里给足撤回的时间。 */
const CLEANUP_SNACKBAR_DURATION_MS = 10_000;
/** 用户确认过首次清理后记在这里，之后不再打扰。 */
const CONFIRMED_STORAGE_KEY = "stickyhomeworks2.expired-cleanup-confirmed.v1";

function localDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function hasConfirmedCleanup(): boolean {
  try {
    return window.localStorage.getItem(CONFIRMED_STORAGE_KEY) === "1";
  } catch {
    // localStorage 不可用时每次启动都问一次，比静默删除安全。
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

/**
 * 无后端版自动清理过期作业。
 *
 * 触发时机全部在前端：启动后、每分钟比对一次本地日期（跨天）、
 * 窗口从后台/休眠回到前台、以及「自动清理」开关刚被打开（或延迟清理被关掉）的那一瞬间。
 * 真正的删除逻辑在 `useHomeworkStore.cleanupExpiredHomeworks`，走既有的串行保存队列，
 * 因此不会和用户操作打架；删除后弹一条 10 秒的 snackbar，点「撤回」按原位置插回去。
 *
 * 第一次真正要删东西之前会先要一次确认（`confirmFirstCleanup`），确认结果记在
 * localStorage 里，之后不再打扰；选择「暂不清理」只影响本次运行。
 * 撤回成功后当天的自动清理就停了（只记在内存里，重启即忘），
 * 想提前恢复只能把「自动清理」关掉再打开。
 */
export function useExpiredHomeworkCleanup({
  appData,
  cleanup,
  restore,
  getProtectedHomeworkId,
  confirmFirstCleanup,
}: ExpiredHomeworkCleanupOptions) {
  const lastCheckedDate = ref(localDateKey());
  /** 撤回当天的日期；等于今天就说明今天别再清了。重启后自然为空。 */
  const suppressedDate = ref<string | null>(null);
  let timerId: number | undefined;
  let isSweeping = false;
  let disposed = false;
  /** 用户在首次确认里选择「暂不清理」后，本次运行不再自动扫。 */
  let declinedThisSession = false;
  /** 清理进行中又被触发的扫描，结束后补一次。 */
  let pendingSweepReason: string | null = null;

  function isSuppressedToday() {
    return suppressedDate.value !== null && suppressedDate.value === localDateKey();
  }

  function showCleanupSnackbar(removed: readonly RemovedHomework[]) {
    M3eSnackbar.open(`已自动清理 ${removed.length} 条过期作业`, "撤回", {
      duration: CLEANUP_SNACKBAR_DURATION_MS,
      actionCallback: () => {
        // 先暂停当天清理，否则撤回引起的 homeworks 变化会立刻又扫一次、把作业删回去。
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

      // 首次清理前确认一次：不打招呼删掉积压的历史过期作业太粗暴。
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

  // 打开「自动清理」的那一瞬间就检测；关掉延迟清理会让作业重新变成过期，也补一次。
  // 重新打开开关同时解除撤回当天的暂停。
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

  // 作业本身变了（新建、编辑截止日期）也立刻对齐染色：一旦变成过期就当场清掉。
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
