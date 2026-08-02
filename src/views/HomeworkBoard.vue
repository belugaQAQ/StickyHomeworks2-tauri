<script setup lang="ts">
import { ref } from "vue";
import { useHomeworkMasonry, type SubjectGroup } from "../composables/useHomeworkMasonry";
import "../styles/homework-board.css";

const selectedHomeworkId = ref<string | null>(null);

const groups: SubjectGroup[] = [
  {
    name: "语文",
    homeworks: [
      { id: "chinese-read-1", content: "第六课课文朗读，并准备两个讨论问题。", tags: ["朗读", "小组"] },
      { id: "chinese-read-2", content: "第六课课文朗读，并准备两个讨论问题。", tags: ["朗读"] },
      { id: "chinese-write", content: "完成练习册最后两行书写练习。", tags: ["练习册"] },
    ],
  },
  {
    name: "数学",
    homeworks: [
      { id: "math-fractions", content: "完成第 1 至 12 题，并写出计算过程。", tags: ["分数", "练习"] },
      { id: "math-geometry", content: "整理角的分类，并完成几何笔记。", tags: ["笔记"] },
    ],
  },
  {
    name: "英语",
    homeworks: [
      { id: "english-words", content: "复习第三组词汇的拼写和例句。", tags: ["词汇"] },
      { id: "english-dialogue", content: "朗读课本第八页对话。", tags: ["朗读"] },
    ],
  },
];

const { boardElement, masonryColumns } = useHomeworkMasonry(groups);

function selectHomework(id: string) {
  selectedHomeworkId.value = selectedHomeworkId.value === id ? null : id;
}

</script>

<template>
  <section ref="boardElement" class="homework-board" aria-label="作业列表">
    <div class="homework-scroll-region">
      <div class="masonry-columns" :style="{ '--homework-column-count': masonryColumns.length }">
        <div v-for="(column, columnIndex) in masonryColumns" :key="columnIndex" class="masonry-column">
          <section v-for="group in column" :key="group.name" class="subject-group" :aria-labelledby="`subject-${group.name}`">
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
                <m3e-icon-button aria-label="编辑作业" title="编辑作业" variant="tonal" @click.stop>
                  <m3e-icon name="edit"></m3e-icon>
                </m3e-icon-button>
                <m3e-icon-button aria-label="删除作业" title="删除作业" variant="standard" @click.stop>
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
