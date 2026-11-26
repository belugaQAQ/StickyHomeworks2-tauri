<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { M3eSnackbar } from "@m3e/web/all";
import { useAppContext } from "../app-context";
import SearchExpansionPanel from "../components/SearchExpansionPanel.vue";
import TimeMachineDiff from "../components/TimeMachineDiff.vue";
import type { DialogElement } from "../composables/useAppDialogs";
import { hideWebKitGtkDialog, useWebKitGtkDialogExit } from "../composables/useWebKitGtkDialogExit";
import { formatLocalDay, formatSnapshotTime, groupSnapshotsByDay, snapshotSourceLabel } from "../domain/time-machine";
import { logWarn } from "../services/logging";
import { listSnapshots, readSnapshot } from "../services/time-machine";
import type { HomeworkRecord } from "../types/app-data";
import type { SnapshotDetail, SnapshotPayload, SnapshotSource, SnapshotSummary } from "../types/time-machine";
import { toTiptapHtml } from "../utils/homework-content";
import { describeError } from "../utils/error-message";
import "../styles/time-machine.css";

const DUAL_PANE_MIN_WIDTH = 950;
const UNAVAILABLE_MESSAGE = "时间机器仅可在 Tauri 应用中使用。";

const context = useAppContext();
const isSupported = isTauri();

const snapshots = ref<SnapshotSummary[]>([]);
const searchQuery = ref("");
const isFilterOpen = ref(false);
const selectedSource = ref<SnapshotSource | "all">("all");
const selectedSubjects = ref<string[]>([]);
const selectedTags = ref<string[]>([]);
const selectedDateStart = ref<Date | null>(null);
const selectedDateEnd = ref<Date | null>(null);
const isLoading = ref(false);
const listError = ref("");
const selectedId = ref<string | null>(null);
const detail = ref<SnapshotDetail | null>(null);
const isRestoring = ref(false);
const restoreError = ref("");
const isConfirmVisible = ref(false);
const lockedDetail = ref<SnapshotDetail | null>(null);
const lockedId = ref<string | null>(null);
const confirmDialog = ref<DialogElement | null>(null);
const introDialog = ref<DialogElement | null>(null);
const viewportWidth = ref(0);

useWebKitGtkDialogExit(confirmDialog);
useWebKitGtkDialogExit(introDialog);

// 递增序号让「快速连续选择」和「卸载」都能作废旧请求，避免详情串页。
let listRequestId = 0;
let detailRequestId = 0;

const payloadRefs = computed(
  () =>
    [
      context.appData.value.homeworks,
      context.appData.value.settings.subjects,
      context.appData.value.settings.tags,
    ] as const,
);

const currentPayload = computed<SnapshotPayload>(() => ({
  homeworks: context.appData.value.homeworks,
  subjects: context.appData.value.settings.subjects,
  tags: context.appData.value.settings.tags,
}));

const dayGroups = computed(() => groupSnapshotsByDay(snapshots.value));
const searchIndexById = computed(() => {
  const index = new Map<string, string>();
  for (const group of dayGroups.value) {
    for (const snapshot of group.snapshots) {
      index.set(
        snapshot.id,
        [
          group.label,
          formatSnapshotTime(snapshot.createdAt, true),
          snapshotSourceLabel(snapshot.source),
          snapshot.source,
          `${snapshot.homeworkCount} 条作业`,
          snapshot.id,
          snapshot.searchText ?? "",
        ]
          .join(" ")
          .toLowerCase(),
      );
    }
  }
  return index;
});
const snapshotSourceOptions: SnapshotSource[] = [
  "homework-create",
  "homework-update",
  "homework-delete",
  "homework-cleanup",
  "expiry-mark",
  "cleanup-undo",
  "uaf-import",
  "legacy-import",
  "vocabulary-update",
  "snapshot-restore",
];

function handleSourceChange(event: Event) {
  const value = (event.currentTarget as HTMLElement & { value?: string | null }).value;
  if (value === "all" || snapshotSourceOptions.includes(value as SnapshotSource)) {
    selectedSource.value = value as SnapshotSource | "all";
  }
}

const availableDateKeys = computed(() => new Set(dayGroups.value.map((group) => group.key).filter(Boolean)));

