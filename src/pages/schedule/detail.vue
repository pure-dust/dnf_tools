<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toPng } from "html-to-image";
import ScheduleBoard from "../../components/ScheduleBoard.vue";
import ScheduleTable from "../../components/ScheduleTable.vue";
import {
  ensureLoaded,
  useScheduleStore,
} from "../../composables/useScheduleStore";
import { exportPng, type ExportResult } from "../../services/storage";
import { scheduleTitle } from "../../types/schedule";

const route = useRoute();
const router = useRouter();
const store = useScheduleStore();

const exporting = ref(false);
const exportMsg = ref<ExportResult | null>(null);
const stageRef = ref<HTMLElement | null>(null);

const schedule = computed(() =>
  store.data.schedules.find((s) => s.id === route.params.id)
);

onMounted(() => {
  void ensureLoaded();
});

function fileStamp() {
  const d = schedule.value ? new Date(schedule.value.time.replace("T", " ")) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function doExport() {
  if (!schedule.value) return;
  exporting.value = true;
  exportMsg.value = null;
  try {
    await nextTick();
    if (!stageRef.value) throw new Error("导出节点不存在");
    const dataUrl = await toPng(stageRef.value, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#ffffff",
    });
    const fileName = `排班_${scheduleTitle(schedule.value).replace(/[\\/:*?"<>|]/g, "_")}_${fileStamp()}.png`;
    exportMsg.value = await exportPng(fileName, dataUrl);
  } catch (e) {
    exportMsg.value = { ok: false, message: String(e) };
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="detail">
    <div class="detail__bar">
      <button class="btn" type="button" @click="router.push('/schedule/history')">
        ← 返回历史
      </button>
      <button class="btn btn--primary" type="button" :disabled="!schedule || exporting" @click="doExport">
        {{ exporting ? "导出中…" : "导出为图片" }}
      </button>
    </div>

    <div v-if="!schedule" class="empty">未找到该排班记录</div>

    <template v-else>
      <!-- 屏上展示（跟随主题） -->
      <ScheduleBoard :schedule="schedule" />

      <div v-if="exportMsg" class="detail__msg" :class="exportMsg.ok ? 'is-ok' : 'is-err'">
        {{ exportMsg.ok ? `导出成功${exportMsg.path ? "，已保存到：" + exportMsg.path : ""}` : "导出失败：" + exportMsg.message }}
      </div>

      <!-- 离屏紧凑表（Excel 风），仅导出时挂载 -->
      <div class="detail__stage" aria-hidden="true">
        <div v-if="exporting && schedule" ref="stageRef">
          <ScheduleTable :schedule="schedule" />
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="less">
.detail {
  &__bar {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 16px;
  }

  &__msg {
    margin-top: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    word-break: break-all;

    &.is-ok {
      color: var(--app-success);
      background-color: color-mix(in srgb, var(--app-success) 12%, transparent);
    }

    &.is-err {
      color: var(--app-danger);
      background-color: color-mix(in srgb, var(--app-danger) 12%, transparent);
    }
  }

  /* 离屏容器：不影响布局，仅用于导出截图 */
  &__stage {
    position: fixed;
    left: -10000px;
    top: 0;
    width: 940px;
    z-index: -1;
    pointer-events: none;
  }
}
</style>
