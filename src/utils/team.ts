import type { Character, Team } from "../types/schedule";
import { uid } from "../types/schedule";

/** 规则：每队默认 1 辅助 + 3 输出 */
export const TEAM_SIZE = 4;
export const DPS_PER_TEAM = 3;
export const SUPPORT_PER_TEAM = 1;

export interface DraftItem {
  memberId: string;
  character: Character;
}

/** 一个队伍的门槛与人数配额 */
export interface DraftLimit {
  damageLimit: number;
  healLimit: number;
  /** 本队最少输出角色数（0=不要求） */
  minDps: number;
  /** 本队最少辅助角色数（0=不要求） */
  minSup: number;
}

export interface TeamDraft extends DraftLimit {
  id: string;
  name: string;
  items: DraftItem[];
}

/** 由模板队伍配置生成空草稿队（门槛 + 输出/辅助最少人数照抄；缺省 输出0 / 辅助1） */
export function emptyDraftsFromTemplate(
  teamConfigs: {
    id?: string
    name?: string
    damageLimit: number
    healLimit: number
    minDps?: number
    minSup?: number
  }[]
): TeamDraft[] {
  return teamConfigs.map((c, i) => ({
    id: c.id ?? uid(),
    name: c.name || `${i + 1}队`,
    damageLimit: c.damageLimit || 0,
    healLimit: c.healLimit || 0,
    minDps: c.minDps ?? 0,
    minSup: c.minSup ?? 1,
    items: [],
  }))
}

/**
 * 就近补齐式分配（在 emptyDraftsFromTemplate 之后调用）：
 * - 队伍按“伤害门槛降序”处理（红队门槛最高优先拿人，颜色红→蓝）；
 * - **分两个阶段取人**：
 *   ① **辅助先行**：红队 → 黄队 → …，先把各队需要的辅助（minSup，以 minSup 为上限不超编）补齐；
 *      直到“辅助无法再进行排班”（辅助池耗尽 / 各启用队配额已满足）即停止；
 *   ② **再排输出**（规则同辅助）：同样红队 → 黄队 → …，先满足各队最少输出（minDps），
 *      再把每队补到 4 人（仅以输出补，宁缺不额外补辅助）；
 * - **宁缺不开碎队**：第一队（红）允许不满员；从第二队起剩余池不足一整队（< TEAM_SIZE）
 *   则不再开该队及后续队伍，其余一律进替补——避免“黄/绿单挂 1 人碎队”；
 * - 取人时满足门槛者优先（取最高）；无人满足则就近补位（低于门槛但最高）；
 * - **只按定位选人**：队内不区分细分职业(job)，仅按 输出/辅助 定位 + 门槛/分数 取人；
 * - 超过所有队伍容量的人进入替补（bench）。
 */
export function assignByLimits(
  teams: TeamDraft[],
  pool: DraftItem[]
): { teams: TeamDraft[]; bench: DraftItem[] } {
  // 伤害门槛降序作为填充顺序（决定“红→蓝”的档次）
  const ordered = [...teams]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.damageLimit - a.t.damageLimit || a.i - b.i)

  const out: TeamDraft[] = ordered.map(({ t }) => ({ ...t, items: [] }))
  const sup = pool
    .filter((p) => p.character.roleType === "support")
    .sort((a, b) => b.character.score - a.character.score)
  const dps = pool
    .filter((p) => p.character.roleType === "dps")
    .sort((a, b) => b.character.score - a.character.score)

  const roleCount = (items: DraftItem[], role: "dps" | "support") =>
    items.filter((x) => x.character.roleType === role).length

  /**
   * 取一名角色：列表已按分数降序。只按定位 + 门槛取人（不区分细分职业）：
   * 优先取满足门槛的第一个（即满足者中分数最高）；整池无人达标则就近补位取最高（列表头）。
   */
  function take(list: DraftItem[], limit: number): DraftItem | null {
    if (!list.length) return null
    let idx = list.findIndex((it) => limit <= 0 || it.character.score >= limit)
    if (idx < 0) idx = 0
    return list.splice(idx, 1)[0]
  }

  // 宁缺：先按“每队满编 4 人”沿顺序预估“会启用”的队伍数（红队允许不满员；之后不足一整队即停）
  let openN = 0
  let rem = sup.length + dps.length
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && rem < TEAM_SIZE) break
    openN++
    rem -= TEAM_SIZE
  }
  const active = out.slice(0, Math.max(openN, 1))
  if (active.length > out.length) active.length = out.length

  // 阶段① 辅助先行：红队 → 黄队 → …，各队保 minSup（不超编），直到辅助无法再排
  for (const team of active) {
    const minSup = team.minSup ?? 1
    while (team.items.length < TEAM_SIZE && roleCount(team.items, "support") < minSup && sup.length) {
      const it = take(sup, team.healLimit)
      if (!it) break
      team.items.push(it)
    }
  }
  // 阶段② 输出保底：红队 → 黄队 → …，先满足各队 minDps
  for (const team of active) {
    const minDps = team.minDps ?? 0
    while (team.items.length < TEAM_SIZE && roleCount(team.items, "dps") < minDps && dps.length) {
      const it = take(dps, team.damageLimit)
      if (!it) break
      team.items.push(it)
    }
  }
  // 阶段③ 输出补满到 4 人（仅输出，宁缺不补辅助）
  for (const team of active) {
    while (team.items.length < TEAM_SIZE && dps.length) {
      const it = take(dps, team.damageLimit)
      if (!it) break
      team.items.push(it)
    }
  }
  // 宁缺兜底：非首队若最终仍凑不满一整队（输出不足导致只拿到辅助/少数输出），整队退回替补，避免碎队
  for (let i = 1; i < active.length; i++) {
    const team = active[i]
    if (team.items.length && team.items.length < TEAM_SIZE) {
      while (team.items.length) {
        const it = team.items.pop()!
        ;(it.character.roleType === "support" ? sup : dps).push(it)
      }
    }
  }

  return { teams: out, bench: [...sup, ...dps] }
}

