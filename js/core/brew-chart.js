// 抽出チャート（E3）：TDS×抽出収率に自分の評価を重ね、自分の好きゾーンを出す（純粋関数）
// 固定の理想ではなく自分の評価から学ぶ（spec 2.1）。昔からの理想の範囲（収率18〜22%・TDS 1.15〜1.35%）は参考に重ねる。

import { isIced } from './plan-adjust.js';
import { THRESHOLDS, readiness } from './analysis.js';
import { quantile } from './chart-scale.js';
import { DEFAULT_RETENTION } from './extraction.js';

/** 1957年の古典的な抽出チャートの理想域（参考） */
export const CLASSIC_ZONE = Object.freeze({ x0: 18, x1: 22, y0: 1.15, y1: 1.35 });
/** 好きゾーンに使う★（この値以上） */
export const GOOD_STARS = 4;
/** 好きゾーンに要る、★の高い杯の数 */
export const GOOD_MIN = 3;
/** 比率の斜線（1:x） */
export const RATIO_LINES = Object.freeze([14, 15, 16, 17]);

const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * チャートの点（TDSと収率がそろった杯）。
 * @param {object[]} rows analysisRows の結果
 * @returns {{x:number, y:number, stars:number|null, brewId:string, beanName:string, ymd:string, estimated:boolean}[]}
 */
export function chartPoints(rows) {
  return rows
    .filter((r) => r.metrics.tdsPct != null && r.metrics.eyPct != null && !isIced(r.brew)) // アイスは氷で薄まり、収率も比べられない
    .map((r) => ({
      x: r.metrics.eyPct,
      y: r.metrics.tdsPct,
      stars: r.stars,
      brewId: r.brew.id,
      beanName: r.bean?.name ?? '',
      ymd: r.ymd,
      estimated: r.metrics.beverageEstimated,
    }));
}

/**
 * 自分の好きゾーン：★の高い杯（★4以上）の、収率とTDSそれぞれ真ん中50%の範囲。
 * ★のあるTDS付きの杯が10杯に届くまでは出さない。
 * @returns {{ready:boolean, have:number, need:number, left:number, zone:{x0:number,x1:number,y0:number,y1:number}|null, goodN:number}}
 */
export function favoriteZone(points) {
  const rated = points.filter((p) => p.stars != null);
  const r = readiness(rated.length, THRESHOLDS.zone);
  const good = rated.filter((p) => p.stars >= GOOD_STARS);
  if (!r.ready || good.length < GOOD_MIN) return { ...r, zone: null, goodN: good.length };
  const xs = good.map((p) => p.x);
  const ys = good.map((p) => p.y);
  return {
    ...r,
    goodN: good.length,
    zone: { x0: r1(quantile(xs, 0.25)), x1: r1(quantile(xs, 0.75)), y0: r2(quantile(ys, 0.25)), y1: r2(quantile(ys, 0.75)) },
  };
}

/** 比率 1:ratio の斜線の TDS（収率 x のとき）。抽出液 = 湯量 − 保持率×粉量 として TDS = 収率 ÷ (比率 − 保持率) */
export function ratioLineTds(ratio, eyPct, retention = DEFAULT_RETENTION) {
  const d = ratio - retention;
  return d > 0 ? eyPct / d : null;
}

/**
 * ある杯がゾーンのどこにいるか（直し方の言葉は濃度と収率で。spec 2.1）
 * @returns {string} 「好きゾーンの中」「好きゾーンより薄い・抽出が足りない」など。ゾーンがなければ空文字
 */
export function zonePosition(point, zone) {
  if (!point || !zone) return '';
  const parts = [];
  if (point.y < zone.y0) parts.push('薄い（粉を増やすか湯を減らす）');
  else if (point.y > zone.y1) parts.push('濃い（湯を増やす）');
  if (point.x < zone.x0) parts.push('抽出が足りない（細かく挽く・湯温を上げる）');
  else if (point.x > zone.x1) parts.push('抽出しすぎ（粗く挽く）');
  return parts.length ? `好きゾーンより${parts.join('・')}` : '好きゾーンの中';
}
