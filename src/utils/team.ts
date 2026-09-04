import type { Character, Team } from "../types/schedule";
import { effScore, uid } from "../types/schedule";

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
  /** 本队“总伤害”下限：队内输出有效伤害合计需 ≥ 此值（0=不限） */
  totalDamageLimit?: number;
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
    totalDamageLimit?: number
    minDps?: number
    minSup?: number
  }[]
): TeamDraft[] {
  return teamConfigs.map((c, i) => ({
    id: c.id ?? uid(),
    name: c.name || `${i + 1}队`,
    damageLimit: c.damageLimit || 0,
    healLimit: c.healLimit || 0,
    totalDamageLimit: c.totalDamageLimit || 0,
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
    .sort((a, b) => effScore(b.character.job, b.character.score) - effScore(a.character.job, a.character.score))
  const dps = pool
    .filter((p) => p.character.roleType === "dps")
    .sort((a, b) => effScore(b.character.job, b.character.score) - effScore(a.character.job, a.character.score))

  const roleCount = (items: DraftItem[], role: "dps" | "support") =>
    items.filter((x) => x.character.roleType === role).length

  /**
   * 取一名角色：列表已按分数降序。只按定位 + 门槛取人（不区分细分职业）：
   * 优先取满足门槛的第一个（即满足者中分数最高）；整池无人达标则就近补位取最高（列表头）。
   */
  function take(list: DraftItem[], limit: number): DraftItem | null {
    if (!list.length) return null
    let idx = list.findIndex((it) => limit <= 0 || effScore(it.character.job, it.character.score) >= limit)
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
  // 是否有队伍要求“总伤害下限”→ 启用“总伤均衡分配”
  const dmgBalanced = active.some((t) => (t.totalDamageLimit ?? 0) > 0)
  if (dmgBalanced) {
    // —— 均衡模式：把最强输出“蛇形轮流”分给各队，避免高分全堆在首队——
    // 每轮按“总伤害目标从高到低”决定谁先选（目标 0=不限 的队伍排最后当吸收池），
    // 各队每轮各取当前池中一名最强，直到队伍满员或输出耗尽。
    // 效果：顶级 C 均匀错开到各队，各队总伤既贴近各自目标又彼此均衡；
    // 目标高的队伍因每轮先手会拿到略强的组合（与其更高的门槛一致）。
    const priority = active
      .map((t, i) => ({ t, i }))
      .sort((a, b) => (b.t.totalDamageLimit ?? 0) - (a.t.totalDamageLimit ?? 0) || a.i - b.i)
      .map((x) => x.t)
    let guard = 0
    while (dps.length && guard++ < priority.length * TEAM_SIZE) {
      let placed = false
      for (const team of priority) {
        if (team.items.length >= TEAM_SIZE) continue
        const outSeats = TEAM_SIZE - roleCount(team.items, "support")
        if (roleCount(team.items, "dps") >= outSeats) continue
        const it = take(dps, team.damageLimit)
        if (!it) break
        team.items.push(it)
        placed = true
      }
      if (!placed) break
    }
  } else {
    // 原逻辑（没有队伍设总伤害目标时保持既有行为）
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
    totalDamageLimit: d.totalDamageLimit || 0,
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

/** 队伍内输出的“有效伤害合计”（总伤害下限校验用，与展示/比较同口径） */
export function totalDmgEff(items: DraftItem[]): number {
  return items.reduce(
    (s, it) => (it.character.roleType === "dps" ? s + effScore(it.character.job, it.character.score) : s),
    0,
  );
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
  carHeader = 0,
  balance = false,
): { waves: DraftItem[][]; bench: DraftItem[] } {
  if (!items.length || perWave <= 0) return { waves: [], bench: [] }
  if (items.length === 1) return { waves: [items], bench: [] }

  const isSup = (i: DraftItem) => i.character.roleType === "support"
  /** 车头：达到“车头伤害限制”的输出（每班尽量只放 1 个，避免大C扎堆同班） */
  const isCar = (i: DraftItem) =>
    carHeader > 0 && !isSup(i) && effScore(i.character.job, i.character.score) >= carHeader
  const effOf = (i: DraftItem) => effScore(i.character.job, i.character.score)
  const memberCount = new Set(items.map((i) => i.memberId)).size
  // 计划班数：纯按模板容量（不考虑成员/奶等规则）
  const targetW = Math.max(1, Math.ceil(items.length / perWave))
  // 每班最多可坐人数：同人每班 1 号 → 受“参与成员数”限制
  const seat = Math.max(1, Math.min(perWave, memberCount))
  // 每班先配的辅助数 = 该班最多能组成的满编(4人)队数（保底 1）
  const supPerWave = Math.max(1, Math.floor(seat / TEAM_SIZE))

  // 辅助按有效奶量降序：靠前班次（红队所在）优先分到大奶
  const remSup = items.filter(isSup).sort((a, b) => effOf(b) - effOf(a))
  // 车头池按有效伤害降序：第 1 班先拿全局最高，第 2 班次高 …（保证各班都有最强C）
  const carPool = items.filter(isCar).sort((a, b) => effOf(b) - effOf(a))
  // 普通输出（未达车头限制）
  const remDps = items.filter((i) => !isSup(i) && !isCar(i))
  if (balance) remDps.sort((a, b) => effOf(b) - effOf(a))

  /** 从列表中取第一个“成员尚未在本班出现”的角色（保持原顺序，确保每班各成员至多 1 号） */
  const takeDistinct = (arr: DraftItem[], members: Set<string>): DraftItem | null => {
    const i = arr.findIndex((p) => !members.has(p.memberId))
    if (i < 0) return null
    return arr.splice(i, 1)[0]
  }

  if (!balance) {
    // —— 原分班逻辑（保持既有行为）——
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
      // ①.5 车头：每班放至多 1 个“剩余最强”车头
      {
        const car = takeDistinct(carPool, members)
        if (car && wave.length < seat) {
          wave.push(car)
          members.add(car.memberId)
        }
      }
      // ② 用普通输出把班补满（每班各成员至多 1 号）
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
    // 计划班数用尽后仍未放下的角色 → 替补区（未用完的车头排前，留给缺车头的班/手动）
    const bench = [...remSup, ...carPool, ...remDps]
    return { waves, bench }
  }

  // —— 跨班均衡模式（balance=true）——
  // 建班并预放“辅助 + 每班 1 车头”
  const waves: DraftItem[][] = []
  const waveMembers: Set<string>[] = []
  const totals: number[] = []
  for (let w = 0; w < targetW; w++) {
    const wave: DraftItem[] = []
    const members = new Set<string>()
    while (wave.length < seat && wave.length < supPerWave) {
      const s = takeDistinct(remSup, members)
      if (!s) break
      wave.push(s)
      members.add(s.memberId)
    }
    {
      const car = takeDistinct(carPool, members)
      if (car && wave.length < seat) {
        wave.push(car)
        members.add(car.memberId)
      }
    }
    waves.push(wave)
    waveMembers.push(members)
    totals.push(totalDmgEff(wave))
  }
  // 最空优先：从“最强普通输出”起，逐个放进“累计总伤最低且还能再坐”的班
  // → 各班获得的中强输出数量/伤害趋于平均，各班（红队）总伤不再两极分化
  let i = 0
  while (i < remDps.length) {
    let hasRoom = false
    for (let w = 0; w < waves.length; w++) {
      if (waves[w].length < seat) {
        hasRoom = true
        break
      }
    }
    if (!hasRoom) break
    const it = remDps[i]
    let best = -1
    let bestTot = Infinity
    for (let w = 0; w < waves.length; w++) {
      const wave = waves[w]
      if (wave.length >= seat) continue
      if (waveMembers[w].has(it.memberId)) continue
      if (totals[w] < bestTot) {
        bestTot = totals[w]
        best = w
      }
    }
    if (best < 0) {
      i++ // 该角色与所有未满班同人冲突 → 留替补
      continue
    }
    waves[best].push(it)
    waveMembers[best].add(it.memberId)
    totals[best] += effOf(it)
    remDps.splice(i, 1)
  }
  // 末尾：仍未满的班用多余辅助补位（减少无谓替补）
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w]
    const members = waveMembers[w]
    while (wave.length < seat) {
      const s = takeDistinct(remSup, members)
      if (!s) break
      wave.push(s)
      members.add(s.memberId)
    }
  }
  const bench = [...remSup, ...carPool, ...remDps]
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
