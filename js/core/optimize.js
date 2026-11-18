// 実験プランナーの最適化モード（F7、spec 6.6）：純粋関数
// 豆1つについて、挽き目と比率（選べば湯温も）の範囲を決めると、その豆で淹れて★を付けた杯から
// 「次に試すと最も学びが大きい条件」を出す。ベイズ最適化（ガウス過程と期待改善量 EI）をブラウザの中で計算する。
//
// - 範囲は 0〜1 に直して計算する。カーネルは RBF（長さ LENGTH_SCALE）、★のばらつき（ノイズ）を NOISE_SD とみる
// - 予想の土台（平均）は、その豆の★の平均。データがないところは「分からない」（幅が広い）になる
// - 範囲の格子の中で EI がいちばん大きい所を次の条件にする。乱数は使わない（同じ記録なら同じ答え）
// - ★の付いた杯が MIN_POINTS に届くまでは、範囲の中に散らばるように決めた所（INITIAL_DESIGN）を順に出す
// 1つの記録は Experiment（kind 'optimize'）。淹れた杯はつながず、その豆の杯（同じグラインダー）を毎回集め直す。

import { OPTIMIZE_KIND } from './compare.js';
import { DEFAULT_GRIND_STEP, RATIO_STEP } from './dialin.js';
import { ratioOf } from './recipes.js';
import { isIced } from './plan-adjust.js';

const clean = (v) => String(v ?? '').normalize('NFKC').trim();
const alive = (r) => r && r.deletedAt == null;
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = clean(v);
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const decimals = (step) => (String(step).split('.')[1] ?? '').length;
const roundTo = (n, step) => Number((Math.round(n / step) * step).toFixed(decimals(step)));
const r1 = (n) => Math.round(n * 10) / 10;

export const LENGTH_SCALE = 0.3;
export const NOISE_SD = 0.5;
export const SIGNAL_SD = 1;
export const MIN_POINTS = 3;
/** EI がこれより小さいと「これ以上はあまり良くなりそうにない」 */
export const EI_SMALL = 0.05;
/** 動かす条件と刻み */
export const OPT_FACTORS = Object.freeze({
  grind: { label: '挽き目', step: DEFAULT_GRIND_STEP },
  ratio: { label: '比率', step: RATIO_STEP },
  tempC: { label: '湯温', step: 1 },
});
const LIMITS = Object.freeze({ ratio: [8, 25], tempC: [60, 100], grind: [0, 1000] });
/** 最初に試す所（0〜1。[挽き目, 比率, 湯温]） */
export const INITIAL_DESIGN = Object.freeze([
  [0.5, 0.5, 0.5],
  [0.2, 0.75, 0.25],
  [0.8, 0.25, 0.75],
  [0.2, 0.25, 0.75],
  [0.8, 0.75, 0.25],
]);

/** 使う条件の並び（湯温は範囲があるときだけ） */
export const dimsOf = (exp) => (exp?.ranges?.tempC ? ['grind', 'ratio', 'tempC'] : ['grind', 'ratio']);
/** 挽き目の刻み（グラインダーの1目盛り） */
const stepOf = (exp, k) => (k === 'grind' ? (exp?.grindStep > 0 ? exp.grindStep : DEFAULT_GRIND_STEP) : OPT_FACTORS[k].step);

/** 範囲の初期値：レシピの値のまわり（挽き目±4目盛り、比率±1.5、湯温±4℃） */
export function defaultRanges(recipe, grindStep = DEFAULT_GRIND_STEP) {
  const g = num(recipe?.grind?.setting);
  const r = ratioOf(recipe?.doseG, recipe?.waterG);
  const t = num(recipe?.tempC);
  return {
    grind: g == null ? null : [Math.max(0, roundTo(g - 4 * grindStep, grindStep)), roundTo(g + 4 * grindStep, grindStep)],
    ratio: r == null ? null : [roundTo(Math.max(LIMITS.ratio[0], r - 1.5), RATIO_STEP), roundTo(Math.min(LIMITS.ratio[1], r + 1.5), RATIO_STEP)],
    tempC: t == null ? null : [Math.max(LIMITS.tempC[0], Math.round(t - 4)), Math.min(LIMITS.tempC[1], Math.round(t + 4))],
  };
}

/**
 * 始める入力を確かめる
 * @param {{beanId:string, recipeId:string, ranges:{grind:[any,any], ratio:[any,any], tempC?:[any,any]|null}, useTemp?:boolean}} input
 * @param {{beans:object[], recipes:object[], grinders?:object[]}} ctx
 */
