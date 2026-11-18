// 味の評価：クイック評価（B1）、ちょうど良さ評価（JAR、B2）、詳細評価（B3）、香味と雑味（B4）（純粋関数）
// 1杯につき、温度帯（熱いうち・温かいうち・冷めてから、B5）ごとに「自分」の評価を1件ずつ持つ。開き直したらその1件を直す。
// 主な評価は「温かいうち」（抽出の直後に入れる評価）。次の1杯の提案（F1）・★の集計はこの評価を使う（D-104）。
// JARは −2（弱すぎ）〜 +2（強すぎ）。押していない項目は null（未回答）で、ちょうど（0）と区別する。
// 詳細評価は CVA にならい、項目ごとの「強さ 0〜15」と「好み 1〜9」を別々に持つ（intensity と liking）。

import { formatDateTimeJa } from './format.js';
import { normalizeFlavors, normalizeDefects, flavorsText } from './flavors.js';

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

/** 詳細評価（B3）の項目（CVAの記述と好みの評価に合わせた7つ） */
export const DETAIL_ATTRS = Object.freeze([
  { key: 'fragrance', label: '香り（粉）' },
  { key: 'aroma', label: '香り（液）' },
  { key: 'flavor', label: '風味' },
  { key: 'aftertaste', label: '余韻' },
  { key: 'acidity', label: '酸味' },
  { key: 'sweetness', label: '甘さ' },
  { key: 'mouthfeel', label: '口当たり' },
]);

export const DETAIL_KEYS = Object.freeze(DETAIL_ATTRS.map((a) => a.key));

/** 強さの目盛り（0＝感じない 〜 15＝とても強い） */
export const INTENSITY_MAX = 15;

/** 好みの9段階（1〜9）の呼び方 */
export const LIKING_WORDS = Object.freeze([
  'とても嫌い',
  'かなり嫌い',
  'やや嫌い',
  '少し嫌い',
  'どちらでもない',
  '少し好き',
  'やや好き',
  'かなり好き',
  'とても好き',
]);
export const LIKING_MAX = LIKING_WORDS.length;

/** 評価者（ゲスト評価 B7 で増やす）と、主な評価の温度帯 */
export const DEFAULT_BY = 'me';
export const DEFAULT_STAGE = 'warm';

/** 温度帯（B5）。主な評価は warm。ほかは冷め際の味の変化を見るための評価 */
export const STAGES = Object.freeze([
  { key: 'hot', label: '熱いうち' },
  { key: 'warm', label: '温かいうち' },
  { key: 'cool', label: '冷めてから' },
]);
export const STAGE_KEYS = Object.freeze(STAGES.map((s) => s.key));

/** 温度帯の呼び方（知らない値は「温かいうち」） */
export function stageLabel(stage) {
  return (STAGES.find((s) => s.key === stage) ?? STAGES[1]).label;
}

/** 温度帯の値をそろえる（知らない値・空は warm） */
export function normalizeStage(stage) {
  return STAGE_KEYS.includes(stage) ? stage : DEFAULT_STAGE;
}

/** 冷めた味の評価を促すのは、落ち切ってから何分後か（spec 4.2） */
export const COOL_AFTER_MIN = 15;
/** 冷めた味の評価を促すのをやめるのは、落ち切ってから何時間後か */
export const COOL_WITHIN_HOURS = 3;

/** すべて未回答のJAR */
export function emptyJar() {
  return Object.fromEntries(JAR_KEYS.map((k) => [k, null]));
}

/** すべて「ちょうど」のJAR */
export function allJustJar() {
  return Object.fromEntries(JAR_KEYS.map((k) => [k, 0]));
}

/** すべて未回答の詳細評価（強さ・好みのどちらにも使う） */
export function emptyDetail() {
  return Object.fromEntries(DETAIL_KEYS.map((k) => [k, null]));
}

/** 何も入っていない入力 */
export function emptyTastingInput() {
  return { stars: null, tags: [], jar: emptyJar(), intensity: emptyDetail(), liking: emptyDetail(), flavors: [], defects: [], memo: '' };
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

  const intensity = emptyDetail();
  const liking = emptyDetail();
  for (const k of DETAIL_KEYS) {
    const i = intIn(input.intensity?.[k], 0, INTENSITY_MAX);
    if (Number.isNaN(i)) errors.detail = `強さは0〜${INTENSITY_MAX}、好みは1〜${LIKING_MAX}で選んでください`;
    else intensity[k] = i;
    const l = intIn(input.liking?.[k], 1, LIKING_MAX);
    if (Number.isNaN(l)) errors.detail = `強さは0〜${INTENSITY_MAX}、好みは1〜${LIKING_MAX}で選んでください`;
    else liking[k] = l;
  }

  const flavors = normalizeFlavors(input.flavors);
  const defects = normalizeDefects(input.defects);
  const memo = clean(input.memo);

  const answered =
    stars != null ||
    tags.length > 0 ||
    JAR_KEYS.some((k) => jar[k] != null) ||
    detailAnsweredCount({ intensity, liking }) > 0 ||
    flavors.length > 0 ||
    defects.length > 0 ||
    memo !== '';
  if (!answered && !allowEmpty && !errors.stars && !errors.jar && !errors.detail) {
    errors.empty = '★・一言・ちょうど良さなど、どれか1つを入れてください';
  }

  return { value: { stars, tags, jar, intensity, liking, flavors, defects, memo }, errors };
}

