<script setup lang="ts">
import { computed } from "vue";
import type { Schedule } from "../types/schedule";
import { fmtEffScore, roleLabel, scheduleTitle, statLabel } from "../types/schedule";
import { colorizeTeams } from "../utils/teamColor";

const props = defineProps<{ schedule: Schedule }>();

const displayTime = computed(() =>
  props.schedule.time ? props.schedule.time.replace("T", " ") : ""
);

/** 按伤害门槛降序 + 红黄绿蓝配色 */
const board = computed(() => colorizeTeams(props.schedule.teams));

/** 行列式紧凑表格的最大行数（每队人数取最大值） */
const maxRows = computed(() =>
  Math.max(1, ...props.schedule.teams.map((t) => t.members.length))
);

const total = computed(() =>
  props.schedule.teams.reduce((s, t) => s + t.members.length, 0)
);
</script>

<template>
  <!-- 紧凑 Excel 风排版：仅用于导出图片 -->
  <div class="sx">
    <div class="sx__head">
      <h2 class="sx__title">
        {{ scheduleTitle(schedule) }}
        <span v-if="schedule.roundLabel" class="sx__round"> · {{ schedule.roundLabel }}</span>
      </h2>
      <div class="sx__meta">
        <span>{{ displayTime || "未设置时间" }}</span>
        <span>{{ schedule.teams.length }} 队 / {{ total }} 人</span>
      </div>
    </div>

    <table class="sx__table">
      <thead>
        <tr>
          <th class="sx__corner">位置</th>
          <th
            v-for="c in board"
            :key="c.team.id"
            :style="{ backgroundColor: c.color }"
          >
            {{ c.team.name }}<br />
            <span class="sx__th-limits">
              伤害≥{{ c.team.damageLimit ? c.team.damageLimit : "不限" }} · 奶量≥{{
                c.team.healLimit ? c.team.healLimit : "不限"
              }}
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in maxRows" :key="r">
          <td class="sx__pos">第{{ r }}位</td>
          <td v-for="c in board" :key="c.team.id" class="sx__cell">
            <template v-if="c.team.members[r - 1]">
              <div class="sx__cell-line1">
                <span class="sx__role" :data-role="c.team.members[r - 1].roleType">
                  {{ roleLabel(c.team.members[r - 1].roleType) }}
                </span>
                <b>{{ c.team.members[r - 1].nickname }}</b>
                <span class="sx__member">（{{ c.team.members[r - 1].memberName }}）</span>
              </div>
              <div class="sx__cell-line2">
                {{ c.team.members[r - 1].job }}
              </div>
              <div class="sx__cell-line3">
                {{ statLabel(c.team.members[r - 1].roleType) }}
                {{ fmtEffScore(c.team.members[r - 1].job, c.team.members[r - 1].score) }} · 名望 {{ c.team.members[r - 1].fame }}
              </div>
            </template>
            <span v-else class="sx__empty">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style lang="less">
/* 导出固定为白底黑字的紧凑表（仅用于 toPng 截图） */
.sx {
  background-color: #ffffff;
  color: #111111;
  padding: 14px;
  width: max-content;
  min-width: 100%;

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 2px 4px 10px;
    border-bottom: 2px solid #111;
    margin-bottom: 10px;
    min-width: 420px;
  }

  &__title {
    font-size: 22px;
    font-weight: 700;
  }

  &__round {
    font-size: 14px;
    font-weight: 600;
    color: #333;
  }

  &__meta {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: #333;
  }

  &__table {
    border-collapse: collapse;
    font-size: 13px;
    table-layout: auto;

    th,
    td {
      border: 1px solid #888;
      padding: 6px 10px;
      vertical-align: middle;
    }

    thead th {
      color: #fff;
      font-weight: 700;
      text-align: center;
      white-space: nowrap;
    }

    .sx__th-limits {
      font-size: 11px;
      font-weight: 400;
      opacity: 0.92;
    }

    .sx__corner {
      background-color: #333 !important;
      color: #fff;
      white-space: nowrap;
    }

    td {
      text-align: center;
    }

    .sx__pos {
      background-color: #f1f3f5;
      color: #333;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .sx__cell {
      min-width: 130px;
      white-space: nowrap;

      &-line1 {
        display: flex;
        align-items: center;
        gap: 4px;
        justify-content: center;
      }

      &-line2 {
        font-size: 12px;
        color: #333;
      }

      &-line3 {
        font-size: 11px;
        color: #555;
      }
    }

    .sx__role {
      display: inline-block;
      padding: 0 6px;
      border-radius: 8px;
      font-size: 10px;
      color: #fff;

      &[data-role="dps"] {
        background-color: #1971c2;
      }

      &[data-role="support"] {
        background-color: #2f9e44;
      }
    }

    .sx__member {
      font-size: 11px;
      color: #555;
    }

    .sx__empty {
      color: #aaa;
    }
  }
}
</style>