export function normalizeOptimizeInput(input, { beans, recipes, grinders = [] }) {
  const errors = {};
  const bean = (beans ?? []).find((b) => alive(b) && b.id === input?.beanId && b.status !== 'finished' && b.status !== 'ordered') ?? null;
  if (!bean) errors.beanId = '豆を選んでください';
  const recipe = (recipes ?? []).find((r) => alive(r) && r.id === input?.recipeId) ?? null;
  if (!recipe) errors.recipeId = '淹れるレシピを選んでください';
  else if (num(recipe.grind?.setting) == null) errors.recipeId = 'このレシピの挽き目が数字ではありません。挽き目が数字のレシピを選んでください';
  const grinderId = recipe?.grind?.grinderId ?? null;
  const grinder = (grinders ?? []).find((g) => g.id === grinderId) ?? null;
  const gs = num(grinder?.attrs?.step);
  const grindStep = gs > 0 ? gs : DEFAULT_GRIND_STEP;
  const range = (key, raw) => {
    const lo = num(raw?.[0]);
    const hi = num(raw?.[1]);
    const [min, max] = LIMITS[key];
    if (lo == null || hi == null) return { error: `${OPT_FACTORS[key].label}の範囲を数字で入れてください` };
    if (lo < min || hi > max) return { error: `${OPT_FACTORS[key].label}は${min}〜${max}の間にしてください` };
    const step = key === 'grind' ? grindStep : OPT_FACTORS[key].step;
    if (hi - lo < step * 2) return { error: `${OPT_FACTORS[key].label}の範囲が狭すぎます（3段階以上にしてください）` };
    if ((hi - lo) / step > 60) return { error: `${OPT_FACTORS[key].label}の範囲が広すぎます` };
    return { value: [roundTo(lo, step), roundTo(hi, step)] };
  };
  const ranges = {};
  for (const key of ['grind', 'ratio', ...(input?.useTemp ? ['tempC'] : [])]) {
    const r = range(key, input?.ranges?.[key]);
    if (r.error) errors[key] = r.error;
    else ranges[key] = r.value;
  }
  if (!input?.useTemp) ranges.tempC = null;
  return { value: { beanId: bean?.id ?? null, recipeId: recipe?.id ?? null, grinderId, grindStep, ranges }, errors, bean, recipe };
}

/** 保存する最適化の記録（id・日時の共通項目は db 側で付ける） */
export function buildOptimizeExperiment({ value, bean }) {
  return {
    kind: OPTIMIZE_KIND,
    title: `${clean(bean.name)} の最適化`,
    blind: false,
    beanId: value.beanId,
    recipeId: value.recipeId,
    grinderId: value.grinderId,
    grindStep: value.grindStep,
    ranges: { grind: [...value.ranges.grind], ratio: [...value.ranges.ratio], tempC: value.ranges.tempC ? [...value.ranges.tempC] : null },
    entries: [],
    ratings: [],
    revealedAt: null, // 「終える」で日時が入る
  };
}

/**
 * 学びに使う杯：その豆で★の付いた杯（アイスと別のグラインダーは除く）。範囲から1刻みはみ出した杯まで使う
 * @param {object} exp
 * @param {object[]} rows core/analysis.js の analysisRows の結果
 * @returns {{x:Record<string,number>, y:number, brewId:string, at:string}[]}
 */
export function optimizePoints(exp, rows) {
  const dims = dimsOf(exp);
  const out = [];
  for (const r of rows ?? []) {
    if (r.brew?.beanId !== exp.beanId || r.stars == null || isIced(r.brew)) continue;
    const a = r.brew.actual ?? {};
    const gid = a.grind?.grinderId ?? r.brew.equipment?.grinderId ?? null;
    if (exp.grinderId != null && gid != null && gid !== exp.grinderId) continue;
    const raw = { grind: num(a.grind?.setting), ratio: r.metrics?.ratio ?? ratioOf(a.doseG, a.waterG), tempC: num(a.tempC) };
    if (dims.some((k) => raw[k] == null)) continue;
    const x = Object.fromEntries(dims.map((k) => [k, raw[k]])); // 動かさない条件（湯温）は持たない
    const inside = dims.every((k) => {
      const [lo, hi] = exp.ranges[k];
      const s = stepOf(exp, k);
      return x[k] >= lo - s && x[k] <= hi + s;
    });
    if (!inside) continue;
    out.push({ x, y: r.stars, brewId: r.brew.id, at: r.brew.at });
  }
  return out;
}

