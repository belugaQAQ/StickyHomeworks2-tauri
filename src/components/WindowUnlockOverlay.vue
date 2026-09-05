<template>
  <aside class="window-unlock-overlay" aria-live="polite">
    <div class="window-unlock-overlay__guide">
      <div class="window-unlock-overlay__demo" aria-hidden="true">
        <div class="window-unlock-overlay__preview">
          <m3e-icon name="lock_open"></m3e-icon>
          <span></span>
          <span></span>
        </div>
        <span class="window-unlock-overlay__move">
          <m3e-icon name="open_with"></m3e-icon>
        </span>
        <span class="window-unlock-overlay__resize">
          <m3e-icon name="aspect_ratio"></m3e-icon>
        </span>
      </div>
      <m3e-card variant="filled" class="window-unlock-overlay__card">
        <m3e-heading slot="header" variant="headline" size="small" level="2">窗口已解锁</m3e-heading>
        <div slot="content" class="window-unlock-overlay__content">
          <p>拖动内容区可移动窗口，拉伸边缘可调整窗口大小。</p>
        </div>
      </m3e-card>
    </div>
  </aside>
</template>

<style scoped>
.window-unlock-overlay {
  position: fixed;
  z-index: 9;
  inset: 0;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  touch-action: none;
  background: color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent);
  cursor: grab;
  user-select: none;
  --window-unlock-loop: calc(var(--md-sys-motion-duration-extra-long-4, 1000ms) * 6);
  --window-unlock-demo-width: 20rem;
  --window-unlock-demo-height: 11rem;
  --window-unlock-preview-offset-x: 5rem;
  --window-unlock-preview-offset-y: 1.75rem;
  --window-unlock-preview-width: 10rem;
  --window-unlock-preview-height: 6.5rem;
  --window-unlock-preview-expanded-width: 12.8rem;
  --window-unlock-preview-expanded-height: 7.54rem;
  --window-unlock-move-distance-x: 2.25rem;
  --window-unlock-move-distance-y: -0.65rem;
  --window-unlock-preview-moved-x: calc(var(--window-unlock-preview-offset-x) + var(--window-unlock-move-distance-x));
  --window-unlock-preview-moved-y: calc(var(--window-unlock-preview-offset-y) + var(--window-unlock-move-distance-y));
}

.window-unlock-overlay:active {
  cursor: grabbing;
}

.window-unlock-overlay__guide {
  display: grid;
  justify-items: center;
  gap: 1.5rem;
  width: min(24rem, calc(100vw - 3rem));
  animation: window-unlock-overlay-enter var(--md-sys-motion-spring-slow-spatial) both;
}

.window-unlock-overlay__demo {
  position: relative;
  width: var(--window-unlock-demo-width);
  height: var(--window-unlock-demo-height);
  color: var(--md-sys-color-primary);
}

.window-unlock-overlay__preview {
  position: absolute;
  top: var(--window-unlock-preview-offset-y);
  left: var(--window-unlock-preview-offset-x);
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: repeat(2, min-content);
  align-items: center;
  gap: 0.6rem;
  box-sizing: border-box;
  width: var(--window-unlock-preview-width);
  height: var(--window-unlock-preview-height);
  padding: 1.25rem;
  border-radius: var(--md-sys-shape-corner-extra-large, 1.75rem);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  animation: window-unlock-preview-motion var(--window-unlock-loop) var(--md-sys-motion-easing-emphasized, ease-in-out) infinite;
}

.window-unlock-overlay__preview m3e-icon {
  grid-row: span 2;
  font-size: 2rem;
}

.window-unlock-overlay__preview span {
  display: block;
  height: 0.45rem;
  border-radius: var(--md-sys-shape-corner-full, 99rem);
  background: currentColor;
  opacity: 0.72;
}

.window-unlock-overlay__preview span:last-child {
  width: 65%;
}

.window-unlock-overlay__move,
.window-unlock-overlay__resize {
  position: absolute;
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  box-sizing: border-box;
  border-radius: var(--md-sys-shape-corner-full, 99rem);
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  font-size: 1.5rem;
}

.window-unlock-overlay__move m3e-icon,
.window-unlock-overlay__resize m3e-icon {
  display: block;
  --m3e-icon-size: 1.25rem;
}

.window-unlock-overlay__move {
  top: 0.6rem;
  left: 0.5rem;
  animation: window-unlock-move-cue var(--window-unlock-loop) var(--md-sys-motion-easing-emphasized, ease-in-out) infinite;
}

.window-unlock-overlay__resize {
  right: 0.5rem;
  bottom: 0.6rem;
  animation: window-unlock-resize-cue var(--window-unlock-loop) var(--md-sys-motion-easing-emphasized, ease-in-out) infinite;
}

.window-unlock-overlay__card {
  width: 100%;
}

.window-unlock-overlay__content {
  display: grid;
  justify-items: center;
  gap: 1rem;
  text-align: center;
}

.window-unlock-overlay__content p {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-body-large-font-size, 1rem);
  font-weight: var(--md-sys-typescale-body-large-font-weight, 400);
  line-height: var(--md-sys-typescale-body-large-line-height, 1.5rem);
}

@keyframes window-unlock-overlay-enter {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes window-unlock-preview-motion {
  0%,
  15%,
  48%,
  100% {
    top: var(--window-unlock-preview-offset-y);
    left: var(--window-unlock-preview-offset-x);
    width: var(--window-unlock-preview-width);
    height: var(--window-unlock-preview-height);
  }

  27%,
  35% {
    top: var(--window-unlock-preview-moved-y);
    left: var(--window-unlock-preview-moved-x);
    width: var(--window-unlock-preview-width);
    height: var(--window-unlock-preview-height);
  }

  67%,
  77% {
    top: var(--window-unlock-preview-offset-y);
    left: var(--window-unlock-preview-offset-x);
    width: var(--window-unlock-preview-expanded-width);
    height: var(--window-unlock-preview-expanded-height);
  }
}

@keyframes window-unlock-move-cue {
  0%,
  12%,
  42%,
  100% {
    opacity: 0.56;
    box-shadow: 0 0 0 0 transparent;
  }

  24%,
  32% {
    opacity: 1;
    box-shadow: 0 0 0 0.45rem color-mix(in srgb, var(--md-sys-color-primary) 32%, transparent);
  }
}

@keyframes window-unlock-resize-cue {
  0%,
  52%,
  100% {
    opacity: 0.56;
    box-shadow: 0 0 0 0 transparent;
  }

  67%,
  78% {
    opacity: 1;
    box-shadow: 0 0 0 0.45rem color-mix(in srgb, var(--md-sys-color-primary) 32%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .window-unlock-overlay__card,
  .window-unlock-overlay__preview,
  .window-unlock-overlay__move,
  .window-unlock-overlay__resize {
    animation: none;
  }
}
</style>
