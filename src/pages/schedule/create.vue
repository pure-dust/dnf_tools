<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import type { Character, Member, Schedule, ScheduledSlot, Template } from "../../types/schedule"
import { roleLabel, statLabel, uid } from "../../types/schedule"
import { ensureLoaded, replaceSchedules, saveSchedule, useScheduleStore } from "../../composables/useScheduleStore"
import type { DraftItem, TeamDraft } from "../../utils/team"
import {
  assignByLimits,
  emptyDraftsFromTemplate,
  estimateWaveCount,
  splitRounds,
  teamCounts,
  toScheduleTeams,
  TEAM_SIZE,
} from "../../utils/team"
import { colorizeTeams } from "../../utils/teamColor"

const store = useScheduleStore()
const router = useRouter()
const route = useRoute()

function nowLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

/* ---------- 基本信息 ---------- */
const time = ref(nowLocal())

/* ---------- 模板 ---------- */
const templates = computed(() => store.data.templates)
const selectedTemplateId = ref("")
const template = computed<Template | null>(() => templates.value.find((t) => t.id === selectedTemplateId.value) ?? null)
/** 每波人数上限由模板决定 */
const templateMax = computed(() => template.value?.maxMembers ?? 0)

onMounted(async () => {
  await ensureLoaded()
  if (!selectedTemplateId.value && templates.value.length) {
    selectedTemplateId.value = templates.value[0].id
  }
  const groupKey = route.query.group
  if (typeof groupKey === "string" && groupKey) {
    void loadForEdit(groupKey)
  }
})

function selectTemplate(t: Template) {
  if (selectedTemplateId.value === t.id) return
  selectedTemplateId.value = t.id
  editingGroupKey.value = null // 手动切换模板视为新建
  clearAll()
  resetResult()
}

/* ---------- 编辑历史“整组”排班：一次性载入全部场次 ---------- */
async function loadForEdit(groupKey: string) {
  // 同一组（groupId，无则自身 id）的全部“场”，按 roundIndex 升序
  const list = store.data.schedules
    .filter((x) => (x.groupId ?? x.id) === groupKey)
    .sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0))
  if (!list.length) {
    alert("找不到该组排班记录")
    return
  }
  const first = list[0]
  // 定位模板：优先按 templateId，其次按同名模板
  const t =
    templates.value.find((x) => x.id === first.templateId) ??
    (first.templateName ? templates.value.find((x) => x.name === first.templateName) : undefined)
  if (!t) {
    alert("原模板已不存在，无法编辑：请先到「排班模板」重建同名模板")
    return
  }
  if (template.value?.id !== t.id) selectTemplate(t)
  if (first.time) time.value = first.time

  // 每“场”各重建一个波次（角色以保存快照为准，即使成员库已改仍完整显示）
  const ws: Wave[] = list.map((s, i) => {
    const waveItems: DraftItem[] = []
    const teams: TeamDraft[] = (s.teams ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      damageLimit: team.damageLimit || 0,
      healLimit: team.healLimit || 0,
      minDps: team.minDps ?? 0,
      minSup: team.minSup ?? 1,
      items: (team.members ?? []).map((slot) => {
        const it: DraftItem = {
          memberId: slot.memberId,
          character: {
            id: slot.characterId,
            nickname: slot.nickname,
            roleType: slot.roleType,
            job: slot.job,
            fame: slot.fame,
            score: slot.score,
          } as Character,
        }
        waveItems.push(it)
        return it
      }),
    }))
    return {
      label: s.roundLabel || (list.length > 1 ? `第 ${i + 1} 波` : "本波"),
      pool: waveItems,
      teams,
    }
  })
  waves.value = ws

  // 勾选仍存在于成员库中的角色（优先按 id；成员被重建导致 id 变化时按“成员昵称+角色昵称”回退）
  const memberById = new Map(store.data.members.map((m) => [m.id, m]))
  const memberByNick = new Map<string, Member[]>()
  store.data.members.forEach((m) => {
    const list2 = memberByNick.get(m.nickname) ?? []
    list2.push(m)
    memberByNick.set(m.nickname, list2)
  })
  const live = new Set<string>()
  const tryAdd = (slot: ScheduledSlot) => {
    const direct = memberById.get(slot.memberId)?.characters.find((c) => c.id === slot.characterId)
    if (direct) {
      live.add(direct.id)
      return
    }
    const fallback = (memberByNick.get(slot.memberName ?? "") ?? [])
      .map((m) => m.characters.find((c) => c.nickname === slot.nickname))
      .find(Boolean)
    if (fallback) live.add(fallback.id)
  }
  list.forEach((s) => {
    ;(s.teams ?? []).forEach((team) => (team.members ?? []).forEach(tryAdd))
    ;(s.bench ?? []).forEach(tryAdd)
  })
  // 恢复替补区：替补快照记录在组内第一场（旧数据没有则替补为空）
  const benchSource = list.find((s) => (s.bench ?? []).length) ?? list[0]
  mergedBench.value = (benchSource?.bench ?? []).map((slot) => ({
    memberId: slot.memberId,
    character: {
      id: slot.characterId,
      nickname: slot.nickname,
      roleType: slot.roleType,
      job: slot.job,
      fame: slot.fame,
      score: slot.score,
    } as Character,
  }))

  // 保存后成员新增的角色：编辑时自动放入替补区并纳入勾选（便于参与后续重新生成/手动安排）
  const savedCharIds = new Set<string>()
  const appearMemberIds = new Set<string>()
  const appearMemberNames = new Set<string>()
  const savedNicks = new Map<string, Set<string>>()
  const noteNick = (k: string, nick: string) => {
    if (!k) return
    let s = savedNicks.get(k)
    if (!s) {
      s = new Set()
      savedNicks.set(k, s)
    }
    s.add(nick)
  }
  list.forEach((s) => {
    const slots = [...(s.teams ?? []).flatMap((t) => t.members ?? []), ...(s.bench ?? [])]
    slots.forEach((sl) => {
      savedCharIds.add(sl.characterId)
      if (sl.memberId) appearMemberIds.add(sl.memberId)
      if (sl.memberName) appearMemberNames.add(sl.memberName)
      noteNick(sl.memberId, sl.nickname)
      noteNick(sl.memberName, sl.nickname)
    })
  })
  for (const m of store.data.members) {
    if (!m.schedulable) continue
    // 只处理“本次排班用到的成员”（保存快照里出现过）
    if (!appearMemberIds.has(m.id) && !appearMemberNames.has(m.nickname)) continue
    const have = new Set<string>()
    savedNicks.get(m.id)?.forEach((n) => have.add(n))
    savedNicks.get(m.nickname)?.forEach((n) => have.add(n))
    for (const c of m.characters) {
      if (savedCharIds.has(c.id)) continue // 已排/已在替补中的角色
      if (have.has(c.nickname)) continue // 同昵称视为已有
      // 新角色 → 替补区 + 勾选
      tryAdd({
        memberId: m.id,
        characterId: c.id,
        memberName: m.nickname,
        nickname: c.nickname,
        roleType: c.roleType,
        job: c.job,
        fame: c.fame,
        score: c.score,
      })
      mergedBench.value.push({ memberId: m.id, character: c })
    }
  }
  selectedIds.value = [...live]

  hasGenerated.value = true
  editingGroupKey.value = groupKey
}

