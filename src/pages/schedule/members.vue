<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { Character, Member } from "../../types/schedule";
import { JOB_kIND, fmtEffScore, roleLabel, statLabel, uid } from "../../types/schedule";
import {
  addMember,
  importRosterGroups,
  removeMember,
  updateMember,
  useScheduleStore,
} from "../../composables/useScheduleStore";
import {
  exampleText,
  parseRosterText,
  type RosterParseResult,
} from "../../utils/importRoster";
import { exportJson, type ExportResult } from "../../services/storage";

const store = useScheduleStore();

/* ---------------- 角色名自动生成（与 roster.html 规则一致） ---------------- */
/** 角色名 = 成员昵称-职业；同职业角色 ≥2 个时从第 1 个起加序号（…红眼1、红眼2）。 */
function autoCharName(m: Member, ci: number): string {
  const job = (m.characters[ci].job || "").trim();
  if (!job) return "";
  let total = 0;
  let occ = 0;
  m.characters.forEach((x, k) => {
    if ((x.job || "").trim() === job) {
      total++;
      if (k <= ci) occ++;
    }
  });
  const base = (m.nickname || "").trim();
  return (base ? base + "-" : "") + job + (total >= 2 ? String(occ) : "");
}

/** 重算某成员全部角色昵称（新增/删除/改职业/改成员名后保证编号连续一致） */
function normalizeMemberNames(m: Member) {
  if (!m) return;
  m.characters.forEach((_, ci) => {
    const name = autoCharName(m, ci);
    if (name) m.characters[ci].nickname = name;
  });
}

/** 结构/命名变化后统一落盘：先重算昵称，再更新该成员 */
function commitMember(m: Member) {
  if (!m) return;
  normalizeMemberNames(m);
  updateMember(m);
}

/* ---------------- 成员弹窗 ---------------- */
const memberDialog = ref(false);
const memberDraft = reactive<{ id: string | null; nickname: string; schedulable: boolean }>({
  id: null,
  nickname: "",
  schedulable: true,
});

function openMemberDialog(m?: Member) {
  memberDialog.value = true;
  memberDraft.id = m ? m.id : null;
  memberDraft.nickname = m ? m.nickname : "";
  memberDraft.schedulable = m ? m.schedulable : true;
}

function submitMember() {
  const nickname = memberDraft.nickname.trim();
  if (!nickname) return;
  if (memberDraft.id) {
    const m = store.data.members.find((x) => x.id === memberDraft.id);
    if (m) {
      m.nickname = nickname;
      m.schedulable = memberDraft.schedulable;
      // 成员改名 → 该成员所有角色昵称同步更新（同职业编号重排）
      commitMember(m);
    }
  } else {
    addMember(nickname);
  }
  memberDialog.value = false;
}

function toggleSchedulable(m: Member) {
  m.schedulable = !m.schedulable;
  updateMember(m);
}

/* ---------------- 角色弹窗 ---------------- */
const charDialog = ref(false);
const charDraft = reactive<{
  memberId: string;
  id: string | null;
  nickname: string;
  roleType: "dps" | "support";
  job: string;
  fame: number | null;
  score: number | null;
}>({
  memberId: "",
  id: null,
  nickname: "",
  roleType: "dps",
  job: "",
  fame: null,
  score: null,
});

function openCharDialog(memberId: string, c?: Character) {
  charDialog.value = true;
  charDraft.memberId = memberId;
  charDraft.id = c ? c.id : null;
  charDraft.nickname = c ? c.nickname : "";
  charDraft.roleType = c ? c.roleType : "dps";
  charDraft.job = c ? c.job : "";
  charDraft.fame = c ? c.fame : null;
  charDraft.score = c ? c.score : null;
}

