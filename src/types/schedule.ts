/** 角色定位：输出 / 辅助 */
export type RoleType = "dps" | "support";

/** 一个成员名下的角色 */
export interface Character {
  id: string;
  /** 角色昵称 */
  nickname: string;
  /** 定位：输出 or 辅助 */
  roleType: RoleType;
  /** 细分职业（如：狂战士 / 炽天使） */
  job: string;
  /** 名望 */
  fame: number;
  /** 输出为“伤害”，辅助为“奶量” */
  score: number;
}

/** 成员：一个人可有多个角色 */
export interface Member {
  id: string;
  /** 昵称 */
  nickname: string;
  /** 是否可排班 */
  schedulable: boolean;
  characters: Character[];
}

/** 已排入队伍的“快照角色”（排班历史里记录当时的角色数据） */
export interface ScheduledSlot {
  memberId: string;
  characterId: string;
  /** 快照 */
  memberName: string;
  nickname: string;
  roleType: RoleType;
  job: string;
  fame: number;
  score: number;
}

export interface Team {
  id: string;
  /** 队伍名，如 “红队” */
  name: string;
  members: ScheduledSlot[];
  /** 本队输出伤害门槛（0=不限） */
  damageLimit: number;
  /** 本队辅助奶量门槛（0=不限） */
  healLimit: number;
  /** 本队“总伤害”下限：队内输出有效伤害合计需 ≥ 此值（0=不限） */
  totalDamageLimit?: number;
  /** 本队最少输出角色数（0=不要求） */
  minDps?: number;
  /** 本队最少辅助角色数（0=不要求） */
  minSup?: number;
}

export interface Schedule {
  id: string;
  /** 排班时间（datetime-local 字符串） */
  time: string;
  /** 副本名（可选；旧数据保留展示，新建排班不再填写） */
  dungeon?: string;
  createdAt: number;
  /** 生成时使用的模板 id（可选） */
  templateId?: string;
  /** 模板名快照 */
  templateName?: string;
  /** 车头伤害限制快照（保存时模板的 carHeader；0/缺省=未启用，供历史预览判定车头） */
  carHeader?: number;
  /** 同一批排班的分组 id（多班次时各“班”共享一个 groupId） */
  groupId?: string;
  /** 若为多班次，本记录是哪一班（如 “第 1 班”） */
  roundLabel?: string;
  /** 班次序号（从 1 起） */
  roundIndex?: number;
  /** 参与人数上限 */
  maxMembers: number;
  /** 旧版字段：每队统一输出门槛（保留兼容），新数据以 teams[].damageLimit 为准 */
  teamDamageLimit?: number;
  /** 旧版字段：每队统一辅助门槛（保留兼容） */
  teamHealLimit?: number;
  teams: Team[];
  /** 替补区角色快照（整组合并替补，保存在组内第一场；可选，兼容旧数据） */
  bench?: ScheduledSlot[];
}

/** 模板中的一个队伍配置 */
export interface TemplateTeam {
  id: string;
  name: string;
  /** 该队输出伤害门槛（0=不限） */
  damageLimit: number;
  /** 该队辅助奶量门槛（0=不限） */
  healLimit: number;
  /** 该队“总伤害”下限：队内输出有效伤害合计需 ≥ 此值（0=不限） */
  totalDamageLimit?: number;
  /** 该队最少输出角色数（0=不要求） */
  minDps?: number;
  /** 该队最少辅助角色数（0=不要求） */
  minSup?: number;
}

/** 排班模板：规定参与人数 + 每个队伍各自的伤害/奶量限制 */
export interface Template {
  id: string;
  name: string;
  /** 目标参与人数上限 */
  maxMembers: number;
  teams: TemplateTeam[];
  /** 最低伤害限制：低于此分的输出不参与自动排班（仅可手动拖；0=不限） */
  minDamage?: number;
  /** 最低奶量限制：低于此分的辅助不参与自动排班（仅可手动拖；0=不限） */
  minHeal?: number;
  /** 车头伤害限制：伤害≥此分的输出视为“车头”，自动排班时每班红队尽量只放 1 个车头（0=关闭） */
  carHeader?: number;
}

/** 整包持久化数据 */
export interface AppData {
  version: 1;
  members: Member[];
  schedules: Schedule[];
  templates: Template[];
}

export function emptyData(): AppData {
  return {
    version: 1,
    members: [],
    schedules: [],
    templates: [],
  };
}

/** 定位中文名 */
export function roleLabel(t: RoleType): string {
  return t === "dps" ? "输出" : "辅助";
}

/** 数值含义标签：输出=伤害，辅助=奶量 */
export function statLabel(t: RoleType): string {
  return t === "dps" ? "伤害(千亿)" : "奶量";
}

