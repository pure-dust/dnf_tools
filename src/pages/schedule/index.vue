<script setup lang="ts">
import { onMounted } from "vue";
import { useEff } from "../../composables/useEffMode";
import { ensureLoaded } from "../../composables/useScheduleStore";

onMounted(() => {
  void ensureLoaded();
});

function toggleEff() {
  useEff.value = !useEff.value;
}
</script>

<template>
  <div class="sched">
    <nav class="sched__tabs">
      <RouterLink class="sched__tab" to="/schedule/create">创建排班</RouterLink>
      <RouterLink class="sched__tab" to="/schedule/templates">排班模板</RouterLink>
      <RouterLink class="sched__tab" to="/schedule/members">成员管理</RouterLink>
      <RouterLink class="sched__tab" to="/schedule/history">历史排班</RouterLink>

      <label
        class="sched__eff"
        :title="
          useEff
            ? '当前：修正后伤害/奶量（×职业补正系数）。点此改用原始数值'
            : '当前：原始伤害/奶量。点此改用 ×职业补正系数后的数值'
        "
      >
        <input type="checkbox" :checked="useEff" @change="toggleEff" />
        <span>使用修正后伤害</span>
      </label>
    </nav>
    <div class="sched__body">
      <RouterView />
    </div>
  </div>
</template>

<style lang="less">
.sched {
  padding: 16px 20px;

  &__tabs {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--app-border);
  }

  &__tab {
    padding: 6px 16px;
    border-radius: 16px;
    font-size: 13px;
    color: var(--app-text-secondary);
    text-decoration: none;
    transition: background-color 0.2s ease, color 0.2s ease;

    &:hover {
      color: var(--app-text);
      background-color: var(--app-border);
    }

    &.router-link-active {
      color: #fff;
      background-color: var(--app-primary);
    }
  }

  /* 全局口径开关：居 tab 行最右侧 */
  &__eff {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    padding: 5px 12px;
    border: 1px solid var(--app-border);
    border-radius: 16px;
    font-size: 12px;
    line-height: 1.3;
    color: var(--app-text-secondary);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    transition: border-color 0.2s ease, color 0.2s ease, background-color 0.2s ease;

    &:hover {
      border-color: var(--app-primary);
      color: var(--app-text);
      background-color: var(--app-border);
    }

    input {
      accent-color: var(--app-primary);
    }
  }

  &__body {
    padding-top: 16px;
  }
}
</style>