/** 该角色（含新增/编辑草稿）将自动采用的昵称：成员昵称-职业 + 同职业序号，随职业/成员名实时变化 */
const charPreviewName = computed(() => {
  const d = charDraft;
  const job = (d.job || "").trim();
  if (!job || !d.memberId) return "";
  const m = store.data.members.find((x) => x.id === d.memberId);
  if (!m) return "";
  const jobs: string[] = m.characters.map((c) => c.job || "");
  let self = d.id ? m.characters.findIndex((c) => c.id === d.id) : m.characters.length;
  if (d.id) {
    if (self >= 0) jobs[self] = job;
    else self = m.characters.length;
  } else {
    jobs.push(job);
  }
  let total = 0;
  let occ = 0;
  jobs.forEach((j, k) => {
    if ((j || "").trim() === job) {
      total++;
      if (k <= self) occ++;
    }
  });
  const base = (m.nickname || "").trim();
  return (base ? base + "-" : "") + job + (total >= 2 ? String(occ) : "");
});

const charDraftValid = computed(() => {
  const d = charDraft;
  return (
    !!charPreviewName.value &&
    (d.fame ?? 0) >= 0 &&
    (d.score ?? 0) >= 0
  );
});

function submitCharacter() {
  if (!charDraftValid.value) return;
  const member = store.data.members.find((x) => x.id === charDraft.memberId);
  if (!member) return;
  const payload: Character = {
    id: charDraft.id ?? uid(),
    nickname: charPreviewName.value,
    roleType: charDraft.roleType,
    job: charDraft.job.trim(),
    fame: charDraft.fame ?? 0,
    score: charDraft.score ?? 0,
  };
  if (charDraft.id) {
    const i = member.characters.findIndex((c) => c.id === charDraft.id);
    if (i >= 0) member.characters[i] = payload;
  } else {
    member.characters.push(payload);
  }
  // 落盘并重算该成员所有角色昵称（同职业编号连续一致）
  commitMember(member);
  charDialog.value = false;
}

const jobListId = computed(() =>
  charDraft.roleType === "dps" ? "job-options-dps" : "job-options-support"
);

const charRoleStatLabel = computed(() => statLabel(charDraft.roleType));

function removeMemberConfirm(m: Member) {
  if (confirm(`确定删除成员「${m.nickname}」及其所有角色？`)) {
    removeMember(m.id);
  }
}

function removeCharacterConfirm(memberId: string, c: Character) {
  if (confirm(`确定删除角色「${c.nickname}」？`)) {
    const member = store.data.members.find((x) => x.id === memberId);
    if (!member) return;
    member.characters = member.characters.filter((x) => x.id !== c.id);
    commitMember(member);
  }
}

/* ---------------- 折叠/展开 ---------------- */
/** 已手动展开的成员 id */
const expanded = ref<string[]>([]);
const expandedAll = computed(
  () =>
    store.data.members.length > 0 &&
    store.data.members.every((m) => expanded.value.includes(m.id))
);

/** 无角色时始终展开，方便直接添加 */
function isOpen(m: Member) {
  return m.characters.length === 0 || expanded.value.includes(m.id);
}

function toggleExpand(id: string) {
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter((x) => x !== id)
    : [...expanded.value, id];
}

function toggleAll() {
  expanded.value = expandedAll.value
    ? []
    : store.data.members.map((m) => m.id);
}

function memberRoleCounts(m: Member) {
  const dps = m.characters.filter((c) => c.roleType === "dps").length;
  return { dps, support: m.characters.length - dps };
}

/* ---------------- 批量导出 ---------------- */
const exportDialog = ref(false);
const exportText = ref("");
const exportMsg = ref<ExportResult | null>(null);
const exporting = ref(false);

/** 把成员转成与“导入角色”兼容的成员数组（nickname + schedulable + characters） */
function toExportRoster() {
  return store.data.members.map((m) => ({
    nickname: m.nickname,
    schedulable: !!m.schedulable,
    characters: m.characters.map((c) => ({
      nickname: c.nickname,
      roleType: c.roleType,
      job: c.job,
      fame: c.fame,
      score: c.score,
    })),
  }));
}

function openExportDialog() {
  exportText.value = JSON.stringify(toExportRoster(), null, 2);
  exportMsg.value = null;
  exportDialog.value = true;
}

