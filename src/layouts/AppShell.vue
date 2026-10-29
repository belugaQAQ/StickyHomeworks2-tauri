<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { appContextKey } from "../app-context";
import HomeworkExportDialog from "../components/HomeworkExportDialog.vue";
import WindowUnlockOverlay from "../components/WindowUnlockOverlay.vue";
import { useAppBootstrap } from "../composables/useAppBootstrap";
import { useAppDialogs, type DialogElement } from "../composables/useAppDialogs";
import { useDesktopWindowControls } from "../composables/useDesktopWindowControls";
import { useExpiredHomeworkCleanup } from "../composables/useExpiredHomeworkCleanup";
import { useHomeworkEditor } from "../composables/useHomeworkEditor";
import { useHomeworkStore } from "../composables/useHomeworkStore";
import { useLinuxClipboardWorkaround } from "../composables/useLinuxClipboardWorkaround";
import { hideWebKitGtkDialog, useWebKitGtkDialogExit } from "../composables/useWebKitGtkDialogExit";
import { patchM3eAttributes } from "../m3e-internals";
import { routeTransitionName } from "../router";
import { logInfo } from "../services/logging";
import type { AppSettings } from "../types/app-data";
import "../styles/app-shell.css";

const HomeworkEditorDialog = defineAsyncComponent(() => import("../components/HomeworkEditorDialog.vue"));

type NavigationItem = "homeworks" | "templates" | "settings";

const route = useRoute();
const router = useRouter();
const isDrawerOpen = ref(false);
const isHomeworkFrozen = ref(false);
const settingsError = ref("");
const appDrawer = ref<HTMLElement | null>(null);
const moreSheet = ref<DialogElement | null>(null);
const cleanupConfirmDialog = ref<DialogElement | null>(null);
const cleanupPendingCount = ref(0);
let resolveCleanupConfirm: ((approved: boolean) => void) | undefined;
useWebKitGtkDialogExit(cleanupConfirmDialog);
const {
  isDesktopWindow,
  isUnlocked: isWindowUnlocked,
  isMaximized: isWindowMaximized,
  error: windowControlError,
  initialize: initializeWindowControls,
  close: closeWindow,
  minimize: minimizeWindow,
  toggleMaximize: toggleWindowMaximize,
  toggleUnlocked: toggleWindowUnlocked,
  startDragging: startWindowDragging,
  setAlwaysOnBottom,
} = useDesktopWindowControls();
const {
  appData,
  homeworkGroups,
  load,
  saveHomework,
  deleteHomework,
  updateSettings,
  deleteGlobalTag: deleteGlobalTagFromStore,
  importLegacyData: importLegacyDataFromStore,
  cleanupExpiredHomeworks,
  restoreHomeworks,
} = useHomeworkStore();
const {
  editingHomework,
  saveError,
  editorSubjects,
  editorTags,
  openCreate,
  openEdit,
  updateContent,
  updateSubject,
  updateDueDate,
  updateTagSelection,
  save: saveHomeworkEditor,
  reset: resetHomeworkEditor,
} = useHomeworkEditor({ appData, isHomeworkFrozen, saveHomework });

useLinuxClipboardWorkaround();

const navigationItems: Array<{ id: NavigationItem; label: string; hint: string }> = [
  { id: "homeworks", label: "作业", hint: "home" },
  { id: "templates", label: "模板", hint: "article" },
  { id: "settings", label: "设置", hint: "settings" },
];

const activeNavigation = computed<NavigationItem>(() => {
  if (route.path.startsWith("/settings")) return "settings";
  if (route.path === "/templates") return "templates";
  return "homeworks";
});

const currentTitle = computed(
  () => navigationItems.find((item) => item.id === activeNavigation.value)?.label ?? appData.value.settings.title,
);

const currentContext = computed(() => (activeNavigation.value === "homeworks" ? "今日任务" : currentTitle.value));

const {
  editorDialog,
  exportDialog,
  exitDialog,
  deleteDialog,
  deleteError,
  openMountedHomeworkEditor,
  openHomeworkExport,
  closeHomeworkEditor,
  saveEditedHomework,
  requestDeleteHomework,
  closeDeleteDialog,
  requestCloseWindow,
  closeExitDialog,
  confirmDeleteHomework,
} = useAppDialogs({
  moreSheet,
  isHomeworkFrozen,
  saveHomeworkEditor,
  resetHomeworkEditor,
  deleteHomework,
});

