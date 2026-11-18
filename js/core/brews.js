// 抽出の記録（A4）：途中の状態（下書き）、実績の入力チェック、計画との差（純粋関数）
// 抽出の記録は「その時の計画の写し（planned）」と「実績（actual）」を並べて持つ（spec 9章）。
// 後でレシピを直しても、過去の抽出は変わらない。

import { parseNumber } from './beans.js';
import { ratioOf, parseSec, formatSec } from './recipes.js';
import { autoAdvance } from './timer.js';
import { daysBetween } from './freshness.js';
import { localYmd } from './format.js';
import { daysOffRoastFromPortion } from './frozen.js';

/** 下書きの形の版。形を変えたら上げ、古い下書きは捨てる */
export const DRAFT_VERSION = 1;

const round1 = (n) => Math.round(n * 10) / 10;
const clean = (v) => String(v ?? '').normalize('NFKC').trim();

/**
 * 新しい下書き。
 * @param {object} plan planFromRecipe / planFromBrew で作った計画
 * @param {string|null} beanId
 * @param {number|null} startedAtMs スタートした時刻（ミリ秒）。タイマーを使わないときは null
 * @param {object|null} [precheck] 抽出前チェック（A5）で確かめた項目 { temp, rinse, preheat, tare }
 */
export function newDraft(plan, beanId, startedAtMs, precheck = null) {
  return {
    v: DRAFT_VERSION,
    plan,
    beanId: beanId || null,
    startedAtMs,
    precheck: precheck == null ? null : normalizePrecheck(precheck),
    laps: [],
    finishedSec: null,
    stage: startedAtMs == null ? 'result' : 'timer',
    input: null,
  };
}

/** 抽出前チェック（A5）の項目。チェックしなくてもスタートできる */
export const PRECHECK_ITEMS = Object.freeze([
  { key: 'temp', label: '湯温', hint: 'ケトルの湯が計画の温度になっている' },
  { key: 'rinse', label: 'リンス', hint: 'ペーパーフィルターを湯で流した' },
  { key: 'preheat', label: '予熱', hint: 'ドリッパーとサーバーを温めた' },
  { key: 'tare', label: 'スケールの0点', hint: '粉を入れてから0gに合わせた' },
]);

export const PRECHECK_KEYS = Object.freeze(PRECHECK_ITEMS.map((i) => i.key));

/** 抽出前チェックの形をそろえる（知らない項目は捨て、どの項目も true か false） */
export function normalizePrecheck(input) {
  return Object.fromEntries(PRECHECK_KEYS.map((k) => [k, input?.[k] === true]));
}

/** 抽出前チェックで確かめた項目の名前「湯温・リンス」（記録がなければ空文字） */
export function precheckText(precheck) {
  if (!precheck) return '';
  return PRECHECK_ITEMS.filter((i) => precheck[i.key] === true)
    .map((i) => i.label)
    .join('・');
}

/** 下書きとして使える形か（壊れた・古い下書きは捨てるため） */
export function isValidDraft(d) {
  return (
    d != null &&
    typeof d === 'object' &&
    d.v === DRAFT_VERSION &&
    d.plan != null &&
    Array.isArray(d.plan.pours) &&
    Array.isArray(d.laps) &&
    (d.stage === 'timer' || d.stage === 'result')
  );
}

/** スタートからの経過秒（止めたあとは止めた時の秒） */
export function elapsedSec(draft, nowMs) {
  if (draft.finishedSec != null) return draft.finishedSec;
  if (draft.startedAtMs == null) return 0;
  return Math.max(0, (nowMs - draft.startedAtMs) / 1000);
}

/** 落ち切ったので止める。押し忘れた投は null で埋める */
export function finishDraft(draft, nowMs) {
  const sec = round1(elapsedSec(draft, nowMs));
  const pours = draft.plan.pours;
  const laps = autoAdvance(pours, draft.laps, sec);
  while (laps.length < pours.length) laps.push(null);
  return { ...draft, laps, finishedSec: sec, stage: 'result', input: null };
}

/** 実績の注湯：計画の時刻と累計gに、注湯完了を押した秒（押していなければ null）を添える */
export function actualPours(plan, laps) {
  return (plan.pours ?? []).map((p, i) => ({ atSec: p.atSec, toG: p.toG, doneSec: laps[i] ?? null }));
}

/** 実績の確認画面の初期値（計画の値を入れておく） */
export function initialActualInput(draft) {
  const p = draft.plan;
  return {
    beanId: draft.beanId ?? '',
    doseG: p.doseG ?? '',
    waterG: p.waterG ?? '',
    tempC: p.tempC ?? '',
    grindSetting: p.grind?.setting ?? '',
    totalSec: draft.finishedSec != null ? formatSec(draft.finishedSec) : '',
    beverageG: '',
    memo: '',
  };
}

/**
 * 実績の入力を確かめる。数字は文字列でも数でもよい。
 * @returns {{value: object, errors: Record<string,string>}}
 */
