// お店で飲んだ1杯（X37 を記録だけに変えたもの、D-188、純粋関数）
// 手で淹れた抽出の記録（brews）とは別の表（cafeVisits）に持ち、分析・提案・カフェイン・年間まとめには入れない。

import { ROAST_LEVELS } from './roast.js';
import { parseNumber } from './beans.js';
import { STAR_MAX } from './tastings.js';

/** 淹れ方の選択肢（保存する値 → 表示） */
export const CAFE_METHODS = Object.freeze([
  { key: 'drip', label: 'ハンドドリップ' },
  { key: 'espresso', label: 'エスプレッソ' },
  { key: 'milk', label: 'ラテなど' },
  { key: 'other', label: 'その他' },
]);

/** ホット・アイス */
export const CAFE_TEMPS = Object.freeze([
  { key: 'hot', label: 'ホット' },
  { key: 'iced', label: 'アイス' },
]);

const clean = (v) => String(v ?? '').normalize('NFKC').trim();
const alive = (r) => r && r.deletedAt == null;
const pad2 = (n) => String(n).padStart(2, '0');

/** 日時を、日時の入力欄（datetime-local）の値（端末の時刻で YYYY-MM-DDTHH:mm）にする */
export function toLocalInputValue(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * お店の1杯の入力を確かめて、保存する形にする
 * @param {Record<string, string>} raw フォームの値（stars は数字の文字列か空）
 * @returns {{value:object, errors:Record<string,string>}}
 */
export function normalizeCafeInput(raw = {}) {
  const errors = {};
  const text = (k) => clean(raw[k]);

  const shopName = text('shopName');
  if (!shopName) errors.shopName = '店の名前を入れてください';

  let at = null;
  const atText = text('at');
  const t = atText ? new Date(atText) : null;
  if (!t || Number.isNaN(t.getTime())) errors.at = '飲んだ日時を入れてください';
  else at = t.toISOString();

  const method = text('method');
  if (method && !CAFE_METHODS.some((m) => m.key === method)) errors.method = '淹れ方を選んでください';
  const temp = text('temp');
  if (temp && !CAFE_TEMPS.some((m) => m.key === temp)) errors.temp = 'ホットかアイスを選んでください';
  const roastLevel = text('roastLevel');
  if (roastLevel && !ROAST_LEVELS.includes(roastLevel)) errors.roastLevel = '焙煎度を選んでください';

  let priceJpy = parseNumber(raw.priceJpy);
  if (priceJpy != null && (Number.isNaN(priceJpy) || priceJpy < 0 || priceJpy > 1000000)) {
    errors.priceJpy = '値段は0以上の数字で入れてください';
    priceJpy = null;
  } else if (priceJpy != null) priceJpy = Math.round(priceJpy);

  let stars = parseNumber(raw.stars);
  if (stars != null && (!Number.isInteger(stars) || stars < 1 || stars > STAR_MAX)) {
    errors.stars = `★は1〜${STAR_MAX}で選んでください`;
    stars = null;
  }

  return {
    value: {
      at,
      shopName,
      drinkName: text('drinkName'),
      method: method || null,
      temp: temp || null,
      beanName: text('beanName'),
      roastLevel: roastLevel || null,
      priceJpy,
      stars,
      memo: text('memo'),
    },
    errors,
  };
}

/** 保存したお店の1杯をフォームの値に戻す（編集のとき） */
export function cafeToFormValues(v) {
  const str = (x) => (x == null ? '' : String(x));
  return {
    at: v?.at ? toLocalInputValue(v.at) : '',
    shopName: str(v?.shopName),
    drinkName: str(v?.drinkName),
    method: str(v?.method),
    temp: str(v?.temp),
    beanName: str(v?.beanName),
    roastLevel: str(v?.roastLevel),
    priceJpy: str(v?.priceJpy),
    stars: str(v?.stars),
    memo: str(v?.memo),
  };
}

/** 新しい順（同じ日時なら作った順の新しいほうが先） */
export function sortCafeVisits(list = []) {
  return (list ?? [])
    .filter(alive)
    .slice()
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

/** 比べるときの形（全角・半角、大文字・小文字、空白の違いを無視） */
const key = (s) => clean(s).toLowerCase().replace(/\s+/g, '');

/** 店の名前・飲み物・豆・メモのどれかに、言葉（空白で区切るとすべてを含む）が入っている記録だけ */
export function searchCafeVisits(list = [], query = '') {
  const words = clean(query).toLowerCase().split(/\s+/).filter(Boolean).map(key);
  const sorted = sortCafeVisits(list);
  if (!words.length) return sorted;
  return sorted.filter((v) => {
    const hay = key([v.shopName, v.drinkName, v.beanName, v.memo].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** 前に入れた店の名前（よく行く順、同じ回数なら最近の順。表記ゆれは最近の書き方にまとめる） */
export function shopNameSuggestions(list = [], max = 20) {
  const byKey = new Map();
  for (const v of sortCafeVisits(list)) {
    const k = key(v.shopName);
    if (!k) continue;
    const cur = byKey.get(k);
    if (cur) cur.count += 1;
    else byKey.set(k, { name: v.shopName, count: 1, last: String(v.at ?? '') });
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, max)
    .map((s) => s.name);
}

const labelOf = (opts, k) => opts.find((o) => o.key === k)?.label ?? '';

/** 一覧の1行に出す説明（淹れ方・ホットかアイス・豆・焙煎度・値段） */
export function cafeSummary(v) {
  const parts = [];
  const how = [labelOf(CAFE_METHODS, v?.method), labelOf(CAFE_TEMPS, v?.temp)].filter(Boolean).join('・');
  if (how) parts.push(how);
  const bean = [v?.beanName, v?.roastLevel && `${v.roastLevel}ロースト`].filter(Boolean).join(' ');
  if (bean) parts.push(bean);
  if (v?.priceJpy != null) parts.push(`${v.priceJpy.toLocaleString('ja-JP')}円`);
  return parts.join(' / ');
}