const {
  isMobileRuntime,
  isMobileLayout,
  loadError,
  preserveMobileScrollPosition,
  start: startAppBootstrap,
  dispose: disposeAppBootstrap,
} = useAppBootstrap({
  appData,
  appDrawer,
  activeNavigation: () => activeNavigation.value,
  load,
  updateSettings,
  initializeWindowControls,
  setAlwaysOnBottom,
  navigate: (path) => {
    void router.push(path);
  },
});

const { start: startExpiredHomeworkCleanup } = useExpiredHomeworkCleanup({
  appData,
  cleanup: cleanupExpiredHomeworks,
  restore: restoreHomeworks,
  getProtectedHomeworkId: () => editingHomework.value?.id ?? null,
  confirmFirstCleanup,
});

/** 首次自动清理前的确认 */
function confirmFirstCleanup(count: number) {
  cleanupPendingCount.value = count;
  void nextTick(() => cleanupConfirmDialog.value?.show());
  return new Promise<boolean>((resolve) => {
    resolveCleanupConfirm = resolve;
  });
}

async function answerCleanupConfirm(approved: boolean) {
  await hideWebKitGtkDialog(cleanupConfirmDialog.value);
  const resolve = resolveCleanupConfirm;
  resolveCleanupConfirm = undefined;
  resolve?.(approved);
}

function toggleHomeworkFrozen() {
  isHomeworkFrozen.value = !isHomeworkFrozen.value;
  logInfo(isHomeworkFrozen.value ? "homework.freeze" : "homework.unfreeze", "作业冻结状态已变化");
}

function selectNavigation(id: NavigationItem) {
  const path = id === "homeworks" ? "/" : `/${id}`;
  void router.push(path);
  isDrawerOpen.value = false;
  logInfo("navigation.select", `已进入导航：${id}`);
}

function openCreateHomework() {
  if (openCreate()) logInfo("homework.create.request", "已请求新建作业");
}

function openEditHomework(id: string) {
  if (openEdit(id)) logInfo("homework.edit.request", "已请求编辑作业");
}

async function updateAppSettings(mutate: (settings: AppSettings) => AppSettings) {
  settingsError.value = "";
  try {
    await updateSettings(mutate);
  } catch {
    settingsError.value = "保存失败，请重试。";
  }
}

async function deleteGlobalTag(tag: string) {
  settingsError.value = "";
  try {
    await deleteGlobalTagFromStore(tag);
  } catch {
    settingsError.value = "保存失败，请重试。";
  }
}

async function importLegacyData(profileContents: string | undefined, settingsContents: string) {
  settingsError.value = "";
  try {
    return await importLegacyDataFromStore(profileContents, settingsContents);
  } catch (error) {
    settingsError.value = "导入失败，请检查所选文件后重试。";
    throw error;
  }
}

provide(appContextKey, {
  appData,
  homeworkGroups,
  isMobileRuntime,
  isMobileLayout,
  isHomeworkFrozen,
  settingsError,
  openEditHomework,
  requestDeleteHomework,
  updateAppSettings,
  deleteGlobalTag,
  importLegacyData,
});

async function startWindowDrag(event: Event) {
  if (event instanceof PointerEvent && event.pointerType !== "mouse") return;
  if (!isWindowUnlocked.value) return;
  event.preventDefault();
  await startWindowDragging();
}

function syncDrawerState(event: Event) {
  isDrawerOpen.value = (event.currentTarget as HTMLElement & { start: boolean }).start;
}

function syncMenuToggle(event: Event) {
  isDrawerOpen.value = (event.currentTarget as HTMLElement & { selected: boolean }).selected;
}

/** 窗口解锁遮罩显示期间按 Esc 退出解锁；解锁结束或组件卸载时移除监听。 */
let removeUnlockEscapeListener: (() => void) | undefined;
watch(isWindowUnlocked, (unlocked) => {
  removeUnlockEscapeListener?.();
  removeUnlockEscapeListener = undefined;
  if (!unlocked) return;

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    void toggleWindowUnlocked();
  };
  window.addEventListener("keydown", onKeydown);
  removeUnlockEscapeListener = () => window.removeEventListener("keydown", onKeydown);
});

onMounted(async () => {
  await startAppBootstrap();
  startExpiredHomeworkCleanup();

  // 等 M3E 组件挂载完再补 attribute；property → attribute 的原因见 m3e-internals。
  await nextTick();
  patchM3eAttributes(moreSheet.value, { handle: "", detents: "fit half full" });
});

