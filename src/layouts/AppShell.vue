<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, ref } from "vue";
import HomeworkBoard from "../views/HomeworkBoard.vue";
import { loadAppData } from "../services/app-data";
import { createDefaultAppData, type AppData } from "../types/app-data";
import type { SubjectGroup } from "../composables/useHomeworkMasonry";
import { isHomeworkExpired, toHomeworkDisplayText } from "../utils/homework-content";
import "../styles/app-shell.css";

type NavigationItem = "homeworks" | "templates" | "settings";

const activeNavigation = ref<NavigationItem>("homeworks");
const isDrawerOpen = ref(false);
const isMobileRuntime = ref(false);
const appDrawer = ref<HTMLElement | null>(null);
const moreSheet = ref<HTMLElement | null>(null);
const appData = ref<AppData>(createDefaultAppData());

const navigationItems: Array<{ id: NavigationItem; label: string; hint: string }> = [
  { id: "homeworks", label: "作业", hint: "home" },
  { id: "templates", label: "模板", hint: "article" },
  { id: "settings", label: "设置", hint: "settings" },
];

const currentTitle = computed(() =>
  navigationItems.find((item) => item.id === activeNavigation.value)?.label ?? "作业",
);

const currentContext = computed(() => {
  if (activeNavigation.value === "homeworks") return "今日任务";
  return currentTitle.value;
});

const homeworkGroups = computed<SubjectGroup[]>(() => {
  const groups = new Map<string, SubjectGroup>();

  for (const homework of appData.value.homeworks) {
    const subject = homework.subject.trim() || "其它";
    const group = groups.get(subject) ?? { name: subject, homeworks: [] };
    group.homeworks.push({
      id: homework.id,
      content: toHomeworkDisplayText(homework.content),
      tags: homework.tags,
      expired: isHomeworkExpired(homework.dueTime),
    });
    groups.set(subject, group);
  }

  return [...groups.values()];
});

function selectNavigation(id: NavigationItem) {
  activeNavigation.value = id;
  isDrawerOpen.value = false;
}

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
  // M3E uses the handle attribute in its Shadow DOM CSS, while Vue's
  // custom-element bridge may leave only the corresponding property.
  moreSheet.value?.setAttribute("handle", "");
  moreSheet.value?.setAttribute("detents", "fit half full");
  isMobileRuntime.value = await detectMobileRuntime();
  appData.value = await loadAppData();
});
</script>

<template>
  <m3e-theme
    class="app-theme"
    :class="{ 'app-theme--mobile': isMobileRuntime }"
    color="#22D1EC"
    scheme="auto"
    motion="expressive"
    strong-focus
  >
    <div class="app-frame">
      <m3e-app-bar>
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
        <span slot="title">作业</span>
        <span slot="subtitle">{{currentContext}}</span>
        <m3e-icon-button slot="trailing" aria-label="More options" variant="tonal">
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
          <HomeworkBoard
            v-if="activeNavigation === 'homeworks'"
            :mobile-layout="isMobileRuntime"
            :groups="homeworkGroups"
          />

          <section v-else class="placeholder-view">
            <m3e-heading variant="headline" size="large" level="1">{{ currentTitle }}</m3e-heading>
          </section>
        </main>
      </m3e-drawer-container>

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
        <m3e-fab-menu-item>
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
        <m3e-heading id="sheetTitle" slot="header" variant="title" size="large">
          更多
          </m3e-heading>
        <m3e-action-list>
          <m3e-list-action>
            <m3e-bottom-sheet-action @click="selectNavigation('settings')">设置</m3e-bottom-sheet-action>
            <span slot="supporting-text">前往设置页面</span>
          </m3e-list-action>
        </m3e-action-list>
      </m3e-bottom-sheet>
    </div>
  </m3e-theme>
</template>
