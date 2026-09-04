<script setup lang="ts">
import { computed } from "vue";
import type { Schedule, Team } from "../types/schedule";
import { roleLabel, scheduleTitle, statLabel } from "../types/schedule";
import { colorizeTeams } from "../utils/teamColor";

const props = defineProps<{
  schedule: Schedule;
  /** 固定为浅色（导出图片用） */
  forceLight?: boolean;
}>();

const displayTime = computed(() =>
  props.schedule.time ? props.schedule.time.replace("T", " ") : ""
);

const totalMembers = computed(() =>
  props.schedule.teams.reduce((s, t) => s + t.members.length, 0)
);

/** 按伤害门槛从高到低排序并赋予 红→黄→绿→蓝 配色 */
const board = computed(() => colorizeTeams(props.schedule.teams));

const teamPeople = (t: Team) =>
  t.members.reduce(
    (acc, m) => {
      if (m.roleType === "dps") acc.dps += 1;
      else acc.support += 1;
      return acc;
    },
    { dps: 0, support: 0 }
  );
</script>

<template>
  <div class="sboard" :class="{ 'sboard--light': forceLight }">
    <header class="sboard__head">
      <div>
        <h2 class="sboard__dungeon">{{ scheduleTitle(schedule) }}</h2>
        <p class="sboard__time">{{ displayTime || "未设置时间" }}</p>
      </div>
      <div class="sboard__meta">
        <span v-if="schedule.roundLabel" class="sboard__chip">{{ schedule.roundLabel }}</span>
        <span class="sboard__chip">{{ schedule.teams.length }} 个队伍</span>
        <span class="sboard__chip">{{ totalMembers }} 人</span>
      </div>
    </header>

    <div class="sboard__teams">
      <section
        v-for="c in board"
        :key="c.team.id"
        class="sboard__team"
        :style="{ '--tcol': c.color }"
      >
        <div class="sboard__team-head">
          <div class="sboard__team-head-main">
            <b class="sboard__team-name">{{ c.team.name }}</b>
            <span class="sboard__team-info">
              输出 {{ teamPeople(c.team).dps }} · 辅助 {{ teamPeople(c.team).support }}
            </span>
          </div>
          <span class="sboard__team-limits">
            伤害≥{{ c.team.damageLimit ? c.team.damageLimit : "不限" }} · 奶量≥{{ c.team.healLimit ? c.team.healLimit : "不限" }}
          </span>
        </div>
        <ul class="sboard__rows">
          <li v-for="s in c.team.members" :key="s.characterId" class="sboard__row">
            <span class="sboard__role" :data-role="s.roleType">
              {{ roleLabel(s.roleType) }}
            </span>
            <span class="sboard__who">
              <span class="sboard__charname">{{ s.nickname }}</span>
              <span class="sboard__member">{{ s.memberName }}</span>
            </span>
            <span class="sboard__job">{{ s.job }}</span>
            <span class="sboard__stat">
              {{ statLabel(s.roleType) }} {{ s.score }} · 名望 {{ s.fame }}
            </span>
          </li>
          <li v-if="c.team.members.length === 0" class="sboard__empty">空队</li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style lang="less">
.sboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--app-border);
  border-radius: 12px;
  background-color: var(--app-bg);
  color: var(--app-text);
  transition: background-color 0.3s ease, color 0.3s ease;

  /* 固定浅色（导出图片用） */
  &--light {
    --app-bg: #ffffff;
    --app-surface: #f7f8fa;
    --app-text: #1f2329;
    --app-text-secondary: #646a73;
    --app-border: #e5e6eb;
    --app-primary: #1677ff;
    --app-success: #389e0d;
    --app-warn: #d48806;
    --app-danger: #cf1322;
  }

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--app-text);
  }

  &__dungeon {
    font-size: 22px;
    font-weight: 700;
    color: var(--app-text);
  }

  &__time {
    margin-top: 2px;
    font-size: 13px;
    color: var(--app-text-secondary);
  }

  &__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }

  &__chip {
    padding: 2px 10px;
    border-radius: 12px;
    background-color: var(--app-surface);
    color: var(--app-text-secondary);
    font-size: 12px;
    border: 1px solid var(--app-border);
  }

  &__teams {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }

  &__team {
    border: 1px solid var(--app-border);
    border-radius: 10px;
    overflow: hidden;
    background-color: var(--app-surface);
  }

  &__team-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px;
    background-color: var(--tcol, var(--app-text));
    color: #fff;
    font-size: 14px;
  }

  &__team-head-main {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  &__team-name {
    font-size: 15px;
  }

  &__team-info {
    font-size: 12px;
    opacity: 0.9;
  }

  &__team-limits {
    font-size: 11px;
    opacity: 0.85;
  }

  &__rows {
    list-style: none;
    display: flex;
    flex-direction: column;
    padding: 6px;
    gap: 4px;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 8px;
    background-color: var(--app-bg);
  }

  &__role {
    flex-shrink: 0;
    min-width: 34px;
    text-align: center;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    color: #fff;

    &[data-role="dps"] {
      background-color: var(--app-primary);
    }

    &[data-role="support"] {
      background-color: var(--app-success);
    }
  }

  &__who {
    display: flex;
    flex-direction: column;
    min-width: 90px;
  }

  &__charname {
    font-weight: 600;
    font-size: 14px;
    color: var(--app-text);
  }

  &__member {
    font-size: 11px;
    color: var(--app-text-secondary);
  }

  &__job {
    font-size: 12px;
    color: var(--app-text);
    min-width: 60px;
  }

  &__stat {
    margin-left: auto;
    font-size: 12px;
    color: var(--app-text-secondary);
  }

  &__empty {
    padding: 10px;
    text-align: center;
    color: var(--app-text-secondary);
    font-size: 12px;
  }
}
</style>
