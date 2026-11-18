// 味の評価：クイック評価（B1）とちょうど良さ評価（JAR、B2）（純粋関数）
// 1杯につき「自分・温かいうち」の評価を1件持つ。開き直したらその1件を直す。
// JARは −2（弱すぎ）〜 +2（強すぎ）。押していない項目は null（未回答）で、ちょうど（0）と区別する。

import { formatDateTimeJa } from './format.js';

/** 総合の★の最大 */
export const STAR_MAX = 5;

/** 一言タグ（spec 4.2） */
export const QUICK_TAGS = Object.freeze(['酸っぱい', '苦い', '薄い', '濃い', '渋い', '甘い', '好き']);

/** ちょうど良さの項目。words は −2, −1, 0, +1, +2 の順の呼び方 */
export const JAR_ATTRS = Object.freeze([
  { key: 'strength', label: '濃さ', words: ['薄すぎ', 'やや薄い', 'ちょうど', 'やや濃い', '濃すぎ'] },
  { key: 'acidity', label: '酸味', words: ['弱すぎ', 'やや弱い', 'ちょうど', 'やや強い', '強すぎ'] },
  { key: 'bitterness', label: '苦味', words: ['弱すぎ', 'やや弱い', 'ちょうど', 'やや強い', '強すぎ'] },
  { key: 'sweetness', label: '甘さ', words: ['弱すぎ', 'やや弱い', 'ちょうど', 'やや強い', '強すぎ'] },
  { key: 'body', label: 'ボディ', words: ['軽すぎ', 'やや軽い', 'ちょうど', 'やや重い', '重すぎ'] },
  { key: 'astringency', label: '渋み', words: ['弱すぎ', 'やや弱い', 'ちょうど', 'やや強い', '強すぎ'] },
]);

export const JAR_KEYS = Object.freeze(JAR_ATTRS.map((a) => a.key));

/** 評価者と温度帯（MVPは自分・温かいうちだけ。B5・B7で増やす） */
export const DEFAULT_BY = 'me';
export const DEFAULT_STAGE = 'warm';

/** すべて未回答のJAR */
export function emptyJar() {
  return Object.fromEntries(JAR_KEYS.map((k) => [k, null]));
}

/** すべて「ちょうど」のJAR */
export function allJustJar() {
  return Object.fromEntries(JAR_KEYS.map((k) => [k, 0]));
}

/** 何も入っていない入力 */
export function emptyTastingInput() {
  return { stars: null, tags: [], jar: emptyJar(), memo: '' };
}

/** 保存した評価を入力の形にする（評価がなければ空の入力） */
export function tastingInput(tasting) {
  if (!tasting) return emptyTastingInput();
  const { value } = normalizeTastingInput(tasting, { allowEmpty: true });
  return value;
}

const clean = (v) => String(v ?? '').normalize('NFKC').trim();

/** 整数 lo〜hi なら数、空なら null、それ以外は NaN */
function intIn(v, lo, hi) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(clean(v));
  return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN;
}

/** JARの1項目の値を呼び方にする（未回答なら空文字） */
export function jarWord(key, value) {
  const attr = JAR_ATTRS.find((a) => a.key === key);
  if (!attr || value == null) return '';
  return attr.words[value + 2] ?? '';
}

/**
 * 評価の入力を確かめる。知らないタグ・項目は捨てる。
 * @param {{stars?:any, tags?:any[], jar?:object, memo?:string}} input
 * @param {{allowEmpty?: boolean}} [opts] 何も入っていなくてもエラーにしない（読み込み用）
 * @returns {{value: {stars:number|null, tags:string[], jar:object, memo:string}, errors: Record<string,string>}}
 */
