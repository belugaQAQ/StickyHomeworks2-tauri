import { nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance, type Ref } from "vue";
import { distributeMasonry } from "./masonryDistribution";

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

export function useHomeworkMasonry(groups: Ref<SubjectGroup[]>, mobileLayout: Ref<boolean>) {
  const boardElement = ref<HTMLElement | null>(null);
  const scrollElement = ref<HTMLElement | null>(null);
  const masonryColumns = ref<SubjectGroup[][]>([groups.value]);
  const groupElements = new Map<string, HTMLElement>();
  const groupHeights = new Map<string, number>();
  let previousColumns = new Map<string, number>();
  let resizeObserver: ResizeObserver | undefined;
  let groupResizeObserver: ResizeObserver | undefined;
  let layoutFrame = 0;

  function setBoardElement(element: Element | ComponentPublicInstance | null) {
    boardElement.value = element instanceof HTMLElement ? element : null;
  }

  function setScrollElement(element: Element | ComponentPublicInstance | null) {
    scrollElement.value = element instanceof HTMLElement ? element : null;
  }

  function setGroupElement(name: string, element: Element | ComponentPublicInstance | null) {
    const nextElement = element instanceof HTMLElement ? element : null;
    const previousElement = groupElements.get(name);

    if (previousElement && previousElement !== nextElement) {
      groupResizeObserver?.unobserve(previousElement);
      groupElements.delete(name);
    }

    if (nextElement && previousElement !== nextElement) {
      groupElements.set(name, nextElement);
      groupResizeObserver?.observe(nextElement);
    }

    scheduleLayout();
  }

  function scheduleLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      void updateLayout();
    });
  }

  async function updateLayout() {
    await nextTick();

    if (mobileLayout.value) {
      masonryColumns.value = [groups.value];
      previousColumns = new Map(groups.value.map((group) => [group.name, 0]));
      return;
    }

    const maxHeight = getAvailableColumnHeight();
    const gap = getColumnGap();

    for (const group of groups.value) {
      const element = groupElements.get(group.name);
      if (element) groupHeights.set(group.name, element.getBoundingClientRect().height);
    }

    const items = groups.value.map((group) => ({
      group,
      key: group.name,
      // Before the first measurement, use a stable provisional height only to render every group.
      height: groupHeights.get(group.name) ?? 160,
    }));
    const distribution = distributeMasonry(items, maxHeight, gap, previousColumns);
    const nextColumns = distribution.columns.map((column) => column.map((item) => item.group));

    if (!hasSameColumns(masonryColumns.value, nextColumns)) masonryColumns.value = nextColumns;
    previousColumns = distribution.columnByKey;
  }

  function getAvailableColumnHeight() {
    const element = scrollElement.value ?? boardElement.value;
    if (!element) return Math.max(240, window.innerHeight);

    const styles = getComputedStyle(element);
    const padding = Number.parseFloat(styles.paddingBlockStart) + Number.parseFloat(styles.paddingBlockEnd);
    return Math.max(1, element.clientHeight - padding);
  }

  function getColumnGap() {
    const element = boardElement.value?.querySelector<HTMLElement>(".masonry-column");
    if (!element) return 36;
    return Number.parseFloat(getComputedStyle(element).rowGap) || 0;
  }

  onMounted(() => {
    resizeObserver = new ResizeObserver(scheduleLayout);
    if (boardElement.value) resizeObserver.observe(boardElement.value);
    if (scrollElement.value) resizeObserver.observe(scrollElement.value);

    groupResizeObserver = new ResizeObserver(scheduleLayout);
    for (const element of groupElements.values()) groupResizeObserver.observe(element);

    window.addEventListener("resize", scheduleLayout);
    scheduleLayout();
  });

  watch([groups, mobileLayout], scheduleLayout, { deep: true });

  onBeforeUnmount(() => {
    cancelAnimationFrame(layoutFrame);
    resizeObserver?.disconnect();
    groupResizeObserver?.disconnect();
    window.removeEventListener("resize", scheduleLayout);
  });

  return { masonryColumns, setBoardElement, setGroupElement, setScrollElement };
}

function hasSameColumns(current: SubjectGroup[][], next: SubjectGroup[][]) {
  return current.length === next.length
    && current.every((column, columnIndex) => column.length === next[columnIndex].length
      && column.every((group, groupIndex) => group.name === next[columnIndex][groupIndex].name));
}