async function copyExport() {
  const fallback = () => {
    const ta = document.querySelector(".export-json") as HTMLTextAreaElement | null;
    if (!ta) return false;
    ta.focus();
    ta.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  };
  try {
    await navigator.clipboard.writeText(exportText.value);
    exportMsg.value = { ok: true, message: "已复制到剪贴板" };
  } catch {
    exportMsg.value = fallback()
      ? { ok: true, message: "已复制到剪贴板" }
      : { ok: false, message: "复制失败，请手动选中文本后 Ctrl+C" };
  }
}

async function downloadExport() {
  if (exporting.value) return;
  exporting.value = true;
  exportMsg.value = null;
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    exportMsg.value = await exportJson(`成员_${stamp}.json`, exportText.value);
  } finally {
    exporting.value = false;
  }
}

/* ---------------- 批量导入 ---------------- */
const importDialog = ref(false);
/** 花名册：每条含成员与角色；纯角色列表：并入单个目标成员 */
const importMode = ref<"roster" | "char-list">("roster");
const importText = ref("");
const importFileName = ref("");
const importTargetId = ref("");
const importNewName = ref("");
const importMsg = ref<{ ok: boolean; text: string } | null>(null);
const preview = ref<RosterParseResult | null>(null);

function openImportDialog() {
  importDialog.value = true;
  importMode.value = "roster";
  importText.value = "";
  importFileName.value = "";
  importTargetId.value = "";
  importNewName.value = "";
  importMsg.value = null;
  preview.value = null;
}

function onModeChange() {
  preview.value = null;
  importMsg.value = null;
}

function fillExample() {
  importText.value = exampleText(importMode.value);
  preview.value = null;
  importMsg.value = null;
}

function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    importText.value = String(reader.result ?? "");
    importFileName.value = file.name;
    preview.value = null;
    importMsg.value = null;
  };
  reader.readAsText(file);
  input.value = "";
}

function parsePreview() {
  const r = parseRosterText(importText.value);
  preview.value = r;
  if (r.errors.length) {
    importMsg.value = { ok: false, text: `解析完成，但有 ${r.errors.length} 条问题：${r.errors.slice(0, 4).join("；")}` };
  } else {
    const groupCount = importMode.value === "roster" ? r.groups.length : 1;
    importMsg.value = { ok: true, text: `解析成功：${groupCount} 个分组 / 共 ${r.charTotal} 个角色` };
  }
}

function doImport() {
  const r = parseRosterText(importText.value);
  if (!r.groups.length || r.charTotal === 0) {
    importMsg.value = { ok: false, text: "没有可导入的角色，请检查 JSON 内容" };
    return;
  }
  let groups = r.groups;
  if (importMode.value === "char-list") {
    let targetNick: string;
    if (importTargetId.value) {
      const m = store.data.members.find((x) => x.id === importTargetId.value);
      targetNick = m ? m.nickname : "";
    } else {
      targetNick = importNewName.value.trim();
    }
    if (!targetNick) {
      importMsg.value = { ok: false, text: "请选择要并入的成员，或勾选“导入到新成员”并填写昵称" };
      return;
    }
    groups = [
      {
        nickname: targetNick,
        schedulable: true,
        chars: r.groups.flatMap((g) => g.chars),
      },
    ];
  }
  const { members, chars } = importRosterGroups(
    groups.map((g) => ({ nickname: g.nickname, schedulable: g.schedulable, chars: g.chars }))
  );
  importMsg.value = { ok: true, text: `导入完成：新增 ${members} 位成员、新增 ${chars} 个角色` };
  if (r.errors.length) {
    importMsg.value.text += `（${r.errors.length} 条被跳过）`;
  }
  preview.value = null;
  // 短暂展示结果后关闭
  window.setTimeout(() => {
    if (importDialog.value) importDialog.value = false;
  }, 900);
}
</script>