function isBlackoutDate(date: Date): boolean {
  return !availableDateKeys.value.has(formatLocalDay(date));
}

const dateRangeDisplayText = computed(() => {
  if (!selectedDateStart.value) return "";
  const start = formatLocalDay(selectedDateStart.value);
  if (!selectedDateEnd.value) return start;
  const end = formatLocalDay(selectedDateEnd.value);
  return start === end ? start : `${start} ~ ${end}`;
});

function handleDateRangeChange(event: Event) {
  const picker = event.currentTarget as HTMLElement & {
    rangeStart?: Date | null;
    rangeEnd?: Date | null;
    date?: Date | null;
  };
  const start = picker.rangeStart ?? picker.date ?? null;
  const end = picker.rangeEnd ?? start;
  if (start && end && start.getTime() > end.getTime()) {
    selectedDateStart.value = end;
    selectedDateEnd.value = start;
  } else {
    selectedDateStart.value = start;
    selectedDateEnd.value = end;
  }
}

const subjectFilterOptions = computed(() => {
  const seen = new Set<string>();
  for (const snapshot of snapshots.value) {
    for (const subject of snapshot.subjects ?? []) {
      seen.add(subject);
    }
  }
  return [...seen];
});

const tagFilterOptions = computed(() => {
  const seen = new Set<string>();
  for (const snapshot of snapshots.value) {
    for (const tag of snapshot.tags ?? []) {
      seen.add(tag);
    }
  }
  return [...seen];
});

function readMultiSelectValues(event: Event): string[] {
  const select = event.currentTarget as HTMLElement & {
    selected?: ReadonlyArray<{ value?: string | null }>;
    value?: string | readonly string[] | null;
  };
  if (Array.isArray(select.selected)) {
    return select.selected
      .map((option) => (typeof option.value === "string" ? option.value : ""))
      .filter((value) => value.length > 0);
  }
  if (Array.isArray(select.value)) {
    return select.value.filter((value): value is string => typeof value === "string" && value.length > 0);
  }
  if (typeof select.value === "string" && select.value.length > 0) {
    return select.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function handleSubjectsChange(event: Event) {
  selectedSubjects.value = readMultiSelectValues(event);
}

function handleTagsChange(event: Event) {
  selectedTags.value = readMultiSelectValues(event);
}

type MatchSegment = {
  text: string;
  hit: boolean;
};

const activeSearchTerms = computed(() => searchQuery.value.trim().toLowerCase().split(/\s+/).filter(Boolean));

function matchSegmentsForSnapshot(snapshot: SnapshotSummary): MatchSegment[] {
  const terms = activeSearchTerms.value;
  const sourceText = snapshot.searchText ?? "";
  if (terms.length === 0 || !sourceText) return [];

  const lower = sourceText.toLowerCase();
  let firstHitIndex = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (firstHitIndex === -1 || idx < firstHitIndex)) {
      firstHitIndex = idx;
    }
  }
  if (firstHitIndex === -1) return [];

  const start = Math.max(0, firstHitIndex - 14);
  const end = Math.min(sourceText.length, start + 56);
  const rawSnippet = sourceText.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < sourceText.length ? "…" : "";
  const snippet = `${prefix}${rawSnippet}${suffix}`;
  const snippetLower = snippet.toLowerCase();

  const ranges: Array<{ start: number; end: number }> = [];
  for (const term of terms) {
    let cursor = 0;
    while (cursor < snippetLower.length) {
      const found = snippetLower.indexOf(term, cursor);
      if (found === -1) break;
      ranges.push({ start: found, end: found + term.length });
      cursor = found + term.length;
    }
  }
  if (ranges.length === 0) return [];

  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const segments: MatchSegment[] = [];
  let pos = 0;
  for (const range of merged) {
    if (range.start > pos) {
      segments.push({ text: snippet.slice(pos, range.start), hit: false });
    }
    segments.push({ text: snippet.slice(range.start, range.end), hit: true });
    pos = range.end;
  }
  if (pos < snippet.length) {
    segments.push({ text: snippet.slice(pos), hit: false });
  }
  return segments;
}

