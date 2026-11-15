<script setup lang="ts">
import { computed } from "vue";
import { buildRestoreDiff, type DiffLineKind } from "../domain/time-machine-diff";
import type { SnapshotPayload } from "../types/time-machine";

const props = defineProps<{ before: SnapshotPayload; after: SnapshotPayload }>();

const diff = computed(() => buildRestoreDiff(props.before, props.after));

const blocks = computed(() => {
  const result: Array<{ key: string; title: string; lines: typeof diff.value.homeworkLines; truncated: boolean }> = [];
  if (diff.value.homeworkLines.length > 0) {
    result.push({
      key: "homeworks",
      title: "",
      lines: diff.value.homeworkLines,
      truncated: diff.value.homeworkTruncated,
    });
  }
  for (const section of diff.value.vocabularySections) {
    result.push({
      key: section.key,
      title: section.title,
      lines: section.lines,
      truncated: section.truncated ?? false,
    });
  }
  if (diff.value.orderSection) {
    result.push({
      key: diff.value.orderSection.key,
      title: diff.value.orderSection.title,
      lines: diff.value.orderSection.lines,
      truncated: diff.value.orderSection.truncated ?? false,
    });
  }
  return result.map((block) => ({
    ...block,
    lines: block.lines.map((line, index) => ({
      ...line,
      separated:
        index > 0 &&
        line.kind !== "context" &&
        block.lines[index - 1].kind !== "context" &&
        block.lines[index - 1].kind !== line.kind,
    })),
  }));
});

function marker(kind: DiffLineKind): string {
  if (kind === "remove") return "−";
  if (kind === "add") return "+";
  return " ";
}

function markerLabel(kind: DiffLineKind): string | undefined {
  if (kind === "remove") return "恢复时移除";
  if (kind === "add") return "恢复时加入";
  return undefined;
}
</script>

<template>
  <div class="time-machine-diff">
    <p v-if="blocks.length === 0" class="time-machine-diff__empty">与当前数据一致</p>
    <template v-else>
      <section v-for="block in blocks" :key="block.key" class="time-machine-diff__section">
        <m3e-heading v-if="block.title" variant="title" size="medium" level="4">{{ block.title }}</m3e-heading>
        <div class="time-machine-diff__lines">
          <div
            v-for="(line, index) in block.lines"
            :key="index"
            class="time-machine-diff__line"
            :class="[
              `time-machine-diff__line--${line.kind}`,
              {
                'time-machine-diff__line--block-start': line.startsHomework,
                'time-machine-diff__line--separated': line.separated,
              },
            ]"
          >
            <span class="time-machine-diff__marker" :aria-label="markerLabel(line.kind)">{{ marker(line.kind) }}</span>
            <span class="time-machine-diff__text">{{ line.text }}</span>
          </div>
        </div>
        <p v-if="block.truncated" class="time-machine-diff__truncated">
          内容较长，差异预览已截断，恢复仍使用完整快照。
        </p>
      </section>
    </template>
  </div>
</template>
