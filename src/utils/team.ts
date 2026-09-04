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

/** 一个队伍的门槛 */
export interface DraftLimit {
  damageLimit: number;
  healLimit: number;
}

export interface TeamDraft extends DraftLimit {
  id: string;
  name: string;
  items: DraftItem[];
}

/** 由模板队伍配置生成空草稿队（门槛照抄） */
export function emptyDraftsFromTemplate(
  teamConfigs: { id?: string; name?: string; damageLimit: number; healLimit: number }[]
): TeamDraft[] {
  return teamConfigs.map((c, i) => ({
    id: c.id ?? uid(),
    name: c.name || `${i + 1}队`,
    damageLimit: c.damageLimit || 0,
    healLimit: c.healLimit || 0,
    items: [],
  }));
}

/**
 * 就近补齐式分配（在 emptyDraftsFromTemplate 之后调用）：
 * - 目标：**优先补满完整的 4 人队**，而不是把人摊满每支队伍；
 * - 队伍按“伤害门槛降序”处理（红队门槛最高优先拿人，颜色红→蓝）；
 * - 逐队填满：每队先放 1 辅助，再补输出直到 4 人（或无人可用）；
 *   剩余不足 4 人的参与者，落到最后一支被填充的队伍（不满 4 人即“偏队”）；
 * - 选人规则：有满足该队门槛的人就取其中数值最高者；若无人满足（该队无法按限制满员），
 *   则填入距离门槛最近（低于门槛但最高）的角色；
 * - 超过所有队伍容量的人进入替补（bench）。
 */
export function assignByLimits(
  teams: TeamDraft[],
  pool: DraftItem[]
): { teams: TeamDraft[]; bench: DraftItem[] } {
  // 伤害门槛降序作为填充顺序（决定“红→蓝”的档次）
  const ordered = [...teams]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.damageLimit - a.t.damageLimit || a.i - b.i);

  const out: TeamDraft[] = ordered.map(({ t }) => ({ ...t, items: [] }));
  const sup = pool
    .filter((p) => p.character.roleType === "support")
    .sort((a, b) => b.character.score - a.character.score);
  const dps = pool
    .filter((p) => p.character.roleType === "dps")
    .sort((a, b) => b.character.score - a.character.score);

  function take(list: DraftItem[], limit: number): DraftItem | null {
    if (!list.length) return null;
    // 满足门槛的最高者优先；无人满足则取最接近（最高）者
    const meetIdx = list.findIndex(
      (it) => limit <= 0 || it.character.score >= limit
    );
    const idx = meetIdx >= 0 ? meetIdx : 0;
    return list.splice(idx, 1)[0];
  }

  for (const team of out) {
    // 先放 1 辅助
    if (team.items.length < TEAM_SIZE && sup.length) {
      const it = take(sup, team.healLimit);
      if (it) team.items.push(it);
    }
    // 用输出补满至 4 人
    while (team.items.length < TEAM_SIZE && dps.length) {
      const it = take(dps, team.damageLimit);
      if (!it) break;
      team.items.push(it);
    }
    // 若输出已耗尽仍想补满本队，允许辅助顺延进队（尽量凑出满队）
    while (team.items.length < TEAM_SIZE && sup.length) {
      const it = take(sup, team.healLimit);
      if (!it) break;
      team.items.push(it);
    }
    // 已无人可用（人不够）则此后的队伍保持空，剩余不足 4 人时停在当前队
    if (!sup.length && !dps.length) break;
  }

  return { teams: out, bench: [...sup, ...dps] };
}

/** 把草稿队转成持久化的排班队伍快照（含每队门槛） */
export function toScheduleTeams(drafts: TeamDraft[]): Team[] {
  return drafts.map((d) => ({
    id: d.id,
    name: d.name,
    damageLimit: d.damageLimit,
    healLimit: d.healLimit,
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
 * 拆班：**优先把前面的班填满（补满优先）**，同人“连排”降为软偏好。
 * - 参与角色先按“3 输出 + 1 辅助”交错成队列（各自按数值降序），保证每班能凑出 1辅+3出 的队形；
 * - 逐角色放进“最早可入”的班：从第 0 班起找第一个“未满、且不含该成员其它角色”的班，
 *   从而尽量先填满前面的班（班数尽量少、前面的班尽量满员）；
 * - 同一成员的其它角色会在其已占班之后顺延到后续班，自然形成“相邻班次”的软连排；
 *   仅在“塞进最靠前空班不会更亏”的前提下贴近，不强制跨越满班去连排。
 * 注：班数下界 = max(⌈总角色/每班⌉, 单成员最大角色数)（同人不可同班所致）。当存在角色数超过
 *    单班容量的“大号”成员时，其后半段角色必然落到较后的班——为保住前面班满员而接受。
 * 保证：每班人数 ≤ perWave，且每班内每个成员至多一个角色。
 */
export function splitRounds(items: DraftItem[], perWave: number): DraftItem[][] {
  if (!items.length || perWave <= 0) return [];
  if (items.length === 1) return [items];

  const sup = items
    .filter((i) => i.character.roleType === "support")
    .sort((a, b) => b.character.score - a.character.score);
  const dps = items
    .filter((i) => i.character.roleType === "dps")
    .sort((a, b) => b.character.score - a.character.score);

  // 交错队列：3 输出 + 1 辅助（数值降序）
  const ordered: DraftItem[] = [];
  let si = 0;
  let di = 0;
  while (si < sup.length || di < dps.length) {
    for (let k = 0; k < 3 && di < dps.length; k++) ordered.push(dps[di++]);
    if (si < sup.length) ordered.push(sup[si++]);
  }

  const waves: DraftItem[][] = [];
  const memberUsedInWave = new Map<string, Set<number>>();

  for (const it of ordered) {
    let used = memberUsedInWave.get(it.memberId);
    if (!used) {
      used = new Set();
      memberUsedInWave.set(it.memberId, used);
    }
    let placed = false;
    for (let w = 0; w < waves.length; w++) {
      if (waves[w].length >= perWave) continue; // 该班已满
      if (used.has(w)) continue; // 该成员已在此班（同人不同班）
      waves[w].push(it);
      used.add(w);
      placed = true;
      break;
    }
    if (!placed) {
      const w = waves.length;
      waves.push([it]);
      used.add(w);
    }
  }
  return waves;
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
