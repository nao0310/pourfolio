// 気になる豆リスト（F6、spec 6.5・9章の Wishlist、純粋関数）
// 買う候補の豆を貯めておく。商品ページの貼り付け（X28 と同じ読み取り）か手入力で足し、
// 買ったら豆の登録画面を開いて「購入済み」にする。予測の点数は保存せず、表示のたびに計算する（D-095 と同じ考え方）。

import { ROAST_LEVELS } from './roast.js';
import { parseNumber, DEFAULT_SHOP } from './beans.js';
import { nameKey } from './compare.js';

const clean = (v) => String(v ?? '').normalize('NFKC').trim();
const alive = (r) => r && r.deletedAt == null;

/**
 * 気になる豆の入力を確かめて、保存する形にする
 * @param {Record<string, string>} raw フォームの値
 * @returns {{value:object, errors:Record<string,string>}}
 */
export function normalizeWishInput(raw = {}) {
  const errors = {};
  const text = (k) => clean(raw[k]);
  const name = text('name');
  if (!name) errors.name = '銘柄を入れてください';
  const productUrl = text('productUrl');
  if (productUrl && !/^https?:\/\/\S+$/i.test(productUrl)) errors.productUrl = 'https:// で始まるURLを入れてください';
  const roastLevel = text('roastLevel');
  if (roastLevel && !ROAST_LEVELS.includes(roastLevel)) errors.roastLevel = '焙煎度を選んでください';
  let priceJpy = parseNumber(raw.priceJpy);
  if (priceJpy != null && (Number.isNaN(priceJpy) || priceJpy < 0 || priceJpy > 1000000)) {
    errors.priceJpy = '価格は0以上の数字で入れてください';
    priceJpy = null;
  } else if (priceJpy != null) priceJpy = Math.round(priceJpy);
  let labelWeightG = parseNumber(raw.labelWeightG);
  if (labelWeightG != null && (Number.isNaN(labelWeightG) || labelWeightG <= 0 || labelWeightG > 100000)) {
    errors.labelWeightG = '重さは0より大きい数字で入れてください';
    labelWeightG = null;
  }
  const priceTable = Array.isArray(raw.priceTable)
    ? raw.priceTable.filter((r) => Number.isFinite(r?.g) && r.g > 0 && Number.isFinite(r?.priceJpy) && r.priceJpy >= 0).map((r) => ({ g: r.g, priceJpy: r.priceJpy }))
    : [];
  return {
    value: {
      name,
      productUrl,
      productCode: text('productCode'),
      origin: { country: text('country'), region: text('region'), farm: text('farm') },
      variety: text('variety'),
      process: text('process'),
      roastLevel, // 店の標準の焙煎度（わかれば）
      labelWeightG: labelWeightG ?? (priceJpy != null ? 100 : null),
      labelWeightBasis: 'green',
      priceJpy,
      priceTable,
      flavorNotes: text('flavorNotes'),
      memo: text('memo'),
    },
    errors,
  };
}

/** 商品ページの読み取り結果（tonya.js の parseProductText）を、気になる豆のフォームの値にする */
export function wishFormFromProduct(p, productUrl = '') {
  return {
    name: p?.name ?? '',
    productUrl: clean(productUrl),
    productCode: p?.productCode ?? '',
    country: p?.country ?? '',
    region: p?.region ?? '',
    farm: p?.farm ?? '',
    variety: p?.variety ?? '',
    process: p?.process ?? '',
    roastLevel: p?.roastLevel ?? '',
    labelWeightG: p?.labelWeightG != null ? String(p.labelWeightG) : '',
    priceJpy: p?.priceJpy != null ? String(p.priceJpy) : '',
    priceTable: p?.priceTable ?? [],
    flavorNotes: p?.flavorNotes ?? '',
    memo: '',
  };
}

/** 保存した気になる豆をフォームの値に戻す（編集のとき） */
export function wishToFormValues(w) {
  const str = (v) => (v == null ? '' : String(v));
  return {
    name: str(w?.name),
    productUrl: str(w?.productUrl),
    productCode: str(w?.productCode),
    country: str(w?.origin?.country),
    region: str(w?.origin?.region),
    farm: str(w?.origin?.farm),
    variety: str(w?.variety),
    process: str(w?.process),
    roastLevel: str(w?.roastLevel),
    labelWeightG: str(w?.labelWeightG),
    priceJpy: str(w?.priceJpy),
    flavorNotes: str(w?.flavorNotes),
    memo: str(w?.memo),
  };
}

/** URLを比べるときの形（末尾の / と ? 以降を無視） */
const urlKey = (u) => clean(u).replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();

/**
 * 買った豆（なければ null）。登録画面でつないだ豆、なければ気になる豆を足したあとに登録した、
 * 商品ページのURLか銘柄が同じ豆
 */
export function boughtBeanOf(wish, beans = []) {
  const list = (beans ?? []).filter(alive);
  if (wish?.boughtBeanId) {
    const b = list.find((x) => x.id === wish.boughtBeanId);
    if (b) return b;
  }
  const after = list.filter((b) => String(b.createdAt ?? '') >= String(wish?.createdAt ?? ''));
  const u = urlKey(wish?.productUrl);
  if (u) {
    const byUrl = after.find((b) => urlKey(b.productUrl) === u);
    if (byUrl) return byUrl;
  }
  const k = nameKey(wish);
  return k ? after.find((b) => nameKey(b) === k) ?? null : null;
}

/**
 * 気になる豆の一覧を「まだ買っていない」と「購入済み」に分ける（新しく足した順）
 * @returns {{open:object[], bought:{wish:object, bean:object}[]}}
 */
export function splitWishlist(wishlist = [], beans = []) {
  const open = [];
  const bought = [];
  const list = (wishlist ?? []).filter(alive).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const w of list) {
    const bean = boughtBeanOf(w, beans);
    if (bean) bought.push({ wish: w, bean });
    else open.push(w);
  }
  return { open, bought };
}

/**
 * 「買った」で開く豆の登録画面に入れる値（beans.js の beanToFormValues と同じ形の一部）
 * 焙煎度と重さは、注文した内容に直してもらう
 */
export function wishToBeanForm(w, { roastLevel = '', labelWeightG = null } = {}) {
  const g = labelWeightG ?? w?.labelWeightG ?? null;
  const hit = (w?.priceTable ?? []).find((r) => r.g === g);
  return {
    name: clean(w?.name),
    shop: DEFAULT_SHOP,
    productUrl: clean(w?.productUrl),
    productCode: clean(w?.productCode),
    country: clean(w?.origin?.country),
    region: clean(w?.origin?.region),
    farm: clean(w?.origin?.farm),
    variety: clean(w?.variety),
    process: clean(w?.process),
    roastLevel: roastLevel || clean(w?.roastLevel),
    labelWeightG: g != null ? String(g) : '',
    labelWeightBasis: 'green',
    priceJpy: hit ? String(hit.priceJpy) : w?.priceJpy != null && g === w?.labelWeightG ? String(w.priceJpy) : '',
    flavorNotes: clean(w?.flavorNotes),
    status: 'ordered',
  };
}

/** 気になる豆を1行にまとめる「エチオピア・ナチュラル・ミディアム（店の標準）・720円/100g」 */
export function wishSummary(w) {
  const price = w?.priceJpy != null ? `${w.priceJpy.toLocaleString('ja-JP')}円${w.labelWeightG ? `/${w.labelWeightG}g` : ''}` : '';
  return [clean(w?.origin?.country), clean(w?.process), w?.roastLevel ? `${w.roastLevel}（店の標準）` : '', price].filter(Boolean).join('・');
}
