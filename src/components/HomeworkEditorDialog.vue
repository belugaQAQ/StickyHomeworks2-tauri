<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { EditorContent } from "@tiptap/vue-3";
import type { Selection } from "@tiptap/pm/state";
import { createHomeworkEditor, insertHomeworkImage, insertHomeworkLink, loadHomeworkEditor } from "../composables/homeworkEditorDocument";
import { hideWebKitGtkDialog, useWebKitGtkDialogExit } from "../composables/useWebKitGtkDialogExit";
import { toDateInputValue } from "../domain/homework";
import type { HomeworkRecord } from "../types/app-data";
import { serializeHomeworkContent, type HomeworkContent } from "../types/homework-content";
import ExternalLinkConfirmDialog from "./ExternalLinkConfirmDialog.vue";

type DialogElement = HTMLElement & { show: () => void | Promise<void>; hide: () => void | Promise<void> };
type DatepickerElement = HTMLElement & { date: Date | null };
type SelectElement = HTMLElement & { value: string | readonly string[] | null };
type FilterChipElement = HTMLElement & { selected: boolean };
const props = defineProps<{
  homework: HomeworkRecord | null;
  subjects: string[];
  tags: string[];
  saveError: string;
  isEditing: boolean;
  mobileLayout: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [];
  "update:content": [content: string];
  "update:subject": [subject: string];
  "update:dueDate": [date: Date];
  "update:tagSelection": [tag: string, selected: boolean];
}>();

const dialog = ref<DialogElement | null>(null);
const linkDialog = ref<DialogElement | null>(null);
const externalLinkDialog = ref<InstanceType<typeof ExternalLinkConfirmDialog> | null>(null);
const dueDatePicker = ref<DatepickerElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const linkUrl = ref("");
const linkDisplayText = ref("");
const linkSelection = ref<Selection | null>(null);
const editorError = ref("");
const linkError = ref("");
const editorContent = ref<HomeworkContent>({ kind: "plain-text", text: "" });
const toolbarState = ref({ bold: false, italic: false, underline: false });
const editor = createHomeworkEditor((content) => {
  editorContent.value = content;
  emit("update:content", serializeHomeworkContent(content));
}, (href, text) => {
  void nextTick(() => externalLinkDialog.value?.open(href, text));
}, props.mobileLayout);

function syncToolbarState() {
  toolbarState.value = { bold: editor.isActive("bold"), italic: editor.isActive("italic"), underline: editor.isActive("underline") };
}
editor.on("transaction", syncToolbarState);
syncToolbarState();
function chooseImage() { imageInput.value?.click(); }
async function updateImage(event: Event) { const file = (event.currentTarget as HTMLInputElement).files?.[0]; editorError.value = file ? (await insertHomeworkImage(editor, file) ?? "") : ""; if (imageInput.value) imageInput.value.value = ""; }
function addLink() { linkSelection.value = editor.state.selection; linkUrl.value = ""; linkDisplayText.value = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " "); linkError.value = ""; void nextTick(() => linkDialog.value?.show()); }
function cancelLink() { void hideWebKitGtkDialog(linkDialog.value); }
function confirmLink() { const error = insertHomeworkLink(editor, linkUrl.value, linkDisplayText.value, linkSelection.value ?? editor.state.selection); if (error) { linkError.value = error; return; } void hideWebKitGtkDialog(linkDialog.value); }
watch(() => props.homework, (homework) => { if (!homework) return; editorContent.value = typeof homework.content === "string" ? { kind: "plain-text", text: homework.content } : homework.content; loadHomeworkEditor(editor, editorContent.value); syncToolbarState(); }, { immediate: true });
useWebKitGtkDialogExit(dialog);
useWebKitGtkDialogExit(linkDialog);
function prepareDialog() { const root = dialog.value?.shadowRoot; const base = root?.querySelector<HTMLDialogElement>(".base"); const content = root?.querySelector<HTMLElement>(".content"); if (!base || !content) return; base.style.maxHeight = "calc(100dvh - 2rem)"; content.style.flex = "1 1 auto"; content.style.minHeight = "0"; content.style.overflow = "auto"; }
function show() { void nextTick(() => { if (props.homework && dueDatePicker.value) dueDatePicker.value.date = new Date(`${toDateInputValue(props.homework.dueTime)}T00:00:00`); void Promise.resolve(dialog.value?.show()).then(prepareDialog); }); }
async function hide() { await hideWebKitGtkDialog(dialog.value); }
function updateDueDate(event: Event) { const date = (event.currentTarget as DatepickerElement).date; if (date) emit("update:dueDate", date); }
function updateSubject(event: Event) { const value = (event.currentTarget as SelectElement).value; if (typeof value === "string") emit("update:subject", value); }
function updateTagSelection(tag: string, event: Event) { emit("update:tagSelection", tag, (event.currentTarget as FilterChipElement).selected); }
defineExpose({ show, hide });
</script>

