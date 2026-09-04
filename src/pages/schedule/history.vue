<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import type { Schedule } from "../../types/schedule"
import { scheduleTitle } from "../../types/schedule"
import { ensureLoaded, removeSchedule, useScheduleStore } from "../../composables/useScheduleStore"
import { colorizeTeams } from "../../utils/teamColor"

const store = useScheduleStore()
const router = useRouter()

onMounted(() => void ensureLoaded())

const schedules = computed(() => store.data.schedules)

interface HistGroup {
  key: string
  title: string
  time: string
  createdAt: number
  /** 该次排班的各“班”（多班次时为多场，roundIndex 升序） */
  items: Schedule[]
}

/** 同一 groupId 的排班合并为“一次排班”；无 groupId 的旧记录各自独立 */
const groups = computed<HistGroup[]>(() => {
  const map = new Map<string, HistGroup>()
  for (const s of schedules.value) {
    const key = s.groupId ?? s.id
    let g = map.get(key)
    if (!g) {
      g = {
        key,
        title: scheduleTitle(s),
        time: s.time,
        createdAt: s.createdAt,
        items: [],
      }
      map.set(key, g)
    }
    g.items.push(s)
  }
  const arr = [...map.values()]
  arr.forEach((g) => g.items.sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0)))
  arr.sort((a, b) => b.createdAt - a.createdAt)
  return arr
})

function fmtTime(s: string) {
  return s ? s.replace("T", " ") : "未设置时间"
}

function peopleOf(s: Schedule) {
  return s.teams.reduce((n, t) => n + t.members.length, 0)
}

function groupPeople(g: HistGroup) {
  return g.items.reduce((n, s) => n + peopleOf(s), 0)
}

function teamPeople(team: { members: { roleType: string }[] }) {
  const c = team.members.reduce(
    (a, m) => {
      if (m.roleType === "dps") a.dps += 1
      else a.support += 1
      return a
    },
    { dps: 0, support: 0 },
  )
  return `${c.dps}C${c.support}奶`
}

function removeRound(s: Schedule) {
  if (confirm(`确定删除「${scheduleTitle(s)}」的${s.roundLabel || "这条排班"}？`)) {
    removeSchedule(s.id)
  }
}

function removeGroup(g: HistGroup) {
  if (confirm(`确定删除「${g.title}」的这次排班（共 ${g.items.length} 场）？`)) {
    g.items.forEach((s) => removeSchedule(s.id))
  }
}

/* ---------------- 组内明细（详细班次）显示 ---------------- */
const detailIds = ref<string[]>([])

function isDetailOpen(g: HistGroup) {
  return detailIds.value.includes(g.key)
}

function toggleDetail(g: HistGroup) {
  detailIds.value = isDetailOpen(g)
    ? detailIds.value.filter((k) => k !== g.key)
    : [...detailIds.value, g.key]
}

/* ---------------- 组内总览 ---------------- */
const overviewIds = ref<string[]>([])

function isOvOpen(g: HistGroup) {
  return overviewIds.value.includes(g.key)
}

function toggleOv(g: HistGroup) {
  overviewIds.value = isOvOpen(g) ? overviewIds.value.filter((k) => k !== g.key) : [...overviewIds.value, g.key]
}

interface OvColumn {
  key: string
  name: string
  color: string
  rank: number
}

const OV_COLOR_NAMES = ["红队", "黄队", "绿队", "蓝队"]

/** 表头列：按“该组第一场”队伍门槛降序给 红→黄→绿→蓝（与详情配色一致） */
function ovColumns(g: HistGroup): OvColumn[] {
  const first = g.items[0]
  return colorizeTeams(first ? first.teams : []).map((c) => ({
    key: c.team.id,
    name: c.team.name,
    color: c.color,
    rank: c.rank,
  }))
}

function ovColName(c: OvColumn): string {
  return OV_COLOR_NAMES[c.rank % OV_COLOR_NAMES.length]
}

/** 总览 Grid 的列模板：首列场次 + 每队一列（等宽） */
function ovGridCols(g: HistGroup): string {
  const n = ovColumns(g).length
  const team = n ? Array.from({ length: n }, () => "minmax(0, 1fr)").join(" ") : "1fr"
  return `minmax(88px, auto) ${team}`
}

/** 取某“场”中对应列（按基准队伍）的角色列表 */
function ovMembers(s: Schedule, c: OvColumn) {
  const t = s.teams.find((x) => x.id === c.key) ?? s.teams.find((x) => x.name === c.name)
  return t ? t.members : []
}
</script>