export function normalizeTastingInput(input = {}, { allowEmpty = false } = {}) {
  const errors = {};

  let stars = intIn(input.stars, 1, STAR_MAX);
  if (Number.isNaN(stars)) {
    errors.stars = `総合は★1〜${STAR_MAX}で選んでください`;
    stars = null;
  }

  const picked = new Set(Array.isArray(input.tags) ? input.tags.map(clean) : []);
  const tags = QUICK_TAGS.filter((t) => picked.has(t)); // 並びはいつも同じにする

  const jar = emptyJar();
  for (const k of JAR_KEYS) {
    const n = intIn(input.jar?.[k], -2, 2);
    if (Number.isNaN(n)) errors.jar = 'ちょうど良さは5段階のボタンで選んでください';
    else jar[k] = n;
  }

  const memo = clean(input.memo);

  const answered = stars != null || tags.length > 0 || JAR_KEYS.some((k) => jar[k] != null) || memo !== '';
  if (!answered && !allowEmpty && !errors.stars && !errors.jar) {
    errors.empty = '★・一言・ちょうど良さのどれか1つを入れてください';
  }

  return { value: { stars, tags, jar, memo }, errors };
}

/** JARに答えた項目の数 */
export function jarAnsweredCount(jar) {
  return JAR_KEYS.filter((k) => jar?.[k] != null).length;
}

/**
 * 保存する評価の記録の中身（id・日時の共通項目は db 側で付ける）
 * @param {{brewId:string, value:object}} p value は normalizeTastingInput の value
 */
export function buildTasting({ brewId, value }) {
  return {
    brewId,
    by: DEFAULT_BY,
    stage: DEFAULT_STAGE,
    stars: value.stars,
    tags: [...value.tags],
    jar: { ...value.jar },
    memo: value.memo,
  };
}

const alive = (r) => r && r.deletedAt == null;
const newer = (a, b) => (String(a.updatedAt ?? '') >= String(b.updatedAt ?? '') ? a : b);

/** その抽出の「自分・温かいうち」の評価（削除済みは除く。2件以上あれば新しいほう）。なければ null */
export function pickTasting(tastings, brewId) {
  const list = (tastings ?? []).filter(
    (t) => alive(t) && t.brewId === brewId && (t.by ?? DEFAULT_BY) === DEFAULT_BY && (t.stage ?? DEFAULT_STAGE) === DEFAULT_STAGE,
  );
  return list.length ? list.reduce(newer) : null;
}

/** 評価がまだの抽出を探す時間の幅（時間） */
export const UNRATED_WITHIN_HOURS = 24;

/**
 * 評価がまだの抽出のうち、いちばん新しいもの（直近24時間・削除済みは除く）。なければ null
 * @param {object[]} brews
 * @param {object[]} tastings
 * @param {Date|number|string} [now]
 */
export function pickUnratedBrew(brews, tastings, now = new Date(), withinHours = UNRATED_WITHIN_HOURS) {
  const nowMs = new Date(now).getTime();
  const rated = new Set((tastings ?? []).filter(alive).map((t) => t.brewId));
  const candidates = (brews ?? []).filter((b) => {
    if (!alive(b) || rated.has(b.id)) return false;
    const at = Date.parse(b.at);
    return Number.isFinite(at) && at <= nowMs + 60_000 && nowMs - at <= withinHours * 3_600_000;
  });
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (Date.parse(a.at) >= Date.parse(b.at) ? a : b));
}

/** 評価の短いまとめ「★4　酸っぱい・甘い　酸味 やや強い」（ちょうど・未回答の項目は書かない） */
export function tastingSummary(t) {
  if (!t) return '';
  const parts = [];
  if (t.stars != null) parts.push(`★${t.stars}`);
  if (t.tags?.length) parts.push(t.tags.join('・'));
  const off = JAR_ATTRS.filter((a) => t.jar?.[a.key] != null && t.jar[a.key] !== 0).map((a) => `${a.label} ${jarWord(a.key, t.jar[a.key])}`);
  if (off.length) parts.push(off.join('・'));
  else if (jarAnsweredCount(t.jar) > 0) parts.push('ちょうど良い');
  return parts.join('　');
}

/** 抽出の1行の説明「11/18 07:42　15g・225g」 */
export function brewLine(brew) {
  const a = brew?.actual ?? {};
  const when = formatDateTimeJa(brew?.at).slice(5); // 年を省く
  const amounts = a.doseG != null && a.waterG != null ? `${a.doseG}g・${a.waterG}g` : '';
  return [when, amounts].filter(Boolean).join('　');
}
