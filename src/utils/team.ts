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
 * - 目标：**优先补满完整的 4 人队**，而不是把人摊满每支队伍；
 * - 队伍按“伤害门槛降序”处理（红队门槛最高优先拿人，颜色红→蓝）；
 * - 每队填人顺序：
 *   ① 保证最少辅助数（minSup，默认 1，**辅助以 minSup 为上限，不超编**）；
 *   ② 保证最少输出数（minDps，默认 0）；
 *   ③ 剩余空位**仅以输出补满**到 4 人；输出不足则宁缺（不额外补辅助）；
 * - **宁缺不开碎队**：第一队（红）允许不满员；从第二队起，若剩余池不足一整队
 *   （< TEAM_SIZE）则不再开新队，其余一律进替补——避免“黄/绿单挂 1 人碎队”；
 * - 取人时满足门槛者优先（取最高）；无人满足则就近补位（低于门槛但最高）；
 * - 队内细分职业**尽量不重复**（软偏好，必要时才允许同职业）；
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

  /** 取一名角色：满足门槛取最高分；否则就近补位；同分/同满足优先选“队内没出现过的职业” */
  function take(
    list: DraftItem[],
    limit: number,
    usedJobs: Set<string>
  ): DraftItem | null {
    if (!list.length) return null
    let meet = list.findIndex(
      (it) => limit <= 0 || it.character.score >= limit
    )
    if (meet < 0) meet = list.length
    let idx = -1
    // 满足门槛且职业不重复者优先
    for (let i = meet; i < list.length; i++) {
      if (!usedJobs.has(list[i].character.job)) {
        idx = i
        break
      }
    }
    // 满足门槛但职业都有重复 → 取满足者最高
    if (idx < 0 && meet < list.length) idx = meet
    // 无人满足：就近补位，尽量职业不重复
    if (idx < 0) {
      for (let i = 0; i < meet; i++) {
        if (!usedJobs.has(list[i].character.job)) {
          idx = i
          break
        }
      }
      if (idx < 0) idx = 0
    }
    const it = list.splice(idx, 1)[0]
    usedJobs.add(it.character.job)
    return it
  }

  for (let ti = 0; ti < out.length; ti++) {
    const team = out[ti]
    // 宁缺不开碎队：第二队起剩余不足一整队即停（其余人进替补）
    if (ti > 0 && sup.length + dps.length < TEAM_SIZE) break
    const usedJobs = new Set<string>()
    const minSup = team.minSup ?? 1
    const minDps = team.minDps ?? 0
    // ① 保证最少辅助数
    while (
      team.items.length < TEAM_SIZE &&
      roleCount(team.items, "support") < minSup &&
      sup.length
    ) {
      const it = take(sup, team.healLimit, usedJobs)
      if (!it) break
      team.items.push(it)
    }
    // ② 保证最少输出数
    while (
      team.items.length < TEAM_SIZE &&
      roleCount(team.items, "dps") < minDps &&
      dps.length
    ) {
      const it = take(dps, team.damageLimit, usedJobs)
      if (!it) break
      team.items.push(it)
    }
    // ③ 剩余空位仅以输出补满（辅助不超过 minSup，宁缺不超编）
    while (team.items.length < TEAM_SIZE && dps.length) {
      const it = take(dps, team.damageLimit, usedJobs)
      if (!it) break
      team.items.push(it)
    }
    // 已无人可用则此后的队伍保持空
    if (!sup.length && !dps.length) break
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
 * 拆班：按“每班=每成员各出 1 个号”逐班铺排（同人每班至多 1 号），**满员优先**。
 * - 每班容量 = min(perWave, 可排成员数)：同人不可同班 → 每班人数上限被“成员数”锁死；
 * - 逐班（wave）填充：每班把“仍有号可出”的成员（按剩余号数降序取前 cap 名）各取 1 个号，
 *   因此前面的班总是最满、越靠后越稀疏（满员优先 + 班数下界=单成员最大号数的物理约束）；
 * - **每班至多 1 个辅助**：每班从“仍有未用辅助”的成员中，轮转选出“距上次出奶最久”者作
 *   奶提供者（其辅助按分数降序取队首），其余成员该班给出分数最高的输出；
 *   奶用尽后（或成员无奶可出时）剩余班次全部为输出（宁缺不加第二奶）；
 * - 成员在自己有号的每个班都出 1 个号 → 同人各号落在**连续相邻班次**（天然软连排），
 *   且各号不会落回其已出过的班（同人不同班保证）。
 * 保证：每班人数 ≤ perWave，且每班内每个成员至多一个角色。
 */
export function splitRounds(items: DraftItem[], perWave: number): DraftItem[][] {
  if (!items.length || perWave <= 0) return [];
  if (items.length === 1) return [items];

  const isSup = (i: DraftItem) => i.character.roleType === "support";
  const memberCount = new Set(items.map((i) => i.memberId)).size;
  const cap = Math.max(1, Math.min(perWave, memberCount));

  // 按成员归堆：每人辅助/输出分开排队（各自按分数降序）
  interface Pile {
    memberId: string
    order: number // 稳定的原始次序，用于并列时的确定性
    sups: DraftItem[]
    dps: DraftItem[]
  }
  const byMember = new Map<string, Pile>()
  items.forEach((it, i) => {
    let p = byMember.get(it.memberId)
    if (!p) {
      p = { memberId: it.memberId, order: i, sups: [], dps: [] }
      byMember.set(it.memberId, p)
    }
    ;(isSup(it) ? p.sups : p.dps).push(it)
  })
  const order = [...byMember.values()].sort(
    (a, b) => b.sups.length + b.dps.length - (a.sups.length + a.dps.length) || a.order - b.order,
  )
  const remaining = (p: Pile) => p.sups.length + p.dps.length
  order.forEach((p) => {
    p.sups.sort((a, b) => b.character.score - a.character.score)
    p.dps.sort((a, b) => b.character.score - a.character.score)
  })

  const waves: DraftItem[][] = []
  /** 每名成员上次出奶的班次（用于“距上次出奶最久者”轮转） */
  const lastSupAt = new Map<string, number>()

  while (order.some((p) => remaining(p) > 0)) {
    const w = waves.length
    // 本班在役成员：仍有号者，按剩余号数降序取前 cap 名（满员优先）
    const active = order
      .filter((p) => remaining(p) > 0)
      .sort(
        (a, b) => remaining(b) - remaining(a) || b.sups.length + b.dps.length - (a.sups.length + a.dps.length) || a.order - b.order,
      )
      .slice(0, cap)

    // 选奶提供者：有未用辅助的成员中“距上次出奶最久”者（保证奶在各班轮转、尽量靠前班带奶）
    let provider: Pile | null = null
    let bestGap = -1
    for (const p of active) {
      if (!p.sups.length) continue
      const gap = w - (lastSupAt.get(p.memberId) ?? -1)
      if (gap > bestGap) {
        bestGap = gap
        provider = p
      }
    }

    const wave: DraftItem[] = []
    const used = new Set<string>()
    if (provider) {
      wave.push(provider.sups.shift()!)
      used.add(provider.memberId)
      lastSupAt.set(provider.memberId, w)
    }
    for (const p of active) {
      if (used.has(p.memberId)) continue
      if (p.dps.length) {
        wave.push(p.dps.shift()!)
        used.add(p.memberId)
      }
      // 无输出可出（只剩辅助）且非本次奶提供者 → 本班缺席，奶留待其轮到提供时再出
    }
    if (!wave.length) break // 防御：不该出现
    waves.push(wave)
  }
  return waves
}

/** 与 splitRounds 完全同规则，只返回需要的班次数（用于界面预估） */
export function estimateWaveCount(items: DraftItem[], perWave: number): number {
  return splitRounds(items, perWave).length;
}

/** 提示某队伍组成是否“合规” 1辅助+3输出 */
export function isIdealTeam(items: DraftItem[]): boolean {
  const c = teamCounts(items);
  return c.support === SUPPORT_PER_TEAM && c.dps === DPS_PER_TEAM;
}
