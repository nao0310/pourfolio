// 焙煎度と、焙煎による目減り（純粋関数）
// 焙煎度は珈琲問屋の8段階の表記をそのまま使う（spec 4.4）。

/** 焙煎度（浅い順） */
export const ROAST_LEVELS = Object.freeze(['ライト', 'シナモン', 'ミディアム', 'ハイ', 'シティ', 'フルシティ', 'フレンチ', 'イタリアン']);

/** 焙煎度の大まかな区分（飲み頃の目安に使う） */
export const ROAST_GROUPS = Object.freeze({
  light: { label: '浅煎り', levels: ['ライト', 'シナモン'] },
  medium: { label: '中煎り', levels: ['ミディアム', 'ハイ'] },
  mediumDark: { label: '中深煎り', levels: ['シティ', 'フルシティ'] },
  dark: { label: '深煎り', levels: ['フレンチ', 'イタリアン'] },
});

/** 焙煎度の区分のキー。わからない焙煎度は null */
export function roastGroup(level) {
  for (const [key, g] of Object.entries(ROAST_GROUPS)) if (g.levels.includes(level)) return key;
  return null;
}

/**
 * 生豆から焙煎後に減る割合（%）の初期値。
 * 珈琲問屋のお試し（ミディアム〜フルシティ）は生豆100gが焙煎後81〜84gになる（spec 4.4）ことに合わせた目安。
 */
export const DEFAULT_LOSS_PCT = Object.freeze({
  ライト: 14,
  シナモン: 15,
  ミディアム: 16,
  ハイ: 17,
  シティ: 18,
  フルシティ: 19,
  フレンチ: 21,
  イタリアン: 22,
});

/** 焙煎度がわからないときの目減り率 */
export const FALLBACK_LOSS_PCT = 18;

const round1 = (n) => Math.round(n * 10) / 10;
const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * 過去の豆（生豆時の表記重量と実重量の両方がある、同じ焙煎度のもの）から目減り率の平均を出す。
 * @param {object[]} beans
 * @param {string} level
 * @param {string} [excludeId] 計算から外す豆（自分自身）
 * @returns {{pct:number, count:number}|null}
 */
export function learnedLossPct(beans, level, excludeId) {
  const samples = beans.filter(
    (b) =>
      b.deletedAt == null &&
      b.id !== excludeId &&
      b.roastLevel === level &&
      b.labelWeightBasis === 'green' &&
      isPositive(b.labelWeightG) &&
      isPositive(b.actualWeightG) &&
      b.actualWeightG <= b.labelWeightG,
  );
  if (!samples.length) return null;
  const avg = samples.reduce((s, b) => s + (1 - b.actualWeightG / b.labelWeightG) * 100, 0) / samples.length;
  return { pct: round1(avg), count: samples.length };
}

/**
 * 使う目減り率。自分の記録があればそれ、なければ初期値。
 * @returns {{pct:number, learned:boolean, count:number}}
 */
export function lossPct(level, beans = [], excludeId) {
  const learned = learnedLossPct(beans, level, excludeId);
  if (learned) return { pct: learned.pct, learned: true, count: learned.count };
  return { pct: DEFAULT_LOSS_PCT[level] ?? FALLBACK_LOSS_PCT, learned: false, count: 0 };
}

/**
 * 入庫する量（焙煎後の重さ）を決める。
 * 実重量があればそれ。表記が焙煎後ならその値。表記が生豆時なら目減り率で見積もる。
 * @param {object} bean
 * @param {object[]} [beans] 学習に使う過去の豆
 * @returns {{g:number, estimated:boolean, lossPct?:number, learned?:boolean}|null}
 */
export function initialStockG(bean, beans = []) {
  if (isPositive(bean.actualWeightG)) return { g: round1(bean.actualWeightG), estimated: false };
  if (!isPositive(bean.labelWeightG)) return null;
  if (bean.labelWeightBasis !== 'green') return { g: round1(bean.labelWeightG), estimated: false };
  const loss = lossPct(bean.roastLevel, beans, bean.id);
  return {
    g: round1(bean.labelWeightG * (1 - loss.pct / 100)),
    estimated: true,
    lossPct: loss.pct,
    learned: loss.learned,
  };
}