/** 排班展示名：创建日期（年月日）+ 模板名，如 “2026-09-04 困难团本(4队)” */
export function scheduleTitle(s: {
  createdAt: number;
  templateName?: string;
}): string {
  const d = new Date(s.createdAt);
  const date = Number.isFinite(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "日期未知";
  const name = (s.templateName ?? "").trim();
  return name ? `${date} ${name}` : `${date} 排班`;
}

/** 细分职业建议（可直接输入自定义职业） */
export const JOB_kIND: Record<RoleType, string[]> = {
  dps: [
    "红眼",
    "剑魂",
    "瞎子",
    "鬼泣",
    "剑影",

    "剑宗",
    "剑帝",
    "剑魔",
    "暗帝",
    "刃影",

    "男街霸",
    "男气功",
    "男柔道",
    "乌鸡",

    "女街霸",
    "女柔道",
    "女气功",
    "武神",

    "男漫游",
    "男机械",
    "男大枪",
    "男弹药",
    "合金",

    "女漫游",
    "女机械",
    "女大枪",
    "女弹药",

    "审判",
    "蓝拳",
    "驱魔",
    "四叔",

    "放火奶",
    "泥鳅奶",
    "四姨",
    "女拳",

    "魔皇",
    "冰姐",
    "血法",
    "次元",
    "风法",

    "元素",
    "召唤",
    "战法",
    "魔道",

    "关羽",
    "赵云",
    "光枪",
    "暗枪",

    "帕拉甲",
    "帕拉乙",
    "帕拉丙",
    "帕拉丁",

    "死灵",
    "刺客",
    "忍者",
    "鹦鹉",

    "暗刃",
    "佣兵",
    "源神",
    "特工",

    "旅人",
    "猎人",
    "妖护使",
    "奇美拉",

    "破浪者",

    "鼠标妹",
    "尬舞男",
  ],
  support: [
    "奶爸",
    "奶妈",
    "奶萝",
    "奶弓",
    "奶枪",
  ],
};

export const JOB_COEFFICIENT: Record<string, number> = {
  "红眼": 1.09,
  "剑魂": 1.29,
  "瞎子": 1.17,
  "鬼泣": 1.22,
  "剑影": 1.18,

  "剑宗": 1.25,
  "剑帝": 1.10,
  "剑魔": 1.00,
  "暗帝": 1.18,
  "刃影": 1.01,

  "男街霸": 1.18,
  "男气功": 1.30,
  "男柔道": 1.02,
  "乌鸡": 1.39,

  "女街霸": 1.30,
  "女柔道": 1.13,
  "女气功": 1.17,
  "武神": 1.32,

  "男漫游": 1.27,
  "男机械": 1.11,
  "男大枪": 1.11,
  "男弹药": 1.31,
  "合金": 1.43,

  "女漫游": 1.09,
  "女机械": 1.13,
  "女大枪": 1.12,
  "女弹药": 1.86,

  "审判": 1.25,
  "蓝拳": 1.17,
  "驱魔": 1.15,
  "四叔": 1.09,

  "团长": 1.05,
  "巫女": 1.13,
  "四姨": 1.14,
  "女拳": 1.18,

  "魔皇": 1.35,
  "冰姐": 1.20,
  "血法": 1.15,
  "次元": 1.03,
  "风法": 1.38,

  "元素": 1.24,
  "召唤": 1.20,
  "战法": 1.29,
  "魔道": 1.24,

  "关羽": 1.23,
  "赵云": 1.25,
  "光枪": 1.13,
  "暗枪": 1.17,

  "帕拉甲": 1.31,
  "帕拉乙": 1.09,
  "帕拉丙": 1.13,
  "帕拉丁": 1.22,

  "死灵": 1.17,
  "刺客": 1.33,
  "忍者": 1.23,
  "鹦鹉": 1.25,

  "暗刃": 1.06,
  "佣兵": 1.04,
  "源神": 1.21,
  "特工": 1.20,

  "旅人": 1.20,
  "猎人": 1.22,
  "妖护使": 1.07,
  "奇美拉": 1.54,

  "破浪者": 1.33,

  "鼠标妹": 1.23,
  "尬舞男": 1.33,

  "奶爸": 0.997,
  "奶妈": 1.000,
  "奶萝": 1.040,
  "奶弓": 1.002,
  "奶枪": 0.995,
}

/** 职业系数（job 未收录时为 1） */
export function jobCoef(job: string): number {
  const c = JOB_COEFFICIENT[job];
  return typeof c === "number" && Number.isFinite(c) ? c : 1;
}

/** 有效数值 = score × 职业系数：展示与门槛比较时使用（取不到系数则 ×1） */
export function effScore(job: string, score: number): number {
  return score * jobCoef(job);
}

/** 展示用有效数值：乘职业系数后保留 2 位小数（如 4.5862 → “4.59”） */
export function fmtEffScore(job: string, score: number): string {
  return (score * jobCoef(job)).toFixed(2);
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
