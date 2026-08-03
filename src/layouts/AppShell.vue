<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, nextTick, onMounted, provide, ref } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { appContextKey } from "../app-context";
import HomeworkEditorDialog from "../components/HomeworkEditorDialog.vue";
import WindowUnlockOverlay from "../components/WindowUnlockOverlay.vue";
import { useHomeworkEditor } from "../composables/useHomeworkEditor";
import { useHomeworkStore } from "../composables/useHomeworkStore";
import { useDesktopWindowControls } from "../composables/useDesktopWindowControls";
import { useLinuxClipboardWorkaround } from "../composables/useLinuxClipboardWorkaround";
import { useWebKitGtkDialogExit } from "../composables/useWebKitGtkDialogExit";
import type { AppSettings } from "../types/app-data";
import { routeTransitionName } from "../router";
import "../styles/app-shell.css";

type NavigationItem = "homeworks" | "templates" | "settings";

type DialogElement = HTMLElement & {
  show: () => void;
  hide: () => void;
};

type HomeworkEditorDialogElement = {
  show: () => void;
  hide: () => void;
};

const route = useRoute();
const router = useRouter();
const isDrawerOpen = ref(false);
const isMobileRuntime = ref(false);
const loadError = ref("");
const deleteError = ref("");
const settingsError = ref("");
const appDrawer = ref<HTMLElement | null>(null);
const moreSheet = ref<HTMLElement | null>(null);
const editorDialog = ref<HomeworkEditorDialogElement | null>(null);
const deleteDialog = ref<DialogElement | null>(null);
const exitDialog = ref<DialogElement | null>(null);
const deleteHomeworkId = ref<string | null>(null);
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
} = useHomeworkEditor({ appData, saveHomework });

useLinuxClipboardWorkaround();
useWebKitGtkDialogExit(deleteDialog);

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

const currentTitle = computed(() =>
  navigationItems.find((item) => item.id === activeNavigation.value)?.label ?? appData.value.settings.title,
);

const currentContext = computed(() => activeNavigation.value === "homeworks" ? "今日任务" : currentTitle.value);

function selectNavigation(id: NavigationItem) {
  const path = id === "homeworks" ? "/" : `/${id}`;
  void router.push(path);
  isDrawerOpen.value = false;
}

function openCreateHomework() {
  openCreate();
  editorDialog.value?.show();
}

function openEditHomework(id: string) {
  if (openEdit(id)) editorDialog.value?.show();
}

function closeHomeworkEditor() {
  editorDialog.value?.hide();
}

async function saveEditedHomework() {
  if (await saveHomeworkEditor()) closeHomeworkEditor();
}

function requestDeleteHomework(id: string) {
  deleteHomeworkId.value = id;
  deleteError.value = "";
  void nextTick(() => deleteDialog.value?.show());
}

function closeDeleteDialog() {
  deleteDialog.value?.hide();
  deleteHomeworkId.value = null;
  deleteError.value = "";
}

function requestCloseWindow() {
  exitDialog.value?.show();
}

function closeExitDialog() {
  exitDialog.value?.hide();
}

async function confirmDeleteHomework() {
  if (!deleteHomeworkId.value) return;

  try {
    await deleteHomework(deleteHomeworkId.value);
    closeDeleteDialog();
  } catch {
    deleteError.value = "删除失败，请重试。";
  }
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
    settingsError.value = error instanceof Error ? error.message : "导入失败，请检查所选文件。";
    throw error;
  }
}

provide(appContextKey, {
  appData,
  homeworkGroups,
  isMobileRuntime,
  settingsError,
  openEditHomework,
  requestDeleteHomework,
  updateAppSettings,
  deleteGlobalTag,
  importLegacyData,
});

function syncDrawerState(event: Event) {
  isDrawerOpen.value = (event.currentTarget as HTMLElement & { start: boolean }).start;
}

function syncMenuToggle(event: Event) {
  isDrawerOpen.value = (event.currentTarget as HTMLElement & { selected: boolean }).selected;
}

function preserveMobileScrollPosition() {
  if (!isMobileRuntime.value) return;

  const scrollTargets = [
    document.scrollingElement,
    appDrawer.value?.shadowRoot?.querySelector<HTMLElement>(".content"),
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
  } catch {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }
}

onMounted(async () => {
  isMobileRuntime.value = await detectMobileRuntime();
  await initializeWindowControls(isMobileRuntime.value);
  // M3E uses the attribute in Shadow DOM CSS, while Vue may set only the property.
  await nextTick();
  moreSheet.value?.setAttribute("handle", "");
  moreSheet.value?.setAttribute("detents", "fit half full");

  try {
    await load();
  } catch {
    loadError.value = "无法读取本地数据。请检查应用数据目录后重试。";
  }
});
</script>

<template>
  <div
    class="app-frame"
    :class="{
      'app-frame--mobile': isMobileRuntime,
      'app-frame--window-unlocked': isWindowUnlocked,
    }"
    :data-tauri-drag-region="isWindowUnlocked ? 'deep' : undefined"
  >
      <m3e-app-bar class="app-bar" :class="{ 'app-bar--unlocked': isWindowUnlocked }">
        <m3e-icon-button
          slot="leading"
          aria-label="Menu"
          toggle
          :selected="isDrawerOpen"
          @change="syncMenuToggle"
        >
          <m3e-icon name="menu"></m3e-icon>
          <m3e-icon slot="selected" name="menu_open"></m3e-icon>
        </m3e-icon-button>
        <span slot="title">{{ appData.settings.title }}</span>
        <span slot="subtitle">{{ currentContext }}</span>
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
        start-mode="auto"
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

        <main class="app-content">
          <p v-if="loadError" class="editor-error" role="alert">{{ loadError }}</p>
          <RouterView v-slot="{ Component }">
            <Transition :name="routeTransitionName" mode="out-in">
              <div :key="route.fullPath" class="route-view">
                <component :is="Component" />
              </div>
            </Transition>
          </RouterView>
        </main>
      </m3e-drawer-container>

      <template v-if="activeNavigation === 'homeworks'">
        <m3e-fab
          variant="primary"
          size="medium"
          class="create-fab"
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
      </template>

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
        <m3e-action-list>
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

      <WindowUnlockOverlay v-if="isWindowUnlocked" />

      <HomeworkEditorDialog
        ref="editorDialog"
        :homework="editingHomework"
        :subjects="editorSubjects"
        :tags="editorTags"
        :save-error="saveError"
        :is-editing="Boolean(editingHomework && appData.homeworks.some((item) => item.id === editingHomework?.id))"
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
  </div>
</template>
