/**
 * 队伍配色：按“伤害门槛从高到低”排序，依次为 红 → 黄 → 绿 → 蓝。
 * 队伍超过 4 支时按该顺序循环。
 */
export const TEAM_COLOR_RED = "#e03131";
export const TEAM_COLOR_YELLOW = "#f59f00";
export const TEAM_COLOR_GREEN = "#2f9e44";
export const TEAM_COLOR_BLUE = "#1971c2";

export const TEAM_COLORS = [
  TEAM_COLOR_RED,
  TEAM_COLOR_YELLOW,
  TEAM_COLOR_GREEN,
  TEAM_COLOR_BLUE,
];

export interface TeamLike {
  id: string;
  damageLimit: number;
}

export interface ColorizedTeam<T extends TeamLike> {
  team: T;
  /** 排名 0 为伤害门槛最高 */
  rank: number;
  color: string;
}

/** 按伤害门槛从高到低排序并上色（门槛并列时按原顺序） */
export function colorizeTeams<T extends TeamLike>(teams: T[]): ColorizedTeam<T>[] {
  const sorted = teams
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) => b.t.damageLimit - a.t.damageLimit || a.i - b.i
    );
  return sorted.map(({ t }, rank) => ({
    team: t,
    rank,
    color: TEAM_COLORS[rank % TEAM_COLORS.length],
  }));
}
