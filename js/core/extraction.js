// TDS・抽出収率（A8）と、抽出液の量・カフェインの目安（純粋関数）
// 抽出収率 = TDS(%) × 抽出液の重さ ÷ 粉量（spec 5.1）。
// 抽出液を量っていない日は「湯量 − 保持率 × 粉量」で見積もる。保持率は初期値2.0で、
// 抽出液を量った杯からドリッパーごとに求め直す（2杯以上あるとき）。
// カフェインは日本食品標準成分表（粉10g・熱湯150mL＝比率1:15で100mLあたり60mg）からの換算で、あくまで目安。

import { ratioOf } from './recipes.js';

/** 粉1gあたりに残る液体（g）の初期値（透過式。spec 2.1） */
export const DEFAULT_RETENTION = 2.0;
/** ドリッパーごとの保持率を使い始める、抽出液を量った杯の数 */
export const RETENTION_MIN_N = 2;
/** TDSの入力の範囲（%）。ハンドドリップの値として受け付ける幅 */
export const TDS_MIN = 0.1;
export const TDS_MAX = 5;
/** カフェイン：比率1:15の抽出液100mLあたり60mg（1gあたり0.6mg） */
export const CAFFEINE_MG_PER_G_AT_15 = 0.6;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * TDSの入力を確かめる（空なら null）。
 * @returns {{value:number|null, error:string|null}}
 */
export function normalizeTds(v) {
  if (v == null) return { value: null, error: null };
  const s = typeof v === 'number' ? String(v) : String(v).normalize('NFKC').replace(/[%％]/g, '').trim();
  if (s === '') return { value: null, error: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < TDS_MIN || n > TDS_MAX) {
    return { value: null, error: `TDSは${TDS_MIN}〜${TDS_MAX}の数字（%）で入れてください。屈折計の表示が「1.35」なら1.35です` };
  }
  return { value: round2(n), error: null };
}

/** 抽出収率（%）。どれかが欠けていれば null */
export function extractionYieldPct(tdsPct, beverageG, doseG) {
  if (!(tdsPct > 0) || !(beverageG > 0) || !(doseG > 0)) return null;
  return round1((tdsPct * beverageG) / doseG);
}

/** その杯で実際に量った保持率（(湯量 − 抽出液) ÷ 粉量）。量っていなければ null */
export function measuredRetention(brew) {
  const a = brew?.actual ?? {};
  if (!(a.beverageG > 0) || !(a.waterG > 0) || !(a.doseG > 0) || a.beverageG > a.waterG) return null;
  const r = (a.waterG - a.beverageG) / a.doseG;
  return r >= 0.5 && r <= 5 ? r : null; // 量り間違いと思われる値は使わない
}

/**
 * ドリッパーごとの保持率を抽出液を量った杯から求める（中央値）。
 * @param {object[]} brews
 * @returns {Record<string, {retention:number, n:number}>} キーはドリッパーのID（なしは ''）
 */
export function retentionTable(brews) {
  const groups = new Map();
  for (const b of brews ?? []) {
    if (b?.deletedAt != null) continue;
    const r = measuredRetention(b);
    if (r == null) continue;
    const key = b.equipment?.dripperId ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = {};
  for (const [k, rs] of groups) out[k] = { retention: round2(median(rs)), n: rs.length };
  return out;
}

/** その杯で使う保持率（そのドリッパーで量った杯が2杯以上あればその値、なければ初期値） */
export function retentionFor(brew, table = {}) {
  const row = table[brew?.equipment?.dripperId ?? ''];
  if (row && row.n >= RETENTION_MIN_N) return { retention: row.retention, learned: true, n: row.n };
  return { retention: DEFAULT_RETENTION, learned: false, n: row?.n ?? 0 };
}

/**
 * 抽出液の量（g）。量っていればその値、なければ見積もり。
 * @returns {{g:number|null, estimated:boolean}}
 */
export function beverageOf(brew, table = {}) {
  const a = brew?.actual ?? {};
  if (a.beverageG > 0) return { g: a.beverageG, estimated: false };
  if (!(a.waterG > 0) || !(a.doseG > 0)) return { g: null, estimated: true };
  const g = Math.round(a.waterG - retentionFor(brew, table).retention * a.doseG);
  return { g: g > 0 ? g : null, estimated: true };
}

/** カフェインの目安（mg）。抽出液の量(≒mL) × 0.6 × 15 ÷ 比率 */
export function caffeineMg(beverageG, ratio) {
  if (!(beverageG > 0) || !(ratio > 0)) return null;
  return Math.round((beverageG * CAFFEINE_MG_PER_G_AT_15 * 15) / ratio);
}

/**
 * 1杯の計算値をまとめて出す。
 * @param {object} brew
 * @param {Record<string,{retention:number,n:number}>} [table] retentionTable の結果
 * @returns {{ratio:number|null, beverageG:number|null, beverageEstimated:boolean, tdsPct:number|null, eyPct:number|null, caffeineMg:number|null}}
 */
export function brewMetrics(brew, table = {}) {
  const a = brew?.actual ?? {};
  const ratio = ratioOf(a.doseG, a.waterG);
  const bev = beverageOf(brew, table);
  const tdsPct = a.tdsPct > 0 ? a.tdsPct : null;
  return {
    ratio,
    beverageG: bev.g,
    beverageEstimated: bev.estimated,
    tdsPct,
    eyPct: tdsPct != null ? extractionYieldPct(tdsPct, bev.g, a.doseG) : null,
    caffeineMg: caffeineMg(bev.g, ratio),
  };
}

/** 抽出の記録に TDS を入れ直した actual（あとから評価の画面で入れるとき） */
export function withTds(brew, tdsPct) {
  return { ...(brew.actual ?? {}), tdsPct: tdsPct ?? null };
}

/** 「TDS 1.35%・収率 20.1%（抽出液は見積もり）」のような短い文。TDSがなければ空文字 */
export function metricsText(m) {
  if (!m || m.tdsPct == null) return '';
  const parts = [`TDS ${m.tdsPct}%`];
  if (m.eyPct != null) parts.push(`収率 ${m.eyPct}%`);
  return parts.join('・') + (m.eyPct != null && m.beverageEstimated ? '（抽出液は見積もり）' : '');
}