/* ---------- 可排人选 ---------- */
const pool = computed<DraftItem[]>(() =>
  store.data.members
    .filter((m) => m.schedulable)
    .flatMap((m) => m.characters.map((c) => ({ memberId: m.id, character: c }))),
)

const schedulableMembers = computed(() => store.data.members.filter((m) => m.schedulable))

const selectedIds = ref<string[]>([])
const selectedCount = computed(() => selectedIds.value.length)
const dpsSelected = computed(
  () => pool.value.filter((p) => p.character.roleType === "dps" && selectedIds.value.includes(p.character.id)).length,
)
const supportSelected = computed(
  () =>
    pool.value.filter((p) => p.character.roleType === "support" && selectedIds.value.includes(p.character.id)).length,
)

/**
 * 需要的波次数 = ⌈总角色 / 模板每班人数上限⌉：先按模板容量定班数（不因成员/奶等规则增加），
 * 放不进这些班的角色会进入替补区。与 splitRounds 的计划一致，生成后不跳变。
 */
const roundCount = computed(() => {
  const cap = Math.min(Math.max(templateMax.value || 1, 1), 20)
  if (!selectedCount.value || !cap) return 0
  return estimateWaveCount(selectedItems(), cap)
})

/** 参与成员数（勾选角色去重后的成员人数） */
const selMemberCount = computed(() => new Set(selectedItems().map((i) => i.memberId)).size)

/** 每波实际可容纳人数 = min(模板每班上限, 参与成员数)：同人每班 1 号 → 成员不足时装不满模板容量 */
const waveCap = computed(() => {
  const cap = Math.min(Math.max(templateMax.value || 1, 1), 20)
  const m = Math.max(selMemberCount.value, 1)
  return Math.max(1, Math.min(cap, m))
})

function toggleSelect(id: string) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
    return
  }
  // 不再限制单波人数：多于每波人数时自动分多波
  selectedIds.value = [...selectedIds.value, id]
}

function selectAll() {
  selectedIds.value = pool.value.map((p) => p.character.id)
}
function clearAll() {
  selectedIds.value = []
}

/* ---------- 选择角色：按成员折叠 ---------- */
const pickOpen = ref<string[]>([])

function pickToggle(m: Member) {
  pickOpen.value = pickOpen.value.includes(m.id) ? pickOpen.value.filter((x) => x !== m.id) : [...pickOpen.value, m.id]
}

/** 折叠完全由用户手动控制（是否展开只看是否点过） */
function pickOpenState(m: Member) {
  return pickOpen.value.includes(m.id)
}

function pickSelectedCount(m: Member) {
  return m.characters.filter((c) => selectedIds.value.includes(c.id)).length
}

function pickRoleCounts(m: Member) {
  const dps = m.characters.filter((c) => c.roleType === "dps").length
  return { dps, support: m.characters.length - dps }
}

/* ---------- 就近补齐 + 多波次（替补区全局合并） ---------- */
interface Wave {
  label: string
  /** 分配到本波次的全部参与人 */
  pool: DraftItem[]
  teams: TeamDraft[]
}

const waves = ref<Wave[]>([])
/** 全局合并的替补区（各波的替补统一放这里） */
const mergedBench = ref<DraftItem[]>([])
const hasGenerated = ref(false)
/** 编辑历史“整组”时的原组 key；保存时覆盖该组旧记录 */
const editingGroupKey = ref<string | null>(null)

function resetResult() {
  waves.value = []
  mergedBench.value = []
  hasGenerated.value = false
}

function selectedItems(): DraftItem[] {
  return pool.value.filter((p) => selectedIds.value.includes(p.character.id))
}

/** 生成：先按模板每班容量定下“计划班数”，再按规则填充；放不进这些班的角色进入替补区 */
function generate() {
  if (!template.value) {
    alert("请先在“排班模板”页创建并选择一个模板")
    return
  }
  const items = selectedItems()
  if (!items.length) return
  const cap = Math.min(Math.max(templateMax.value || 1, 1), 20)
  const { waves: rounds, bench: overflow } = splitRounds(items, cap)
  const ws: Wave[] = []
  const benchAll: DraftItem[] = [...overflow]
  rounds.forEach((poolItems, i) => {
    const base = emptyDraftsFromTemplate(template.value!.teams)
    const res = assignByLimits(base, poolItems)
    ws.push({
      label: rounds.length > 1 ? `第 ${i + 1} 波` : "本波",
      pool: poolItems,
      teams: res.teams,
    })
    benchAll.push(...res.bench)
  })
  waves.value = ws
  mergedBench.value = benchAll
  hasGenerated.value = true
  // 生成后内置“多次插入”：按生成逻辑（启用空队、先辅后出、每队≤4、同人每班1号）反复补，直到无法再插入
  insertBenchToTeams()
}

/* ---------------- 替补插入（生成内置 + 自动补位） ---------------- */
/** 把一个替补角色按生成逻辑放入指定班内的某队（先补辅助缺口，再补输出到 ≤4；同班不重复成员） */
function fillTeamFromBench(wave: Wave, team: TeamDraft) {
  const used = mergedBench.value
  const isSup = (i: DraftItem) => i.character.roleType === "support"
  const supCount = (items: DraftItem[]) => items.filter(isSup).length
  const inWave = (item: DraftItem) =>
    wave.teams.some((t) => t.items.some((x) => x.memberId === item.memberId))
  if (team.items.length >= TEAM_SIZE) return
  const minSup = team.minSup ?? 1
  // ① 补辅助缺口（不超编：最多补到 minSup）
  while (team.items.length < TEAM_SIZE && supCount(team.items) < minSup) {
    const idx = used.findIndex((i) => isSup(i) && !inWave(i))
    if (idx < 0) break
    const it = used.splice(idx, 1)[0]
    team.items.push(it)
  }
  // ② 补输出直到满 4 人（输出不足则停在不满员）
  while (team.items.length < TEAM_SIZE) {
    const idx = used.findIndex((i) => !isSup(i) && !inWave(i))
    if (idx < 0) break
    const it = used.splice(idx, 1)[0]
    team.items.push(it)
  }
}