const matchSegmentsById = computed(() => {
  const map = new Map<string, MatchSegment[]>();
  if (activeSearchTerms.value.length === 0) return map;
  for (const group of filteredDayGroups.value) {
    for (const snapshot of group.snapshots) {
      const segments = matchSegmentsForSnapshot(snapshot);
      if (segments.length > 0) map.set(snapshot.id, segments);
    }
  }
  return map;
});

const activeFilterCount = computed(() => {
  let count = 0;
  if (selectedSource.value !== "all") count += 1;
  count += selectedSubjects.value.length;
  count += selectedTags.value.length;
  if (selectedDateStart.value) count += 1;
  return count;
});

const hasAnyFilter = computed(() => activeFilterCount.value > 0 || searchQuery.value.trim().length > 0);

function resetSearchFilters() {
  searchQuery.value = "";
  selectedSource.value = "all";
  selectedSubjects.value = [];
  selectedTags.value = [];
  selectedDateStart.value = null;
  selectedDateEnd.value = null;
}

const filteredDayGroups = computed(() => {
  const sourceFilter = selectedSource.value;
  const requiredSubjects = selectedSubjects.value;
  const requiredTags = selectedTags.value;
  const startKey = selectedDateStart.value ? formatLocalDay(selectedDateStart.value) : null;
  const endKey = selectedDateEnd.value ? formatLocalDay(selectedDateEnd.value) : startKey;
  const terms = searchQuery.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (
    sourceFilter === "all" &&
    requiredSubjects.length === 0 &&
    requiredTags.length === 0 &&
    !startKey &&
    terms.length === 0
  ) {
    return dayGroups.value;
  }
  return dayGroups.value
    .filter((group) => {
      if (!startKey) return true;
      if (!group.key) return false;
      return group.key >= startKey && group.key <= (endKey ?? startKey);
    })
    .map((group) => ({
      ...group,
      snapshots: group.snapshots.filter((snapshot) => {
        if (sourceFilter !== "all" && snapshot.source !== sourceFilter) return false;
        if (requiredSubjects.length > 0) {
          const subjectSet = new Set(snapshot.subjects ?? []);
          if (!requiredSubjects.every((subject) => subjectSet.has(subject))) return false;
        }
        if (requiredTags.length > 0) {
          const tagSet = new Set(snapshot.tags ?? []);
          if (!requiredTags.every((tag) => tagSet.has(tag))) return false;
        }
        if (terms.length === 0) return true;
        const searchable = searchIndexById.value.get(snapshot.id) ?? "";
        return terms.every((term) => searchable.includes(term));
      }),
    }))
    .filter((group) => group.snapshots.length > 0);
});
const dualPane = computed(() => !context.isMobileRuntime.value && viewportWidth.value >= DUAL_PANE_MIN_WIDTH);

const paneDirection = ref<"forward" | "back">("forward");
const paneTransition = computed(() => (paneDirection.value === "forward" ? "settings-forward" : "settings-back"));
const paneKey = computed(() => (dualPane.value ? "dual" : (selectedId.value ?? "list")));
const paneAnimationEnabled = ref(true);
const paneAnimation = computed(() => (paneAnimationEnabled.value ? paneTransition.value : "no-transition"));

const showListPane = computed(() => dualPane.value || selectedId.value === null);
const showDetailPane = computed(() => dualPane.value || selectedId.value !== null);
const displayedDetail = computed(() => lockedDetail.value ?? detail.value);
const isFrozen = computed(() => context.isHomeworkFrozen.value);

type SnapshotGroup = {
  subject: string;
  items: Array<{ id: string; html: string; due: string; tags: string[] }>;
};

const contentGroups = computed<SnapshotGroup[]>(() => {
  const groups = new Map<string, SnapshotGroup>();
  for (const homework of displayedDetail.value?.homeworks ?? []) {
    const subject = homework.subject.trim() || "其它";
    const group = groups.get(subject) ?? { subject, items: [] };
    group.items.push(contentItem(homework));
    groups.set(subject, group);
  }
  return [...groups.values()];
});

function contentItem(homework: HomeworkRecord) {
  return {
    id: homework.id,
    // 和看板同一套渲染
    html: toTiptapHtml(homework.content),
    due: homework.dueTime.slice(0, 10),
    tags: homework.tags,
  };
}