onUnmounted(() => {
  removeUnlockEscapeListener?.();
  removeUnlockEscapeListener = undefined;
  disposeAppBootstrap();
});
</script>

<template>
  <div
    class="app-frame"
    :class="{
      'app-frame--mobile': isMobileLayout,
      'app-frame--window-unlocked': isWindowUnlocked,
    }"
    :style="{ '--background-opacity': `${appData.settings.backgroundOpacity}%` }"
    :data-tauri-drag-region="isWindowUnlocked ? 'deep' : undefined"
  >
    <m3e-app-bar class="app-bar" :class="{ 'app-bar--unlocked': isWindowUnlocked }">
      <m3e-icon-button slot="leading" aria-label="Menu" toggle :selected="isDrawerOpen" @change="syncMenuToggle">
        <m3e-icon name="menu"></m3e-icon>
        <m3e-icon slot="selected" name="menu_open"></m3e-icon>
      </m3e-icon-button>
      <span slot="title">{{ appData.settings.title }}</span>
      <span slot="subtitle">{{ currentContext }}</span>
      <m3e-icon-button
        class="homework-freeze-button"
        slot="trailing"
        :aria-label="isHomeworkFrozen ? '解除作业冻结' : '冻结作业操作'"
        :title="isHomeworkFrozen ? '解除作业冻结' : '冻结作业操作'"
        :variant="isHomeworkFrozen ? 'filled' : 'tonal'"
        @click="toggleHomeworkFrozen"
      >
        <m3e-icon name="ac_unit"></m3e-icon>
      </m3e-icon-button>
      <m3e-icon-button slot="trailing" aria-label="更多选项" variant="tonal">
        <m3e-bottom-sheet-trigger for="More-Sheet">
          <m3e-icon name="more_horiz"></m3e-icon>
        </m3e-bottom-sheet-trigger>
      </m3e-icon-button>
    </m3e-app-bar>

    <m3e-drawer-container
      ref="appDrawer"
      class="app-drawer"
      :start="isDrawerOpen"
      start-mode="over"
      start-divider
      @change="syncDrawerState"
    >
      <aside slot="start" class="navigation-panel" aria-label="Main navigation">
        <m3e-nav-menu class="navigation-list">
          <m3e-nav-menu-item
            v-for="item in navigationItems"
            :key="item.id"
            :selected="activeNavigation === item.id"
            @click="selectNavigation(item.id)"
          >
            <m3e-icon slot="icon" :name="item.hint"></m3e-icon>
            <span slot="label">{{ item.label }}</span>
          </m3e-nav-menu-item>
        </m3e-nav-menu>
      </aside>

      <main class="app-content" :class="{ 'app-content--settings': activeNavigation === 'settings' }">
        <p v-if="loadError" class="editor-error" role="alert">{{ loadError }}</p>
        <RouterView v-slot="{ Component }">
          <Transition
            :name="routeTransitionName"
            :mode="routeTransitionName === 'settings-detail' ? undefined : 'out-in'"
          >
            <div :key="route.fullPath" class="route-view">
              <component :is="Component" />
            </div>
          </Transition>
        </RouterView>
      </main>
    </m3e-drawer-container>

    <m3e-fab
      variant="primary"
      size="medium"
      class="create-fab"
      :class="{ 'create-fab--hidden': activeNavigation !== 'homeworks' || isHomeworkFrozen }"
      aria-label="Create homework"
      @pointerdown="preserveMobileScrollPosition"
    >
      <m3e-fab-menu-trigger for="fab-menu">
        <m3e-icon name="edit" variant="rounded"></m3e-icon>
      </m3e-fab-menu-trigger>
    </m3e-fab>
    <m3e-fab-menu id="fab-menu" variant="primary">
      <m3e-fab-menu-item @click="openCreateHomework">
        <m3e-icon slot="icon" name="add" filled></m3e-icon>
        新建作业
      </m3e-fab-menu-item>
    </m3e-fab-menu>

    <m3e-bottom-sheet
      ref="moreSheet"
      id="More-Sheet"
      modal
      handle
      hideable
      detents="fit half full"
      aria-labelledby="sheetTitle"
    >
      <m3e-heading id="sheetTitle" slot="header" variant="title" size="large">更多</m3e-heading>
      <m3e-action-list class="window-control-action-list">
        <m3e-list-action @click="openHomeworkExport">
          <m3e-icon slot="leading" name="image"></m3e-icon>
          <m3e-bottom-sheet-action>导出作业图片</m3e-bottom-sheet-action>
        </m3e-list-action>
        <m3e-list-action v-if="isDesktopWindow" @click="toggleWindowMaximize">
          <m3e-icon slot="leading" :name="isWindowMaximized ? 'fullscreen_exit' : 'fullscreen'"></m3e-icon>
          <m3e-bottom-sheet-action>{{ isWindowMaximized ? "还原窗口" : "最大化" }}</m3e-bottom-sheet-action>
        </m3e-list-action>
        <m3e-list-action v-if="isDesktopWindow" @click="toggleWindowUnlocked">
          <m3e-icon slot="leading" :name="isWindowUnlocked ? 'lock' : 'lock_open'"></m3e-icon>
          <m3e-bottom-sheet-action>{{ isWindowUnlocked ? "锁定窗口" : "解锁窗口" }}</m3e-bottom-sheet-action>
          <span slot="supporting-text">{{ isWindowUnlocked ? "窗口不可移动或调整大小" : "允许移动和调整大小" }}</span>
        </m3e-list-action>
        <m3e-list-action v-if="isDesktopWindow" @click="minimizeWindow">
          <m3e-icon slot="leading" name="minimize"></m3e-icon>
          <m3e-bottom-sheet-action>最小化</m3e-bottom-sheet-action>
        </m3e-list-action>
        <m3e-list-action v-if="isDesktopWindow" @click="requestCloseWindow">
          <m3e-icon slot="leading" name="close"></m3e-icon>
          <m3e-bottom-sheet-action>关闭</m3e-bottom-sheet-action>
        </m3e-list-action>
      </m3e-action-list>
      <p v-if="windowControlError" class="window-control-error" role="alert">{{ windowControlError }}</p>
    </m3e-bottom-sheet>
    <WindowUnlockOverlay v-if="isWindowUnlocked" @pointerdown="startWindowDrag" @touchstart="startWindowDrag" />

    <HomeworkExportDialog
      ref="exportDialog"
      :groups="homeworkGroups"
      :title="appData.settings.title"
      :mobile-layout="isMobileLayout"
      :max-panel-width="appData.settings.maxPanelWidth"
    />

    <HomeworkEditorDialog
      v-if="editingHomework"
      ref="editorDialog"
      @vue:mounted="openMountedHomeworkEditor"
      :homework="editingHomework"
      :subjects="editorSubjects"
      :tags="editorTags"
      :save-error="saveError"
      :is-editing="true"
      :mobile-layout="isMobileLayout"
      @closed="closeHomeworkEditor"
      @cancel="closeHomeworkEditor"
      @save="saveEditedHomework"
      @update:content="updateContent"
      @update:subject="updateSubject"
      @update:due-date="updateDueDate"
      @update:tag-selection="updateTagSelection"
    />

    <m3e-dialog ref="exitDialog" alert disable-close>
      <m3e-heading slot="header" variant="headline" size="small" level="2">关闭应用？</m3e-heading>
      <div slot="actions" end>
        <m3e-button variant="text" @click="closeExitDialog">取消</m3e-button>
        <m3e-button variant="filled" @click="closeWindow">确定</m3e-button>
      </div>
    </m3e-dialog>

    <m3e-dialog ref="deleteDialog" alert disable-close>
      <m3e-heading slot="header" variant="headline" size="small" level="2">删除作业？</m3e-heading>
      删除后将无法从当前作业列表恢复。
      <p v-if="deleteError" class="editor-error" role="alert">{{ deleteError }}</p>
      <div slot="actions" end>
        <m3e-button variant="text" @click="closeDeleteDialog">取消</m3e-button>
        <m3e-button variant="filled" @click="confirmDeleteHomework">删除</m3e-button>
      </div>
    </m3e-dialog>

    <m3e-dialog ref="cleanupConfirmDialog" alert disable-close>
      <m3e-heading slot="header" variant="headline" size="small" level="2">清理过期作业？</m3e-heading>
      将移除 {{ cleanupPendingCount }} 条截止日期已过的作业，将会在之后自动清理，此提示只出现一次。
      <div slot="actions" end>
        <m3e-button variant="text" @click="answerCleanupConfirm(false)">暂不清理</m3e-button>
        <m3e-button variant="filled" @click="answerCleanupConfirm(true)">清理</m3e-button>
      </div>
    </m3e-dialog>
  </div>
</template>
