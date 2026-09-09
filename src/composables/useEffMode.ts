import { ref } from "vue";
import { effScore } from "../types/schedule";

/**
 * 全局：是否使用“修正后伤害/奶量”（乘职业补正系数）。
 * 勾选（默认）= 所有页面的展示与门槛比较都用 score×职业系数；
 * 不勾选 = 使用原始 score。
 */
export const useEff = ref(true);

/** 当前口径下的角色数值 */
export function valOf(job: string, score: number): number {
  return useEff.value ? effScore(job, score) : score;
}

/** 当前口径下角色数值展示（保留 2 位小数） */
export function fmtVal(job: string, score: number): string {
  return valOf(job, score).toFixed(2);
}