/**
 * 生成内置：把替补按生成逻辑尽量插入各队（启用空队），反复进行直到无法再插入。
 * 逐班(靠前)→逐队(红→黄→绿)→先补辅助再补输出；每队≤4、同班同人至多 1 号；
 * 放不下的替补保留在替补区。
 */
function insertBenchToTeams() {
  let changed = true
  let guard = 0
  while (changed && guard++ < 100) {
    changed = false
    for (const wave of waves.value) {
      for (const team of wave.teams) {
        const before = team.items.length
        fillTeamFromBench(wave, team)
        if (team.items.length > before) changed = true
      }
    }
  }
}

/**
 * 自动补位（简单版）：把替补区角色直接插回“有空位队伍且同班不含该成员”的队，
 * 不看门槛/顺序；放不下的保留替补。用于生成后手动调整时快速回填空位。
 */
function autoFillBench() {
  if (!mergedBench.value.length) return
  const rest: DraftItem[] = []
  for (const item of mergedBench.value) {
    let placed = false
    for (const wave of waves.value) {
      if (hasSameMemberInWave(wave, item)) continue // 同班不可重复同一成员
      const team = wave.teams.find((t) => t.items.length < TEAM_SIZE)
      if (team) {
        team.items.push(item)
        placed = true
        break
      }
    }
    if (!placed) rest.push(item)
  }
  mergedBench.value = rest
}

/* ---------------- 结果区总览式网格（行=波次，列=队伍） ---------------- */
/** 第一波（基准波）的队伍 → 作为列头/列配置源 */
function baseTeams(): TeamDraft[] {
  return waves.value[0]?.teams ?? []
}

/** 网格列模板：波次列 + 每队一列（可横向滚动） */
function resGridCols(): string {
  const n = baseTeams().length
  const team = n ? Array.from({ length: n }, () => "minmax(210px, 1fr)").join(" ") : "1fr"
  return `minmax(150px, auto) ${team}`
}

/** 列头队伍圆点颜色（按基准波门槛排序，与结果格同色） */
function baseTeamColor(idx: number): string {
  const w = waves.value[0]
  const t = w?.teams[idx]
  return t ? colorOf(w, t.id) : ""
}

/** 列头门槛/配额改动 → 同步到全部波次的同一列队伍 */
function onColumnLimit(
  idx: number,
  field: "damageLimit" | "healLimit" | "minDps" | "minSup",
  ev: Event,
) {
  const raw = (ev.target as HTMLInputElement).value
  const val = raw === "" ? 0 : Number(raw)
  const v = Number.isFinite(val) && val >= 0 ? val : 0
  waves.value.forEach((w) => {
    const t = w.teams[idx]
    if (t) t[field] = v
  })
}

/** 按某波门槛重新分配（该波此前手动放入替补的人会重新参与分配并从替补移除） */
function reassignWave(wave: Wave) {
  const poolIds = new Set(wave.pool.map((p) => p.character.id))
  mergedBench.value = mergedBench.value.filter((x) => !poolIds.has(x.character.id))
  const res = assignByLimits(wave.teams, wave.pool)
  wave.teams = res.teams
  mergedBench.value.push(...res.bench)
}

/* ---------- 波次/队伍显示 ---------- */
function colorOf(wave: Wave, teamId: string): string {
  const c = colorizeTeams(wave.teams).find((x) => x.team.id === teamId)
  return c ? c.color : "#888888"
}

function teamPeople(wave: Wave, idx: number) {
  return teamCounts(wave.teams[idx].items)
}

function wavePlaced(wave: Wave) {
  return wave.teams.reduce((s, d) => s + d.items.length, 0)
}

function teamsTotal() {
  return waves.value.reduce((s, w) => s + wavePlaced(w), 0)
}

/* ---------- 拖拽调整（替补全局） ---------- */
interface DragSource {
  /** 队伍内拖拽的来源波次；从替补拖时为 null */
  wave: Wave | null
  kind: "team" | "bench"
  teamIdx: number
  item: DraftItem
}

/** 放置处理只依赖这几个事件成员 */
interface DropLike {
  preventDefault(): void
  stopPropagation?(): void
}

const dragSrc = ref<DragSource | null>(null)
const hoverMark = ref("")

function endDrag() {
  dragSrc.value = null
  hoverMark.value = ""
  removeGhost()
}

function popMergedBench(item: DraftItem) {
  const i = mergedBench.value.indexOf(item)
  if (i >= 0) mergedBench.value.splice(i, 1)
}

/** 该波是否已有同一成员的其他角色 */
function hasSameMemberInWave(wave: Wave, item: DraftItem) {
  return wave.teams.some((t) => t.items.some((i) => i.memberId === item.memberId))
}

/** 丢到某队成员上：队伍内=调整顺序/跨队交换；替补→队=插入 */
function dropOnMember(ev: DropLike, wave: Wave, teamIdx: number, targetIdx: number) {
  ev.preventDefault()
  ev.stopPropagation?.()
  const s = dragSrc.value
  hoverMark.value = ""
  if (!s) {
    endDrag()
    return
  }
  const targetItems = wave.teams[teamIdx].items
  const targ = targetItems[targetIdx]

  if (s.kind === "bench") {
    if (hasSameMemberInWave(wave, s.item)) {
      alert("该成员已有角色在本波，不能重复放入")
      endDrag()
      return
    }
    if (targetItems.length >= TEAM_SIZE) {
      alert("该队已满 4 人，无法从替补放入")
      endDrag()
      return
    }
    popMergedBench(s.item)
    targetItems.splice(Math.min(targetIdx, targetItems.length), 0, s.item)
    endDrag()
    return
  }

  // 队伍内拖拽仅限同波
  if (!s.wave || s.wave !== wave) {
    endDrag()
    return
  }
  const srcItems = s.wave.teams[s.teamIdx].items
  if (s.teamIdx === teamIdx) {
    const i = srcItems.indexOf(s.item)
    if (i >= 0) {
      srcItems.splice(i, 1)
      srcItems.splice(Math.min(targetIdx, srcItems.length), 0, s.item)
    }
    endDrag()
    return
  }
  // 同波跨队交换
  const i = srcItems.indexOf(s.item)
  if (i < 0 || !targ) {
    endDrag()
    return
  }
  const j = targetItems.indexOf(targ)
  srcItems.splice(i, 1)
  targetItems.splice(j, 1)
  srcItems.push(targ)
  targetItems.splice(Math.min(targetIdx, targetItems.length), 0, s.item)
  endDrag()
}

