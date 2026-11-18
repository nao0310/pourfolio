// 条件と評価（E4）：挽き目・湯温・比率・焙煎後日数と★の関係、焙煎度ごとの飲み頃カーブ（純粋関数）
// 相関は「一緒に動いている」だけで原因とは限らない（spec 5.3）。画面でも必ずそう添える。

import { isIced } from './plan-adjust.js';
import { THRESHOLDS, readiness, ratedRows } from './analysis.js';
import { linearFit, correlationWord, mean } from './chart-scale.js';
import { ROAST_LEVELS } from './roast.js';

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').normalize('NFKC').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const r1 = (n) => Math.round(n * 10) / 10;

/** 条件の種類 */
export const FACTORS = Object.freeze([
  { key: 'grind', label: '挽き目', unit: '', hint: '数字が小さいほど細かい' },
  { key: 'tempC', label: '湯温', unit: '℃', hint: '' },
  { key: 'ratio', label: '比率', unit: '', hint: '1:x の x。大きいほど薄い' },
  { key: 'days', label: '焙煎後日数', unit: '日', hint: '' },
]);

/** いちばん多く使ったグラインダー（挽き目の比べはこの1台だけにする。目盛りはグラインダーごとに違うため） */
export function mainGrinderId(rows) {
  const count = new Map();
  for (const r of rows) {
    const id = r.brew.actual?.grind?.grinderId ?? r.brew.equipment?.grinderId ?? null;
    if (id == null) continue;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  let best = null;
  for (const [id, n] of count) if (best == null || n > count.get(best)) best = id;
  return best;
}

/** その杯の条件の値（数字でなければ null） */
export function factorValue(row, key, grinderId = null) {
  const a = row.brew.actual ?? {};
  if (key === 'grind') {
    const id = a.grind?.grinderId ?? row.brew.equipment?.grinderId ?? null;
    if (grinderId != null && id !== grinderId) return null;
    return num(a.grind?.setting);
  }
  if (key === 'tempC') return num(a.tempC);
  if (key === 'ratio') return row.metrics.ratio;
  if (key === 'days') return num(row.brew.derived?.daysOffRoast);
  return null;
}

/**
 * 条件ごとの点・傾向線・言葉。★のある杯が20杯に届くまでは ready:false
 * @param {object[]} rows analysisRows の結果
 */
export function factorAnalysis(rows) {
  const rated = ratedRows(rows).filter((r) => !isIced(r.brew)); // アイスは比率（お湯だけ）が比べられない
  const ready = readiness(rated.length, THRESHOLDS.factors);
  const grinderId = mainGrinderId(rated);
  const factors = FACTORS.map((f) => {
    const points = rated
      .map((r) => ({ x: factorValue(r, f.key, grinderId), y: r.stars, brewId: r.brew.id }))
      .filter((p) => p.x != null);
    const fit = points.length >= 5 ? linearFit(points) : null;
    const word = fit ? correlationWord(fit.r) : { level: 'none', text: points.length < 5 ? '記録が少なくて分かりません' : '値が1つしかなく分かりません' };
    return { ...f, points, fit, word, n: points.length };
  });
  // 関係の強い順（|r| の大きい順）
  const ranked = factors.filter((f) => f.fit).sort((a, b) => Math.abs(b.fit.r) - Math.abs(a.fit.r));
  return { ready, grinderId, factors, strongest: ranked[0]?.word.level !== 'none' ? ranked[0] ?? null : null };
}

/** 焙煎後日数の区切り（飲み頃カーブ） */
export const DAY_BINS = Object.freeze([
  { from: 0, to: 3, label: '0〜3日' },
  { from: 4, to: 7, label: '4〜7日' },
  { from: 8, to: 11, label: '8〜11日' },
  { from: 12, to: 15, label: '12〜15日' },
  { from: 16, to: 21, label: '16〜21日' },
  { from: 22, to: 30, label: '22〜30日' },
  { from: 31, to: Infinity, label: '31日〜' },
]);

/**
 * 焙煎度ごとの飲み頃カーブ。同じ焙煎度で5袋に届いた焙煎度だけ曲線を出す。
 * @returns {{level:string, bags:number, ready:object, bins:{label:string, mid:number, n:number, mean:number|null}[], peak:object|null}[]}
 */
export function roastCurves(rows) {
  const rated = ratedRows(rows).filter((r) => r.bean?.roastLevel && num(r.brew.derived?.daysOffRoast) != null);
  const byLevel = new Map();
  for (const r of rated) {
    const lv = r.bean.roastLevel;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(r);
  }
  const order = (lv) => {
    const i = ROAST_LEVELS.indexOf(lv);
    return i < 0 ? 99 : i;
  };
  return [...byLevel.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([level, list]) => {
      const bags = new Set(list.map((r) => r.bean.id)).size;
      const bins = DAY_BINS.map((b) => {
        const ys = list.filter((r) => {
          const d = num(r.brew.derived.daysOffRoast);
          return d >= b.from && d <= b.to;
        }).map((r) => r.stars);
        return { label: b.label, mid: Number.isFinite(b.to) ? (b.from + b.to) / 2 : b.from + 3, n: ys.length, mean: ys.length ? r1(mean(ys)) : null };
      });
      const withData = bins.filter((b) => b.n >= 2);
      const peak = withData.length ? withData.reduce((a, b) => (b.mean > a.mean ? b : a)) : null;
      return { level, bags, cups: list.length, ready: readiness(bags, THRESHOLDS.roastCurveBags), bins, peak };
    });
}