export function normalizeActualInput(input) {
  const errors = {};
  const num = (v) => (typeof v === 'number' ? v : parseNumber(v));
  const range = (key, v, lo, hi, msg, required) => {
    const n = num(v);
    if (n == null) {
      if (required) errors[key] = msg;
      return null;
    }
    if (Number.isNaN(n) || n < lo || n > hi) {
      errors[key] = msg;
      return null;
    }
    return round1(n);
  };

  const doseG = range('doseG', input.doseG, 0.1, 100, '粉量は0より大きく100以下の数字（g）で入れてください', true);
  const waterG = range('waterG', input.waterG, 10, 3000, '湯量は10〜3000の数字（g）で入れてください', true);
  const tempC = range('tempC', input.tempC, 50, 100, '湯温は50〜100の数字（℃）で入れてください', false);
  let beverageG = range('beverageG', input.beverageG, 1, 3000, '抽出液の重さは数字（g）で入れてください', false);
  if (beverageG != null && waterG != null && beverageG > waterG) {
    errors.beverageG = '抽出液の重さは湯量より少なくなります。量った値を確かめてください';
    beverageG = null;
  }

  let totalSec = typeof input.totalSec === 'number' ? input.totalSec : parseSec(input.totalSec);
  if (totalSec == null || Number.isNaN(totalSec) || totalSec <= 0 || totalSec > 3600) {
    errors.totalSec = '総時間を「3:30」のように入れてください';
    totalSec = null;
  } else totalSec = Math.round(totalSec);

  return {
    value: {
      beanId: clean(input.beanId) || null,
      doseG,
      waterG,
      tempC,
      grindSetting: clean(input.grindSetting),
      totalSec,
      beverageG,
      memo: clean(input.memo),
    },
    errors,
  };
}

const diffOf = (a, b) => (a == null || b == null ? null : round1(a - b));

/**
 * 計画との差（実績 − 計画）。比べられない項目は null。
 * 時間はレシピの目標時間と比べる。
 */
export function brewDiff(plan, actual) {
  const plannedGrind = clean(plan.grind?.setting);
  const actualGrind = clean(actual.grind?.setting ?? actual.grindSetting);
  return {
    doseG: diffOf(actual.doseG, plan.doseG),
    waterG: diffOf(actual.waterG, plan.waterG),
    tempC: diffOf(actual.tempC, plan.tempC),
    totalSec: diffOf(actual.totalSec, plan.targetTotalSec),
    ratio: diffOf(ratioOf(actual.doseG, actual.waterG), ratioOf(plan.doseG, plan.waterG)),
    grindChanged: plannedGrind !== '' && actualGrind !== '' && plannedGrind !== actualGrind,
  };
}

const signed = (n, unit) => `${n > 0 ? '+' : '−'}${Math.abs(n)}${unit}`;

/** 計画との差を短い文の並びにする（差がない項目は書かない）「湯量 +2g」「時間 +15秒」 */
export function diffLines(diff, plan = {}, actual = {}) {
  const lines = [];
  if (diff.doseG) lines.push(`粉量 ${signed(diff.doseG, 'g')}`);
  if (diff.waterG) lines.push(`湯量 ${signed(diff.waterG, 'g')}`);
  if (diff.tempC) lines.push(`湯温 ${signed(diff.tempC, '℃')}`);
  if (diff.grindChanged) lines.push(`挽き目 ${clean(plan.grind?.setting)}→${clean(actual.grind?.setting ?? actual.grindSetting)}`);
  if (diff.totalSec) lines.push(`時間 ${signed(Math.round(diff.totalSec), '秒')}`);
  return lines;
}

/** 計画の写しから、抽出の記録に要らない項目（どこから写したか等）を外す */
function plannedCopy(plan) {
  const { source, fromBrewId, beanId, ratio, suggestionId, ...rest } = plan;
  return JSON.parse(JSON.stringify(rest));
}

/**
 * 保存する抽出の記録の中身（id・日時の共通項目は db 側で付ける）
 * @param {{draft:object, value:object, at:string, bean?:object|null}} p
 *   value は normalizeActualInput の value、at は抽出の日時（ISO）、bean は選んだ豆（焙煎後日数の計算用）
 * @param {object|null} [p.portion] 冷凍の袋を使ったとき、その袋（冷凍中の日数を焙煎後日数に数えない）
 */
export function buildBrew({ draft, value, at, bean = null, portion = null }) {
  const plan = draft.plan;
  const actual = {
    doseG: value.doseG,
    waterG: value.waterG,
    tempC: value.tempC,
    grind: { grinderId: plan.grind?.grinderId ?? null, setting: value.grindSetting },
    pours: actualPours(plan, draft.laps),
    totalSec: value.totalSec,
    beverageG: value.beverageG,
    tdsPct: null,
  };
  const diff = brewDiff(plan, actual);
  const usePortion = portion && portion.beanId === value.beanId ? portion : null;
  const daysOffRoast = usePortion
    ? daysOffRoastFromPortion(usePortion, localYmd(at), localYmd(at))
    : bean?.roastDate
      ? daysBetween(bean.roastDate, localYmd(at))
      : null;
  return {
    at,
    beanId: value.beanId,
    recipeId: plan.recipeId ?? null,
    recipeVersion: plan.recipeVersion ?? null,
    suggestionId: plan.suggestionId ?? null, // ダイヤルイン提案（F1）を入れた計画で淹れたとき、その提案
    frozenPortionId: usePortion?.id ?? null, // 冷凍の袋（C4）を使ったとき、その袋（保存すると取り出したことになる）
    equipment: { ...(plan.equipment ?? {}), grinderId: plan.grind?.grinderId ?? null },
    planned: plannedCopy(plan),
    actual,
    timerUsed: draft.startedAtMs != null,
    precheck: draft.precheck ? normalizePrecheck(draft.precheck) : null, // 抽出前チェック（A5）。チェックの欄を使わなかった杯は null
    beanState: null,
    context: {},
    derived: { ratio: ratioOf(actual.doseG, actual.waterG), daysOffRoast, diff },
    memo: value.memo,
  };
}