<template>
  <div class="members">
    <div class="members__head">
      <div>
        <h2 class="members__title">成员管理</h2>
        <p class="members__sub">
          共 {{ store.data.members.length }} 位成员
          · {{ store.data.members.reduce((s, m) => s + m.characters.length, 0) }} 个角色
        </p>
      </div>
      <div class="members__head-ops">
        <button class="btn" type="button" @click="toggleAll">
          {{ expandedAll ? "收起全部" : "展开全部" }}
        </button>
        <button class="btn" type="button" @click="openExportDialog">
          导出 JSON
        </button>
        <button class="btn" type="button" @click="openImportDialog">
          导入角色
        </button>
        <button class="btn btn--primary" type="button" @click="openMemberDialog()">
          + 添加成员
        </button>
      </div>
    </div>

    <div v-if="store.data.members.length === 0" class="empty">
      还没有成员，先点击右上角「添加成员」吧
    </div>

    <div class="members__list">
      <section
        v-for="m in store.data.members"
        :key="m.id"
        class="member panel"
        :class="{ 'is-open': isOpen(m) }"
      >
        <header class="member__head" @click="toggleExpand(m.id)">
          <span class="member__avatar">{{ m.nickname.slice(0, 1) }}</span>
          <div class="member__main">
            <div class="member__title-row">
              <span class="member__nick">{{ m.nickname }}</span>
              <button
                class="member__status"
                :class="m.schedulable ? 'is-on' : 'is-off'"
                type="button"
                :title="m.schedulable ? '点击设为不可排班' : '点击设为可排班'"
                @click.stop="toggleSchedulable(m)"
              >
                {{ m.schedulable ? "可以排" : "不可以排" }}
              </button>
            </div>
            <div class="member__meta">
              <span>角色 {{ m.characters.length }}</span>
              <span>输出 <b>{{ memberRoleCounts(m).dps }}</b> · 辅助 <b>{{ memberRoleCounts(m).support }}</b></span>
            </div>
          </div>
          <div class="member__ops" @click.stop>
            <button class="btn btn--sm" type="button" @click="openMemberDialog(m)">编辑</button>
            <button class="btn btn--sm btn--danger" type="button" @click="removeMemberConfirm(m)">删除</button>
          </div>
          <button
            class="member__chev"
            type="button"
            :aria-label="isOpen(m) ? '收起角色' : '展开角色'"
            @click.stop="toggleExpand(m.id)"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </header>

        <Transition name="expand">
          <div v-show="isOpen(m)" class="member__body">
            <div class="member__chars">
              <div v-if="m.characters.length === 0" class="member__none">
                该成员还没有角色
              </div>
              <div v-for="c in m.characters" :key="c.id" class="char">
                <span class="char__nick">{{ c.nickname }}</span>
                <span class="tag" :class="c.roleType === 'dps' ? 'tag--dps' : 'tag--support'">
                  {{ roleLabel(c.roleType) }} · {{ c.job }}
                </span>
                <span class="char__field">名望 {{ c.fame }}</span>
                <span class="char__field">{{ statLabel(c.roleType) }} {{ fmtEffScore(c.job, c.score) }}</span>
                <span class="char__ops">
                  <button class="btn btn--sm" type="button" @click="openCharDialog(m.id, c)">编辑</button>
                  <button class="btn btn--sm btn--danger" type="button" @click="removeCharacterConfirm(m.id, c)">删除</button>
                </span>
              </div>
            </div>
            <button class="btn btn--sm member__add-char" type="button" @click="openCharDialog(m.id)">
              + 添加角色
            </button>
          </div>
        </Transition>
      </section>
    </div>

    <!-- 成员弹窗 -->
    <div v-if="memberDialog" class="overlay" @click.self="memberDialog = false">
      <div class="dialog">
        <h3 class="dialog__title">{{ memberDraft.id ? "编辑成员" : "添加成员" }}</h3>
        <div class="form-field">
          <label>昵称</label>
          <input
            v-model="memberDraft.nickname"
            class="input"
            type="text"
            placeholder="请输入成员昵称"
          />
        </div>
        <div class="form-field">
          <label>可排班状态</label>
          <label class="switch-line">
            <input v-model="memberDraft.schedulable" type="checkbox" />
            <span>可参与排班（{{ memberDraft.schedulable ? "可以排" : "不可以排" }}）</span>
          </label>
        </div>
        <div class="dialog__ops">
          <button class="btn" type="button" @click="memberDialog = false">取消</button>
          <button
            class="btn btn--primary"
            type="button"
            :disabled="!memberDraft.nickname.trim()"
            @click="submitMember"
          >
            保存
          </button>
        </div>
      </div>
    </div>

    <!-- 角色弹窗 -->
    <div v-if="charDialog" class="overlay" @click.self="charDialog = false">
      <div class="dialog">
        <h3 class="dialog__title">{{ charDraft.id ? "编辑角色" : "添加角色" }}</h3>

        <div class="form-field">
          <label>角色昵称（自动）</label>
          <input
            class="input char-nick"
            type="text"
            readonly
            :value="charPreviewName"
            placeholder="成员昵称-职业（自动）"
          />
          <p class="form-hint">
            名称自动为「成员昵称-职业」；同一职业有多个角色时自动加序号（如 …-红眼1、红眼2）；改成员名/改职业时自动同步。
          </p>
        </div>

        <div class="form-field">
          <label>定位</label>
          <div class="role-pick">
            <button
              class="role-pick__opt"
              :class="{ 'is-on': charDraft.roleType === 'dps' }"
              type="button"
              @click="charDraft.roleType = 'dps'"
            >
              输出职业
            </button>
            <button
              class="role-pick__opt"
              :class="{ 'is-on': charDraft.roleType === 'support' }"
              type="button"
              @click="charDraft.roleType = 'support'"
            >
              辅助职业
            </button>
          </div>
        </div>

        <div class="form-field">
          <label>细分职业</label>
          <input
            v-model="charDraft.job"
            class="input"
            type="text"
            :list="jobListId"
            :placeholder="charDraft.roleType === 'dps' ? '如：剑帝' : '如：奶妈'"
          />
          <datalist id="job-options-dps">
            <option v-for="j in JOB_kIND.dps" :key="j" :value="j" />
          </datalist>
          <datalist id="job-options-support">
            <option v-for="j in JOB_kIND.support" :key="j" :value="j" />
          </datalist>
        </div>

        <div class="form-grid">
          <div class="form-field">
            <label>名望</label>
            <input v-model.number="charDraft.fame" class="input" type="number" min="0" placeholder="0" />
          </div>
          <div class="form-field">
            <label>{{ charRoleStatLabel }}</label>
            <input v-model.number="charDraft.score" class="input" type="number" min="0" placeholder="0" />
          </div>
        </div>

        <div class="dialog__ops">
          <button class="btn" type="button" @click="charDialog = false">取消</button>
          <button class="btn btn--primary" type="button" :disabled="!charDraftValid" @click="submitCharacter">
            保存
          </button>
        </div>
      </div>
    </div>

    <!-- 导入角色弹窗 -->
    <div v-if="importDialog" class="overlay" @click.self="importDialog = false">
      <div class="dialog import-dialog">
        <div class="dialog__head">
          <h3 class="dialog__title">导入角色</h3>
          <button class="btn btn--sm" type="button" @click="fillExample">填入示例</button>
        </div>

        <div class="import-tabs">
          <button
            type="button"
            class="import-tab"
            :class="{ 'is-on': importMode === 'roster' }"
            @click="importMode = 'roster'; onModeChange()"
          >
            花名册（每条含成员+角色）
          </button>
          <button
            type="button"
            class="import-tab"
            :class="{ 'is-on': importMode === 'char-list' }"
            @click="importMode = 'char-list'; onModeChange()"
          >
            纯角色列表（并入某成员）
          </button>
        </div>

        <div v-if="importMode === 'char-list'" class="form-grid">
          <div class="form-field">
            <label>并入已有成员</label>
            <select v-model="importTargetId" class="select">
              <option value="">— 导入到新成员 —</option>
              <option v-for="m in store.data.members" :key="m.id" :value="m.id">
                {{ m.nickname }}
              </option>
            </select>
          </div>
          <div class="form-field">
            <label>新成员昵称（未选已有成员时）</label>
            <input v-model="importNewName" class="input" type="text" placeholder="如：小明" />
          </div>
        </div>

        <div class="form-field">
          <label>JSON 内容（粘贴文本或选择文件）</label>
          <div class="import-source">
            <textarea
              v-model="importText"
              class="input import-json"
              rows="9"
              placeholder='在此粘贴 JSON…'
            ></textarea>
            <label class="btn import-file-btn">
              选择 .json 文件{{ importFileName ? `（${importFileName}）` : "" }}
              <input type="file" accept=".json,application/json" hidden @change="onImportFile" />
            </label>
          </div>
          <p class="import-hint">
            {{
              importMode === "roster"
                ? "成员数组：[{ nickname:\"小明\", characters:[{nickname, roleType:\"输出/辅助\", job, fame, damage 或 heal}] }]"
                : "角色对象数组：[{nickname, roleType(或 damage/heal), job, fame, damage/heal}]"
            }}
            字段支持中文键名（角色名/职业/名望/伤害/奶量…）
          </p>
        </div>

        <div v-if="preview" class="import-preview">
          <span>分组 {{ preview.groups.length }} · 可导入 {{ preview.charTotal }} 个角色</span>
          <span v-for="g in preview.groups.slice(0, 6)" :key="g.nickname">「{{ g.nickname }}」×{{ g.chars.length }}</span>
        </div>

        <div v-if="importMsg" class="import-msg" :class="importMsg.ok ? 'is-ok' : 'is-err'">
          {{ importMsg.text }}
        </div>

        <div class="dialog__ops">
          <button class="btn" type="button" @click="importDialog = false">取消</button>
          <button class="btn" type="button" :disabled="!importText.trim()" @click="parsePreview">
            解析预览
          </button>
          <button class="btn btn--primary" type="button" :disabled="!importText.trim()" @click="doImport">
            导入
          </button>
        </div>
      </div>
    </div>

    <!-- 导出成员 JSON 弹窗 -->
    <div v-if="exportDialog" class="overlay" @click.self="exportDialog = false">
      <div class="dialog export-dialog">
        <div class="dialog__head">
          <h3 class="dialog__title">导出成员 JSON</h3>
          <span class="export-hint"
            >{{ store.data.members.length }} 位成员 ·
            {{ store.data.members.reduce((s, m) => s + m.characters.length, 0) }} 个角色</span
          >
        </div>
        <p class="export-tip">
          格式与「导入角色」兼容：可复制/保存后再次导入，也可用于备份与迁移。
        </p>
        <textarea class="input export-json" readonly rows="10" spellcheck="false">{{ exportText }}</textarea>
        <div v-if="exportMsg" class="import-msg" :class="exportMsg.ok ? 'is-ok' : 'is-err'">
          {{ exportMsg.message }}<span v-if="exportMsg.path" class="export-path">{{ exportMsg.path }}</span>
        </div>
        <div class="dialog__ops">
          <button class="btn" type="button" @click="exportDialog = false">关闭</button>
          <button class="btn" type="button" :disabled="exporting" @click="copyExport">复制</button>
          <button class="btn btn--primary" type="button" :disabled="exporting" @click="downloadExport">
            {{ exporting ? "导出中…" : "下载 / 保存到本地" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less">
.members {
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

  .member {
    &__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-bottom: 10px;
      border-bottom: 1px dashed var(--app-border);
    }

    &__info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    &__nick {
      font-size: 15px;
      font-weight: 600;
      color: var(--app-text);
    }

    &__status {
      border: none;
      border-radius: 10px;
      padding: 2px 10px;
      font-size: 11px;
      cursor: pointer;
      transition: filter 0.2s ease;

      &.is-on {
        color: var(--app-success);
        background-color: color-mix(in srgb, var(--app-success) 14%, transparent);
      }

      &.is-off {
        color: var(--app-text-secondary);
        background-color: var(--app-border);
      }

      &:hover {
        filter: brightness(1.08);
      }
    }

    &__ops {
      display: flex;
      gap: 6px;
    }

    &__chars {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 0 6px;
    }

    &__none {
      font-size: 12px;
      color: var(--app-text-secondary);
      padding: 4px 0;
    }

    &__add-char {
      align-self: flex-start;
    }
  }

  .char {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 8px;
    background-color: var(--app-bg);

    &__nick {
      font-size: 13px;
      font-weight: 600;
      color: var(--app-text);
      min-width: 80px;
    }

    &__field {
      font-size: 12px;
      color: var(--app-text-secondary);
    }

    &__ops {
      margin-left: auto;
      display: flex;
      gap: 6px;
    }
  }

  .role-pick {
    display: flex;
    gap: 8px;

    &__opt {
      flex: 1;
      height: 32px;
      border: 1px solid var(--app-border);
      border-radius: 6px;
      background-color: var(--app-bg);
      color: var(--app-text-secondary);
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;

      &.is-on {
        border-color: var(--app-primary);
        color: var(--app-primary);
        background-color: color-mix(in srgb, var(--app-primary) 10%, transparent);
      }
    }
  }

  .switch-line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--app-text);
    cursor: pointer;
  }

  &__head-ops {
    display: flex;
    gap: 8px;
  }
}

