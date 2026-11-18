// 注文と入荷待ち（X29の登録部分）・到着・お届け日数（純粋関数）
// 注文メールの読み取り（tonya.js）が作った品目から、1袋ずつ「入荷待ち」の豆を作る。
// 届いたら実重量と到着日を入れ、入荷待ち → 未開封にする（そこで入庫の履歴ができる）。

import { ROAST_LEVELS } from './roast.js';
import { DEFAULT_SHOP } from './beans.js';
import { daysBetween } from './freshness.js';

/** お届け日数の初期値（注文から到着まで。実績が貯まると置き換わる） */
export const DEFAULT_DELIVERY_DAYS = 5;
/** 実績からお届け日数を出すのに必要な注文の数 */
export const DELIVERY_MIN_ORDERS = 2;
/** 1回の注文で登録できる袋の数の上限（読み間違いで大量に作らないため） */
export const MAX_BAGS = 30;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v) => String(v ?? '').normalize('NFKC').trim();

/** 「2026-11-18」に日数を足す（端末の時間帯によらず同じ答え） */
export function addDaysYmd(ymd, days) {
  if (!YMD.test(ymd ?? '')) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isValidYmd = (s) => YMD.test(s ?? '') && addDaysYmd(s, 0) === s;

/**
 * 注文の品目を確かめて整える（読み取りの結果や、画面で直した値）
 * @param {{name?:string, productCode?:string, roastLevel?:string, labelWeightG?:number|string, labelWeightBasis?:string, qty?:number|string, priceJpy?:number|string|null, productUrl?:string, process?:string, farm?:string}} item
 * @returns {{value:object, errors:Record<string,string>}}
 */
export function normalizeOrderItem(item = {}) {
  const errors = {};
  const name = clean(item.name);
  if (!name) errors.name = '銘柄を入れてください';
  let roastLevel = clean(item.roastLevel);
  if (roastLevel && !ROAST_LEVELS.includes(roastLevel)) roastLevel = '';
  const num = (v) => {
    const s = clean(v).replace(/[,，]/g, '');
    return s === '' ? null : Number(s);
  };
  const labelWeightG = num(item.labelWeightG);
  if (!(labelWeightG > 0 && labelWeightG <= 10000)) errors.labelWeightG = '重さ（g）を入れてください';
  const qty = num(item.qty ?? 1);
  if (!(Number.isInteger(qty) && qty >= 1 && qty <= MAX_BAGS)) errors.qty = `数量は1〜${MAX_BAGS}で入れてください`;
  let priceJpy = num(item.priceJpy);
  if (priceJpy != null && !(priceJpy >= 0)) {
    errors.priceJpy = '価格は0以上の数字で入れてください';
    priceJpy = null;
  }
  const productUrl = clean(item.productUrl);
  return {
    value: {
      name,
      productCode: clean(item.productCode),
      roastLevel,
      labelWeightG: labelWeightG > 0 ? Math.round(labelWeightG * 10) / 10 : null,
      qty: Number.isInteger(qty) ? qty : 1,
      priceJpy: priceJpy == null ? null : Math.round(priceJpy),
      productUrl: /^https?:\/\/\S+$/i.test(productUrl) ? productUrl : '',
      labelWeightBasis: item.labelWeightBasis === 'roasted' ? 'roasted' : 'green',
      process: clean(item.process),
      farm: clean(item.farm),
    },
    errors,
  };
}

/**
 * 注文1回の記録（orders の表に入れる中身）
 * @param {{orderNo?:string, orderDate:string, shippingJpy?:number|null, items:object[]}} order
 */
export function orderFields({ orderNo = '', orderDate, shippingJpy = null, items = [] }) {
  if (!isValidYmd(orderDate)) throw new Error('注文日の形が正しくありません');
  return {
    shop: DEFAULT_SHOP,
    orderNo: clean(orderNo),
    orderDate,
    shippingJpy: Number.isFinite(shippingJpy) && shippingJpy >= 0 ? Math.round(shippingJpy) : null,
    items: items.map(({ name, productCode, roastLevel, labelWeightG, labelWeightBasis, qty, priceJpy }) => ({
      name,
      productCode: productCode ?? '',
      roastLevel,
      labelWeightG,
      labelWeightBasis: labelWeightBasis === 'roasted' ? 'roasted' : 'green',
      qty,
      priceJpy,
    })),
  };
}

/**
 * 注文の品目から、1袋ずつ入荷待ちの豆を作る（数量2なら2袋）
 * 表記重量は生豆時（珈琲問屋の表記）。価格は1袋の値段。
 * @param {{orderId:string, orderDate:string, items:object[]}} p items は normalizeOrderItem の value
 * @returns {object[]} 豆の中身（id などは保存のときに付く）
 */
export function beansFromOrder({ orderId, orderDate, items }) {
  const bags = items.reduce((s, it) => s + it.qty, 0);
  if (bags > MAX_BAGS) throw new Error(`1回の注文で登録できるのは${MAX_BAGS}袋までです`);
  const out = [];
  for (const it of items) {
    for (let i = 0; i < it.qty; i += 1) {
      out.push({
        name: it.name,
        shop: DEFAULT_SHOP,
        productUrl: it.productUrl ?? '',
        productCode: it.productCode ?? '',
        origin: { country: '', region: '', farm: it.farm ?? '' },
        variety: '',
        process: it.process ?? '',
        roastLevel: it.roastLevel ?? '',
        roastDate: null,
        orderDate,
        arrivalDate: null,
        labelWeightG: it.labelWeightG,
        labelWeightBasis: it.labelWeightBasis === 'roasted' ? 'roasted' : 'green',
        actualWeightG: null,
        priceJpy: it.priceJpy ?? null,
        flavorNotes: '',
        memo: '',
        status: 'ordered',
        orderId,
      });
    }
  }
  return out;
}

/**
 * 届いたときの入力を確かめ、豆に入れる変更を作る
 * 焙煎日を入れなければ、到着日の前日にする（受注後に焙煎して発送するため。袋に焙煎日があれば直す）
 * @param {{arrivalDate:string, actualWeightG:string|number, roastDate?:string}} raw
 * @returns {{value:object, errors:Record<string,string>}}
 */
export function arrivalChanges(raw = {}) {
  const errors = {};
  const arrivalDate = clean(raw.arrivalDate);
  if (!isValidYmd(arrivalDate)) errors.arrivalDate = '到着日を入れてください';
  const w = Number(clean(raw.actualWeightG).replace(/[,，]/g, '').replace(/g$/i, ''));
  if (!(w > 0 && w <= 10000)) errors.actualWeightG = '量った重さ（g）を入れてください';
  let roastDate = clean(raw.roastDate);
  if (roastDate && !isValidYmd(roastDate)) errors.roastDate = '日付の形が正しくありません';
  if (!roastDate && isValidYmd(arrivalDate)) roastDate = addDaysYmd(arrivalDate, -1);
  if (roastDate && isValidYmd(arrivalDate) && roastDate > arrivalDate) errors.roastDate = '焙煎日が到着日より後になっています';
  return {
    value: { status: 'unopened', arrivalDate, actualWeightG: Math.round(w * 10) / 10, roastDate: roastDate || null },
    errors,
  };
}

/**
 * お届け日数：注文日から到着日までの日数の中央値（注文ごとに1つ。DELIVERY_MIN_ORDERS 回以上あれば）
 * @param {object[]} beans
 * @param {number} [fallback] 設定の値（なければ初期値）
 * @returns {{days:number, learned:boolean, samples:number}}
 */
export function deliveryDays(beans = [], fallback = DEFAULT_DELIVERY_DAYS) {
  const perOrder = new Map();
  for (const b of beans) {
    if (b.deletedAt != null || !b.orderDate || !b.arrivalDate) continue;
    const d = daysBetween(b.orderDate, b.arrivalDate);
    if (d == null || d < 0 || d > 60) continue;
    const key = b.orderId ?? `${b.orderDate}/${b.arrivalDate}`;
    if (!perOrder.has(key)) perOrder.set(key, d);
  }
  const ds = [...perOrder.values()].sort((a, b) => a - b);
  const base = Number.isFinite(fallback) && fallback >= 0 ? fallback : DEFAULT_DELIVERY_DAYS;
  if (ds.length < DELIVERY_MIN_ORDERS) return { days: base, learned: false, samples: ds.length };
  const mid = Math.floor(ds.length / 2);
  const median = ds.length % 2 ? ds[mid] : (ds[mid - 1] + ds[mid]) / 2;
  return { days: Math.ceil(median), learned: true, samples: ds.length };
}
