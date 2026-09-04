/** 角色导入解析：支持中文/英文/拼音等常见字段名 */

export type Role = "dps" | "support";

export interface DraftChar {
  nickname: string;
  roleType: Role;
  job: string;
  fame: number;
  score: number;
}

export interface ImportMemberGroup {
  nickname: string;
  schedulable: boolean;
  chars: DraftChar[];
}

export interface RosterParseResult {
  groups: ImportMemberGroup[];
  /** 某条数据无法解析时的说明 */
  errors: string[];
  charTotal: number;
}

function pick<T>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v as T;
  }
  return undefined;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 解析定位文本：辅助/奶 → support；输出/伤/dps → dps */
function parseRoleText(s: string): Role | null {
  const t = s.trim().toLowerCase();
  if (/(辅助|奶|奶妈|奶爸|奶萝|support|辅)/.test(t)) return "support";
  if (/(输出|输出职业|伤害|伤|dps|攻)/.test(t)) return "dps";
  return null;
}

function hasDpsField(o: Record<string, unknown>) {
  return pick<unknown>(o, ["damage", "dps", "伤害", "攻击", "输"] ) !== undefined;
}
function hasHealField(o: Record<string, unknown>) {
  return pick<unknown>(o, ["heal", "healing", "奶量", "奶", "辅助数值"]) !== undefined;
}

/** 把一条字符对象解析为标准 DraftChar，失败返回错误说明 */
export function parseChar(obj: unknown, tag = ""): DraftChar | string {
  if (!obj || typeof obj !== "object") return `${tag} 不是对象`;
  const o = obj as Record<string, unknown>;

  const nickname = pick<string>(o, ["nickname", "name", "昵称", "角色名", "角色昵称", "charName"]);
  const roleTypeRaw = pick<string>(o, ["roleType", "role", "type", "定位", "职业类型", "kind"]);
  const job = pick<string>(o, ["job", "职业", "细分职业", "class", "职业名"]);

  let roleType: Role | null = null;
  if (roleTypeRaw !== undefined) roleType = parseRoleText(String(roleTypeRaw));
  if (!roleType) roleType = hasHealField(o) && !hasDpsField(o) ? "support" : hasDpsField(o) ? "dps" : null;

  if (!nickname) return `${tag}缺少昵称(nickname/昵称)`;
  if (!roleType) return `${tag}「${nickname}」无法判断定位，请给 roleType=输出/辅助 或 伤害/奶量 字段`;
  if (!job) return `${tag}「${nickname}」缺少职业(job/职业)`;

  const fame = toNum(pick<unknown>(o, ["fame", "名望"]));
  const scoreRaw = roleType === "dps"
    ? pick<unknown>(o, ["damage", "dps", "伤害", "输出", "score", "输出数值"])
    : pick<unknown>(o, ["heal", "healing", "奶量", "奶", "score", "辅助数值"]);

  return {
    nickname: String(nickname).trim(),
    roleType,
    job: String(job).trim(),
    fame,
    score: toNum(scoreRaw),
  };
}

/** 解析一组角色数组 */
function parseCharList(list: unknown): { chars: DraftChar[]; errors: string[] } {
  const chars: DraftChar[] = [];
  const errors: string[] = [];
  if (!Array.isArray(list)) return { chars, errors: ["characters 应为数组"] };
  list.forEach((c, i) => {
    const r = parseChar(c, `第 ${i + 1} 个角色`);
    if (typeof r === "string") errors.push(r);
    else chars.push(r);
  });
  return { chars, errors };
}

/**
 * 解析导入 JSON 文本。
 * 支持：成员数组（每条含 characters）、{members:[...]}、
 * 单成员 {nickname, characters:[...]}、纯角色数组（归到"未命名成员"或 item 内 member 名）。
 */
