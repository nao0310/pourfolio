// ダイヤルインの道のり（E2）：豆ごとに、何を変えて評価がどう動いたか（純粋関数）
// 1つの豆で3杯から表示する。ダイヤルインの速さ＝自己ベストの9割に届くまでの杯数（spec 5.1）。

import { THRESHOLDS, readiness } from './analysis.js';
import { ratioOf } from './recipes.js';

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').normalize('NFKC').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const grindOf = (brew) => String(brew?.actual?.grind?.setting ?? '').normalize('NFKC').trim();
const r1 = (n) => Math.round(n * 10) / 10;
const signed = (n) => `${n > 0 ? '+' : '−'}${Math.abs(r1(n))}`;

/**
 * 前の杯から変えた条件の短い文の並び「挽き目 24→23」「比率 1:15→1:15.5」「湯温 +2℃」「粉量 +1g」「レシピを変えた」
 */
export function changesBetween(prev, cur) {
  if (!prev || !cur) return [];
  const out = [];
  const pa = prev.actual ?? {};
  const ca = cur.actual ?? {};
  if ((prev.recipeId ?? null) !== (cur.recipeId ?? null)) out.push('レシピを変えた');
  const g0 = grindOf(prev);
  const g1 = grindOf(cur);
  if (g0 && g1 && g0 !== g1) out.push(`挽き目 ${g0}→${g1}`);
  const ratio0 = ratioOf(pa.doseG, pa.waterG);
  const ratio1 = ratioOf(ca.doseG, ca.waterG);
  if (ratio0 != null && ratio1 != null && Math.abs(ratio1 - ratio0) >= 0.3) out.push(`比率 1:${ratio0}→1:${ratio1}`);
  const t0 = num(pa.tempC);
  const t1 = num(ca.tempC);
  if (t0 != null && t1 != null && Math.abs(t1 - t0) >= 1) out.push(`湯温 ${signed(t1 - t0)}℃`);
  const d0 = num(pa.doseG);
  const d1 = num(ca.doseG);
  if (d0 != null && d1 != null && Math.abs(d1 - d0) >= 0.5) out.push(`粉量 ${signed(d1 - d0)}g`);
  return out;
}

/**
 * 自己ベストの9割に初めて届いた杯（1から数える）。★がなければ null
 * @param {(number|null)[]} stars 杯の順の★
 */
export function cupsToNinety(stars) {
  const vals = stars.filter((s) => Number.isFinite(s));
  if (!vals.length) return null;
  const goal = Math.max(...vals) * 0.9;
  const i = stars.findIndex((s) => Number.isFinite(s) && s >= goal - 1e-9);
  return i < 0 ? null : i + 1;
}

/**
 * 豆ごとの道のり（最後に淹れた豆が先）。
 * @param {object[]} rows analysisRows の結果
 * @param {object[]} [suggestions] 提案ログ（その杯で使った提案の文を出す）
 * @returns {{bean:object, cups:object[], ready:object, best:number|null, cupsTo90:number|null, lastAt:string}[]}
 */
export function beanJourneys(rows, suggestions = []) {
  const sugOf = new Map((suggestions ?? []).filter((s) => s.deletedAt == null).map((s) => [s.id, s]));
  const groups = new Map();
  for (const r of rows) {
    if (!r.bean) continue;
    if (!groups.has(r.bean.id)) groups.set(r.bean.id, []);
    groups.get(r.bean.id).push(r);
  }
  const out = [];
  for (const list of groups.values()) {
    const cups = list.map((r, i) => {
      const used = r.brew.suggestionId ? sugOf.get(r.brew.suggestionId) : null;
      return {
        n: i + 1,
        brewId: r.brew.id,
        at: r.at,
        ymd: r.ymd,
        stars: r.stars,
        changes: changesBetween(list[i - 1]?.brew, r.brew),
        suggestion: used?.action?.short ?? used?.action?.text ?? '',
        defects: r.tasting?.defects ?? [],
        grind: grindOf(r.brew),
        ratio: r.metrics.ratio,
      };
    });
    const stars = cups.map((c) => c.stars);
    const rated = stars.filter((s) => s != null);
    out.push({
      bean: list[0].bean,
      cups,
      ready: readiness(cups.length, THRESHOLDS.dialin),
      best: rated.length ? Math.max(...rated) : null,
      cupsTo90: cupsToNinety(stars),
      lastAt: list[list.length - 1].at,
    });
  }
  return out.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}

/** ダイヤルインの速さの平均（9割に届いた豆だけ、杯数の平均。豆が2つ未満なら null） */
export function averageCupsTo90(journeys) {
  const xs = journeys.filter((j) => j.ready.ready && j.cupsTo90 != null).map((j) => j.cupsTo90);
  return xs.length >= 2 ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}
