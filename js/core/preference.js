// 嗜好プロファイル（E5）：産地・精製・焙煎度・品種ごとの好みと、組み合わせの表、味の好みの位置（純粋関数）
// 嗜好スコアはベイズ平均（spec 5.1）：score = (n×平均 + m×全体の平均) ÷ (n + m)、m の初期値は5。
// 件数の少ない区分を全体の平均に寄せ、「1杯だけ飲んだ豆が1位」という誤認を防ぐ。

import { THRESHOLDS, readiness, ratedRows, confidenceOf } from './analysis.js';
import { mean } from './chart-scale.js';
import { ROAST_LEVELS } from './roast.js';
import { DETAIL_ATTRS, INTENSITY_MAX } from './tastings.js';

/** 事前の重み m */
export const PRIOR_WEIGHT = 5;

const r2 = (n) => Math.round(n * 100) / 100;
const clean = (v) => String(v ?? '').normalize('NFKC').trim();

/** 区分の種類 */
export const DIMENSIONS = Object.freeze([
  { key: 'origin', label: '産地', of: (bean) => clean(bean?.origin?.country) },
  { key: 'process', label: '精製', of: (bean) => clean(bean?.process) },
  { key: 'roastLevel', label: '焙煎度', of: (bean) => clean(bean?.roastLevel) },
  { key: 'variety', label: '品種', of: (bean) => clean(bean?.variety) },
]);

const dimOf = (key) => DIMENSIONS.find((d) => d.key === key);

/** ベイズ平均 */
export function bayesScore(n, meanC, meanAll, m = PRIOR_WEIGHT) {
  if (!(n > 0) || meanC == null) return meanAll;
  return (n * meanC + m * meanAll) / (n + m);
}

/**
 * ある区分の好みの並び（嗜好スコアの高い順）。区分の値がない杯は数えない。
 * @returns {{key:string, n:number, mean:number, score:number, confidence:object}[]}
 */
export function preferenceBy(rows, dimKey, m = PRIOR_WEIGHT) {
  const dim = dimOf(dimKey);
  const rated = ratedRows(rows);
  const all = mean(rated.map((r) => r.stars));
  if (!dim || all == null) return [];
  const groups = new Map();
  for (const r of rated) {
    const k = dim.of(r.bean);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r.stars);
  }
  return [...groups.entries()]
    .map(([key, ys]) => {
      const mc = mean(ys);
      return { key, n: ys.length, mean: r2(mc), score: r2(bayesScore(ys.length, mc, all, m)), confidence: confidenceOf(ys.length) };
    })
    .sort((a, b) => b.score - a.score || b.n - a.n || a.key.localeCompare(b.key));
}

/**
 * 組み合わせの表（産地×焙煎度、精製×焙煎度）。マスごとに件数と嗜好スコア。
 * 焙煎度は浅い順、もう一方は件数の多い順。
 * @returns {{rows:string[], cols:string[], cells:Record<string, Record<string, {n:number, score:number}|null>>, mean:number|null}}
 */
export function heatmap(rows, rowDim, colDim = 'roastLevel', m = PRIOR_WEIGHT) {
  const rd = dimOf(rowDim);
  const cd = dimOf(colDim);
  const rated = ratedRows(rows);
  const all = mean(rated.map((r) => r.stars));
  const cells = {};
  const rowCount = new Map();
  const colSet = new Set();
  for (const r of rated) {
    const a = rd?.of(r.bean);
    const b = cd?.of(r.bean);
    if (!a || !b) continue;
    rowCount.set(a, (rowCount.get(a) ?? 0) + 1);
    colSet.add(b);
    ((cells[a] ??= {})[b] ??= []).push(r.stars);
  }
  const rowsOut = [...rowCount.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([k]) => k);
  const order = (v) => (colDim === 'roastLevel' ? (ROAST_LEVELS.indexOf(v) + 1 || 99) : 0);
  const colsOut = [...colSet].sort((x, y) => order(x) - order(y) || x.localeCompare(y));
  const out = {};
  for (const a of rowsOut) {
    out[a] = {};
    for (const b of colsOut) {
      const ys = cells[a]?.[b];
      out[a][b] = ys ? { n: ys.length, score: r2(bayesScore(ys.length, mean(ys), all, m)) } : null;
    }
  }
  return { rows: rowsOut, cols: colsOut, cells: out, mean: all == null ? null : r2(all) };
}

/** 強さの区切り（味の好みの位置） */
export const INTENSITY_BINS = Object.freeze([
  { from: 0, to: 3 },
  { from: 4, to: 6 },
  { from: 7, to: 9 },
  { from: 10, to: 12 },
  { from: 13, to: INTENSITY_MAX },
]);

/**
 * 味の好みの位置：詳細評価（強さ0〜15・好み1〜9）から、項目ごとに好みがいちばん高い強さの区切り。
 * 詳細評価が20件に届くまでは ready:false。区切りは2件以上あるものだけ比べる。
 */
export function likingPeaks(tastings) {
  const detailed = (tastings ?? []).filter(
    (t) => t.deletedAt == null && DETAIL_ATTRS.some((a) => Number.isFinite(t.intensity?.[a.key]) && Number.isFinite(t.liking?.[a.key])),
  );
  const ready = readiness(detailed.length, THRESHOLDS.liking);
  const attrs = DETAIL_ATTRS.map((a) => {
    const pairs = detailed
      .filter((t) => Number.isFinite(t.intensity?.[a.key]) && Number.isFinite(t.liking?.[a.key]))
      .map((t) => ({ x: t.intensity[a.key], y: t.liking[a.key] }));
    const bins = INTENSITY_BINS.map((b) => {
      const ys = pairs.filter((p) => p.x >= b.from && p.x <= b.to).map((p) => p.y);
      return { label: `${b.from}〜${b.to}`, n: ys.length, mean: ys.length ? r2(mean(ys)) : null };
    });
    const usable = bins.filter((b) => b.n >= 2);
    const peak = usable.length ? usable.reduce((x, y) => (y.mean > x.mean ? y : x)) : null;
    return { key: a.key, label: a.label, n: pairs.length, bins, peak };
  });
  return { ready, attrs };
}

/** 嗜好の要約「好きな産地はケニア（★4.3・12杯）」。区分の1位が全体の平均より高いときだけ */
export function topLine(list, label) {
  const top = list[0];
  if (!top) return '';
  return `好きな${label}は${top.key}（スコア${top.score}・${top.n}杯・信頼度${top.confidence.text}）`;
}