/** 把草稿队转成持久化的排班队伍快照（含每队门槛与输出/辅助配额） */
export function toScheduleTeams(drafts: TeamDraft[]): Team[] {
  return drafts.map((d) => ({
    id: d.id,
    name: d.name,
    damageLimit: d.damageLimit,
    healLimit: d.healLimit,
    minDps: d.minDps,
    minSup: d.minSup,
    members: d.items.map((it) => {
      const c = it.character;
      return {
        memberId: it.memberId,
        characterId: c.id,
        memberName: "", // 由调用方回填
        nickname: c.nickname,
        roleType: c.roleType,
        job: c.job,
        fame: c.fame,
        score: c.score,
      };
    }),
  }));
}

export function teamCounts(items: DraftItem[]) {
  return {
    dps: items.filter((i) => i.character.roleType === "dps").length,
    support: items.filter((i) => i.character.roleType === "support").length,
  };
}

/**
 * 拆班：**先按模板容量定“计划班数”，再按班填充（每班配足该班可组队伍所需的辅助）**。
 * - 计划班数 = ⌈总角色 / perWave⌉（纯按“模板参与人数上限”，不因成员数/奶等规则而增加）；
 * - 每班容量 seat = min(perWave, 参与成员数)，且同人每班至多 1 号；
 * - **辅助先行（按班）**：每班先放“该班能组满编队所需的辅助数” = max(1, ⌊seat/4⌋)
 *   （即 12 人班放 3 奶、8 人班放 2 奶、不足 4 人班放 1 奶），各奶来自不同成员；
 *   这样后续组队阶段可“先红队辅助 → 黄队辅助 → …”，每支可开队伍都有辅助；
 * - 辅助不足时后面的班才会缺奶（宁缺）；随后用输出把班补满，成员不足则少填；
 * - 计划班数用完后剩余角色进入替补 bench；班数本身不随规则膨胀。
 */
export function splitRounds(
  items: DraftItem[],
  perWave: number,
): { waves: DraftItem[][]; bench: DraftItem[] } {
  if (!items.length || perWave <= 0) return { waves: [], bench: [] }
  if (items.length === 1) return { waves: [items], bench: [] }

  const isSup = (i: DraftItem) => i.character.roleType === "support"
  const memberCount = new Set(items.map((i) => i.memberId)).size
  // 计划班数：纯按模板容量（不考虑成员/奶等规则）
  const targetW = Math.max(1, Math.ceil(items.length / perWave))
  // 每班最多可坐人数：同人每班 1 号 → 受“参与成员数”限制
  const seat = Math.max(1, Math.min(perWave, memberCount))
  // 每班先配的辅助数 = 该班最多能组成的满编(4人)队数（保底 1）
  const supPerWave = Math.max(1, Math.floor(seat / TEAM_SIZE))

  const remSup = items.filter(isSup)
  const remDps = items.filter((i) => !isSup(i))

  /** 从列表中取第一个“成员尚未在本班出现”的角色（保持原顺序，确保每班各成员至多 1 号） */
  const takeDistinct = (arr: DraftItem[], members: Set<string>): DraftItem | null => {
    const i = arr.findIndex((p) => !members.has(p.memberId))
    if (i < 0) return null
    return arr.splice(i, 1)[0]
  }

  const waves: DraftItem[][] = []
  for (let w = 0; w < targetW; w++) {
    const wave: DraftItem[] = []
    const members = new Set<string>()
    // ① 辅助先行：每班先放 supPerWave 个辅助（来自不同成员）
    while (wave.length < seat && wave.length < supPerWave) {
      const s = takeDistinct(remSup, members)
      if (!s) break
      wave.push(s)
      members.add(s.memberId)
    }
    // ② 用输出把班补满（每班各成员至多 1 号）
    while (wave.length < seat) {
      const d = takeDistinct(remDps, members)
      if (!d) break
      wave.push(d)
      members.add(d.memberId)
    }
    // ③ 输出不足以满员时，可用多余辅助补位（减少无谓替补）
    while (wave.length < seat) {
      const s = takeDistinct(remSup, members)
      if (!s) break
      wave.push(s)
      members.add(s.memberId)
    }
    if (!wave.length) break
    waves.push(wave)
  }
  // 计划班数用尽后仍未放下的角色 → 替补区
  const bench = [...remSup, ...remDps]
  return { waves, bench }
}

/**
 * 需要的班次数（与 splitRounds 的计划一致）：只按“模板每班人数上限”算 ⌈总角色 / perWave⌉，
 * 不因成员数/奶等规则膨胀；放不进这些班的角色会进入替补区。
 */
export function estimateWaveCount(items: DraftItem[], perWave: number): number {
  if (!items.length || perWave <= 0) return 0
  return Math.max(1, Math.ceil(items.length / perWave))
}

/** 提示某队伍组成是否“合规” 1辅助+3输出 */
export function isIdealTeam(items: DraftItem[]): boolean {
  const c = teamCounts(items);
  return c.support === SUPPORT_PER_TEAM && c.dps === DPS_PER_TEAM;
}
