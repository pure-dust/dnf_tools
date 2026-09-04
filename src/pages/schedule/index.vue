<script setup lang="ts">
import { onMounted } from "vue";
import { ensureLoaded } from "../../composables/useScheduleStore";

onMounted(() => {
  void ensureLoaded();
});
</script>

<template>
  <div class="sched">
    <nav class="sched__tabs">
      <RouterLink class="sched__tab" to="/schedule/create">创建排班</RouterLink>
      <RouterLink class="sched__tab" to="/schedule/templates">排班模板</RouterLink>
      <RouterLink class="sched__tab" to="/schedule/members">成员管理</RouterLink>
      <RouterLink class="sched__tab" to="/schedule/history">历史排班</RouterLink>
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

  &__body {
    padding-top: 16px;
  }
}
</style>
