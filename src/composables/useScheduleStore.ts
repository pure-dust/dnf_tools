import { reactive } from "vue";
import type {
  AppData,
  Character,
  Member,
  Schedule,
  Template,
  TemplateTeam,
} from "../types/schedule";
import { emptyData, uid } from "../types/schedule";
import { loadDataRaw, saveDataRaw } from "../services/storage";

interface ScheduleStore {
  loaded: boolean;
  data: AppData;
}

const store = reactive<ScheduleStore>({ loaded: false, data: emptyData() });

/** 旧数据迁移：为历史排班的队伍补齐每队门槛（沿用旧版统一门槛） */
function normalizeSchedules(list: Schedule[]): Schedule[] {
  return list.map((s) => ({
    ...s,
    maxMembers: s.maxMembers || 20,
    teams: (s.teams || []).map((t) => ({
      ...t,
      damageLimit:
        typeof t.damageLimit === "number" ? t.damageLimit : s.teamDamageLimit || 0,
      healLimit:
        typeof t.healLimit === "number" ? t.healLimit : s.teamHealLimit || 0,
    })),
  }));
}

function parse(raw: string | null): AppData {
  if (!raw) return emptyData();
  try {
    const obj = JSON.parse(raw) as AppData;
    return {
      version: 1,
      members: Array.isArray(obj.members) ? obj.members : [],
      schedules: normalizeSchedules(
        Array.isArray(obj.schedules) ? obj.schedules : []
      ),
      templates: Array.isArray(obj.templates) ? obj.templates : [],
    };
  } catch {
    return emptyData();
  }
}

async function persist() {
  await saveDataRaw(JSON.stringify(store.data));
}

/** 首次进入时加载一次 */
export async function ensureLoaded(): Promise<void> {
  if (store.loaded) return;
  const raw = await loadDataRaw();
  store.data = parse(raw);
  store.loaded = true;
}

// ---------------- 成员与角色 ----------------

export function addMember(nickname: string): Member {
  const m: Member = { id: uid(), nickname, schedulable: true, characters: [] };
  store.data.members.push(m);
  void persist();
  return m;
}

export function updateMember(member: Member) {
  const i = store.data.members.findIndex((x) => x.id === member.id);
  if (i >= 0) store.data.members[i] = member;
  void persist();
}

export function removeMember(id: string) {
  store.data.members = store.data.members.filter((m) => m.id !== id);
  void persist();
}

export function addCharacter(memberId: string, char: Character) {
  const m = store.data.members.find((x) => x.id === memberId);
  if (!m) return;
  char.id = uid();
  m.characters.push(char);
  void persist();
}

export function updateCharacter(memberId: string, char: Character) {
  const m = store.data.members.find((x) => x.id === memberId);
  if (!m) return;
  const i = m.characters.findIndex((c) => c.id === char.id);
  if (i >= 0) m.characters[i] = char;
  void persist();
}

export function removeCharacter(memberId: string, charId: string) {
  const m = store.data.members.find((x) => x.id === memberId);
  if (!m) return;
  m.characters = m.characters.filter((c) => c.id !== charId);
  void persist();
}

/** 导入：按成员昵称查找（找不到则新建），角色按昵称去重后追加，只落盘一次 */
export function importRosterGroups(
  groups: Array<{
    nickname: string;
    schedulable: boolean;
    chars: Array<Omit<Character, "id">>;
  }>
): { members: number; chars: number } {
  let members = 0;
  let chars = 0;
  for (const g of groups) {
    const nick = (g.nickname || "").trim();
    if (!nick) continue;
    let m = store.data.members.find((x) => x.nickname.trim() === nick);
    if (!m) {
      m = { id: uid(), nickname: nick, schedulable: g.schedulable, characters: [] };
      store.data.members.push(m);
      members++;
    }
    for (const c of g.chars) {
      if (m.characters.some((x) => x.nickname === c.nickname)) continue;
      m.characters.push({ ...c, id: uid() });
      chars++;
    }
  }
  void persist();
  return { members, chars };
}

// ---------------- 排班历史 ----------------

export function saveSchedule(schedule: Schedule) {
  store.data.schedules.unshift(schedule);
  void persist();
}

export function removeSchedule(id: string) {
  store.data.schedules = store.data.schedules.filter((s) => s.id !== id);
  void persist();
}
/** 覆盖整组历史：删除 removeIds 后整体写入 add（只落盘一次） */
export function replaceSchedules(removeIds: string[], add: Schedule[]) {
  const keep = store.data.schedules.filter((s) => !removeIds.includes(s.id))
  store.data.schedules = [...add, ...keep]
  void persist()
}
// ---------------- 排班模板 ----------------

export function addTemplate(
  name: string,
  maxMembers: number,
  teams: TemplateTeam[],
  minDamage = 0,
  minHeal = 0,
  carHeader = 0,
): Template {
  const tpl: Template = {
    id: uid(),
    name,
    maxMembers,
    teams,
    minDamage: minDamage || 0,
    minHeal: minHeal || 0,
    carHeader: carHeader || 0,
  };
  store.data.templates.push(tpl);
  void persist();
  return tpl;
}

export function updateTemplate(tpl: Template) {
  const i = store.data.templates.findIndex((t) => t.id === tpl.id);
  if (i >= 0) store.data.templates[i] = tpl;
  void persist();
}

export function removeTemplate(id: string) {
  store.data.templates = store.data.templates.filter((t) => t.id !== id);
  void persist();
}

export function useScheduleStore() {
  return store;
}
