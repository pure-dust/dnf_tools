<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { Template, TemplateTeam } from "../../types/schedule";
import { uid } from "../../types/schedule";
import {
  addTemplate,
  removeTemplate,
  updateTemplate,
  useScheduleStore,
} from "../../composables/useScheduleStore";
import { colorizeTeams, type TeamLike } from "../../utils/teamColor";

const store = useScheduleStore();

/* 队伍行预览上色（伤害门槛降序 → 红黄绿蓝） */
function colored(teams: TemplateTeam[]) {
  return colorizeTeams(teams);
}

/* ---------------- 编辑弹窗 ---------------- */
interface Row extends TeamLike {
  id: string;
  name: string;
  damageLimit: number;
  healLimit: number;
  /** 总伤害下限 */
  totalDamageLimit: number;
  /** 最少输出角色数 */
  minDps: number;
  /** 最少辅助角色数 */
  minSup: number;
}

const dialog = ref(false);
const editingId = ref<string | null>(null);
const draft = reactive<{ name: string; maxMembers: number; minDamage: number; minHeal: number; carHeader: number; teams: Row[] }>({
  name: "",
  maxMembers: 16,
  minDamage: 0,
  minHeal: 0,
  carHeader: 0,
  teams: [],
});

function colorOf(row: Row) {
  const arr = colorizeTeams(draft.teams);
  const found = arr.find((c) => c.team.id === row.id);
  return found ? found.color : "#888";
}

function openCreate() {
  dialog.value = true;
  editingId.value = null;
  draft.name = "";
  draft.maxMembers = 16;
  draft.minDamage = 0;
  draft.minHeal = 0;
  draft.carHeader = 0;
  draft.teams = [];
  addRow();
}

function openEdit(t: Template) {
  dialog.value = true;
  editingId.value = t.id;
  draft.name = t.name;
  draft.maxMembers = t.maxMembers;
  draft.minDamage = t.minDamage ?? 0;
  draft.minHeal = t.minHeal ?? 0;
  draft.carHeader = t.carHeader ?? 0;
  draft.teams = t.teams.map((c) => ({
    id: c.id,
    name: c.name,
    damageLimit: c.damageLimit,
    healLimit: c.healLimit,
    totalDamageLimit: c.totalDamageLimit ?? 0,
    minDps: c.minDps ?? 0,
    minSup: c.minSup ?? 1,
  }));
}

function addRow() {
  draft.teams.push({
    id: uid(),
    name: `${draft.teams.length + 1}队`,
    damageLimit: 0,
    healLimit: 0,
    totalDamageLimit: 0,
    minDps: 0,
    minSup: 1,
  });
}
function removeRow(i: number) {
  draft.teams.splice(i, 1);
}

const rowsValid = computed(() => draft.teams.length >= 1 && draft.teams.every((t) => (t.damageLimit ?? 0) >= 0 && (t.healLimit ?? 0) >= 0 && (t.totalDamageLimit ?? 0) >= 0));
const canSave = computed(() => draft.name.trim().length > 0 && rowsValid.value);

function submit() {
  if (!canSave.value) return;
  const teams: TemplateTeam[] = draft.teams.map((t) => ({
    id: t.id,
    name: t.name || "队",
    damageLimit: t.damageLimit || 0,
    healLimit: t.healLimit || 0,
    totalDamageLimit: t.totalDamageLimit || 0,
    minDps: t.minDps ?? 0,
    minSup: t.minSup ?? 1,
  }));
  if (editingId.value) {
    const cur = store.data.templates.find((t) => t.id === editingId.value);
    if (cur)
      updateTemplate({
        ...cur,
        name: draft.name.trim(),
        maxMembers: draft.maxMembers || 1,
        minDamage: draft.minDamage || 0,
        minHeal: draft.minHeal || 0,
        carHeader: draft.carHeader || 0,
        teams,
      });
  } else {
    addTemplate(draft.name.trim(), draft.maxMembers || 1, teams, draft.minDamage || 0, draft.minHeal || 0, draft.carHeader || 0);
  }
  dialog.value = false;
}

