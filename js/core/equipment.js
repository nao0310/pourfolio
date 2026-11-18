// 器具の登録（D1）の入力を確かめて、保存する形に整える（純粋関数）

import { parseNumber } from './beans.js';

/** 器具の種類（表示の順もこの順） */
export const EQUIPMENT_KINDS = Object.freeze({
  dripper: 'ドリッパー',
  filter: 'フィルター',
  grinder: 'グラインダー',
  kettle: 'ケトル',
  scale: 'スケール',
});
export const KIND_ORDER = Object.freeze(Object.keys(EQUIPMENT_KINDS));

/** ドリッパーの銘柄の候補（spec 13.2） */
export const DRIPPER_MODELS = Object.freeze(['V60', 'カリタウェーブ', 'オリガミ', 'KONO', 'ケメックス', 'ハリオ スイッチ']);
/** ドリッパーの形状（spec 4.5） */
export const DRIPPER_SHAPES = Object.freeze({ cone: '円錐', trapezoid: '台形', flat: '平底', wave: 'ウェーブ' });
/** フィルターの素材 */
export const FILTER_MATERIALS = Object.freeze({ paper: '紙', cloth: '布', metal: '金属' });
/** 紙フィルターの漂白 */
export const FILTER_BLEACH = Object.freeze({ bleached: '漂白', unbleached: '無漂白' });
/** グラインダーの刃 */
export const GRINDER_BURRS = Object.freeze({ conical: 'コニカル', flat: 'フラット' });

/** 名前の入力欄の例（種類ごと） */
export const NAME_PLACEHOLDERS = Object.freeze({
  dripper: '例：ハリオ V60 02',
  filter: '例：ハリオ V60用 02 無漂白',
  grinder: '例：コマンダンテ C40',
  kettle: '例：細口ケトル 0.6L',
  scale: '例：タイマー付きスケール',
});

const clean = (v) => String(v ?? '').normalize('NFKC').trim();
const pickKey = (v, dict) => (Object.hasOwn(dict, clean(v)) ? clean(v) : '');

/**
 * 器具の入力フォームの値を確かめて、保存する形にする。
 * @param {Record<string, string>} raw フォームの値（どれも文字列。isDefault は 'on' か空）
 * @returns {{value: object, errors: Record<string, string>}}
 */
export function normalizeEquipmentInput(raw) {
  const errors = {};
  const kind = clean(raw.kind);
  if (!Object.hasOwn(EQUIPMENT_KINDS, kind)) errors.kind = '種類を選んでください';
  const name = clean(raw.name);
  if (!name) errors.name = '名前を入れてください';

  const num = (k, label, { min = 0, max = 1000, integer = false } = {}) => {
    const n = parseNumber(raw[k]);
    if (n == null) return null;
    if (Number.isNaN(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      errors[k] = `${label}は${min}〜${max}の${integer ? '整数' : '数字'}で入れてください`;
      return null;
    }
    return n;
  };

  let attrs = {};
  if (kind === 'dripper') {
    attrs = {
      shape: pickKey(raw.shape, DRIPPER_SHAPES),
      holes: num('holes', '穴の数', { min: 0, max: 20, integer: true }),
      material: clean(raw.material),
    };
  } else if (kind === 'filter') {
    const material = pickKey(raw.filterMaterial, FILTER_MATERIALS);
    attrs = { material, bleach: material === 'paper' ? pickKey(raw.bleach, FILTER_BLEACH) : '' };
  } else if (kind === 'grinder') {
    const step = num('step', '目盛りの刻み', { min: 0.01, max: 100 });
    attrs = {
      burr: pickKey(raw.burr, GRINDER_BURRS),
      step,
      zeroPoint: clean(raw.zeroPoint),
    };
  }

  return {
    value: { kind, name, attrs, isDefault: raw.isDefault === 'on' || raw.isDefault === true, memo: clean(raw.memo) },
    errors,
  };
}

/** 保存されている器具をフォームの値（文字列）に戻す */
export function equipmentToFormValues(eq) {
  const a = eq.attrs ?? {};
  const str = (v) => (v == null ? '' : String(v));
  return {
    kind: str(eq.kind),
    name: str(eq.name),
    shape: str(a.shape),
    holes: str(a.holes),
    material: eq.kind === 'dripper' ? str(a.material) : '',
    filterMaterial: eq.kind === 'filter' ? str(a.material) : '',
    bleach: str(a.bleach),
    burr: str(a.burr),
    step: str(a.step),
    zeroPoint: str(a.zeroPoint),
    isDefault: Boolean(eq.isDefault),
    memo: str(eq.memo),
  };
}

/** 一覧の順：種類の順 → いつも使うものが先 → 登録の古い順 */
export function sortEquipment(list) {
  const kindRank = (e) => {
    const i = KIND_ORDER.indexOf(e.kind);
    return i < 0 ? KIND_ORDER.length : i;
  };
  return [...list].sort(
    (a, b) =>
      kindRank(a) - kindRank(b) ||
      Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)) ||
      String(a.createdAt).localeCompare(String(b.createdAt)),
  );
}

/** 種類ごとに分ける { dripper: [...], ... }（並びは sortEquipment の順） */
export function groupEquipmentByKind(list) {
  const out = Object.fromEntries(KIND_ORDER.map((k) => [k, []]));
  for (const e of sortEquipment(list)) (out[e.kind] ??= []).push(e);
  return out;
}

/**
 * 種類ごとの「いつも使う」器具のID。いつも使うがなければ、その種類が1つだけのときはそれを使う。
 * @returns {{dripperId:string|null, filterId:string|null, grinderId:string|null, kettleId:string|null, scaleId:string|null}}
 */
export function defaultEquipmentIds(list) {
  const groups = groupEquipmentByKind(list);
  const out = {};
  for (const kind of KIND_ORDER) {
    const items = groups[kind];
    const def = items.find((e) => e.isDefault) ?? (items.length === 1 ? items[0] : null);
    out[`${kind}Id`] = def ? def.id : null;
  }
  return out;
}

/** 器具の説明を1行にする「円錐・1つ穴・セラミック」 */
export function equipmentSummary(eq) {
  const a = eq.attrs ?? {};
  if (eq.kind === 'dripper') {
    return [DRIPPER_SHAPES[a.shape], a.holes != null ? `${a.holes}つ穴` : '', a.material].filter(Boolean).join('・');
  }
  if (eq.kind === 'filter') return [FILTER_MATERIALS[a.material], FILTER_BLEACH[a.bleach]].filter(Boolean).join('・');
  if (eq.kind === 'grinder') {
    return [GRINDER_BURRS[a.burr], a.step != null ? `刻み${a.step}` : '', a.zeroPoint ? `ゼロ点${a.zeroPoint}` : '']
      .filter(Boolean)
      .join('・');
  }
  return '';
}
