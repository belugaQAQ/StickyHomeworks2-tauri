<script setup lang="ts">
import { computed, ref } from "vue";
import HomeworkBoard from "../views/HomeworkBoard.vue";
import "../styles/app-shell.css";
import "@m3e/icons";

type NavigationItem = "homeworks" | "templates" | "settings";

const activeNavigation = ref<NavigationItem>("homeworks");
const isDrawerOpen = ref(false);
const isMoreSheetOpen = ref(false);

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

function selectNavigation(id: NavigationItem) {
  activeNavigation.value = id;
  isDrawerOpen.value = false;
  isMoreSheetOpen.value = false;
}
</script>

<template>
  <m3e-theme class="app-theme" color="#22D1EC" scheme="auto" motion="expressive" strong-focus>
    <div class="app-frame">
      <m3e-app-bar>
        <m3e-icon-button slot="leading" aria-label="Open navigation">
          <m3e-icon name="menu"></m3e-icon>
        </m3e-icon-button>
        <span slot="title">作业</span>
        <span slot="subtitle">{{currentContext}}</span>
        <m3e-icon-button slot="trailing" aria-label="More options" variant="tonal">
          <m3e-bottom-sheet-trigger for="More-Sheet">
            <m3e-icon name="page_info" weight=400 grade="200"></m3e-icon>
          </m3e-bottom-sheet-trigger>
        </m3e-icon-button>
      </m3e-app-bar>

      <m3e-drawer-container class="app-drawer" :start="isDrawerOpen" start-mode="auto" start-divider>
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
          <HomeworkBoard v-if="activeNavigation === 'homeworks'" />

          <section v-else class="placeholder-view">
            <m3e-heading variant="headline" size="large" level="1">{{ currentTitle }}</m3e-heading>
          </section>
        </main>
      </m3e-drawer-container>

      <m3e-fab variant="primary" size="medium" class="create-fab" aria-label="Create homework">
        <m3e-fab-menu-trigger for="fabmenu">
          <m3e-icon name="edit" variant="rounded"></m3e-icon>
        </m3e-fab-menu-trigger>
      </m3e-fab>
      <m3e-fab-menu id="fabmenu" variant="primary">
        <m3e-fab-menu-item>
          <m3e-icon slot="icon" name="add" filled></m3e-icon>
          新建作业
        </m3e-fab-menu-item>
      </m3e-fab-menu>

      <m3e-bottom-sheet id="More-Sheet">
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