function remove(t: Template) {
  if (confirm(`确定删除模板「${t.name}」？已生成的排班不受影响。`)) {
    removeTemplate(t.id);
  }
}
</script>

<template>
  <div class="tpls">
    <div class="tpls__head">
      <div>
        <h2 class="tpls__title">排班模板</h2>
        <p class="tpls__sub">共 {{ store.data.templates.length }} 个模板 · 颜色按队伍伤害门槛从高到低：红→黄→绿→蓝</p>
      </div>
      <button class="btn btn--primary" type="button" @click="openCreate">+ 新建模板</button>
    </div>

    <div v-if="store.data.templates.length === 0" class="empty">
      还没有模板，先点击右上角「新建模板」吧（模板里可设置参与人数与每队限制）
    </div>

    <div class="tpls__list">
      <section v-for="t in store.data.templates" :key="t.id" class="tpl panel">
        <div class="tpl__main">
          <h3 class="tpl__name">{{ t.name }}</h3>
          <p class="tpl__meta">参与人数上限 {{ t.maxMembers }} · {{ t.teams.length }} 个队伍
            <template v-if="(t.minDamage ?? 0) > 0 || (t.minHeal ?? 0) > 0">
              · 自动门槛 伤≥{{ t.minDamage ?? 0 }} 奶≥{{ t.minHeal ?? 0 }}
            </template>
            <template v-if="(t.carHeader ?? 0) > 0">
              · 车头伤害≥{{ t.carHeader ?? 0 }}（每班红队 1 个）
            </template>
          </p>
          <div class="tpl__teams">
              <span
                v-for="c in colored(t.teams)"
                :key="c.team.id"
                class="tpl__team"
                :style="{ '--tpl-c': c.color }"
              >
                <span class="tpl__dot"></span>
                {{ c.team.name }} · 伤害{{ c.team.damageLimit + "千亿" || "不限" }} · 奶量{{ c.team.healLimit || "不限" }}
                <template v-if="(c.team.totalDamageLimit ?? 0) > 0">
                  · 总伤≥{{ c.team.totalDamageLimit }}
                </template>
                <template v-if="(c.team.minDps ?? 0) > 0 || (c.team.minSup ?? 0) > 0">
                  · C≥{{ c.team.minDps ?? 0 }} 奶≥{{ c.team.minSup ?? 0 }}
                </template>
              </span>
          </div>
        </div>
        <div class="tpl__ops">
          <button class="btn btn--sm" type="button" @click="openEdit(t)">编辑</button>
          <button class="btn btn--sm btn--danger" type="button" @click="remove(t)">删除</button>
        </div>
      </section>
    </div>

    <!-- 编辑弹窗 -->
    <div v-if="dialog" class="overlay" @click.self="dialog = false">
      <div class="dialog dialog--wide">
        <h3 class="dialog__title">{{ editingId ? "编辑模板" : "新建模板" }}</h3>

        <div class="form-grid">
          <div class="form-field">
            <label>模板名称</label>
            <input v-model="draft.name" class="input" type="text" placeholder="如：困难 4 人队" />
          </div>
          <div class="form-field">
            <label>参与人数上限</label>
            <input v-model.number="draft.maxMembers" class="input" type="number" min="4" max="20" />
          </div>
        </div>

          <div class="form-grid">
            <div class="form-field">
              <label>最低伤害限制</label>
              <input
                v-model.number="draft.minDamage"
                class="input"
                type="number"
                min="0"
                placeholder="0=不限"
              />
              <small>低于此分的输出不参与自动排班，只能手动拖动</small>
            </div>
            <div class="form-field">
              <label>最低奶量限制</label>
              <input
                v-model.number="draft.minHeal"
                class="input"
                type="number"
                min="0"
                placeholder="0=不限"
              />
              <small>低于此分的辅助不参与自动排班，只能手动拖动</small>
            </div>
          </div>

          <div class="form-field">
            <label>车头伤害限制（输出≥此分视为“车头”）</label>
            <input
              v-model.number="draft.carHeader"
              class="input"
              type="number"
              min="0"
              placeholder="0=关闭"
            />
            <small>车头会尽量分散到不同班次：自动排班时每个班次红队只放 1 个车头，避免伤害最高的大C扎堆同班（0=关闭）</small>
          </div>

        <div class="tpl-editor">
          <div class="tpl-editor__head">
            <b>队伍</b>
            <button class="btn btn--sm" type="button" @click="addRow">+ 添加队伍</button>
          </div>
          <div v-for="(row, i) in draft.teams" :key="row.id" class="tpl-editor__row">
            <span class="tpl-editor__dot" :style="{ backgroundColor: colorOf(row) }"></span>
            <input v-model="row.name" class="input tpl-editor__name" type="text" />
            <div class="tpl-editor__limits">
              <label>
                伤害门槛
                <input v-model.number="row.damageLimit" class="input" type="number" min="0" placeholder="0=不限" />
              </label>
              <label>
                奶量门槛
                <input v-model.number="row.healLimit" class="input" type="number" min="0" placeholder="0=不限" />
              </label>
              <label title="该队输出总伤害下限：队内输出有效伤害合计需≥此值">
                总伤≥
                <input v-model.number="row.totalDamageLimit" class="input" type="number" min="0" placeholder="0=不限" />
              </label>
              <label title="该队至少放入的输出角色数">
                输出≥
                <input v-model.number="row.minDps" class="input" type="number" min="0" placeholder="0" />
              </label>
              <label title="该队至少放入的辅助角色数">
                辅助≥
                <input v-model.number="row.minSup" class="input" type="number" min="0" placeholder="1" />
              </label>
            </div>
            <button class="btn btn--sm btn--danger" type="button" :disabled="draft.teams.length <= 1" @click="removeRow(i)">
              删除
            </button>
          </div>
          <p v-if="draft.teams.length === 0" class="tpl-editor__empty">还没有队伍，点击上方「添加队伍」</p>
          <p class="tpl-editor__hint">颜色自动按“伤害门槛从高到低”排列为 红→黄→绿→蓝，预览见左侧圆点。</p>
        </div>

        <div class="dialog__ops">
          <button class="btn" type="button" @click="dialog = false">取消</button>
          <button class="btn btn--primary" type="button" :disabled="!canSave" @click="submit">
            保存
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less">
.tpls {
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

  .tpl {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;

    &__name {
      font-size: 16px;
      font-weight: 600;
      color: var(--app-text);
    }

    &__meta {
      margin: 2px 0 8px;
      font-size: 12px;
      color: var(--app-text-secondary);
    }

    &__teams {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    &__team {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 12px;
      color: var(--app-text);
      background-color: color-mix(in srgb, var(--tpl-c) 16%, transparent);
      border: 1px solid color-mix(in srgb, var(--tpl-c) 45%, transparent);
    }

    &__dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--tpl-c);
    }

    &__ops {
      display: flex;
      gap: 8px;
    }
  }

  .dialog--wide {
    width: min(840px, calc(100vw - 40px));
  }

  .tpl-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background-color: var(--app-bg);

    &__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--app-text);
    }

    &__row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 8px;
      border: 1px solid var(--app-border);
      border-radius: 8px;
    }
    &__dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    &__name {
      width: 70px;
    }

    &__limits {
      display: flex;
      gap: 8px;
      flex: 1;
      min-width: 220px;

      label {
        white-space: nowrap;
        flex: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--app-text-secondary);
      }
    }

    &__empty {
      font-size: 12px;
      color: var(--app-text-secondary);
    }

    &__hint {
      font-size: 11px;
      color: var(--app-text-secondary);
    }
  }
}
</style>
