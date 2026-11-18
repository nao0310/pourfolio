// 豆カード（C1）の入力を確かめて、保存する形に整える（純粋関数）

import { ROAST_LEVELS } from './roast.js';

/** 精製の選択肢（spec 13.2。「その他」は自由入力） */
export const PROCESS_OPTIONS = Object.freeze(['ウォッシュト', 'ナチュラル', 'ハニー', 'スマトラ式', 'アナエロビック']);
/** 品種の選択肢（spec 13.2。「その他」は自由入力） */
export const VARIETY_OPTIONS = Object.freeze(['ティピカ', 'ブルボン', 'カトゥーラ', 'カトゥアイ', 'ゲイシャ', 'SL28', 'パカマラ']);

/** 豆の状態 */
export const BEAN_STATUS = Object.freeze({
  unopened: '未開封',
  open: '開封済み',
  finished: '飲み切り',
});

/** 表記重量の基準 */
export const WEIGHT_BASIS = Object.freeze({
  green: '生豆時',
  roasted: '焙煎後',
});

export const DEFAULT_SHOP = '珈琲問屋';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 前後の空白を除き、全角英数を半角にする */
const clean = (v) => String(v ?? '').normalize('NFKC').trim();

/**
 * 数字の入力を読む。空なら null、読めなければ NaN。
 * 「200g」「1,200円」のような単位やカンマも許す。
 */
export function parseNumber(v) {
  const s = clean(v).replace(/[,，]/g, '').replace(/(g|グラム|円)$/i, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const isValidYmd = (s) => {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * 豆の入力フォームの値を確かめて、保存する形にする。
 * @param {Record<string, string>} raw フォームの値（どれも文字列）
 * @returns {{value: object, errors: Record<string, string>}} errors が空なら保存してよい
 */
export function normalizeBeanInput(raw) {
  const errors = {};
  const text = (k) => clean(raw[k]);

  const name = text('name');
  if (!name) errors.name = '銘柄を入れてください';

  const productUrl = text('productUrl');
  if (productUrl && !/^https?:\/\/\S+$/i.test(productUrl)) errors.productUrl = 'https:// で始まるURLを入れてください';

  const roastLevel = text('roastLevel');
  if (roastLevel && !ROAST_LEVELS.includes(roastLevel)) errors.roastLevel = '焙煎度を選んでください';

  const dates = {};
  for (const k of ['roastDate', 'orderDate', 'arrivalDate']) {
    const v = text(k);
    if (v && !isValidYmd(v)) errors[k] = '日付の形が正しくありません';
    dates[k] = v || null;
  }

  const weight = (k, label) => {
    const n = parseNumber(raw[k]);
    if (n == null) return null;
    if (Number.isNaN(n) || n <= 0 || n > 100000) {
      errors[k] = `${label}は0より大きい数字で入れてください`;
      return null;
    }
    return Math.round(n * 10) / 10;
  };
  const labelWeightG = weight('labelWeightG', '表記重量');
  const actualWeightG = weight('actualWeightG', '実重量');
  if (labelWeightG == null && actualWeightG == null && !errors.labelWeightG && !errors.actualWeightG) {
    errors.labelWeightG = '表記重量か実重量のどちらかを入れてください';
  }

  const labelWeightBasis = text('labelWeightBasis') === 'roasted' ? 'roasted' : 'green';

  let priceJpy = parseNumber(raw.priceJpy);
  if (priceJpy != null && (Number.isNaN(priceJpy) || priceJpy < 0)) {
    errors.priceJpy = '価格は0以上の数字で入れてください';
    priceJpy = null;
  } else if (priceJpy != null) {
    priceJpy = Math.round(priceJpy);
  }

  const status = Object.hasOwn(BEAN_STATUS, text('status')) ? text('status') : 'unopened';

  // 「その他」を選んだときは自由入力の値を使う
  const pick = (k) => (text(k) === 'その他' ? text(`${k}Other`) : text(k));

  return {
    value: {
      name,
      shop: text('shop'),
      productUrl,
      origin: { country: text('country'), region: text('region'), farm: text('farm') },
      variety: pick('variety'),
      process: pick('process'),
      roastLevel,
      roastDate: dates.roastDate,
      orderDate: dates.orderDate,
      arrivalDate: dates.arrivalDate,
      labelWeightG,
      labelWeightBasis,
      actualWeightG,
      priceJpy,
      flavorNotes: text('flavorNotes'),
      memo: text('memo'),
      status,
    },
    errors,
  };
}

/** 保存されている豆をフォームの値（文字列）に戻す（編集画面の初期値） */
export function beanToFormValues(bean) {
  const str = (v) => (v == null ? '' : String(v));
  const withOther = (k, options) => {
    const v = bean[k] ?? '';
    if (!v || options.includes(v)) return { [k]: v, [`${k}Other`]: '' };
    return { [k]: 'その他', [`${k}Other`]: v };
  };
  return {
    name: str(bean.name),
    shop: str(bean.shop),
    productUrl: str(bean.productUrl),
    country: str(bean.origin?.country),
    region: str(bean.origin?.region),
    farm: str(bean.origin?.farm),
    ...withOther('variety', VARIETY_OPTIONS),
    ...withOther('process', PROCESS_OPTIONS),
    roastLevel: str(bean.roastLevel),
    roastDate: str(bean.roastDate),
    orderDate: str(bean.orderDate),
    arrivalDate: str(bean.arrivalDate),
    labelWeightG: str(bean.labelWeightG),
    labelWeightBasis: bean.labelWeightBasis === 'roasted' ? 'roasted' : 'green',
    actualWeightG: str(bean.actualWeightG),
    priceJpy: str(bean.priceJpy),
    flavorNotes: str(bean.flavorNotes),
    memo: str(bean.memo),
    status: Object.hasOwn(BEAN_STATUS, bean.status) ? bean.status : 'unopened',
  };
}

/** 一覧に出す順：飲み切りは後ろ、それ以外は焙煎日の新しい順、焙煎日がないものは登録の新しい順 */
export function sortBeansForList(beans) {
  const rank = (b) => (b.status === 'finished' ? 1 : 0);
  return [...beans].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      String(b.roastDate ?? '').localeCompare(String(a.roastDate ?? '')) ||
      String(b.createdAt).localeCompare(String(a.createdAt)),
  );
}

/** 産地を1行にまとめる「エチオピア・イルガチェフェ」 */
export function originText(bean) {
  const o = bean.origin ?? {};
  return [o.country, o.region, o.farm].filter(Boolean).join('・');
}