/** 丢到某队空白区：替补可跨波放入，队伍内仅同波 */
function dropOnTeam(ev: DropLike, wave: Wave, teamIdx: number) {
  ev.preventDefault()
  const s = dragSrc.value
  hoverMark.value = ""
  if (!s) {
    endDrag()
    return
  }
  const team = wave.teams[teamIdx]
  if (s.kind === "bench") {
    if (hasSameMemberInWave(wave, s.item)) {
      alert("该成员已有角色在本波，不能重复放入")
      endDrag()
      return
    }
    if (team.items.length >= TEAM_SIZE) {
      alert("该队已满 4 人，无法放入")
      endDrag()
      return
    }
    popMergedBench(s.item)
    team.items.push(s.item)
    endDrag()
    return
  }
  if (!s.wave || s.wave !== wave || s.teamIdx === teamIdx) {
    endDrag()
    return
  }
  const srcTeam = s.wave.teams[s.teamIdx]
  if (team.items.length < TEAM_SIZE) {
    srcTeam.items = srcTeam.items.filter((x) => x !== s.item)
    team.items.push(s.item)
  } else {
    // 目标满员：与最后一位交换
    const last = team.items[team.items.length - 1]
    srcTeam.items = srcTeam.items.filter((x) => x !== s.item)
    team.items = team.items.map((x) => (x === last ? s.item : x))
    srcTeam.items.push(last)
  }
  endDrag()
}

/** 丢到全局替补区（任一波的成员拖到这里即进入替补） */
function dropOnBench(ev: DropLike) {
  ev.preventDefault()
  const s = dragSrc.value
  hoverMark.value = ""
  if (!s || s.kind === "bench") {
    endDrag()
    return
  }
  if (!s.wave) {
    endDrag()
    return
  }
  const srcTeam = s.wave.teams[s.teamIdx]
  srcTeam.items = srcTeam.items.filter((x) => x !== s.item)
  mergedBench.value.push(s.item)
  endDrag()
}

/* ============ 自定义指针拖拽（兼容 Tauri WebView2 / 浏览器） ============ */
let lastCandidate: { el: HTMLElement; role: string } | null = null
let lastHl: HTMLElement | null = null

function clearHl() {
  if (lastHl) {
    lastHl.classList.remove("drag-target")
    lastHl = null
  }
  lastCandidate = null
}

/* ---- 跟手拖拽浮层（模拟原生拖拽图像） ---- */
let ghostEl: HTMLElement | null = null
let ghostShown = false
let ghostStartX = 0
let ghostStartY = 0

function removeGhost() {
  ghostEl?.remove()
  ghostEl = null
  ghostShown = false
}

/** 构造一个紧凑的“被拖角色”卡片 */
function buildGhost(item: DraftItem) {
  const ch = item.character
  const g = document.createElement("div")
  g.className = "drag-ghost"
  const tag = document.createElement("span")
  tag.className = `tag ${ch.roleType === "dps" ? "tag--dps" : "tag--support"}`
  tag.textContent = roleLabel(ch.roleType)
  const nick = document.createElement("b")
  nick.textContent = ch.nickname
  const meta = document.createElement("span")
  meta.className = "drag-ghost__meta"
  meta.textContent = `${ch.job} · ${statLabel(ch.roleType)} ${ch.score}`
  g.append(tag, nick, meta)
  return g
}

/** 移动浮层跟随光标；移动超过阈值才首次显示，避免点击闪现 */
function moveGhost(x: number, y: number) {
  if (!ghostShown) {
    const dx = x - ghostStartX
    const dy = y - ghostStartY
    if (dx * dx + dy * dy < 49) return // <7px 视为点击
    ghostShown = true
    const s = dragSrc.value
    if (!s) return
    ghostEl = buildGhost(s.item)
    ghostEl.style.left = "0px"
    ghostEl.style.top = "0px"
    document.body.appendChild(ghostEl)
  }
  if (!ghostEl) return
  ghostEl.style.left = `${x + 12}px`
  ghostEl.style.top = `${y + 14}px`
}

/** 从坐标元素向上找最近的放置目标（队伍/成员/替补） */
function dropTargetFrom(el: HTMLElement | null): { el: HTMLElement; role: string } | null {
  let n: HTMLElement | null = el
  while (n) {
    const role = n.getAttribute ? n.getAttribute("data-role") : null
    if (role === "team" || role === "member" || role === "bench") {
      return { el: n, role }
    }
    n = n.parentElement
  }
  return null
}

type EvLike = {
  button: number
  clientX: number
  clientY: number
  preventDefault(): void
  pointerId?: number
}

/** 移除本次拖拽注册的全部监听（pointer + mouse 双通道） */
function clearListeners() {
  window.removeEventListener("pointermove", onMove)
  window.removeEventListener("pointerup", onUp)
  window.removeEventListener("pointercancel", onCancel)
  window.removeEventListener("mousemove", onMove)
  window.removeEventListener("mouseup", onUp)
}

function onMove(ev: { clientX: number; clientY: number; preventDefault(): void }) {
  ev.preventDefault()
  moveGhost(ev.clientX, ev.clientY)
  const c = dropTargetFrom(document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)
  if (!c) {
    if (lastCandidate) clearHl()
    return
  }
  if (lastCandidate && lastCandidate.el === c.el) return
  clearHl()
  c.el.classList.add("drag-target")
  lastCandidate = c
  lastHl = c.el
}

function onUp(ev: { clientX: number; clientY: number }) {
  const c = dropTargetFrom(document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)
  clearListeners()
  clearHl()

  const s = dragSrc.value
  if (!s) return
  if (!c) {
    endDrag()
    return
  }
  const stub: DropLike = {
    preventDefault() {},
    stopPropagation() {},
  }

  if (c.role === "bench") {
    dropOnBench(stub)
    return
  }
  // 队伍 / 成员：找到所在波与队伍
  const teamEl = c.role === "team" ? (c.el as HTMLElement) : ((c.el.closest(".team") as HTMLElement) ?? null)
  if (!teamEl) {
    endDrag()
    return
  }
  const wi = Number(teamEl.getAttribute("data-wi"))
  const ti = Number(teamEl.getAttribute("data-ti"))
  const wave = waves.value[wi]
  if (!wave || Number.isNaN(ti)) {
    endDrag()
    return
  }
  if (c.role === "member") {
    dropOnMember(stub, wave, ti, Number(c.el.getAttribute("data-i")))
  } else {
    dropOnTeam(stub, wave, ti)
  }
}

function onCancel() {
  clearListeners()
  clearHl()
  endDrag()
}