/* ===== 导入弹窗 ===== */
.import-dialog {
  width: min(600px, calc(100vw - 40px));
}

.import-tabs {
  display: flex;
  gap: 8px;
}

.import-tab {
  flex: 1;
  padding: 7px 8px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background-color: var(--app-bg);
  color: var(--app-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;

  &.is-on {
    border-color: var(--app-primary);
    color: var(--app-primary);
    background-color: color-mix(in srgb, var(--app-primary) 10%, transparent);
  }
}

.import-source {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.import-json {
  flex: 1;
  min-height: 120px;
  resize: vertical;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
  line-height: 1.5;
}

.import-file-btn {
  align-self: center;
  flex-shrink: 0;
  input {
    display: none;
  }
}

.import-hint {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--app-text-secondary);
  word-break: break-all;
}

.import-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background-color: var(--app-bg);
  font-size: 12px;
  color: var(--app-text);

  span {
    color: var(--app-text-secondary);
  }
}

.import-msg {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;

  &.is-ok {
    color: var(--app-success);
    background-color: color-mix(in srgb, var(--app-success) 12%, transparent);
  }

  &.is-err {
    color: var(--app-danger);
    background-color: color-mix(in srgb, var(--app-danger) 12%, transparent);
  }
}

.dialog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* ===== 成员卡片：折叠 + 布局优化（覆盖上方） ===== */
.members__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;
  align-items: start;
}

