// 飲み頃の判定（C3、純粋関数）
// 焙煎日からの日数で「休ませ中 → 飲み頃 → ピーク後 → 早めに消費」の4段階にする。
// 日数の初期値は spec 2章の目安（浅煎り5〜12日、中煎り3〜10日、深煎り1〜5日）を8段階に割り振ったもの。
// 「ピーク後」と「早めに消費」の境目は仮の値（DECISIONS D-023）。評価が貯まったら補正する（1-5以降）。

import { roastGroup } from './roast.js';

/**
 * 区分ごとの境目（焙煎日を0日目とした日数）。
 * restUntil 日目までは休ませ中、peakUntil 日目までは飲み頃、pastUntil 日目まではピーク後、それより後は早めに消費。
 */
export const FRESHNESS_WINDOWS = Object.freeze({
  light: { restUntil: 4, peakUntil: 12, pastUntil: 30 },
  medium: { restUntil: 2, peakUntil: 10, pastUntil: 28 },
  mediumDark: { restUntil: 1, peakUntil: 8, pastUntil: 24 },
  dark: { restUntil: 0, peakUntil: 5, pastUntil: 21 },
});

/** 焙煎度がわからないときに使う区分 */
export const FALLBACK_GROUP = 'medium';

export const STAGES = Object.freeze({
  resting: '休ませ中',
  peak: '飲み頃',
  past: 'ピーク後',
  useSoon: '早めに消費',
});

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const ymdToDayNumber = (ymd) => {
  const m = YMD.exec(ymd ?? '');
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
};

/**
 * 焙煎日から今日までの日数（どちらも「2026-11-18」の形。端末の日付で数える）
 * @returns {number|null}
 */
export function daysBetween(fromYmd, toYmd) {
  const a = ymdToDayNumber(fromYmd);
  const b = ymdToDayNumber(toYmd);
  if (a == null || b == null) return null;
  return Math.round(b - a);
}

/**
 * 飲み頃を判定する。
 * @param {string} roastDate 焙煎日「2026-11-08」
 * @param {string} roastLevel 焙煎度（8段階の表記）
 * @param {string} todayYmd 今日「2026-11-18」
 * @returns {{stage:string, label:string, days:number, group:string, window:object, next:{label:string, inDays:number}|null}|null}
 *   焙煎日がない・不正なら null
 */
export function freshness(roastDate, roastLevel, todayYmd) {
  const days = daysBetween(roastDate, todayYmd);
  if (days == null) return null;
  const group = roastGroup(roastLevel) ?? FALLBACK_GROUP;
  const w = FRESHNESS_WINDOWS[group];
  let stage;
  let next = null;
  if (days <= w.restUntil) {
    stage = 'resting';
    next = { label: STAGES.peak, inDays: w.restUntil + 1 - days };
  } else if (days <= w.peakUntil) {
    stage = 'peak';
    next = { label: STAGES.past, inDays: w.peakUntil + 1 - days };
  } else if (days <= w.pastUntil) {
    stage = 'past';
    next = { label: STAGES.useSoon, inDays: w.pastUntil + 1 - days };
  } else {
    stage = 'useSoon';
  }
  return { stage, label: STAGES[stage], days, group, window: w, next };
}