export function parseRosterText(text: string): RosterParseResult {
  const errors: string[] = [];
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    return { groups: [], errors: ["JSON 解析失败：" + (e as Error).message], charTotal: 0 };
  }
  if (root === null || typeof root !== "object") {
    return { groups: [], errors: ["内容应为对象或数组"], charTotal: 0 };
  }

  let items: unknown[];
  if (Array.isArray(root)) {
    items = root;
  } else {
    const r = root as Record<string, unknown>;
    if (Array.isArray(r.members)) items = r.members;
    else if (Array.isArray(r.characters) || Array.isArray(r.roles)) {
      // 单成员带角色：nickname/name/昵称 为该成员名
      const memberName =
        pick<string>(r, ["nickname", "name", "昵称", "member", "memberName"]) ?? "未命名成员";
      const schedulable = parseSchedulable(r["schedulable"] ?? r["可排班"]);
      const { chars, errors: cErrors } = parseCharList(
        Array.isArray(r.characters) ? r.characters : r.roles
      );
      errors.push(...cErrors);
      return { groups: [{ nickname: String(memberName), schedulable, chars }], errors, charTotal: chars.length };
    } else {
      return { groups: [], errors: ["无法识别：请使用成员数组或 {nickname, characters:[...]}"], charTotal: 0 };
    }
  }

  const groups: ImportMemberGroup[] = [];
  let charTotal = 0;
  items.forEach((it, i) => {
    if (!it || typeof it !== "object") {
      errors.push(`第 ${i + 1} 条不是对象，已跳过`);
      return;
    }
    const o = it as Record<string, unknown>;
    const charList = pick<unknown[]>(o, ["characters", "角色", "roles", "角色列表"]);
    // 若该项本身像一条角色（无子角色数组）→ 归入一条默认成员
    if (charList === undefined) {
      const memberName =
        pick<string>(o, ["member", "memberName", "归属", "成员昵称"]) ?? "未命名成员";
      const { chars, errors: cErrors } = parseCharList([o]);
      errors.push(...cErrors);
      const idx = groups.findIndex((g) => g.nickname === memberName);
      if (idx >= 0) {
        groups[idx].chars.push(...chars);
      } else {
        groups.push({
          nickname: String(memberName),
          schedulable: parseSchedulable(o["schedulable"] ?? o["可排班"]),
          chars,
        });
      }
      charTotal += chars.length;
      return;
    }
    const nickname = String(
      pick<string>(o, ["nickname", "name", "昵称", "member", "memberName"]) ?? `成员${i + 1}`
    );
    const schedulable = parseSchedulable(o["schedulable"] ?? o["可排班"]);
    const { chars, errors: cErrors } = parseCharList(charList);
    errors.push(...cErrors);
    groups.push({ nickname, schedulable, chars });
    charTotal += chars.length;
  });

  return { groups, errors, charTotal };
}

function parseSchedulable(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return !["false", "0", "no", "不可以", "不可排", "不可以排"].includes(s.trim());
}

/** 示例文本（按模式返回） */
export function exampleText(mode: "roster" | "char-list"): string {
  if (mode === "roster") {
    return JSON.stringify(
      [
        {
          nickname: "小明",
          schedulable: true,
          characters: [
            { nickname: "小明-红眼", roleType: "输出", job: "狂战士", fame: 52000, damage: 900 },
            { nickname: "小明-奶妈", roleType: "辅助", job: "炽天使(奶妈)", fame: 36000, heal: 6 },
          ],
        },
        {
          nickname: "小红",
          characters: [{ name: "小红-阿修罗", role: "dps", job: "阿修罗", fame: 51000, 伤害: 880 }],
        },
      ],
      null,
      2
    );
  }
  return JSON.stringify(
    [
      { nickname: "大C-红眼", roleType: "输出", job: "狂战士", fame: 52000, damage: 920 },
      { nickname: "奶-炽天使", roleType: "辅助", job: "炽天使(奶妈)", fame: 36000, heal: 6.5 },
      { name: "剑魂-老李", role: "dps", job: "剑魂", fame: 50000, 伤害: 850 },
    ],
    null,
    2
  );
}