<template>
  <div class="history">
    <div class="history__head">
      <div>
        <h2 class="history__title">历史排班</h2>
        <p class="history__sub">
          共 {{ groups.length }} 次排班
          <template v-if="schedules.length > groups.length"> · {{ schedules.length }} 场班次 </template>
        </p>
      </div>
      <button class="btn btn--primary" type="button" @click="router.push('/schedule/create')">+ 新建排班</button>
    </div>

    <div v-if="groups.length === 0" class="empty">暂无历史排班，去「创建排班」生成一条吧</div>

    <div class="history__list">
      <section v-for="g in groups" :key="g.key" class="his panel">
        <div class="his__head">
          <div class="his__head-info">
            <h3 class="his__dungeon">{{ g.title }}</h3>
            <p class="his__time">{{ fmtTime(g.time) }} · 创建于 {{ new Date(g.createdAt).toLocaleString() }}</p>
          </div>
          <div class="his__head-ops">
            <span v-if="g.items.length > 1" class="his__batch"> 同一次排班 · {{ g.items.length }} 场 </span>
            <span class="his__batch">共 {{ groupPeople(g) }} 角色</span>
            <button class="btn btn--sm" type="button" @click="toggleDetail(g)">
              {{ isDetailOpen(g) ? "隐藏班次" : "显示班次" }}
            </button>
            <button class="btn btn--sm" type="button" @click="toggleOv(g)">
              {{ isOvOpen(g) ? "收起总览" : "总览" }}
            </button>
            <button
              class="btn btn--sm"
              type="button"
              @click="router.push({ path: '/schedule/create', query: { group: g.key } })"
            >
              编辑
            </button>
            <button v-if="g.items.length > 1" class="btn btn--sm btn--danger" type="button" @click="removeGroup(g)">
              删除整组
            </button>
          </div>
        </div>

        <!-- 组内总览：一行表头 + 每场一行（Grid 布局） -->
        <div v-if="isOvOpen(g)" class="his__overview">
          <div class="ov-scroll">
            <div class="ov-grid" :style="{ gridTemplateColumns: ovGridCols(g) }">
              <div class="ov-hd ov-hd--label">场次</div>
              <div
                v-for="c in ovColumns(g)"
                :key="c.key"
                class="ov-hd"
                :title="`${c.name} · 伤害门槛`"
              >
                <i class="ov-dot" :style="{ backgroundColor: c.color }"></i>{{ ovColName(c) }}
              </div>
              <template v-for="s in g.items" :key="s.id">
                <div class="ov-label">{{ s.roundLabel || "本次排班" }}</div>
                <div v-for="c in ovColumns(g)" :key="c.key" class="ov-cell">
                  <template v-if="ovMembers(s, c).length">
                    <span
                      v-for="mb in ovMembers(s, c)"
                      :key="mb.characterId"
                      class="ov-chip"
                      :class="mb.roleType === 'dps' ? 'is-dps' : 'is-sup'"
                      :title="`${mb.memberName} · ${mb.job} · ${mb.roleType === 'dps' ? '伤害(千亿) ' : '奶量 '}${mb.score}`"
                    >
                      {{ mb.nickname }}
                    </span>
                  </template>
                  <span v-else class="ov-empty">—</span>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div v-if="isDetailOpen(g)" class="his__rounds">
          <div v-for="s in g.items" :key="s.id" class="his__round">
            <span class="his__round-label">{{ s.roundLabel || "本次排班" }}</span>
            <div class="his__summary">
              <span class="tag tag--muted">{{ s.teams.length }} 队</span>
              <span class="tag tag--muted">{{ peopleOf(s) }} 人</span>
              <span v-for="(t, i) in s.teams" :key="t.id" class="tag tag--muted">
                {{ i + 1 }}队 {{ teamPeople(t) }}
              </span>
            </div>
            <div class="his__ops">
              <button class="btn btn--sm" type="button" @click="router.push(`/schedule/history/${s.id}`)">
                查看/导出
              </button>
              <button class="btn btn--sm btn--danger" type="button" @click="removeRound(s)">删除</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style lang="less">
.history {
  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  &__title {
    font-size: 17px;
    font-weight: 600;
    color: var(--app-text);
  }

  &__sub {
    margin-top: 2px;
    font-size: 12px;
    color: var(--app-text-secondary);
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .his {
    display: flex;
    flex-direction: column;
    gap: 10px;

    &__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--app-border);
    }

    &__dungeon {
      font-size: 16px;
      font-weight: 600;
      color: var(--app-text);
    }

    &__time {
      margin-top: 2px;
      font-size: 12px;
      color: var(--app-text-secondary);
    }

    &__head-ops {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    &__batch {
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      color: var(--app-text-secondary);
      background-color: var(--app-border);
    }

    &__rounds {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    &__round {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 8px 10px;
      border-radius: 8px;
      background-color: var(--app-bg);
    }

    &__round-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--app-text);
      min-width: 52px;
    }

    &__summary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      flex: 1;
      min-width: 200px;
    }

    &__ops {
      display: flex;
      gap: 6px;
    }
  }
}

/* ===== 组内总览 ===== */
.his__overview {
  padding: 2px 0 4px;
}

.ov-scroll {
  overflow-x: auto;
}

.ov-grid {
  display: grid;
  gap: 6px 10px;
  align-items: start;
  min-width: 420px;
}

.ov-hd {
  display: inline-flex;
  align-items: center;
  font-weight: 600;
  color: var(--app-text);
  white-space: nowrap;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--app-border);
}

.ov-label {
  font-weight: 600;
  color: var(--app-text);
  white-space: nowrap;
  align-self: center;
}

.ov-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: flex-start;
  min-width: 0;
}

.ov-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 6px;
}

.ov-chip {
  display: inline-flex;
  margin: 2px 0;
  padding: 2px 8px;
  border-radius: 8px;
  color: #fff;
  white-space: nowrap;

  &.is-dps {
    background-color: #1971c2;
  }

  &.is-sup {
    background-color: #2f9e44;
  }
}

.ov-empty {
  color: var(--app-text-secondary);
}
</style>