/** 0〜1 に直す（範囲の外は 0〜1 の外になる） */
function toUnit(exp, x) {
  return dimsOf(exp).map((k) => {
    const [lo, hi] = exp.ranges[k];
    return hi > lo ? (x[k] - lo) / (hi - lo) : 0.5;
  });
}

const kernel = (a, b, ls = LENGTH_SCALE) => {
  let d2 = 0;
  for (let i = 0; i < a.length; i++) d2 += (a[i] - b[i]) ** 2;
  return SIGNAL_SD ** 2 * Math.exp(-d2 / (2 * ls * ls));
};

/** コレスキー分解（下三角）。対称正定値でなければ null */
export function cholesky(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

/** L y = b を解く */
function forward(L, b) {
  const y = new Array(b.length);
  for (let i = 0; i < b.length; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  return y;
}
/** Lᵀ x = y を解く */
function backward(L, y) {
  const n = y.length;
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/**
 * ガウス過程を当てはめる
 * @param {number[][]} X 0〜1 に直した点
 * @param {number[]} y ★
 * @returns {{predict:(x:number[])=>{mean:number, sd:number}, prior:number}}
 */
export function gpFit(X, y, { lengthScale = LENGTH_SCALE, noiseSd = NOISE_SD } = {}) {
  const n = X.length;
  const prior = n ? y.reduce((a, b) => a + b, 0) / n : 3;
  if (n === 0) return { prior, predict: () => ({ mean: prior, sd: SIGNAL_SD }) };
  const K = X.map((a, i) => X.map((b, j) => kernel(a, b, lengthScale) + (i === j ? noiseSd ** 2 : 0)));
  const L = cholesky(K);
  const alpha = backward(L, forward(L, y.map((v) => v - prior)));
  return {
    prior,
    predict(x) {
      const k = X.map((a) => kernel(a, x, lengthScale));
      const mean = prior + k.reduce((s, v, i) => s + v * alpha[i], 0);
      const v = forward(L, k);
      const variance = Math.max(1e-9, SIGNAL_SD ** 2 - v.reduce((s, a) => s + a * a, 0));
      return { mean, sd: Math.sqrt(variance) };
    },
  };
}

/** 標準正規分布の密度と累積（Abramowitz–Stegun の近似） */
const pdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
export function cdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = pdf(z) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - d : d;
}

/** 期待改善量（今のいちばん best より、どれだけ良くなりそうか） */
export function expectedImprovement(mean, sd, best, xi = 0.01) {
  if (!(sd > 1e-9)) return Math.max(0, mean - best - xi);
  const z = (mean - best - xi) / sd;
  return (mean - best - xi) * cdf(z) + sd * pdf(z);
}

/** 範囲の格子（条件ごとの刻みで、全部の組み合わせ） */
export function candidateGrid(exp) {
  const dims = dimsOf(exp);
  const axes = dims.map((k) => {
    const [lo, hi] = exp.ranges[k];
    const s = stepOf(exp, k);
    const list = [];
    for (let v = lo; v <= hi + s / 1000; v += s) list.push(roundTo(v, s));
    return list;
  });
  let out = [{}];
  dims.forEach((k, i) => {
    out = out.flatMap((p) => axes[i].map((v) => ({ ...p, [k]: v })));
  });
  return out;
}

/** 0〜1 の点を、範囲の格子のいちばん近い値にする */
function fromUnit(exp, u) {
  const x = {};
  dimsOf(exp).forEach((k, i) => {
    const [lo, hi] = exp.ranges[k];
    const s = stepOf(exp, k);
    x[k] = Math.min(hi, Math.max(lo, roundTo(lo + (hi - lo) * u[i], s)));
  });
  return x;
}

/** 条件の言葉「挽き目 22・比率 1:15.5・湯温 92℃」 */
export function trialText(x) {
  return [x.grind != null ? `挽き目 ${x.grind}` : '', x.ratio != null ? `比率 1:${x.ratio}` : '', x.tempC != null ? `湯温 ${x.tempC}℃` : ''].filter(Boolean).join('・');
}

/**
 * 次に試す条件
 * @param {object} exp 最適化の記録
 * @param {{x:object, y:number}[]} points optimizePoints の結果
 * @returns {{phase:'explore'|'ei', x:object, mean:number|null, sd:number|null, ei:number|null, small:boolean, reason:string, left:number}}
 */
export function nextTrial(exp, points) {
  const dims = dimsOf(exp);
  const U = points.map((p) => toUnit(exp, p.x));
  if (points.length < MIN_POINTS) {
    // 最初は散らばるように：すでに試した所の近く（0.15 以内）は飛ばす
    const near = (u) => U.some((p) => Math.hypot(...p.map((v, i) => v - u[i])) < 0.15);
    const design = INITIAL_DESIGN.map((d) => d.slice(0, dims.length)).find((d) => !near(d)) ?? INITIAL_DESIGN[0].slice(0, dims.length);
    const left = MIN_POINTS - points.length;
    return { phase: 'explore', x: fromUnit(exp, design), mean: null, sd: null, ei: null, small: false, left, reason: `まず範囲の中を広く試します（あと${left}杯で、★から選び始めます）` };
  }
  const gp = gpFit(U, points.map((p) => p.y));
  const best = Math.max(...points.map((p) => p.y));
  let pick = null;
  for (const x of candidateGrid(exp)) {
    const { mean, sd } = gp.predict(toUnit(exp, x));
    const ei = expectedImprovement(mean, sd, best);
    if (!pick || ei > pick.ei + 1e-12) pick = { x, mean, sd, ei };
  }
  const small = pick.ei < EI_SMALL;
  const reason = small
    ? 'これ以上はあまり良くなりそうにありません。「今のいちばん」で淹れるか、範囲を変えます'
    : `${points.length}杯の★から、いちばん良くなりそうな所（予想 ★${r1(pick.mean)} ±${r1(pick.sd)}）`;
  return { ...pick, mean: r1(pick.mean), sd: r1(pick.sd), ei: Math.round(pick.ei * 100) / 100, phase: 'ei', small, left: 0, reason };
}

/**
 * 予想がいちばん良い条件（試した杯の中から。同じ条件の杯をまとめて予想する）
 * @returns {{x:object, mean:number, n:number, stars:number[]}|null}
 */
export function bestKnown(exp, points) {
  if (!points.length) return null;
  const gp = points.length >= MIN_POINTS ? gpFit(points.map((p) => toUnit(exp, p.x)), points.map((p) => p.y)) : null;
  const groups = new Map();
  for (const p of points) {
    const k = dimsOf(exp).map((d) => p.x[d]).join('|');
    if (!groups.has(k)) groups.set(k, { x: p.x, stars: [] });
    groups.get(k).stars.push(p.y);
  }
  let best = null;
  for (const g of groups.values()) {
    const avg = g.stars.reduce((a, b) => a + b, 0) / g.stars.length;
    const mean = gp ? gp.predict(toUnit(exp, g.x)).mean : avg;
    if (!best || mean > best.mean) best = { x: g.x, mean: r1(mean), n: g.stars.length, stars: g.stars };
  }
  return best;
}

/**
 * 条件を淹れる画面の URL にする（粉量はレシピのまま、比率は湯量で）
 * @returns {string} brew.html?…
 */
export function trialHref(exp, recipe, x) {
  const q = new URLSearchParams({ recipe: exp.recipeId ?? '', bean: exp.beanId ?? '' });
  if (x.grind != null) q.set('grind', String(x.grind));
  if (x.ratio != null && recipe?.doseG > 0) q.set('water', String(Math.round(recipe.doseG * x.ratio)));
  if (x.tempC != null) q.set('temp', String(x.tempC));
  q.set('via', 'optimize');
  return `brew.html?${q}`;
}

/**
 * 挽き目×比率の予想の表（湯温は fixed の値）。points が MIN_POINTS に届かなければ null
 * @returns {{grinds:number[], ratios:number[], cells:number[][]}|null} cells[ratioの順][挽き目の順] は予想の★
 */
export function predictionTable(exp, points, fixed = {}) {
  if (points.length < MIN_POINTS) return null;
  const gp = gpFit(points.map((p) => toUnit(exp, p.x)), points.map((p) => p.y));
  const axis = (k) => {
    const [lo, hi] = exp.ranges[k];
    const s = stepOf(exp, k);
    const list = [];
    for (let v = lo; v <= hi + s / 1000; v += s) list.push(roundTo(v, s));
    // 多すぎると読めないので、9つほどに間引く
    const every = Math.max(1, Math.ceil(list.length / 9));
    return list.filter((_, i) => i % every === 0 || i === list.length - 1);
  };
  const grinds = axis('grind');
  const ratios = axis('ratio');
  const tempC = exp.ranges.tempC ? fixed.tempC ?? Math.round((exp.ranges.tempC[0] + exp.ranges.tempC[1]) / 2) : undefined;
  const cells = ratios.map((ratio) => grinds.map((grind) => r1(gp.predict(toUnit(exp, { grind, ratio, tempC })).mean)));
  return { grinds, ratios, tempC: tempC ?? null, cells };
}
