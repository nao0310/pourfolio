// 焙煎所・店の台帳（C7）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopLedger, toggleFavorite, shopKey, NO_SHOP } from '../js/core/shops.js';

const bean = (id, extra = {}) => ({
  id,
  name: id,
  shop: '珈琲問屋',
  roastLevel: 'シティ',
  status: 'open',
  actualWeightG: 100,
  priceJpy: 1000,
  orderDate: '2026-11-01',
  createdAt: '2026-11-01T00:00:00Z',
  deletedAt: null,
  ...extra,
});
const brew = (id, beanId, doseG = 15) => ({ id, beanId, at: '2026-11-10T00:00:00Z', actual: { doseG }, deletedAt: null });
const tasting = (brewId, stars) => ({ id: `t-${brewId}`, brewId, by: 'me', stage: 'warm', stars, deletedAt: null });

test('店ごとに：袋の数・買った回数・使った金額（送料込み）・平均★・1杯の平均単価・よく買う豆', () => {
  const beans = [
    bean('a', { name: 'エチオピア', orderId: 'o1' }),
    bean('b', { name: 'エチオピア', orderId: 'o1', createdAt: '2026-11-01T00:00:01Z' }),
    bean('c', { name: 'ケニア', orderId: 'o2', orderDate: '2026-11-10', priceJpy: null, createdAt: '2026-11-10T00:00:00Z' }),
    // 注文につながっていない豆：買った日ごとに1回
    bean('d', { name: 'ブラジル', shop: 'カフェ ロッソ', orderDate: null, arrivalDate: '2026-11-05', priceJpy: 1500, actualWeightG: 150 }),
    bean('e', { name: 'グアテマラ', shop: 'カフェ　ロッソ', orderDate: null, arrivalDate: '2026-11-05', priceJpy: 1500, actualWeightG: 150 }),
    bean('f', { name: 'ペルー', shop: 'ｶﾌｪ ﾛｯｿ', orderDate: null, arrivalDate: '2026-11-12', priceJpy: 1500, actualWeightG: 150, createdAt: '2026-11-12T00:00:00Z' }),
    bean('x', { deletedAt: '2026-11-02T00:00:00Z' }),
  ];
  const orders = [
    { id: 'o1', orderDate: '2026-11-01', shippingJpy: 500, deletedAt: null },
    { id: 'o2', orderDate: '2026-11-10', shippingJpy: 300, deletedAt: null },
  ];
  const brews = [brew('1', 'a'), brew('2', 'b'), brew('3', 'c'), brew('4', 'd', 20), brew('5', 'x')];
  const tastings = [tasting('1', 4), tasting('2', 3), tasting('4', 5)];
  const rows = shopLedger({ beans, orders, brews, tastings });
  assert.equal(rows.length, 2);
  const [rosso, tonya] = rows; // ★の高い順
  assert.equal(rosso.name, 'ｶﾌｪ ﾛｯｿ', '店名は新しい豆の表記');
  assert.equal(rosso.key, 'カフェ ロッソ');
  assert.equal(rosso.bags, 3);
  assert.equal(rosso.purchases, 2, '同じ日の2袋で1回、別の日で1回');
  assert.equal(rosso.spentJpy, 4500);
  assert.equal(rosso.avgStars, 5);
  assert.equal(rosso.avgCostJpy, 200);
  assert.equal(rosso.yenPerStar, 40);
  assert.equal(rosso.lastBoughtYmd, '2026-11-12');

  assert.equal(tonya.name, '珈琲問屋');
  assert.equal(tonya.bags, 3);
  assert.equal(tonya.purchases, 2, '注文ごとに1回');
  assert.equal(tonya.spentJpy, 2000 + 500 + 300);
  assert.equal(tonya.unpricedBags, 1);
  assert.equal(tonya.cups, 3);
  assert.equal(tonya.avgStars, 3.5);
  assert.equal(tonya.rated, 2);
  assert.equal(tonya.avgCostJpy, 150, '価格のない豆の杯は単価に入れない');
  assert.deepEqual(tonya.topBeans, [
    { name: 'エチオピア', bags: 2 },
    { name: 'ケニア', bags: 1 },
  ]);
});

test('並び：お気に入りが先、次に平均★の高い順（評価なしは後ろ）、袋の多い順。購入先が空の豆もまとめる', () => {
  const beans = [
    bean('a', { shop: 'A店' }),
    bean('b', { shop: 'B店' }),
    bean('c', { shop: 'C店' }),
    bean('c2', { shop: 'C店' }),
    bean('n', { shop: '' }),
  ];
  const brews = [brew('1', 'a'), brew('2', 'b')];
  const tastings = [tasting('1', 3), tasting('2', 5)];
  const order = (favorites) => shopLedger({ beans, brews, tastings, favorites }).map((r) => r.name);
  assert.deepEqual(order([]), ['B店', 'A店', 'C店', NO_SHOP]);
  assert.deepEqual(order([shopKey('C店')]), ['C店', 'B店', 'A店', NO_SHOP]);
  // 購入先が空のまとまりはお気に入りにできない
  assert.equal(shopLedger({ beans, favorites: [''] }).find((r) => r.name === NO_SHOP).favorite, false);
});

test('お気に入りの切り替え：元の一覧は変えない', () => {
  const list = ['a'];
  assert.deepEqual(toggleFavorite(list, 'b'), ['a', 'b']);
  assert.deepEqual(toggleFavorite(list, 'a'), []);
  assert.deepEqual(list, ['a']);
  assert.deepEqual(toggleFavorite(undefined, 'a'), ['a']);
  assert.deepEqual(toggleFavorite(['a'], ''), ['a']);
});

test('データがないときは空', () => {
  assert.deepEqual(shopLedger({ beans: [] }), []);
});
