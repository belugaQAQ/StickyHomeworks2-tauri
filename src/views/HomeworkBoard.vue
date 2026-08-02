<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { useHomeworkMasonry } from "../composables/useHomeworkMasonry";
import type { SubjectGroup } from "../types/homework-board";
import "../styles/homework-board.css";

const selectedHomeworkId = ref<string | null>(null);
const props = defineProps<{ mobileLayout: boolean; groups: SubjectGroup[] }>();
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
  selectedHomeworkId.value = selectedHomeworkId.value === id ? null : id;
}

function editHomework(id: string) {
  selectedHomeworkId.value = id;
  emit("edit", id);
}

function deleteHomework(id: string) {
  selectedHomeworkId.value = id;
  emit("delete", id);
}

</script>

<template>
  <section :ref="setBoardElement" class="homework-board" aria-label="作业列表">
    <div :ref="setScrollElement" class="homework-scroll-region">
      <div v-if="groups.length === 0" class="homework-empty-state">
        <m3e-icon name="assignment"></m3e-icon>
        <m3e-heading variant="title" size="large" level="2">还没有作业</m3e-heading>
      </div>
      <div class="masonry-columns" :style="{ '--homework-column-count': masonryColumns.length }">
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
              @click="selectHomework(homework.id)"
            >
              <span slot="leading" class="homework-marker" aria-hidden="true"></span>
              <span class="homework-content">{{ homework.content }}</span>
              <div slot="supporting-text" class="homework-tags">
                <m3e-chip v-for="tag in homework.tags" :key="tag" variant="outlined">{{ tag }}</m3e-chip>
              </div>
              <div v-if="selectedHomeworkId === homework.id" slot="trailing" class="homework-actions">
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
