<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { EditorContent } from "@tiptap/vue-3";
import type { Selection } from "@tiptap/pm/state";
import { clampHomeworkImageWidthPercent, createHomeworkEditor, findHomeworkImagePosition, insertHomeworkImage, insertHomeworkLink, loadHomeworkEditor, updateHomeworkImageWidthPercent } from "../composables/homeworkEditorDocument";
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
  closed: [];
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
const imageSlider = ref<HTMLElement | null>(null);
const imageSliderThumb = ref<(HTMLElement & { value?: string }) | null>(null);

function setImageSliderFromPointer(event: PointerEvent): void {
  const slider = imageSlider.value;
  const thumb = imageSliderThumb.value;
  if (!slider || !thumb || !selectedImage.value) return;
  const rect = slider.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const value = Math.round(10 + ratio * 90);
  thumb.value = String(value);
  thumb.dispatchEvent(new Event("input", { bubbles: true }));
}

function beginImageSliderPointer(event: PointerEvent): void {
  if (event.button !== 0) return;
  const slider = imageSlider.value;
  if (!slider) return;
  event.preventDefault();
  slider.setPointerCapture(event.pointerId);
  setImageSliderFromPointer(event);
  slider.addEventListener("pointermove", setImageSliderFromPointer as EventListener);
  slider.addEventListener("pointerup", endImageSliderPointer as EventListener, { once: true });
  slider.addEventListener("pointercancel", endImageSliderPointer as EventListener, { once: true });
}

function endImageSliderPointer(event: PointerEvent): void {
  const slider = imageSlider.value;
  if (!slider) return;
  slider.removeEventListener("pointermove", setImageSliderFromPointer as EventListener);
  if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId);
}
const linkUrl = ref("");
const linkDisplayText = ref("");
const linkSelection = ref<Selection | null>(null);
const editorError = ref("");
const linkError = ref("");
const editorContent = ref<HomeworkContent>({ kind: "plain-text", text: "" });
const toolbarState = ref({ bold: false, italic: false, underline: false });
const selectedImage = ref<{ position: number; widthPercent: number } | null>(null);
const showImageTools = ref(false);
const toolbarTransition = ref("editor-toolbar-forward");
let syncedImagePosition: number | null = null;
const editor = createHomeworkEditor((content) => {
  editorContent.value = content;
  emit("update:content", serializeHomeworkContent(content));
}, (href, text) => {
  void nextTick(() => externalLinkDialog.value?.open(href, text));
}, props.mobileLayout);

function readSelectedImage(): { position: number; widthPercent: number } | null {
  const position = findHomeworkImagePosition(editor);
  if (position === null) return null;
  const image = editor.state.doc.nodeAt(position);
  if (image?.type.name !== "image") return null;
  return { position, widthPercent: clampHomeworkImageWidthPercent(Number(image.attrs.widthPercent)) };
}

function syncImageSlider(widthPercent: number): void {
  const thumb = imageSliderThumb.value;
  if (!thumb) return;
  const value = String(widthPercent);
  thumb.value = value;
  thumb.setAttribute("value", value);
}

watch(showImageTools, (visible) => {
  if (visible) void nextTick(() => {
    const widthPercent = selectedImage.value?.widthPercent;
    if (widthPercent !== undefined) syncImageSlider(widthPercent);
  });
});

function syncToolbarState(): void {
  toolbarState.value = { bold: editor.isActive("bold"), italic: editor.isActive("italic"), underline: editor.isActive("underline") };
  const image = readSelectedImage();
  if (image) {
    const imageChanged = syncedImagePosition !== image.position;
    selectedImage.value = image;
    if (!showImageTools.value) toolbarTransition.value = "editor-toolbar-forward";
    showImageTools.value = true;
    if (imageChanged) {
      syncedImagePosition = image.position;
      void nextTick(() => syncImageSlider(image.widthPercent));
    }
    return;
  }
  syncedImagePosition = null;
  if (editor.isFocused) {
    selectedImage.value = null;
    showImageTools.value = false;
  }
}

function updateSelectedImageWidth(event: Event): void {
  const source = event.target instanceof HTMLElement ? event.target : event.currentTarget as HTMLElement;
  const thumb = source as HTMLElement & { value?: string | number };
  const value = Number(thumb.value ?? thumb.getAttribute("value") ?? thumb.getAttribute("aria-valuenow"));
  if (!Number.isFinite(value) || selectedImage.value === null) return;
  const widthPercent = updateHomeworkImageWidthPercent(editor, value, selectedImage.value.position);
  if (widthPercent === null) return;
  selectedImage.value = { position: selectedImage.value.position, widthPercent };
  showImageTools.value = true;
}

function returnToFormatTools(): void {
  toolbarTransition.value = "editor-toolbar-backward";
  showImageTools.value = false;
}
editor.on("transaction", syncToolbarState);
syncToolbarState();
function chooseImage() { imageInput.value?.click(); }
async function updateImage(event: Event) { const file = (event.currentTarget as HTMLInputElement).files?.[0]; editorError.value = file ? (await insertHomeworkImage(editor, file) ?? "") : ""; if (imageInput.value) imageInput.value.value = ""; }
function addLink() { linkSelection.value = editor.state.selection; linkUrl.value = ""; linkDisplayText.value = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " "); linkError.value = ""; void nextTick(() => linkDialog.value?.show()); }
function cancelLink() { void hideWebKitGtkDialog(linkDialog.value); }
function confirmLink() { const error = insertHomeworkLink(editor, linkUrl.value, linkDisplayText.value, linkSelection.value ?? editor.state.selection); if (error) { linkError.value = error; return; } void hideWebKitGtkDialog(linkDialog.value); }
watch(() => props.homework?.id, (id) => {
  if (!id || !props.homework) return;
  syncedImagePosition = null;
  showImageTools.value = false;
  selectedImage.value = null;
  editorContent.value = typeof props.homework.content === "string" ? { kind: "plain-text", text: props.homework.content } : props.homework.content;
  loadHomeworkEditor(editor, editorContent.value);
  syncToolbarState();
}, { immediate: true });
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
  <m3e-dialog ref="dialog" class="homework-editor-dialog" dismissible @closed="emit('closed')">
    <span slot="header">编辑作业</span>
    <div v-if="homework" class="homework-editor">
      <div class="homework-editor-toolbar-pages">
        <Transition :name="toolbarTransition" mode="out-in">
          <m3e-toolbar v-if="!showImageTools" key="format" aria-label="作业格式工具栏" class="homework-editor-toolbar" vertical>
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
          <div v-else key="image" class="homework-editor-image-tools" aria-label="图片尺寸工具">
            <m3e-slider ref="imageSlider" min="10" max="100" step="1" labelled @pointerdown="beginImageSliderPointer">
              <m3e-slider-thumb ref="imageSliderThumb" :value="String(selectedImage?.widthPercent ?? 100)" aria-label="图片宽度百分比" @input="updateSelectedImageWidth"></m3e-slider-thumb>
            </m3e-slider>
            <div class="homework-editor-image-actions-row">
              <span class="homework-editor-image-width-value">{{ selectedImage?.widthPercent ?? 100 }}%</span>
              <m3e-icon-button variant="tonal" aria-label="返回格式工具" @click="returnToFormatTools"><m3e-icon name="arrow_back"></m3e-icon></m3e-icon-button>
            </div>
          </div>
        </Transition>
      </div>
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
