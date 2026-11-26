<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    open?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    clearable?: boolean;
    disabled?: boolean;
    hideToggle?: boolean;
    togglePosition?: "before" | "after";
    expandOnFocus?: boolean;
    badgeCount?: number;
  }>(),
  {
    modelValue: "",
    open: undefined,
    placeholder: "搜索...",
    ariaLabel: "搜索",
    clearable: true,
    disabled: false,
    hideToggle: false,
    togglePosition: "after",
    expandOnFocus: false,
    badgeCount: 0,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:open": [value: boolean];
  clear: [];
  submit: [value: string];
  opening: [];
  opened: [];
  closing: [];
  closed: [];
}>();

const internalOpen = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
const collapseRef = ref<HTMLElement | null>(null);
const toggleButtonId = `search-expansion-toggle-${Math.random().toString(36).slice(2, 9)}`;

const isOpen = computed(() => (props.open !== undefined ? props.open : internalOpen.value));

function setOpen(next: boolean) {
  if (props.disabled || next === isOpen.value) return;
  if (props.open === undefined) {
    internalOpen.value = next;
  }
  emit("update:open", next);
}

function toggleOpen() {
  setOpen(!isOpen.value);
}

function handleInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit("update:modelValue", value);
}

function handleFocus() {
  if (props.expandOnFocus && !isOpen.value) {
    setOpen(true);
  }
}

function handleClear() {
  emit("update:modelValue", "");
  emit("clear");
  inputRef.value?.focus();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    emit("submit", props.modelValue);
  } else if (event.key === "Escape" && isOpen.value) {
    setOpen(false);
  }
}

function handleHeaderClick(event: MouseEvent) {
  if (props.disabled) return;
  const target = event.target;
  if (target instanceof Element && target.closest("m3e-icon-button, button, a, input")) return;
  inputRef.value?.focus();
}

watch(isOpen, (next, prev) => {
  if (next === prev) return;
  if (next) emit("opening");
  else emit("closing");
});

function handleTransitionEnd(event: TransitionEvent) {
  if (event.target !== collapseRef.value || event.propertyName !== "grid-template-rows") return;
  if (isOpen.value) emit("opened");
  else emit("closed");
}
</script>

<template>
  <section
    class="search-expansion"
    :class="{
      'search-expansion--open': isOpen,
      'search-expansion--disabled': disabled,
    }"
  >
    <div class="search-expansion__header" @click="handleHeaderClick">
      <slot name="header">
        <m3e-icon-button
          v-if="!hideToggle && togglePosition === 'before'"
          class="search-expansion__toggle"
          :disabled="disabled"
          :aria-expanded="isOpen"
          aria-label="展开或收起"
          @click="toggleOpen"
        >
          <span :id="toggleButtonId" class="search-expansion__toggle-anchor">
            <span class="search-expansion__toggle-icon" :class="{ 'search-expansion__toggle-icon--open': isOpen }">
              <slot name="toggle-icon">
                <m3e-icon name="expand_more"></m3e-icon>
              </slot>
            </span>
          </span>
        </m3e-icon-button>
        <m3e-badge
          v-if="!hideToggle && togglePosition === 'before' && badgeCount > 0"
          class="search-expansion__badge"
          :for="toggleButtonId"
          size="small"
        ></m3e-badge>

        <span class="search-expansion__leading">
          <slot name="leading">
            <m3e-icon name="search"></m3e-icon>
          </slot>
        </span>

        <input
          ref="inputRef"
          class="search-expansion__input"
          type="text"
          :value="modelValue"
          :placeholder="placeholder"
          :aria-label="ariaLabel"
          :disabled="disabled"
          @input="handleInput"
          @focus="handleFocus"
          @keydown="handleKeydown"
        />

        <m3e-icon-button
          v-if="clearable && modelValue.length > 0"
          class="search-expansion__clear"
          :disabled="disabled"
          aria-label="清除搜索"
          @click="handleClear"
        >
          <m3e-icon name="close"></m3e-icon>
        </m3e-icon-button>

        <slot name="trailing"></slot>

        <m3e-icon-button
          v-if="!hideToggle && togglePosition === 'after'"
          class="search-expansion__toggle"
          :disabled="disabled"
          :aria-expanded="isOpen"
          aria-label="展开或收起"
          @click="toggleOpen"
        >
          <span :id="toggleButtonId" class="search-expansion__toggle-anchor">
            <span class="search-expansion__toggle-icon" :class="{ 'search-expansion__toggle-icon--open': isOpen }">
              <slot name="toggle-icon">
                <m3e-icon name="expand_more"></m3e-icon>
              </slot>
            </span>
          </span>
        </m3e-icon-button>
        <m3e-badge
          v-if="!hideToggle && togglePosition === 'after' && badgeCount > 0"
          class="search-expansion__badge"
          :for="toggleButtonId"
          size="small"
        ></m3e-badge>
      </slot>
    </div>

    <div
      ref="collapseRef"
      class="search-expansion__collapse"
      :aria-hidden="!isOpen"
      @transitionend="handleTransitionEnd"
    >
      <div class="search-expansion__collapse-inner">
        <div class="search-expansion__body">
          <slot></slot>
        </div>

        <div v-if="$slots.actions" class="search-expansion__actions">
          <slot name="actions"></slot>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.search-expansion {
  --_container-color: var(--app-surface-low, var(--md-sys-color-surface-container-low));
  --_open-container-color: var(--app-surface, var(--md-sys-color-surface-container));
  --_divider-color: var(--md-sys-color-outline-variant);
  --_duration: var(--md-sys-motion-duration-medium-2, 300ms);
  --_easing: var(--md-sys-motion-easing-emphasized-decelerate, cubic-bezier(0.05, 0.7, 0.1, 1));

  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  border-radius: 1.75rem;
  background: var(--_container-color);
  border: 1px solid var(--_divider-color);
  overflow: hidden;
  transition:
    border-radius var(--_duration) var(--_easing),
    background-color var(--_duration) var(--_easing),
    box-shadow var(--_duration) var(--_easing);
}

