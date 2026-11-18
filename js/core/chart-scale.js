// グラフの目盛りと座標、傾向線などの小さな計算（純粋関数）。描くのは js/chart.js（SVG）。
// グラフの部品は入れず、SVGを自分で描く（D-116）。

/** 平均（空なら null） */
export function mean(xs) {
  const v = (xs ?? []).filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** 分位点（q は 0〜1、間は直線で補う。空なら null） */
export function quantile(xs, q) {
  const v = (xs ?? []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** 見やすい刻み（1・2・5 × 10のべき） */
function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

const fix = (n) => Number(n.toFixed(10));

/**
 * 目盛り。min〜max を含む切りのよい範囲と、目盛りの値。
 * @returns {{min:number, max:number, step:number, ticks:number[]}}
 */
export function niceTicks(min, max, count = 5) {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, count);
  const nmin = fix(Math.floor(lo / step) * step);
  const nmax = fix(Math.ceil(hi / step) * step);
  const ticks = [];
  for (let t = nmin; t <= nmax + step / 2; t += step) ticks.push(fix(t));
  return { min: nmin, max: nmax, step, ticks };
}

/** 値の範囲 [d0, d1] を画面の範囲 [r0, r1] に移す関数 */
export function linearScale([d0, d1], [r0, r1]) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/**
 * 最小二乗の直線と相関係数。2点未満や x がみな同じなら null。
 * @param {{x:number, y:number}[]} points
 * @returns {{slope:number, intercept:number, r:number, n:number}|null}
 */
export function linearFit(points) {
  const p = (points ?? []).filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y));
  const n = p.length;
  if (n < 2) return null;
  const mx = mean(p.map((q) => q.x));
  const my = mean(p.map((q) => q.y));
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const q of p) {
    sxx += (q.x - mx) ** 2;
    syy += (q.y - my) ** 2;
    sxy += (q.x - mx) * (q.y - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  return { slope, intercept: my - slope * mx, r, n };
}

/**
 * 相関の強さを言葉にする（|r| が 0.2 未満は「ほとんど関係が見えない」）
 * @returns {{level:'none'|'weak'|'clear', text:string}}
 */
export function correlationWord(r) {
  if (r == null || !Number.isFinite(r)) return { level: 'none', text: '計算できません' };
  const a = Math.abs(r);
  if (a < 0.2) return { level: 'none', text: 'ほとんど関係が見えない' };
  const dir = r > 0 ? '大きいほど★が高い' : '小さいほど★が高い';
  return a < 0.4 ? { level: 'weak', text: `弱い傾向：${dir}` } : { level: 'clear', text: `はっきりした傾向：${dir}` };
}

/** ★（1〜5）を色の段階 1〜5 にする（範囲外は端に寄せる。なければ 0） */
export function starLevel(stars) {
  if (!Number.isFinite(stars)) return 0;
  return Math.min(5, Math.max(1, Math.round(stars)));
}