function beginDrag(ev: EvLike, src: DragSource, captureEl?: HTMLElement | null) {
  if (ev.button !== 0) return
  if (dragSrc.value) return // 已在进行拖拽（同一次按压 pointerdown+mousedown 只生效一次）
  ev.preventDefault()
  dragSrc.value = src
  ghostStartX = ev.clientX
  ghostStartY = ev.clientY
  ghostShown = false
  if (typeof PointerEvent !== "undefined" && ev instanceof PointerEvent) {
    // 捕获指针，保证拖出窗口/可视区外仍能收到 pointerup
    try {
      captureEl?.setPointerCapture?.(ev.pointerId)
    } catch {
      /* ignore */
    }
  }
  // 同时挂 pointer 与 mouse 两套监听，任一通道触发的 move/up 都能处理
  window.addEventListener("pointermove", onMove, { passive: false })
  window.addEventListener("pointerup", onUp)
  window.addEventListener("pointercancel", onCancel)
  window.addEventListener("mousemove", onMove, { passive: false })
  window.addEventListener("mouseup", onUp)
}

function pdMember(ev: PointerEvent | MouseEvent, wave: Wave, teamIdx: number, item: DraftItem) {
  beginDrag(ev, { wave, kind: "team", teamIdx, item }, ev.currentTarget as HTMLElement | null)
}

function pdBench(ev: PointerEvent | MouseEvent, item: DraftItem) {
  beginDrag(ev, { wave: null, kind: "bench", teamIdx: 0, item }, ev.currentTarget as HTMLElement | null)
}

/* ---------- 保存（每波存成一条排班） ---------- */
const canSave = computed(() => {
  return (
    !!template.value &&
    time.value.trim().length > 0 &&
    hasGenerated.value &&
    waves.value.some((w) => w.teams.some((t) => t.items.length > 0))
  )
})

function save() {
  if (!canSave.value || !template.value) return
  const memberMap = new Map<string, Member>()
  store.data.members.forEach((m) => memberMap.set(m.id, m))
  const created = Date.now()
  const teamOf = (wave: Wave) =>
    toScheduleTeams(wave.teams).map((t) => ({
      ...t,
      members: t.members.map((slot) => ({
        ...slot,
        memberName: memberMap.get(slot.memberId)?.nickname ?? slot.memberName,
      })),
    }))
  // 替补区快照（保存到组内第一场，供下次编辑恢复）
  const benchOf = () =>
    mergedBench.value.map((it) => {
      const ch = it.character
      return {
        memberId: it.memberId,
        characterId: ch.id,
        memberName: memberMap.get(it.memberId)?.nickname ?? "",
        nickname: ch.nickname,
        roleType: ch.roleType,
        job: ch.job,
        fame: ch.fame,
        score: ch.score,
      }
    })

  // 编辑覆盖：复用原组旧记录的 id / createdAt / groupId，位置与分组保持不变
  if (editingGroupKey.value) {
    const olds = store.data.schedules
      .filter((x) => (x.groupId ?? x.id) === editingGroupKey.value)
      .sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0))
    const oldGroupId = olds[0]?.groupId
    // 原为多场组沿用其 groupId；原单场仍为单场；若由单场扩成多场则新建组
    const coverGroupId = oldGroupId ?? (waves.value.length > 1 ? uid() : undefined)
    const payloads: Schedule[] = waves.value.map((wave, i) => {
      const old = olds[i]
      return {
        id: old?.id ?? uid(),
        time: time.value,
        createdAt: old?.createdAt ?? created,
        templateId: template.value!.id,
        templateName: template.value!.name,
        maxMembers: templateMax.value,
        groupId: coverGroupId,
        roundLabel: waves.value.length > 1 ? wave.label : undefined,
        roundIndex: i + 1,
        teams: teamOf(wave),
      }
    })
    // 替补记录到组内第一场
    const benchSlots = benchOf()
    if (benchSlots.length && payloads.length) payloads[0] = { ...payloads[0], bench: benchSlots }
    // 删除该组全部旧记录后整体写回（旧记录多于新场次时自动清除多余）
    replaceSchedules(
      olds.map((o) => o.id),
      payloads,
    )
    router.push("/schedule/history")
    return
  }

  // 新建：多波次共享 groupId
  const groupId = waves.value.length > 1 ? uid() : undefined
  const benchSlots = benchOf()
  for (let i = 0; i < waves.value.length; i++) {
    const wave = waves.value[i]
    const rec: Schedule = {
      id: uid(),
      time: time.value,
      createdAt: created,
      templateId: template.value!.id,
      templateName: template.value!.name,
      maxMembers: templateMax.value,
      groupId,
      roundLabel: waves.value.length > 1 ? wave.label : undefined,
      roundIndex: i + 1,
      teams: teamOf(wave),
    }
    // 替补记录到组内第一场
    if (i === 0 && benchSlots.length) rec.bench = benchSlots
    saveSchedule(rec)
  }
  router.push("/schedule/history")
}
</script>

