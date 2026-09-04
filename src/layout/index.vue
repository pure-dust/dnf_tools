<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTheme } from "../composables/useTheme";

const { theme, toggleTheme } = useTheme();
const route = useRoute();
const router = useRouter();

/** 首页不需要返回按钮 */
const isHome = computed(() => route.path === "/home");

function goHome() {
  router.push("/home");
}

/** 是否运行在 Tauri WebView 中（纯浏览器调试时窗口控制不可用） */
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const isMaximized = ref(false);
let unlistenResized: (() => void) | null = null;

async function minimize() {
  if (!isTauri) return;
  await getCurrentWindow().minimize();
}

async function toggleMaximize() {
  if (!isTauri) return;
  const win = getCurrentWindow();
  await win.toggleMaximize();
  isMaximized.value = await win.isMaximized();
}

async function closeWindow() {
  if (!isTauri) return;
  await getCurrentWindow().close();
}

onMounted(async () => {
  if (!isTauri) return;
  const win = getCurrentWindow();
  isMaximized.value = await win.isMaximized();
  // 通过系统吸附/快捷键等外部方式改变最大化状态时同步图标
  unlistenResized = await win.onResized(async () => {
    isMaximized.value = await win.isMaximized();
  });
});

onUnmounted(() => {
  unlistenResized?.();
});
</script>

<template>
  <div class="layout">
    <header class="header" data-tauri-drag-region>
      <div class="header__title" data-tauri-drag-region>DNF 工具箱</div>

      <div class="header__actions">
        <button
          v-if="!isHome"
          class="back-btn"
          type="button"
          title="返回首页"
          aria-label="返回首页"
          @click="goHome"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          class="theme-toggle"
          type="button"
          :title="theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'"
          :aria-label="theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'"
          @click="toggleTheme"
        >
          <!-- 黑夜模式时显示太阳，点击切回白天 -->
          <svg
            v-if="theme === 'dark'"
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
          <!-- 白天模式时显示月亮，点击切到黑夜 -->
          <svg
            v-else
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>

        <div class="window-controls">
          <button
            class="win-btn"
            type="button"
            title="最小化"
            aria-label="最小化"
            @click="minimize"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <line x1="6" y1="12" x2="18" y2="12" />
            </svg>
          </button>

          <button
            class="win-btn"
            type="button"
            :title="isMaximized ? '还原' : '最大化'"
            :aria-label="isMaximized ? '还原' : '最大化'"
            @click="toggleMaximize"
          >
            <!-- 最大化状态时显示还原图标 -->
            <svg
              v-if="isMaximized"
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <!-- 未最大化时显示最大化图标 -->
            <svg
              v-else
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          </button>

          <button
            class="win-btn win-btn--close"
            type="button"
            title="关闭"
            aria-label="关闭"
            @click="closeWindow"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </header>
    <div class="main">
      <router-view />
    </div>
    <footer class="footer">
      忘忧居出品
    </footer>
  </div>
</template>

<style lang="less">
.layout {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  .header {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 0 12px;
    background-color: var(--app-header-bg);
    border-bottom: 1px solid var(--app-border);
    box-shadow: 0 2px 8px var(--app-shadow);
    transition: background-color 0.3s ease, border-color 0.3s ease,
      box-shadow 0.3s ease;

    .header__title {
      font-size: 14px;
      font-weight: 600;
      color: var(--app-text);
      user-select: none;
    }

    .header__actions {
      height: 100%;
      display: flex;
      align-items: center;
    }

    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      margin: 0 6px 0 0;
      border: none;
      border-radius: 6px;
      background-color: transparent;
      color: var(--app-text-secondary);
      cursor: pointer;
      transition: background-color 0.2s ease, color 0.2s ease,
        transform 0.2s ease;

      &:hover {
        background-color: var(--app-border);
        color: var(--app-text);
      }

      &:active {
        transform: scale(0.9);
      }
    }

    .back-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      margin-right: 2px;
      border: none;
      border-radius: 6px;
      background-color: transparent;
      color: var(--app-text-secondary);
      cursor: pointer;
      transition: background-color 0.2s ease, color 0.2s ease,
        transform 0.2s ease;

      &:hover {
        background-color: var(--app-border);
        color: var(--app-text);
      }

      &:active {
        transform: scale(0.9);
      }
    }

    .window-controls {
      height: 100%;
      display: flex;
      align-items: stretch;
    }

    .win-btn {
      width: 46px;
      height: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background-color: transparent;
      color: var(--app-text-secondary);
      cursor: pointer;
      transition: background-color 0.2s ease, color 0.2s ease;

      &:hover {
        background-color: var(--app-border);
        color: var(--app-text);
      }

      &:active {
        background-color: rgba(0, 0, 0, 0.12);
      }

      &--close:hover {
        background-color: #e81123;
        color: #ffffff;
      }

      &--close:active {
        background-color: #f1707a;
      }
    }
  }

  .main {
    flex: 1;
    min-height: 0;
    background-color: var(--app-bg);
    color: var(--app-text);
    overflow: auto;
    transition: background-color 0.3s ease, color 0.3s ease;
  }

  .footer {
    height: 30px;
    flex-shrink: 0;
    background-color: var(--app-surface);
    border-top: 1px solid var(--app-border);
    text-align: center;
    line-height: 30px;
    font-size: 12px;
    color: var(--app-text-secondary);
    user-select: none;
    transition: background-color 0.3s ease, border-color 0.3s ease,
      color 0.3s ease;
  }
}
</style>