.member {
  overflow: hidden;

  &.is-open .member__head {
    border-bottom: 1px dashed var(--app-border);
  }
}

.member__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: none;
  user-select: none;

  &:hover {
    background-color: color-mix(in srgb, var(--app-border) 45%, transparent);
  }
}

.member__avatar {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  font-weight: 600;
  background-color: var(--app-primary);
}

.member__main {
  flex: 1;
  min-width: 0;
}

.member__title-row {
  display: flex;
  align-items: center;
  gap: 8px;

  .member__nick {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
}

.member__meta {
  display: flex;
  gap: 12px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--app-text-secondary);

  b {
    color: var(--app-primary);
  }
}

/* ===== 角色昵称自动显示 ===== */
.char-nick {
  color: var(--app-text);
  background-color: color-mix(in srgb, var(--app-bg) 60%, transparent);
  cursor: default;
}

.form-hint {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--app-text-secondary);
}

.member__ops {
  margin-left: auto;
}

.member__chev {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background-color: transparent;
  color: var(--app-text-secondary);
  cursor: pointer;
  transition: transform 0.2s ease, background-color 0.2s ease;

  &:hover {
    background-color: var(--app-border);
    color: var(--app-text);
  }
}

.member.is-open .member__chev {
  transform: rotate(180deg);
}

.member__body {
  padding: 6px 12px 12px;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.18s ease;
}

/* ===== 导出成员 JSON ===== */
.export-dialog {
  width: min(640px, 92vw);
}

.export-hint {
  font-size: 12px;
  color: var(--app-text-secondary);
}

.export-tip {
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--app-text-secondary);
}

.export-json {
  font-family: Consolas, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
}

.export-path {
  display: block;
  word-break: break-all;
  color: var(--app-text-secondary);
}

</style>
