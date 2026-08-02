import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export type Homework = {
  id: string;
  content: string;
  tags: string[];
  expired?: boolean;
};

export type SubjectGroup = {
  name: string;
  homeworks: Homework[];
};

export function useHomeworkMasonry(groups: SubjectGroup[]) {
  const boardElement = ref<HTMLElement | null>(null);
  const columnHeight = ref(0);
  const masonryColumns = computed(() => distributeGroups(groups, columnHeight.value));

  function updateColumnHeight() {
    const mobileLayout = window.matchMedia("(max-width: 767px)").matches;
    const boardHeight = boardElement.value?.getBoundingClientRect().height || window.innerHeight;
    columnHeight.value = mobileLayout ? Number.POSITIVE_INFINITY : Math.max(240, boardHeight);
  }

  let resizeObserver: ResizeObserver | undefined;

  onMounted(() => {
    if (!boardElement.value) return;

    resizeObserver = new ResizeObserver(updateColumnHeight);
    resizeObserver.observe(boardElement.value);
    window.addEventListener("resize", updateColumnHeight);
    updateColumnHeight();
  });

  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    window.removeEventListener("resize", updateColumnHeight);
  });

  return { boardElement, masonryColumns };
}

function distributeGroups(subjectGroups: SubjectGroup[], maxHeight: number) {
  const columns: SubjectGroup[][] = [[]];
  let currentColumnHeight = 0;

  for (const group of subjectGroups) {
    const groupHeight = estimateGroupHeight(group);
    if (currentColumnHeight > 0 && currentColumnHeight + groupHeight > maxHeight) {
      columns.push([]);
      currentColumnHeight = 0;
    }
    columns[columns.length - 1].push(group);
    currentColumnHeight += groupHeight;
  }

  return columns;
}

function estimateGroupHeight(group: SubjectGroup) {
  return 50 + group.homeworks.reduce(
    (height, homework) => height + 88 + Math.ceil(homework.content.length / 28) * 28 + homework.tags.length * 6,
    0,
  );
}