function sourceIcon(source: SnapshotSource): string {
  if (source === "homework-delete") return "delete";
  if (source === "homework-create") return "add";
  if (source === "homework-update") return "edit";
  if (source === "homework-cleanup") return "cleaning_services";
  if (source === "expiry-mark") return "schedule";
  if (source === "cleanup-undo") return "undo";
  if (source === "vocabulary-update") return "category";
  if (source === "snapshot-restore") return "restore";
  return "upload_file";
}

const INTRO_STORAGE_KEY = "stickyhomeworks2.time-machine-intro.v1";

function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(INTRO_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_STORAGE_KEY, "1");
  } catch (error) {
    void logWarn("time-machine.intro.save.failure", error instanceof Error ? error.message : String(error));
  }
}

async function closeIntro(): Promise<void> {
  await hideWebKitGtkDialog(introDialog.value);
  markIntroSeen();
}

function updateViewportWidth() {
  const wasDualPane = dualPane.value;
  viewportWidth.value = window.innerWidth;
  if (dualPane.value !== wasDualPane) {
    paneAnimationEnabled.value = false;
    void nextTick(() => {
      paneAnimationEnabled.value = true;
    });
  }
}

async function refresh() {
  if (!isSupported) return;
  const requestId = ++listRequestId;
  isLoading.value = true;
  listError.value = "";
  try {
    const result = await listSnapshots();
    if (requestId !== listRequestId) return;
    snapshots.value = result;
    if (selectedId.value !== null && !result.some((snapshot) => snapshot.id === selectedId.value)) {
      selectedId.value = null;
      detail.value = null;
    }
  } catch (error) {
    if (requestId !== listRequestId) return;
    listError.value = "读取历史失败，请重试。";
    await logWarn("time-machine.list.failure", error instanceof Error ? error.message : String(error));
  } finally {
    if (requestId === listRequestId) isLoading.value = false;
  }
}

async function select(id: string) {
  if (isRestoring.value) return;
  const requestId = ++detailRequestId;
  try {
    const result = await readSnapshot(id);
    if (requestId !== detailRequestId) return;
    paneDirection.value = "forward";
    detail.value = result;
    selectedId.value = id;
  } catch (error) {
    if (requestId !== detailRequestId) return;
    M3eSnackbar.open("读取快照失败，它可能已被清理。");
    await logWarn("time-machine.read.failure", error instanceof Error ? error.message : String(error));
    await refresh();
  }
}

function backToList() {
  paneDirection.value = "back";
  selectedId.value = null;
  detail.value = null;
}

async function requestRestore() {
  if (!detail.value || !selectedId.value || isFrozen.value || isRestoring.value) return;
  lockedDetail.value = detail.value;
  lockedId.value = selectedId.value;
  restoreError.value = "";
  isConfirmVisible.value = true;
  await nextTick();
  confirmDialog.value?.show();
}

async function closeConfirm() {
  await hideWebKitGtkDialog(confirmDialog.value);
  isConfirmVisible.value = false;
  lockedDetail.value = null;
  lockedId.value = null;
  restoreError.value = "";
}

async function confirmRestore() {
  const id = lockedId.value;
  if (!id) return;
  isRestoring.value = true;
  restoreError.value = "";
  try {
    await context.restoreTimeMachineSnapshot(id);
    await closeConfirm();
    M3eSnackbar.open("已恢复到这个时间点。");
    selectedId.value = null;
    detail.value = null;
    await refresh();
  } catch (error) {
    restoreError.value = describeError(error, "恢复失败，请重试");
    await logWarn("time-machine.restore.failure", error instanceof Error ? error.message : String(error));
  } finally {
    isRestoring.value = false;
  }
}

watch(payloadRefs, () => {
  if (!isConfirmVisible.value || isRestoring.value) return;
  void closeConfirm().then(() => {
    M3eSnackbar.open("当前数据已变化，请重新确认恢复");
  });
});

watch(payloadRefs, () => {
  void refresh();
});

onMounted(() => {
  updateViewportWidth();
  window.addEventListener("resize", updateViewportWidth);
  void refresh();
  if (isSupported && !hasSeenIntro()) {
    void nextTick(() => introDialog.value?.show());
  }
});

onUnmounted(() => {
  window.removeEventListener("resize", updateViewportWidth);
  listRequestId += 1;
  detailRequestId += 1;
});
</script>

