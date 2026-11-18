// 焙煎所・店の台帳（C7、純粋関数）
// 豆の「購入先」ごとに、買った袋の数・買った回数・買った額・平均★・1杯の平均単価をまとめる。
// 店名は全角・半角、大文字・小文字、空白の違いを同じ店として数える。
// お気に入りは設定（settings.favoriteShops：店の鍵の一覧）に覚える（表は増やさない）。

import { groupKey, brewCostJpy, boughtYmd } from './cost.js';
import { pickTasting } from './tastings.js';

const alive = (r) => r && r.deletedAt == null;
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/** 購入先が空の豆をまとめる見出し */
export const NO_SHOP = '（購入先なし）';
/** 店ごとに出す「よく買う豆」の数 */
export const TOP_BEANS = 3;

/** 店の鍵（購入先が空なら空文字） */
export const shopKey = (name) => groupKey(name);

/** 店名の見た目を整える（前後の空白・続いた空白） */
const displayName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ');

/**
 * 店の台帳
 * - 買った回数：注文ごとに1回。注文につながっていない豆は、買った日ごとに1回
 * - 買った額：豆の価格の合計＋その店の注文の送料
 * @param {{beans:object[], orders?:object[], brews?:object[], tastings?:object[], favorites?:string[]}} p
 * @returns {{key:string, name:string, favorite:boolean, bags:number, purchases:number, spentJpy:number, unpricedBags:number,
 *   cups:number, avgStars:number|null, rated:number, avgCostJpy:number|null, yenPerStar:number|null,
 *   lastBoughtYmd:string|null, topBeans:{name:string, bags:number}[]}[]}
 *   お気に入りが先、次に平均★の高い順（評価なしは後ろ）、袋の多い順
 */
export function shopLedger({ beans = [], orders = [], brews = [], tastings = [], favorites = [] }) {
  const list = beans.filter(alive);
  const fav = new Set(favorites ?? []);
  const shops = new Map();
  const beanShop = new Map();
  // 新しい豆の表記を店名に使うため、古い順に回す
  const sorted = [...list].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const b of sorted) {
    const key = shopKey(b.shop);
    beanShop.set(b.id, key);
    const s = shops.get(key) ?? {
      key,
      name: '',
      bags: 0,
      purchaseKeys: new Set(),
      orderIds: new Set(),
      spentJpy: 0,
      unpricedBags: 0,
      lastBoughtYmd: null,
      beanNames: new Map(),
      cups: 0,
      costSum: 0,
      costed: 0,
      starSum: 0,
      rated: 0,
    };
    s.name = displayName(b.shop) || NO_SHOP;
    s.bags += 1;
    const ymd = boughtYmd(b);
    s.purchaseKeys.add(b.orderId ? `order:${b.orderId}` : `day:${ymd ?? b.id}`);
    if (b.orderId) s.orderIds.add(b.orderId);
    if (b.priceJpy == null) s.unpricedBags += 1;
    else s.spentJpy += b.priceJpy;
    if (ymd && (!s.lastBoughtYmd || ymd > s.lastBoughtYmd)) s.lastBoughtYmd = ymd;
    const nameKey = groupKey(b.name);
    const bn = s.beanNames.get(nameKey) ?? { name: displayName(b.name), bags: 0 };
    bn.bags += 1;
    s.beanNames.set(nameKey, bn);
    shops.set(key, s);
  }
  // 送料：その注文の豆が属する店に足す（注文1回につき1回）
  for (const o of orders.filter(alive)) {
    if (!(Number(o.shippingJpy) > 0)) continue;
    const s = [...shops.values()].find((x) => x.orderIds.has(o.id));
    if (s) s.spentJpy += o.shippingJpy;
  }
  // 抽出：杯数・平均★・1杯の平均単価
  const beanOf = new Map(list.map((b) => [b.id, b]));
  for (const br of brews.filter(alive)) {
    const s = shops.get(beanShop.get(br.beanId));
    if (!s) continue;
    s.cups += 1;
    const cost = brewCostJpy(br, beanOf.get(br.beanId), list);
    if (cost != null) {
      s.costSum += cost;
      s.costed += 1;
    }
    const stars = pickTasting(tastings, br.id)?.stars;
    if (typeof stars === 'number' && stars > 0) {
      s.starSum += stars;
      s.rated += 1;
    }
  }
  return [...shops.values()]
    .map((s) => {
      const avgStars = s.rated ? round2(s.starSum / s.rated) : null;
      const avgCostJpy = s.costed ? round1(s.costSum / s.costed) : null;
      return {
        key: s.key,
        name: s.name,
        favorite: s.key !== '' && fav.has(s.key),
        bags: s.bags,
        purchases: s.purchaseKeys.size,
        spentJpy: s.spentJpy,
        unpricedBags: s.unpricedBags,
        cups: s.cups,
        avgStars,
        rated: s.rated,
        avgCostJpy,
        yenPerStar: avgCostJpy != null && avgStars ? round1(avgCostJpy / avgStars) : null,
        lastBoughtYmd: s.lastBoughtYmd,
        topBeans: [...s.beanNames.values()].sort((a, b) => b.bags - a.bags || a.name.localeCompare(b.name, 'ja')).slice(0, TOP_BEANS),
      };
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.avgStars ?? -1) - (a.avgStars ?? -1) || b.bags - a.bags);
}

/**
 * お気に入りを切り替えた新しい一覧（元の配列は変えない）
 * @param {string[]} favorites
 * @param {string} key 店の鍵
 */
export function toggleFavorite(favorites, key) {
  const list = Array.isArray(favorites) ? favorites : [];
  if (!key) return [...list];
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}