<template>
  <div class="create">
    <!-- 选择模板 -->
    <section class="panel">
      <h3 class="panel__title">① 选择排班模板</h3>
      <p v-if="templates.length === 0" class="empty">
        还没有模板，请先到「排班模板」页创建模板（可设置参与人数与每队伤害/奶量限制）
      </p>
      <div v-else class="tmpl-pick">
        <button
          v-for="t in templates"
          :key="t.id"
          class="tmpl-pick__item"
          :class="{ 'is-on': selectedTemplateId === t.id }"
          type="button"
          @click="selectTemplate(t)"
        >
          <span class="tmpl-pick__name">{{ t.name }}</span>
          <span class="tmpl-pick__meta">人数 {{ t.maxMembers }} · {{ t.teams.length }} 队</span>
          <span class="tmpl-pick__rows">
            <i
              v-for="c in colorizeTeams(t.teams)"
              :key="c.team.id"
              :style="{ backgroundColor: c.color }"
              :title="c.team.name + ' 伤害' + (c.team.damageLimit || '不限') + ' 奶量' + (c.team.healLimit || '不限')"
            ></i>
          </span>
        </button>
      </div>
      <p v-if="template" class="tmpl-pick__note">
        已选「{{ template.name }}」：参与上限 {{ templateMax }} 人 · 队伍颜色按伤害门槛从高到低为红→黄→绿→蓝
      </p>
    </section>

    <!-- 排班信息 -->
    <section class="panel">
      <h3 class="panel__title">② 排班信息</h3>
      <div class="form-grid">
        <div class="form-field">
          <label>排班时间</label>
          <input v-model="time" class="input" type="datetime-local" />
        </div>
        <div class="form-field">
          <label>参与人数上限（由模板决定）</label>
          <input class="input" type="text" :value="template ? templateMax + ' 人' : '—'" disabled />
        </div>
      </div>
    </section>

    <!-- 选择参与角色 -->
    <section class="panel">
      <div class="create__pick-head">
        <h3 class="panel__title">③ 选择参与角色</h3>
        <div class="create__pick-meta">
          <button class="btn btn--sm" type="button" @click="selectAll">全选可排角色</button>
          <button class="btn btn--sm" type="button" @click="clearAll">清空</button>
          <span class="create__pick-count">
            已选 <b>{{ selectedCount }}</b>
            <template v-if="template && roundCount > 0">
              · 将分 <b>{{ roundCount }}</b> 波（每波 ≤ {{ waveCap }} 人
              <template v-if="waveCap < templateMax">，受成员人数 {{ selMemberCount }} 限制</template>）
            </template>
            · 输出 {{ dpsSelected }} · 辅助 {{ supportSelected }}
          </span>
        </div>
      </div>

      <p v-if="schedulableMembers.length === 0" class="empty">暂无可排班成员，请先到「成员管理」添加成员与角色</p>

      <div v-else class="pick-group">
        <div v-for="m in schedulableMembers" :key="m.id" class="pick-member" :class="{ 'is-open': pickOpenState(m) }">
          <div class="pick-member__head" @click="pickToggle(m)">
            <span class="pick-member__avatar">{{ m.nickname.slice(0, 1) }}</span>
            <span class="pick-member__name">{{ m.nickname }}</span>
            <span class="pick-member__meta">
              已选 <b>{{ pickSelectedCount(m) }}</b
              >/{{ m.characters.length }} · 输出 {{ pickRoleCounts(m).dps }} · 辅助 {{ pickRoleCounts(m).support }}
            </span>
            <button
              class="pick-member__chev"
              type="button"
              :aria-label="pickOpenState(m) ? '收起角色' : '展开角色'"
              @click.stop="pickToggle(m)"
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>

          <div v-show="pickOpenState(m)" class="pick-member__chars">
            <label v-for="c in m.characters" :key="c.id" class="pick-char">
              <input type="checkbox" :checked="selectedIds.includes(c.id)" @change="toggleSelect(c.id)" />
              <span class="pick-char__name">{{ c.nickname }}</span>
              <span class="tag" :class="c.roleType === 'dps' ? 'tag--dps' : 'tag--support'">
                {{ roleLabel(c.roleType) }}
              </span>
              <span class="pick-char__meta">{{ statLabel(c.roleType) }} {{ c.score }} · 名望 {{ c.fame }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="create__gen">
        <button class="btn btn--primary" type="button" :disabled="selectedCount === 0" @click="generate">
          自动生成队伍
        </button>
        <button
          class="btn"
          type="button"
          :disabled="!hasGenerated || mergedBench.length === 0"
          @click="autoFillBench"
          title="把替补区角色插入有空位队伍（仅保证同一成员不在同一班重复）"
        >
          自动补位
        </button>
        <span class="create__hint">按模板各队门槛分配（就近补齐）；角色多于模板人数时自动拆成多波</span>
      </div>
    </section>

    <!-- 排班结果 -->
    <section v-if="hasGenerated && template" class="panel">
      <div class="create__res-head">
        <h3 class="panel__title">④ 排班结果</h3>
        <span class="create__hint">
          {{ waves.length }} 个波次 · 已排 {{ teamsTotal() }} 人 · 替补 {{ mergedBench.length }} 人
        </span>
      </div>

      <div class="results__layout">
        <!-- 左：总览式网格（行=波次，列=队伍） -->
        <div class="res-scroll">
          <p class="create__hint">
            每列一支队伍（列头可改门槛/配额，作用于所有波次的该队）；每行一个波次。拖拽成员可队内调整、同波跨队交换，或拖到右侧“替补区域”移出该波。
          </p>
          <div class="res-grid" :style="{ gridTemplateColumns: resGridCols() }">
            <!-- 表头：波次列 + 每队一列（门槛/配额在列头统一编辑） -->
            <div class="res-hd res-hd--round">波次</div>
            <div
              v-for="(t, idx) in baseTeams()"
              :key="t.id"
              class="res-hd res-hd--team"
              :style="{ '--tc': baseTeamColor(idx) }"
            >
              <div class="res-hd__name">
                <i class="team__dot"></i><b>{{ t.name }}</b>
              </div>
              <div class="res-hd__limits">
                <label title="伤害门槛（0=不限）">
                  <span>伤害</span>
                  <input
                    class="input res-limit-input"
                    type="number"
                    min="0"
                    placeholder="0"
                    :value="t.damageLimit ?? 0"
                    @input="onColumnLimit(idx, 'damageLimit', $event)"
                  />
                </label>
                <label title="奶量门槛（0=不限）">
                  <span>奶量</span>
                  <input
                    class="input res-limit-input"
                    type="number"
                    min="0"
                    placeholder="0"
                    :value="t.healLimit ?? 0"
                    @input="onColumnLimit(idx, 'healLimit', $event)"
                  />
                </label>
                <label title="该队至少放入的输出角色数">
                  <span>输出≥</span>
                  <input
                    class="input res-limit-input"
                    type="number"
                    min="0"
                    placeholder="0"
                    :value="t.minDps ?? 0"
                    @input="onColumnLimit(idx, 'minDps', $event)"
                  />
                </label>
                <label title="该队至少放入的辅助角色数">
                  <span>辅助≥</span>
                  <input
                    class="input res-limit-input"
                    type="number"
                    min="0"
                    placeholder="1"
                    :value="t.minSup ?? 1"
                    @input="onColumnLimit(idx, 'minSup', $event)"
                  />
                </label>
              </div>
            </div>

            <!-- 每波一行 -->
            <template v-for="(wave, wi) in waves" :key="wi">
              <div class="res-round">
                <b class="wave__label">{{ wave.label }}</b>
                <span class="res-round__meta">已排 {{ wavePlaced(wave) }} / {{ wave.pool.length }}</span>
                <button
                  class="btn btn--sm"
                  type="button"
                  :disabled="wave.teams.length === 0"
                  @click="reassignWave(wave)"
                >
                  重排本波
                </button>
              </div>
              <div
                v-for="(t, idx) in wave.teams"
                :key="t.id"
                class="res-cell"
                data-role="team"
                :data-wi="wi"
                :data-ti="idx"
                :class="{ 'is-empty': t.items.length === 0 }"
                :style="{ '--tc': colorOf(wave, t.id) }"
              >
                <div class="res-cell__head">
                  <span v-if="t.items.length" class="res-cell__stat">
                    C {{ teamPeople(wave, idx).dps }} · 奶 {{ teamPeople(wave, idx).support }}
                  </span>
                  <span v-if="t.items.length === 0" class="res-cell__empty-tip">空</span>
                  <span v-else-if="t.items.length < TEAM_SIZE" class="res-cell__warn">
                    未满 {{ t.items.length }}/4
                  </span>
                  <span v-else class="res-cell__full">满员</span>
                </div>
                <ul class="res-cell__list">
                  <li
                    v-for="(it, i) in t.items"
                    :key="it.character.id"
                    class="member-row"
                    data-role="member"
                    :data-wi="wi"
                    :data-ti="idx"
                    :data-i="i"
                    @pointerdown="pdMember($event, wave, idx, it)"
                    @mousedown="pdMember($event, wave, idx, it)"
                  >
                    <span class="drag-grip">⋮⋮</span>
                    <span class="tag" :class="it.character.roleType === 'dps' ? 'tag--dps' : 'tag--support'">
                      {{ roleLabel(it.character.roleType) }}
                    </span>
                    <span class="member-row__nick">{{ it.character.nickname }}</span>
                    <span class="member-row__meta"
                      >{{ it.character.job }} · {{ statLabel(it.character.roleType) }} {{ it.character.score }}</span
                    >
                  </li>
                  <li v-if="t.items.length === 0" class="team__empty">（空）可把成员拖到这里</li>
                </ul>
              </div>
            </template>
          </div>
        </div>

        <!-- 右：合并替补区域 -->
        <aside class="zone bench-zone bench-zone--global" data-role="bench">
          <div class="zone__title">
            替补区域（合并）<small>拖到这里即不参与任何波</small>
            <span class="zone__count">{{ mergedBench.length }} 人</span>
          </div>
          <div class="bench__chips">
            <span
              v-for="it in mergedBench"
              :key="it.character.id"
              class="bench__chip"
              @pointerdown="pdBench($event, it)"
              @mousedown="pdBench($event, it)"
            >
              <span class="drag-grip">⋮⋮</span>
              <span class="tag" :class="it.character.roleType === 'dps' ? 'tag--dps' : 'tag--support'">
                {{ roleLabel(it.character.roleType) }}
              </span>
              {{ it.character.nickname }}
              <span class="bench__meta">{{ it.character.job }}</span>
            </span>
            <span v-if="mergedBench.length === 0" class="bench__empty">
              暂无替补 —— 把任一波的成员拖到这里即可设为替补
            </span>
          </div>
        </aside>
      </div>

      <div class="create__foot">
        <span>共 {{ waves.length }} 波 · 已排 {{ teamsTotal() }} 人 · 替补 {{ mergedBench.length }} 人</span>
        <button class="btn btn--success" type="button" :disabled="!canSave" @click="save">
          保存全部{{ waves.length > 1 ? ` ${waves.length} 波` : "" }}
        </button>
      </div>
    </section>
  </div>
</template>

<style lang="less">
.create {
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__pick-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    .panel__title {
      margin-bottom: 0;
    }
  }

  &__pick-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  &__pick-count {
    font-size: 12px;
    color: var(--app-text-secondary);

    b {
      color: var(--app-primary);
    }
  }

  &__gen {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 14px;
    flex-wrap: wrap;
  }

  &__hint {
    font-size: 12px;
    color: var(--app-text-secondary);
  }

  &__warn {
    margin-bottom: 10px;
    padding: 6px 10px;
    border-radius: 6px;
    background-color: color-mix(in srgb, var(--app-warn) 14%, transparent);
    color: var(--app-warn);
    font-size: 12px;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 14px;
    font-size: 13px;
    color: var(--app-text-secondary);
  }

  .pick-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 10px;
  }

  .pick-member {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    padding: 8px 10px;

    &__name {
      font-size: 13px;
      font-weight: 600;
      color: var(--app-text);
      margin-bottom: 6px;
    }

    &__chars {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  }

  .pick-char {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background-color: var(--app-bg);
    cursor: pointer;
    font-size: 12px;
    color: var(--app-text);
    transition:
      border-color 0.15s ease,
      opacity 0.15s ease;

    &.is-off {
      opacity: 0.5;
    }

    &__name {
      font-weight: 600;
    }

    &__meta {
      color: var(--app-text-secondary);
    }
  }

  .teams {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
  }

  .team {
    &__head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-bottom: 8px;
      border-bottom: 1px dashed var(--app-border);
      flex-wrap: wrap;
    }

    &__name {
      font-size: 14px;
      color: var(--app-text);
    }

    &__count {
      font-size: 12px;
      color: var(--app-text-secondary);
    }

    &__warn {
      font-size: 11px;
      color: var(--app-warn);
      background-color: color-mix(in srgb, var(--app-warn) 12%, transparent);
      padding: 1px 8px;
      border-radius: 8px;
    }

    &__list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 0 0;
    }

    &__empty {
      color: var(--app-text-secondary);
      font-size: 12px;
    }
  }

  .member-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 6px;
    background-color: var(--app-bg);

    &__nick {
      font-weight: 600;
      font-size: 13px;
      color: var(--app-text);
    }

    &__meta {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      color: var(--app-text-secondary);
    }

    &__move {
      width: 110px;
      height: 26px;
      font-size: 12px;
    }
  }

  .bench {
    margin-top: 12px;
    padding: 10px;
    border: 1px dashed var(--app-border);
    border-radius: 8px;

    &__title {
      font-size: 12px;
      color: var(--app-text-secondary);
      margin-bottom: 6px;
    }

    &__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    &__chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 12px;
      background-color: var(--app-border);
      font-size: 12px;
      color: var(--app-text);
    }

    &__move {
      width: 90px;
      height: 22px;
      font-size: 11px;
      padding: 0 4px;
    }
  }
}