<template>
  <section class="time-machine" :class="{ 'time-machine--dual': dualPane }">
    <Transition :name="paneAnimation" mode="out-in">
      <div :key="paneKey" class="time-machine__panes">
        <div v-if="showListPane" class="time-machine__pane time-machine__pane--list">
          <m3e-callout v-if="!isSupported" variant="error" shape="square">{{ UNAVAILABLE_MESSAGE }}</m3e-callout>
          <template v-if="isSupported">
            <SearchExpansionPanel
              v-model="searchQuery"
              v-model:open="isFilterOpen"
              :badge-count="activeFilterCount"
              class="time-machine__search"
              placeholder="搜索作业内容..."
              aria-label="搜索历史记录"
            >
              <div class="time-machine__filters">
                <m3e-form-field variant="outlined" class="time-machine__select-field">
                  <label slot="label" for="time-machine-source-select">快照类型</label>
                  <m3e-select id="time-machine-source-select" :value="selectedSource" @change="handleSourceChange">
                    <m3e-option value="all" :selected="selectedSource === 'all'">全部类型</m3e-option>
                    <m3e-option
                      v-for="source in snapshotSourceOptions"
                      :key="source"
                      :value="source"
                      :selected="selectedSource === source"
                    >
                      {{ snapshotSourceLabel(source) }}
                    </m3e-option>
                  </m3e-select>
                </m3e-form-field>

                <m3e-form-field variant="outlined" class="time-machine__select-field">
                  <label slot="label" for="time-machine-subjects-select">科目（须全部包含）</label>
                  <m3e-select
                    id="time-machine-subjects-select"
                    :multi.prop="true"
                    aria-multiselectable="true"
                    @change="handleSubjectsChange"
                  >
                    <m3e-option
                      v-for="subject in subjectFilterOptions"
                      :key="subject"
                      :value="subject"
                      :selected="selectedSubjects.includes(subject)"
                    >
                      {{ subject }}
                    </m3e-option>
                  </m3e-select>
                </m3e-form-field>

                <m3e-form-field variant="outlined" class="time-machine__select-field">
                  <label slot="label" for="time-machine-tags-select">标签（须全部包含）</label>
                  <m3e-select
                    id="time-machine-tags-select"
                    :multi.prop="true"
                    aria-multiselectable="true"
                    @change="handleTagsChange"
                  >
                    <m3e-option
                      v-for="tag in tagFilterOptions"
                      :key="tag"
                      :value="tag"
                      :selected="selectedTags.includes(tag)"
                    >
                      {{ tag }}
                    </m3e-option>
                  </m3e-select>
                </m3e-form-field>

                <m3e-form-field variant="outlined" class="time-machine__select-field">
                  <label slot="label" for="time-machine-date-trigger">快照日期范围</label>
                  <input
                    id="time-machine-date-trigger"
                    readonly
                    :value="dateRangeDisplayText"
                    placeholder="全部日期"
                  />
                  <m3e-icon-button slot="suffix" aria-label="选择日期范围">
                    <m3e-icon name="calendar_today"></m3e-icon>
                    <m3e-datepicker-toggle for="time-machine-date-picker"></m3e-datepicker-toggle>
                  </m3e-icon-button>
                </m3e-form-field>
              </div>
              <template #actions>
                <m3e-button variant="text" :disabled="!hasAnyFilter" @click="resetSearchFilters">重置</m3e-button>
              </template>
            </SearchExpansionPanel>
            <m3e-datepicker
              id="time-machine-date-picker"
              for="time-machine-date-trigger"
              :range.prop="true"
              :clearable.prop="true"
              clear-label="清除"
              confirm-label="确定"
              dismiss-label="取消"
              label="选择快照日期范围"
              :range-start.prop="selectedDateStart"
              :range-end.prop="selectedDateEnd"
              .blackoutDates="isBlackoutDate"
              @change="handleDateRangeChange"
            ></m3e-datepicker>
            <p v-if="listError" class="time-machine__error" role="alert">
              {{ listError }}
              <m3e-button variant="text" @click="refresh">重试</m3e-button>
            </p>
            <div v-if="isLoading" class="time-machine__loading">
              <m3e-loading-indicator></m3e-loading-indicator>
            </div>
            <template v-else>
              <div v-if="dayGroups.length === 0 && !listError" class="time-machine__empty">
                <m3e-icon name="history"></m3e-icon>
                <p>还没有历史记录。修改作业后会自动留下一个时间点。</p>
              </div>
              <div v-else-if="filteredDayGroups.length === 0 && !listError" class="time-machine__empty">
                <m3e-icon name="search_off"></m3e-icon>
                <p>没有匹配的历史记录。</p>
                <m3e-button variant="text" @click="resetSearchFilters">清除筛选</m3e-button>
              </div>
              <div v-for="group in filteredDayGroups" :key="group.key" class="time-machine__day">
                <m3e-heading variant="label" size="large" level="3" class="time-machine__day-label">{{
                  group.label
                }}</m3e-heading>
                <m3e-list variant="segmented" class="time-machine__list">
                  <m3e-list-action
                    v-for="snapshot in group.snapshots"
                    :key="snapshot.id"
                    :class="{ 'time-machine__item--selected': snapshot.id === selectedId }"
                    :disabled="isRestoring"
                    @click="select(snapshot.id)"
                  >
                    <m3e-icon slot="leading" :name="sourceIcon(snapshot.source)"></m3e-icon>
                    <span>{{ formatSnapshotTime(snapshot.createdAt) }}</span>
                    <span slot="supporting-text">
                      <span>{{ snapshotSourceLabel(snapshot.source) }} · {{ snapshot.homeworkCount }} 条作业</span>
                      <span v-if="matchSegmentsById.get(snapshot.id)" class="time-machine__match-snippet">
                        命中：<template v-for="(seg, segIndex) in matchSegmentsById.get(snapshot.id)" :key="segIndex"><mark
                            v-if="seg.hit"
                            class="time-machine__match-mark"
                            >{{ seg.text }}</mark
                          ><template v-else>{{ seg.text }}</template></template>
                      </span>
                    </span>
                  </m3e-list-action>
                </m3e-list>
              </div>
            </template>
          </template>
        </div>

        <div v-if="showDetailPane && isSupported" class="time-machine__pane time-machine__pane--detail">
          <Transition name="time-machine-detail" mode="out-in">
            <div :key="displayedDetail?.summary.id ?? 'empty'" class="time-machine__detail-content">
              <header class="time-machine__detail-header">
                <m3e-icon-button v-if="!dualPane" aria-label="返回列表" title="返回列表" @click="backToList">
                  <m3e-icon name="arrow_back"></m3e-icon>
                </m3e-icon-button>
                <div class="time-machine__detail-title">
                  <m3e-heading variant="title" size="large" level="2">
                    {{
                      displayedDetail
                        ? formatSnapshotTime(displayedDetail.summary.createdAt, true)
                        : "选择一个时间点查看"
                    }}
                  </m3e-heading>
                  <p v-if="displayedDetail" class="time-machine__detail-meta">
                    {{ snapshotSourceLabel(displayedDetail.summary.source) }}
                    <span v-if="isFrozen"> · 请先解除作业冻结后再恢复</span>
                  </p>
                </div>
                <div v-if="displayedDetail" class="time-machine__detail-actions">
                  <m3e-button
                    variant="filled"
                    aria-label="恢复到这个时间点"
                    title="恢复到这个时间点"
                    :disabled="isRestoring || isFrozen"
                    @click="requestRestore"
                  >
                    <m3e-icon slot="icon" name="restore"></m3e-icon>恢复备份
                  </m3e-button>
                </div>
              </header>

              <div v-if="!displayedDetail" class="time-machine__empty">
                <m3e-icon name="history"></m3e-icon>
                <p>从左侧选择一个时间点，查看它和当前数据的差异。</p>
              </div>

              <template v-else>
                <div class="time-machine__chips">
                  <m3e-chip variant="outlined">{{ displayedDetail.summary.homeworkCount }} 条作业</m3e-chip>
                  <m3e-chip variant="outlined">{{ displayedDetail.summary.subjectCount }} 个科目</m3e-chip>
                  <m3e-chip variant="outlined">{{ displayedDetail.summary.tagCount }} 个标签</m3e-chip>
                </div>

                <m3e-tabs class="time-machine__tabs" variant="primary" stretch>
                  <m3e-tab for="time-machine-content" selected id="tab2">
                    <m3e-icon slot="icon" name="article"></m3e-icon>快照内容
                  </m3e-tab>
                  <m3e-tooltip for="tab2">该备份的数据</m3e-tooltip>
                  <m3e-tab for="time-machine-diff" id="tab1">
                    <m3e-icon slot="icon" name="difference"></m3e-icon>恢复差异
                  </m3e-tab>
                  <m3e-tooltip for="tab1">该备份与您当前数据的差异</m3e-tooltip>
                  <m3e-tab-panel id="time-machine-content">
                    <div class="time-machine__panel-body">
                      <div v-if="contentGroups.length === 0" class="time-machine__empty">
                        <p>这个时间点没有作业</p>
                      </div>
                      <section v-for="group in contentGroups" :key="group.subject" class="time-machine__content-group">
                        <m3e-heading variant="title" size="medium" level="4">{{ group.subject }}</m3e-heading>
                        <m3e-list variant="segmented" class="time-machine__content-list">
                          <m3e-list-item v-for="item in group.items" :key="item.id">
                            <span class="time-machine__content-text" v-html="item.html || '（空内容）'"></span>
                            <span slot="supporting-text" class="time-machine__content-meta">
                              <span>截止 {{ item.due }}</span>
                              <m3e-chip v-for="tag in item.tags" :key="tag" variant="outlined">{{ tag }}</m3e-chip>
                            </span>
                          </m3e-list-item>
                        </m3e-list>
                      </section>
                      <section class="time-machine__content-group">
                        <m3e-heading variant="title" size="medium" level="4">科目词库</m3e-heading>
                        <div class="time-machine__chips">
                          <m3e-chip v-for="subject in displayedDetail.subjects" :key="subject" variant="outlined">{{
                            subject
                          }}</m3e-chip>
                          <span v-if="displayedDetail.subjects.length === 0" class="time-machine__muted">空</span>
                        </div>
                      </section>
                      <section class="time-machine__content-group">
                        <m3e-heading variant="title" size="medium" level="4">标签词库</m3e-heading>
                        <div class="time-machine__chips">
                          <m3e-chip v-for="tag in displayedDetail.tags" :key="tag" variant="outlined">{{
                            tag
                          }}</m3e-chip>
                          <span v-if="displayedDetail.tags.length === 0" class="time-machine__muted">空</span>
                        </div>
                      </section>
                    </div>
                  </m3e-tab-panel>
                  <m3e-tab-panel id="time-machine-diff">
                    <div class="time-machine__panel-body">
                      <TimeMachineDiff :before="currentPayload" :after="displayedDetail" />
                    </div>
                  </m3e-tab-panel>
                </m3e-tabs>
              </template>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>

    <m3e-dialog ref="introDialog" class="time-machine__intro" disable-close>
      <m3e-heading slot="header" variant="headline" size="small" level="2">注意！</m3e-heading>
      <p>时间机器在每次作业或科目、标签词库<b>变动后</b>，保存一份当时的备份以方便还原</p>
      <p>最近 3 天的备份<b>全部保留</b>；再往前一个月内，每天只保留最后 5 份，一年内每天只保留 1 份，超过一年删除</p>
      <p>选择一条记录可以看到备份与当前作业数据的差异，也可以选择恢复到那个时间点；恢复前同样会备份当前状态</p>
      <div slot="actions" end>
        <m3e-button variant="filled" class="time-machine__intro-confirm" @click="closeIntro">知道了</m3e-button>
      </div>
    </m3e-dialog>

    <m3e-dialog ref="confirmDialog" alert disable-close>
      <m3e-heading slot="header" variant="headline" size="small" level="2">恢复到这个时间点？</m3e-heading>
      当前的作业、科目和标签会被替换。恢复前会保存当前状态，其他设置不变。恢复成功后今天不再自动清理过期作业。
      <p v-if="restoreError" class="time-machine__error" role="alert">{{ restoreError }}</p>
      <div slot="actions" end>
        <m3e-button variant="text" :disabled="isRestoring" @click="closeConfirm">取消</m3e-button>
        <m3e-button variant="filled" :disabled="isRestoring" @click="confirmRestore">恢复</m3e-button>
      </div>
    </m3e-dialog>
  </section>
</template>
