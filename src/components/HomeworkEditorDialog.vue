<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useWebKitGtkDialogExit } from "../composables/useWebKitGtkDialogExit";
import { toDateInputValue } from "../domain/homework";
import type { HomeworkRecord } from "../types/app-data";

type DialogElement = HTMLElement & {
  show: () => void;
  hide: () => void;
};

type DatepickerElement = HTMLElement & {
  date: Date | null;
};

type SelectElement = HTMLElement & {
  value: string | readonly string[] | null;
};

const props = defineProps<{
  homework: HomeworkRecord | null;
  subjects: string[];
  newTag: string;
  saveError: string;
  isEditing: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [];
  "update:content": [content: string];
  "update:subject": [subject: string];
  "update:dueDate": [date: Date];
  "update:newTag": [tag: string];
  addTag: [];
  removeTag: [tag: string];
}>();

const dialog = ref<DialogElement | null>(null);
const dueDatePicker = ref<DatepickerElement | null>(null);

useWebKitGtkDialogExit(dialog);

function show() {
  void nextTick(() => {
    if (props.homework && dueDatePicker.value) {
      dueDatePicker.value.date = new Date(`${toDateInputValue(props.homework.dueTime)}T00:00:00`);
    }
    dialog.value?.show();
  });
}

function hide() {
  dialog.value?.hide();
}

function updateDueDate(event: Event) {
  const date = (event.currentTarget as DatepickerElement).date;
  if (date) emit("update:dueDate", date);
}

function updateSubject(event: Event) {
  const value = (event.currentTarget as SelectElement).value;
  if (typeof value === "string") emit("update:subject", value);
}

defineExpose({ show, hide });
</script>

<template>
  <m3e-dialog ref="dialog" class="homework-editor-dialog" dismissible disable-close>
    <m3e-heading slot="header" variant="headline" size="small" level="2">
      {{ isEditing ? "编辑作业" : "新建作业" }}
    </m3e-heading>
    <div v-if="homework" class="homework-editor">
      <m3e-form-field variant="filled">
        <label slot="label" for="homework-content">作业内容</label>
        <textarea
          id="homework-content"
          :value="homework.content"
          rows="4"
          @input="emit('update:content', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
      </m3e-form-field>
      <m3e-textarea-autosize for="homework-content" min-rows="4" max-rows="8"></m3e-textarea-autosize>

      <m3e-form-field variant="outlined">
        <label slot="label" for="homework-subject">科目</label>
        <m3e-select id="homework-subject" @change="updateSubject">
          <m3e-option v-for="subject in subjects" :key="subject" :value="subject" :selected="homework.subject === subject">
            {{ subject }}
          </m3e-option>
        </m3e-select>
      </m3e-form-field>

      <m3e-form-field variant="outlined">
        <label slot="label" for="homework-due-time">截止日期</label>
        <input id="homework-due-time" :value="toDateInputValue(homework.dueTime)" readonly />
        <m3e-icon-button slot="suffix" aria-label="选择截止日期">
          <m3e-icon name="calendar_today"></m3e-icon>
          <m3e-datepicker-toggle for="homework-due-picker"></m3e-datepicker-toggle>
        </m3e-icon-button>
      </m3e-form-field>
      <m3e-datepicker ref="dueDatePicker" id="homework-due-picker" variant="auto" label="选择截止日期" @change="updateDueDate"></m3e-datepicker>

      <m3e-form-field variant="outlined">
        <label slot="label" for="homework-new-tag">标签</label>
        <input
          id="homework-new-tag"
          :value="newTag"
          autocomplete="off"
          @input="emit('update:newTag', ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="emit('addTag')"
        />
        <m3e-icon-button slot="suffix" aria-label="添加标签" @click="emit('addTag')">
          <m3e-icon name="add"></m3e-icon>
        </m3e-icon-button>
      </m3e-form-field>
      <m3e-chip-set v-if="homework.tags.length" class="editor-tag-set">
        <m3e-input-chip
          v-for="tag in homework.tags"
          :key="tag"
          removable
          :remove-label="`移除标签 ${tag}`"
          @remove="emit('removeTag', tag)"
        >
          {{ tag }}
        </m3e-input-chip>
      </m3e-chip-set>
      <p v-if="saveError" class="editor-error" role="alert">{{ saveError }}</p>
    </div>
    <div slot="actions" end>
      <m3e-button variant="text" @click="emit('cancel')">取消</m3e-button>
      <m3e-button variant="filled" @click="emit('save')">保存</m3e-button>
    </div>
  </m3e-dialog>
</template>
