<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import "../styles/settings-view.css";
import { useAppContext } from "../app-context";
import { getSettingsSidebarScrollTop, setSettingsSidebarScrollTop } from "../services/settings-sidebar-scroll";

const RIGHT_PANEL_MIN_WIDTH = 800;
const SPLIT_LAYOUT_MIN_WIDTH = 600;

const settingsSections = [
  { path: "/settings/general", icon: "tune", title: "通用", detail: "应用标题" },
  { path: "/settings/vocabulary", icon: "category", title: "作业词库", detail: "科目和标签" },
  { path: "/settings/expiry", icon: "event_busy", title: "过期作业", detail: "清理和标记" },
  { path: "/settings/board", icon: "view_column", title: "看板", detail: "最大面板宽度" },
  { path: "/settings/import", icon: "upload_file", title: "导入旧版数据", detail: "Profile.json 和 Settings.json" },
  { path: "/settings/diagnostics", icon: "content_copy", title: "诊断信息", detail: "反馈、诊断包与运行日志" },
  { path: "/settings/about", icon: "info", title: "关于", detail: "版本、项目与许可证" },
];
const { title, headingId, error, showBack } = defineProps<{
  title: string;
  headingId: string;
  error?: string;
  showBack?: boolean;
}>();
const router = useRouter();
const route = useRoute();
const { isMobileRuntime } = useAppContext();
const viewportWidth = ref(0);
const navigationList = ref<HTMLElement | null>(null);


const isNarrowSplitLayout = computed(() =>
  !isMobileRuntime.value && viewportWidth.value > 0 && viewportWidth.value < SPLIT_LAYOUT_MIN_WIDTH,
);

const isRightPanelInsufficient = computed(() =>
  !isMobileRuntime.value && viewportWidth.value >= SPLIT_LAYOUT_MIN_WIDTH && viewportWidth.value < RIGHT_PANEL_MIN_WIDTH,
);


function updateAvailableWidth() {
  viewportWidth.value = window.innerWidth;
}

function saveNavigationScrollPosition() {
  if (!navigationList.value) return;
  const scrollTop = navigationList.value.scrollTop;
  setSettingsSidebarScrollTop(scrollTop);
  const restore = () => {
    if (navigationList.value) navigationList.value.scrollTop = scrollTop;
  };
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
}

onMounted(() => {
  updateAvailableWidth();
  window.addEventListener("resize", updateAvailableWidth);
  void nextTick(() => {
    if (navigationList.value) navigationList.value.scrollTop = getSettingsSidebarScrollTop();
  });
});

onBeforeUnmount(() => {
  if (navigationList.value) setSettingsSidebarScrollTop(navigationList.value.scrollTop);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateAvailableWidth);
});
</script>

<template>
  <section
    class="settings-page"
    :class="{ 'settings-page--split': showBack, 'settings-page--mobile': isMobileRuntime, 'settings-page--narrow': isNarrowSplitLayout }"
  >
    <div v-if="showBack" class="settings-layout">
      <nav ref="navigationList" class="settings-layout__sidebar" aria-label="设置分类">
        <m3e-heading variant="title" size="large" level="2">设置</m3e-heading>
        <m3e-action-list variant="segmented" class="settings-navigation__list" @click.capture="saveNavigationScrollPosition">
          <m3e-list-action
            v-for="section in settingsSections"
            :key="section.path"
            class="settings-navigation__item"
            :class="{ 'settings-navigation__item--active': route.path === section.path }"
            :href="`#${section.path}`"
            :aria-current="route.path === section.path ? 'page' : undefined"
          >
            <m3e-icon slot="leading" :name="section.icon"></m3e-icon>
            {{ section.title }}
            <span slot="supporting-text">{{ section.detail }}</span>
          </m3e-list-action>
        </m3e-action-list>
      </nav>
      <section class="settings-layout__content">
        <div class="settings-layout__content-inner">
          <header class="settings-page__header">
            <m3e-icon-button v-if="showBack && (isMobileRuntime || isNarrowSplitLayout)" aria-label="返回设置" title="返回设置" @click="router.replace('/settings')">
              <m3e-icon name="arrow_back"></m3e-icon>
            </m3e-icon-button>
            <m3e-heading :id="headingId" variant="headline" size="large" level="1">{{ title }}</m3e-heading>
          </header>
          <slot />
          <p v-if="error" class="editor-error" role="alert">{{ error }}</p>
        </div>
      <Teleport to="body">
        <Transition name="settings-insufficient">
          <div v-if="isRightPanelInsufficient" class="settings-insufficient-overlay" role="alert" aria-live="polite">
            <m3e-card variant="elevated" class="settings-insufficient-content">
              <div slot="header" class="settings-insufficient-header">
                <m3e-heading class="settings-insufficient-title" variant="title" size="large" level="2">窗口空间不足</m3e-heading>
                <m3e-icon class="settings-insufficient-arrow" name="arrow_forward" aria-hidden="true"></m3e-icon>
              </div>
              <p slot="content" class="settings-insufficient-desc">当前窗口宽度不足以舒适显示设置内容，请继续缩放窗口后使用。</p>
            </m3e-card>
          </div>
        </Transition>
      </Teleport>
      </section>
    </div>

    <template v-else>
      <header class="settings-page__header">
        <m3e-heading :id="headingId" variant="headline" size="large" level="1">{{ title }}</m3e-heading>
      </header>
      <slot />
      <p v-if="error" class="editor-error" role="alert">{{ error }}</p>
    </template>
  </section>
</template>
