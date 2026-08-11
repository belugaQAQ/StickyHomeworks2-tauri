<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { useHomeworkMasonry } from "../composables/useHomeworkMasonry";
import type { SubjectGroup } from "../types/homework-board";
import { logInfo } from "../services/logging";
import "../styles/homework-board.css";

const selectedHomeworkId = ref<string | null>(null);
const props = defineProps<{ mobileLayout: boolean; groups: SubjectGroup[]; maxPanelWidth: number; readonly: boolean }>();
const emit = defineEmits<{
  edit: [id: string];
  delete: [id: string];
}>();
const groups = computed(() => props.groups);

const { masonryColumns, setBoardElement, setGroupElement, setScrollElement } = useHomeworkMasonry(
  groups,
  toRef(props, "mobileLayout"),
);

function selectHomework(id: string) {
  if (props.readonly) {
    logInfo("homework.select.blocked", "冻结状态下选择作业被阻止");
    return;
  }
  selectedHomeworkId.value = selectedHomeworkId.value === id ? null : id;
  logInfo(selectedHomeworkId.value ? "homework.select" : "homework.deselect", "作业选择状态已变化");
}

function editHomework(id: string) {
  if (props.readonly) {
    logInfo("homework.edit.blocked", "冻结状态下编辑作业被阻止");
    return;
  }
  selectedHomeworkId.value = id;
  logInfo("homework.edit.open", "作业编辑已请求");
  emit("edit", id);
}

function deleteHomework(id: string) {
  if (props.readonly) {
    logInfo("homework.delete.blocked", "冻结状态下删除作业被阻止");
    return;
  }
  selectedHomeworkId.value = id;
  logInfo("homework.delete.request", "作业删除已请求");
  emit("delete", id);
}

watch(() => props.readonly, (readonly) => {
  if (readonly) selectedHomeworkId.value = null;
});

</script>

<template>
  <section :ref="setBoardElement" class="homework-board" :class="{ 'homework-board--readonly': readonly }" aria-label="作业列表">
    <div :ref="setScrollElement" class="homework-scroll-region">
      <div v-if="groups.length === 0" class="homework-empty-state">
        <m3e-icon name="assignment"></m3e-icon>
        <m3e-heading variant="title" size="large" level="2">还没有作业</m3e-heading>
      </div>
      <div
        class="masonry-columns"
        :style="{
          '--homework-column-count': masonryColumns.length,
          '--homework-panel-width': `${maxPanelWidth}px`,
        }"
      >
        <div v-for="(column, columnIndex) in masonryColumns" :key="columnIndex" class="masonry-column">
          <section
            v-for="group in column"
            :key="group.name"
            :ref="(element) => setGroupElement(group.name, element)"
            class="subject-group"
            :aria-labelledby="`subject-${group.name}`"
          >
            <m3e-heading :id="`subject-${group.name}`" variant="headline" size="small" level="2">
              {{ group.name }}
            </m3e-heading>

            <m3e-list class="subject-homework-list" variant="segmented">
            <m3e-list-action
              v-for="homework in group.homeworks"
              :key="homework.id"
              class="homework-item"
              :class="{ 'homework-item--selected': selectedHomeworkId === homework.id, 'homework-item--expired': homework.expired }"
              :style="homework.expired ? { '--homework-expired-color': homework.expiredMarkColor } : undefined"
              @click="selectHomework(homework.id)"
            >
              <span class="homework-content"><span class="homework-marker" aria-hidden="true"></span><span class="homework-text">{{ homework.content }}</span></span>
              <div slot="supporting-text" class="homework-supporting-content">
                <div class="homework-tags">
                  <m3e-chip v-for="tag in homework.tags" :key="tag" variant="outlined">{{ tag }}</m3e-chip>
                </div>
                <div v-if="mobileLayout && !readonly && selectedHomeworkId === homework.id" class="homework-actions homework-actions--mobile">
                  <m3e-icon-button aria-label="编辑作业" title="编辑作业" @click.stop="editHomework(homework.id)">
                    <m3e-icon name="edit"></m3e-icon>
                  </m3e-icon-button>
                  <m3e-icon-button aria-label="删除作业" title="删除作业" @click.stop="deleteHomework(homework.id)">
                    <m3e-icon name="delete"></m3e-icon>
                  </m3e-icon-button>
                </div>
              </div>
              <div v-if="!mobileLayout && !readonly && selectedHomeworkId === homework.id" slot="trailing" class="homework-actions">
                <m3e-icon-button aria-label="编辑作业" title="编辑作业" @click.stop="editHomework(homework.id)">
                  <m3e-icon name="edit"></m3e-icon>
                </m3e-icon-button>
                <m3e-icon-button aria-label="删除作业" title="删除作业" @click.stop="deleteHomework(homework.id)">
                  <m3e-icon name="delete"></m3e-icon>
                </m3e-icon-button>
              </div>
            </m3e-list-action>
            </m3e-list>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>