.search-expansion--open {
  border-radius: 1.25rem;
  background: var(--_open-container-color);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.search-expansion--disabled {
  opacity: 0.38;
  pointer-events: none;
}

.search-expansion__header {
  display: flex;
  align-items: center;
  height: var(--m3e-search-bar-container-height, 56px);
  padding-inline: 0.25rem;
  box-sizing: border-box;
  cursor: text;
  --_icon-button-size: auto;
  --_icon-button-min-size: 48px;
}

.search-expansion__leading {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 48px;
  padding-inline: 0.25rem;
  color: var(--m3e-search-bar-leading-icon-color, var(--md-sys-color-on-surface));
  --m3e-icon-color: var(--m3e-search-bar-leading-icon-color, var(--md-sys-color-on-surface));
  --m3e-icon-size: var(--m3e-search-bar-icon-size, 24px);
  flex-shrink: 0;
}

.search-expansion__input {
  flex: 1 1 auto;
  min-width: 0;
  border: unset;
  outline: unset;
  background-color: transparent;
  box-shadow: none;
  padding: unset;
  margin-inline: 0.25rem;
  color: var(--m3e-search-bar-input-color, var(--md-sys-color-on-surface));
  font: inherit;
  font-size: var(--m3e-search-bar-input-text-font-size, 1rem);
  font-weight: var(--m3e-search-bar-input-text-font-weight, 400);
  line-height: var(--m3e-search-bar-input-text-line-height, 1.5rem);
  letter-spacing: var(--m3e-search-bar-input-text-tracking, 0.03125rem);
}

.search-expansion__input::placeholder {
  user-select: none;
  color: var(--m3e-search-bar-supporting-text-color, var(--md-sys-color-on-surface-variant));
  font-size: var(--m3e-search-bar-supporting-text-font-size, 1rem);
  font-weight: var(--m3e-search-bar-supporting-text-font-weight, 400);
  line-height: var(--m3e-search-bar-supporting-text-line-height, 1.5rem);
  letter-spacing: var(--m3e-search-bar-supporting-text-tracking, 0.03125rem);
}

.search-expansion__clear,
.search-expansion__toggle {
  flex-shrink: 0;
  color: var(--m3e-search-bar-trailing-icon-color, var(--md-sys-color-on-surface-variant));
  --m3e-icon-color: var(--m3e-search-bar-trailing-icon-color, var(--md-sys-color-on-surface-variant));
  --m3e-icon-button-icon-color: var(--m3e-search-bar-trailing-icon-color, var(--md-sys-color-on-surface-variant));
  --m3e-icon-size: var(--m3e-search-bar-icon-size, 24px);
}

.search-expansion__toggle-anchor {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.125rem;
  height: 2.125rem;
}

.search-expansion__toggle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--_duration) var(--_easing);
}

.search-expansion__toggle-icon--open {
  transform: rotate(180deg);
}

.search-expansion__badge {
  --m3e-badge-small-size: 0.75rem;
}

.search-expansion__collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--_duration) var(--_easing),
    opacity var(--md-sys-motion-duration-short-4, 200ms) ease;
}

.search-expansion--open .search-expansion__collapse {
  grid-template-rows: 1fr;
  opacity: 1;
}

.search-expansion__collapse-inner {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.search-expansion:not(.search-expansion--open) .search-expansion__collapse-inner {
  visibility: hidden;
}

.search-expansion__body {
  padding: 0.25rem 1rem 0.875rem;
  border-top: 1px solid var(--_divider-color);
}

.search-expansion__actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--_divider-color);
}

@media (forced-colors: active) {
  .search-expansion {
    border: 1px solid CanvasText;
  }
}

@media (prefers-reduced-motion: reduce) {
  .search-expansion,
  .search-expansion__toggle-icon,
  .search-expansion__collapse {
    transition: none;
  }
}
</style>
