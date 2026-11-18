// 冷凍ストック（C4、純粋関数）
// 豆の一部を小分けの袋（FrozenPortion）にして冷凍し、1袋ずつ取り出して使う。
// - 冷凍すると、常温の残量から「冷凍」の在庫履歴で引く（袋の合計g）
// - 取り出すと、「解凍」の在庫履歴でその袋の量を常温に戻す
// - 豆の合計の残量 ＝ 常温（在庫履歴の合計）＋ 冷凍庫にある袋の合計
// - 冷凍中は焙煎後の日数を数えない（袋には冷凍した時点の焙煎後日数を残す）

import { daysBetween } from './freshness.js';
import { parseNumber } from './beans.js';
import { formatG, formatYmdJa } from './format.js';

/** 1回に作れる袋の数の上限 */
export const MAX_PORTIONS = 30;
/** 1袋の量の上限（g） */
export const MAX_PORTION_G = 1000;

const alive = (r) => r && r.deletedAt == null;
const round1 = (n) => Math.round(n * 10) / 10;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v) => String(v ?? '').normalize('NFKC').trim();

/** 冷凍庫にある（取り出していない・削除していない）袋か */
export const isInFreezer = (p) => alive(p) && p.takenOutAt == null;

/**
 * 冷凍の入力を確かめる
 * @param {{gramsPerPortion?:string, count?:string, frozenDate?:string}} raw フォームの値
 * @param {{availableG:number}} ctx 常温の残量
 * @returns {{value:{gramsPerPortion:number, count:number, frozenDate:string, totalG:number}|null, errors:Record<string,string>}}
 */
export function normalizeFreezeInput(raw = {}, { availableG = 0 } = {}) {
  const errors = {};
  const g = parseNumber(raw.gramsPerPortion);
  if (g == null || Number.isNaN(g) || g <= 0 || g > MAX_PORTION_G) errors.gramsPerPortion = '1袋の量を0より大きい数字（g）で入れてください';
  const n = parseNumber(raw.count);
  if (n == null || !Number.isInteger(n) || n < 1 || n > MAX_PORTIONS) errors.count = `袋の数は1〜${MAX_PORTIONS}で入れてください`;
  const frozenDate = clean(raw.frozenDate);
  if (!YMD.test(frozenDate) || daysBetween(frozenDate, frozenDate) !== 0) errors.frozenDate = '冷凍した日を入れてください';
  if (Object.keys(errors).length) return { value: null, errors };
  const gramsPerPortion = round1(g);
  const totalG = round1(gramsPerPortion * n);
  // 0.1g単位の誤差は許す
  if (totalG > round1(Math.max(0, availableG)) + 0.05) {
    errors.count = `常温の残り（${formatG(Math.max(0, availableG))}）より多くは冷凍できません`;
    return { value: null, errors };
  }
  return { value: { gramsPerPortion, count: n, frozenDate, totalG }, errors };
}

/**
 * 新しい袋の番号。冷凍庫にある袋と重ならない、小さい番号から順に使う（袋に書く番号が大きくならないように）
 * @param {object[]} portions 全部の袋
 * @param {number} count
 * @returns {number[]}
 */
export function nextLabelNos(portions, count) {
  const used = new Set((portions ?? []).filter(isInFreezer).map((p) => p.labelNo));
  const out = [];
  for (let no = 1; out.length < count; no += 1) if (!used.has(no)) out.push(no);
  return out;
}

/**
 * 冷凍する袋の中身（id・日時の共通項目は db 側で付ける）
 * @param {{bean:object, value:object, labelNos:number[], freezeTxId?:string|null}} p
 */
export function buildPortions({ bean, value, labelNos, freezeTxId = null }) {
  const roastDays = bean?.roastDate ? daysBetween(bean.roastDate, value.frozenDate) : null;
  return labelNos.slice(0, value.count).map((labelNo) => ({
    beanId: bean.id,
    labelNo,
    grams: value.gramsPerPortion,
    frozenDate: value.frozenDate,
    roastDaysAtFreeze: roastDays != null && roastDays >= 0 ? roastDays : null,
    freezeTxId,
    takenOutAt: null,
    takenOutBrewId: null,
  }));
}