/** 詳細評価で強さか好みを入れた項目の数 */
export function detailAnsweredCount(t) {
  return DETAIL_KEYS.filter((k) => t?.intensity?.[k] != null || t?.liking?.[k] != null).length;
}

/** JARに答えた項目の数 */
export function jarAnsweredCount(jar) {
  return JAR_KEYS.filter((k) => jar?.[k] != null).length;
}

/**
 * 保存する評価の記録の中身（id・日時の共通項目は db 側で付ける）
 * @param {{brewId:string, value:object, stage?:string}} p value は normalizeTastingInput の value、stage は温度帯（B5）
 */
export function buildTasting({ brewId, value, stage = DEFAULT_STAGE }) {
  return {
    brewId,
    by: DEFAULT_BY,
    stage: normalizeStage(stage),
    stars: value.stars,
    tags: [...value.tags],
    jar: { ...value.jar },
    intensity: { ...value.intensity },
    liking: { ...value.liking },
    flavors: [...value.flavors],
    defects: [...value.defects],
    memo: value.memo,
  };
}

const alive = (r) => r && r.deletedAt == null;
const newer = (a, b) => (String(a.updatedAt ?? '') >= String(b.updatedAt ?? '') ? a : b);

/**
 * その抽出の「自分」の評価（削除済みは除く。2件以上あれば新しいほう）。なければ null
 * @param {string} [stage] 温度帯。省くと主な評価（温かいうち）
 */
export function pickTasting(tastings, brewId, stage = DEFAULT_STAGE) {
  const list = (tastings ?? []).filter(
    (t) => alive(t) && t.brewId === brewId && (t.by ?? DEFAULT_BY) === DEFAULT_BY && (t.stage ?? DEFAULT_STAGE) === stage,
  );
  return list.length ? list.reduce(newer) : null;
}

/** その抽出の温度帯ごとの評価 { hot, warm, cool }（ない温度帯は null） */
export function tastingsByStage(tastings, brewId) {
  return Object.fromEntries(STAGE_KEYS.map((k) => [k, pickTasting(tastings, brewId, k)]));
}

/** 落ち切った時刻（ミリ秒）＝抽出の日時＋総時間。日時が読めなければ null */
export function brewEndMs(brew) {
  const at = Date.parse(brew?.at);
  if (!Number.isFinite(at)) return null;
  return at + (Number(brew.actual?.totalSec) || 0) * 1000;
}

/** 冷めた味を評価できるようになる時刻（ミリ秒）。日時が読めなければ null */
export function coolReadyMs(brew) {
  const end = brewEndMs(brew);
  return end == null ? null : end + COOL_AFTER_MIN * 60_000;
}

/**
 * 冷めた味の評価を促す抽出（B5）：落ち切ってから15分〜3時間で、主な評価が済み、冷めてからの評価がまだのもの。
 * いちばん新しい1杯。なければ null
 */
export function pickCoolPrompt(brews, tastings, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const list = (brews ?? []).filter((b) => {
    if (!alive(b)) return false;
    const ready = coolReadyMs(b);
    if (ready == null || nowMs < ready || nowMs - brewEndMs(b) > COOL_WITHIN_HOURS * 3_600_000) return false;
    return pickTasting(tastings, b.id) != null && pickTasting(tastings, b.id, 'cool') == null;
  });
  if (!list.length) return null;
  return list.reduce((a, b) => (Date.parse(a.at) >= Date.parse(b.at) ? a : b));
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
  const flavors = flavorsText(t.flavors, 3);
  if (flavors) parts.push(flavors);
  if (t.defects?.length) parts.push(`雑味 ${t.defects.join('・')}`);
  return parts.join('　');
}

/** 抽出の1行の説明「11/18 07:42　15g・225g」 */
export function brewLine(brew) {
  const a = brew?.actual ?? {};
  const when = formatDateTimeJa(brew?.at).slice(5); // 年を省く
  const amounts = a.doseG != null && a.waterG != null ? `${a.doseG}g・${a.waterG}g` : '';
  return [when, amounts].filter(Boolean).join('　');
}