/* ===== 模板选择 ===== */
.tmpl-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tmpl-pick__item {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  background-color: var(--app-bg);
  color: var(--app-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease;

  &:hover {
    border-color: var(--app-primary);
  }

  &.is-on {
    border-color: var(--app-primary);
    background-color: color-mix(in srgb, var(--app-primary) 8%, transparent);
  }
}

.tmpl-pick__name {
  font-size: 14px;
  font-weight: 600;
}

.tmpl-pick__meta {
  font-size: 12px;
  color: var(--app-text-secondary);
}

.tmpl-pick__rows {
  display: flex;
  gap: 4px;

  i {
    width: 16px;
    height: 10px;
    border-radius: 2px;
  }
}

.tmpl-pick__note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--app-text-secondary);
}

/* ===== 结果头部 ===== */
.create__res-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;

  .panel__title {
    margin-bottom: 0;
  }
}

/* ===== 队伍配色 ===== */
.team__accent {
  height: 5px;
  border-radius: 10px 10px 0 0;
  margin: -16px -16px 10px;
  background-color: var(--tc, #888);
}

.team__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--tc, #888);
}

.team__limits {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;

  label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--app-text-secondary);
  }
}

.team__limit-input {
  width: 96px;
  height: 26px;
  font-size: 12px;
  padding: 0 8px;
}