/** 番号の一覧を「#1〜#4」「#1・#3」の形にする */
export function labelRange(nos) {
  const s = [...nos].sort((a, b) => a - b);
  if (!s.length) return '';
  const contiguous = s.every((n, i) => i === 0 || n === s[i - 1] + 1);
  if (s.length > 2 && contiguous) return `#${s[0]}〜#${s[s.length - 1]}`;
  return s.map((n) => `#${n}`).join('・');
}

/** 冷凍の在庫履歴のメモ「#1〜#4（15g×4袋）」 */
export function freezeMemo(value, labelNos) {
  return `${labelRange(labelNos)}（${formatG(value.gramsPerPortion)}×${value.count}袋）`;
}

/** その豆の冷凍庫にある袋（古い順：冷凍日→番号） */
export function portionsOf(portions, beanId) {
  return (portions ?? [])
    .filter((p) => isInFreezer(p) && p.beanId === beanId)
    .sort((a, b) => String(a.frozenDate).localeCompare(String(b.frozenDate)) || a.labelNo - b.labelNo);
}

/** 袋の合計g */
export function frozenG(portions) {
  return round1((portions ?? []).filter(isInFreezer).reduce((s, p) => s + (Number(p.grams) || 0), 0));
}

/** 袋を豆ごとに分ける（冷凍庫にあるものだけ） { beanId: [portion, …] } */
export function groupPortionsByBean(portions) {
  const out = {};
  for (const p of portions ?? []) if (isInFreezer(p)) (out[p.beanId] ??= []).push(p);
  return out;
}

/** 冷凍庫にある袋の数（全部の豆） */
export function freezerCount(portions) {
  return (portions ?? []).filter(isInFreezer).length;
}

/**
 * 抽出に使う袋の候補：古い袋から（冷凍日→番号）
 * @returns {object|null}
 */
export function pickPortionForBrew(portions, beanId) {
  return portionsOf(portions, beanId)[0] ?? null;
}

/**
 * 実績の確認で「冷凍の袋を使う」を出すか、初めから印を付けるか。
 * 袋があれば出し、常温の残りが粉量に足りないときだけ初めから印を付ける。
 * @returns {{portion:object|null, checked:boolean}}
 */
export function frozenChoice({ portions, beanId, roomG, doseG }) {
  const portion = beanId ? pickPortionForBrew(portions, beanId) : null;
  if (!portion) return { portion: null, checked: false };
  const need = Number(doseG) > 0 ? Number(doseG) : 0;
  return { portion, checked: (Number(roomG) || 0) + 0.05 < need };
}

/**
 * 冷凍した豆で淹れたときの焙煎後日数（冷凍中の日数を数えない）
 * ＝ 冷凍した時点の焙煎後日数 ＋ 取り出してから淹れるまでの日数
 * @returns {number|null}
 */
export function daysOffRoastFromPortion(portion, takenOutYmd, brewYmd) {
  if (portion?.roastDaysAtFreeze == null) return null;
  const after = daysBetween(takenOutYmd, brewYmd);
  return portion.roastDaysAtFreeze + Math.max(0, after ?? 0);
}

/** 袋1つの説明「#3　15g・11/10に冷凍（焙煎後8日）」 */
export function portionText(p) {
  const roast = p.roastDaysAtFreeze != null ? `（焙煎後${p.roastDaysAtFreeze}日）` : '';
  return `#${p.labelNo}　${formatG(p.grams)}・${formatYmdJa(p.frozenDate)}に冷凍${roast}`;
}

/**
 * 残量のまとめ：常温・冷凍・合計
 * @param {number} roomG 常温の残量（在庫履歴の合計）
 * @param {object[]} portions その豆の袋
 */
export function stockParts(roomG, portions) {
  const inFreezer = (portions ?? []).filter(isInFreezer);
  const fz = frozenG(inFreezer);
  const room = round1(Math.max(0, roomG));
  return { roomG: room, frozenG: fz, frozenCount: inFreezer.length, totalG: round1(room + fz) };
}

/** 「常温 40g＋冷凍 4袋（60g）」 */
export function stockPartsText(parts) {
  if (!parts.frozenCount) return `常温 ${formatG(parts.roomG)}`;
  return `常温 ${formatG(parts.roomG)}＋冷凍 ${parts.frozenCount}袋（${formatG(parts.frozenG)}）`;
}
