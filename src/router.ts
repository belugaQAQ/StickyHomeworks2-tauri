import { ref } from "vue";
import {
  createRouter,
  createWebHashHistory,
  type RouteLocationNormalizedLoaded,
  type RouteRecordRaw,
} from "vue-router";
import { settingsSectionComponents, settingsRouteName, settingsSections } from "./settings/sections";
import HomeworksView from "./views/HomeworksView.vue";
import SettingsIndexView from "./views/SettingsIndexView.vue";
import TemplatesView from "./views/TemplatesView.vue";
import TrayMenuView from "./views/TrayMenuView.vue";
import { SETTINGS_DETAIL_MIN_WIDTH } from "./ui/breakpoints";

export type RouteTransitionName = "route-fade" | "settings-forward" | "settings-back" | "settings-detail";

declare module "vue-router" {
  interface RouteMeta {
    settingsDepth?: number;
  }
}

/** `/settings/*` 详情路由由设置分区清单统一生成，路由名/路径/meta 与旧实现保持一致。 */
const settingsDetailRoutes: RouteRecordRaw[] = settingsSections.map((section) => ({
  path: section.path,
  name: settingsRouteName(section),
  component: settingsSectionComponents[section.path],
  meta: { settingsDepth: section.depth },
}));

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "homeworks", component: HomeworksView },
    { path: "/tray-menu", name: "tray-menu", component: TrayMenuView },
    { path: "/templates", name: "templates", component: TemplatesView },
    {
      path: "/settings",
      name: "settings",
      component: SettingsIndexView,
      meta: { settingsDepth: 0 },
      beforeEnter: () => (window.innerWidth > SETTINGS_DETAIL_MIN_WIDTH ? "/settings/general" : true),
    },
    ...settingsDetailRoutes,
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

export const routeTransitionName = ref<RouteTransitionName>("route-fade");

router.afterEach((to, from) => {
  routeTransitionName.value = resolveRouteTransition(from, to);
});

function resolveRouteTransition(
  from: RouteLocationNormalizedLoaded,
  to: RouteLocationNormalizedLoaded,
): RouteTransitionName {
  const fromDepth = from.meta.settingsDepth;
  const toDepth = to.meta.settingsDepth;

  if (fromDepth === 0 && toDepth === 1) return "settings-forward";
  if (fromDepth === 1 && toDepth === 0) return "settings-back";
  if (fromDepth === 1 && toDepth === 1) return "settings-detail";
  return "route-fade";
}