/* ===== 多波次 ===== */
.wave {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--app-border);

  &:first-of-type {
    margin-top: 8px;
    padding-top: 0;
    border-top: none;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  &__label {
    font-size: 16px;
    color: var(--app-text);
    position: relative;

    &::before {
      content: "";
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 8px;
      background: var(--app-primary);
    }
  }

  &__meta {
    font-size: 12px;
    color: var(--app-text-secondary);
  }

  .teams {
    margin-top: 4px;
  }
}

/* ===== 队伍区 / 替补区 与拖拽 ===== */
.zone {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;

  &__title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--app-text);

    small {
      font-weight: 400;
      font-size: 11px;
      color: var(--app-text-secondary);
    }
  }

  &__count {
    font-size: 11px;
    color: var(--app-text-secondary);
    background-color: var(--app-border);
    border-radius: 10px;
    padding: 0 8px;
    line-height: 18px;
  }
}

.bench-zone {
  padding: 10px;
  border: 1px dashed var(--app-border);
  border-radius: 8px;
}

.bench__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.bench__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  background-color: var(--app-border);
  font-size: 12px;
  color: var(--app-text);
}

.bench__meta {
  font-size: 11px;
  color: var(--app-text-secondary);
}

.bench__empty {
  font-size: 12px;
  color: var(--app-text-secondary);
}

/* 拖拽手感 */
.drag-grip {
  color: var(--app-text-secondary);
  font-size: 12px;
  letter-spacing: -2px;
  user-select: none;
}

.member-row[draggable="true"],
.bench__chip[draggable="true"] {
  cursor: grab;
}

.member-row.drop-on,
.team.drop-over,
.bench-zone.drop-over {
  outline: 2px dashed var(--app-primary);
  outline-offset: -2px;
  background-color: color-mix(in srgb, var(--app-primary) 10%, transparent);
}

/* ===== 选择参与角色：成员折叠 ===== */
.pick-member {
  &__head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    user-select: none;

    &:hover {
      background-color: color-mix(in srgb, var(--app-border) 45%, transparent);
    }
  }

  &__avatar {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    background-color: var(--app-primary);
  }

  &__name {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--app-text);
  }

  &__meta {
    margin-left: auto;
    font-size: 11px;
    color: var(--app-text-secondary);
    white-space: nowrap;

    b {
      color: var(--app-primary);
    }
  }

  &__chev {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 5px;
    background-color: transparent;
    color: var(--app-text-secondary);
    cursor: pointer;
    transition:
      transform 0.2s ease,
      background-color 0.2s ease;

    &:hover {
      background-color: var(--app-border);
      color: var(--app-text);
    }
  }

  &.is-open .pick-member__chev {
    transform: rotate(180deg);
  }

  &__chars {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 6px 2px 2px 8px;
  }
}

/* ===== 每波：队伍区(左) + 替补区(右) ===== */
.wave__body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;

  > .zone--teams {
    flex: 1 1 0;
    min-width: 360px;
  }

  .bench-zone {
    flex: 0 0 250px;
    width: 250px;
  }
}

/* ===== 结果区：左=各波次队伍，右=合并替补栏 ===== */
.results__layout {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.results__waves {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;

  .wave {
    border-top: 1px dashed var(--app-border);
    padding-top: 12px;

    &:first-child {
      border-top: none;
      padding-top: 0;
    }
  }
}

.bench-zone--global {
  flex: 0 0 320px;
  width: 320px;
  min-height: 180px;
  position: sticky;
  top: 8px;
  max-height: calc(100vh - 100px);
  overflow: auto;
}

@media (max-width: 960px) {
  .bench-zone--global {
    flex: 1 1 100%;
    width: auto;
    position: static;
    max-height: none;
  }
}

/* ===== 指针拖拽交互 ===== */
.member-row,
.bench__chip {
  user-select: none;
}

.member-row {
  cursor: grab;
}

.bench__chip {
  cursor: grab;
}

.drag-target {
  outline: 2px dashed var(--app-primary);
  outline-offset: -2px;
  background-color: color-mix(in srgb, var(--app-primary) 10%, transparent);
}

/* 跟手的“被拖角色”卡片 */
.drag-ghost {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 320px;
  padding: 6px 10px;
  border-radius: 10px;
  background-color: var(--app-surface);
  border: 1px solid var(--app-border);
  box-shadow: 0 6px 20px var(--app-shadow);
  font-size: 13px;
  color: var(--app-text);
  white-space: nowrap;
  opacity: 0.95;
  transform: rotate(2deg);
}

.drag-ghost b {
  font-weight: 600;
}

.drag-ghost__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--app-text-secondary);
  font-size: 12px;
}

/* ===== 结果区：总览式多波网格（行=波次，列=队伍） ===== */
.res-scroll {
  flex: 1 1 0;
  min-width: 0;
  overflow-x: auto;
}

.res-grid {
  display: grid;
  gap: 8px 12px;
  align-items: start;
  min-width: 720px;
}

.res-hd {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 4px 8px 8px;
  font-weight: 600;
  color: var(--app-text);
  border-bottom: 2px solid var(--app-border);
}

.res-hd--round {
  justify-content: center;
  align-self: center;
}

.res-hd__name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;

  b {
    font-size: 13px;
  }
}

.res-hd__limits {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px 6px;
}

.res-hd__limits label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: 10px;
  color: var(--app-text-secondary);
  white-space: nowrap;
}

.res-limit-input {
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 0 4px;
  font-size: 12px;
  text-align: right;
}

.res-round {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  padding: 6px 2px;

  .wave__label {
    font-size: 14px;
  }
}

.res-round__meta {
  font-size: 12px;
  color: var(--app-text-secondary);
  white-space: nowrap;
}

.res-cell {
  position: relative;
  min-height: 60px;
  padding: 6px 8px 8px;
  border-radius: 8px;
  background-color: var(--app-surface);
  border: 1px solid var(--app-border);
  border-left: 3px solid var(--tc);

  &.is-empty {
    background-color: transparent;
    border-style: dashed;
  }
}

.res-cell__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 11px;
}

.res-cell__stat {
  color: var(--app-text-secondary);
}

.res-cell__warn {
  color: var(--app-warn);
}

.res-cell__full {
  color: var(--app-primary);
  font-weight: 600;
}

.res-cell__empty-tip {
  color: var(--app-text-secondary);
  opacity: 0.7;
}

.res-cell__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;

  .member-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 6px;
    background-color: var(--app-bg);
  }

  .member-row__nick {
    font-weight: 600;
    font-size: 13px;
    color: var(--app-text);
  }

  .member-row__meta {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--app-text-secondary);
  }

  .team__empty {
    padding: 12px 0;
    text-align: center;
  }
}

@media (max-width: 960px) {
  .res-scroll {
    width: 100%;
  }
}
</style>