<template>
  <m3e-dialog ref="dialog" class="homework-editor-dialog" dismissible disable-close>
    <m3e-heading slot="header" variant="headline" size="small" level="2">{{ isEditing ? "编辑作业" : "新建作业" }}</m3e-heading>
    <div v-if="homework" class="homework-editor">
      <m3e-toolbar aria-label="作业格式工具栏" class="homework-editor-toolbar" vertical>
        <m3e-button-group variant="connected" multi>
          <m3e-icon-button variant="tonal" toggle :selected="toolbarState.bold" aria-label="加粗" @beforeinput.prevent @click="editor.chain().focus().toggleBold().run()"><m3e-icon name="format_bold"></m3e-icon></m3e-icon-button>
          <m3e-icon-button variant="tonal" toggle :selected="toolbarState.italic" aria-label="斜体" @beforeinput.prevent @click="editor.chain().focus().toggleItalic().run()"><m3e-icon name="format_italic"></m3e-icon></m3e-icon-button>
          <m3e-icon-button variant="tonal" toggle :selected="toolbarState.underline" aria-label="下划线" @beforeinput.prevent @click="editor.chain().focus().toggleUnderline().run()"><m3e-icon name="format_underlined"></m3e-icon></m3e-icon-button>
        </m3e-button-group>
        <m3e-button-group variant="connected">
          <m3e-icon-button variant="tonal" aria-label="撤销" @click="editor.chain().focus().undo().run()"><m3e-icon name="undo"></m3e-icon></m3e-icon-button>
          <m3e-icon-button variant="tonal" aria-label="重做" @click="editor.chain().focus().redo().run()"><m3e-icon name="redo"></m3e-icon></m3e-icon-button>
          <m3e-icon-button variant="tonal" aria-label="链接" @click="addLink"><m3e-icon name="link"></m3e-icon></m3e-icon-button>
          <m3e-icon-button variant="tonal" aria-label="图片" @click="chooseImage"><m3e-icon name="image"></m3e-icon></m3e-icon-button>
        </m3e-button-group>
        <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden @change="updateImage" />
      </m3e-toolbar>
      <EditorContent :editor="editor" class="homework-editor-content" />
      <m3e-form-field variant="outlined"><label slot="label" for="homework-subject">科目</label><m3e-select id="homework-subject" @change="updateSubject"><m3e-option v-for="subject in subjects" :key="subject" :value="subject" :selected="homework.subject === subject">{{ subject }}</m3e-option></m3e-select></m3e-form-field>
      <m3e-form-field variant="outlined"><label slot="label" for="homework-due-time">截止日期</label><input id="homework-due-time" autocomplete="off" :value="toDateInputValue(homework.dueTime)" readonly /><m3e-icon-button slot="suffix" aria-label="选择截止日期"><m3e-icon name="calendar_today"></m3e-icon><m3e-datepicker-toggle for="homework-due-picker"></m3e-datepicker-toggle></m3e-icon-button></m3e-form-field>
      <m3e-datepicker ref="dueDatePicker" id="homework-due-picker" variant="auto" label="选择截止日期" @change="updateDueDate"></m3e-datepicker>
      <span v-if="tags.length" class="editor-tags-title">标签</span><m3e-filter-chip-set v-if="tags.length" class="editor-tag-set" aria-label="作业标签" multi><m3e-filter-chip v-for="tag in tags" :key="tag" :selected="homework.tags.includes(tag)" @change="updateTagSelection(tag, $event)">{{ tag }}</m3e-filter-chip></m3e-filter-chip-set>
      <p v-if="editorError" class="editor-error" role="alert">{{ editorError }}</p><p v-if="saveError" class="editor-error" role="alert">{{ saveError }}</p>
    </div>
    <div slot="actions" end><m3e-button variant="text" @click="emit('cancel')">取消</m3e-button><m3e-button variant="filled" @click="emit('save')">保存</m3e-button></div>
  </m3e-dialog>
  <m3e-dialog ref="linkDialog" class="homework-link-dialog" dismissible><m3e-heading slot="header" variant="headline" size="small" level="2">插入超链接</m3e-heading><div class="homework-link-form"><m3e-form-field variant="outlined"><label slot="label" for="homework-link-url">URL</label><input id="homework-link-url" v-model="linkUrl" type="url" /></m3e-form-field><m3e-form-field variant="outlined"><label slot="label" for="homework-link-display">显示文字（可选）</label><input id="homework-link-display" v-model="linkDisplayText" type="text" /></m3e-form-field><p v-if="linkError" class="editor-error" role="alert">{{ linkError }}</p></div><div slot="actions" end><m3e-button variant="text" @click="cancelLink">取消</m3e-button><m3e-button variant="filled" @click="confirmLink">确定</m3e-button></div></m3e-dialog>
  <ExternalLinkConfirmDialog ref="externalLinkDialog" />
</template>
