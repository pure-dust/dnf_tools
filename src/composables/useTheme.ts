import { ref, watchEffect } from "vue";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "dnf-theme";

/** 初始化主题：优先读本地存储，其次跟随系统偏好 */
function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage 不可用时忽略 */
  }
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

/** 全局共享的主题状态 */
const theme = ref<ThemeMode>(getInitialTheme());

/** 状态变化时同步应用到根节点并写入本地存储 */
watchEffect(() => {
  document.documentElement.setAttribute("data-theme", theme.value);
  try {
    localStorage.setItem(STORAGE_KEY, theme.value);
  } catch {
    /* ignore */
  }
});

export function useTheme() {
  const toggleTheme = () => {
    theme.value = theme.value === "dark" ? "light" : "dark";
  };

  const setTheme = (mode: ThemeMode) => {
    theme.value = mode;
  };

  return { theme, toggleTheme, setTheme };
}
