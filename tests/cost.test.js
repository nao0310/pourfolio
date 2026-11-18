// コスト管理（C6）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gramPrice,
  brewCostJpy,
  boughtYmd,
  addMonths,
  monthlySpending,
  costByGroup,
  costSummary,
  groupKey,
  yen,
  yenPerGText,
  COST_MONTHS,
} from '../js/core/cost.js';

const TODAY = '2026-11-18';
const bean = (id, extra = {}) => ({
  id,
  name: id,
  shop: '珈琲問屋',
  roastLevel: 'シティ',
  status: 'open',
  labelWeightG: 200,
  labelWeightBasis: 'green',
  actualWeightG: 160,
  priceJpy: 1200,
  orderDate: '2026-11-01',
  createdAt: '2026-11-01T00:00:00Z',
  deletedAt: null,
  ...extra,
});
const brew = (id, beanId, doseG, at = '2026-11-10T00:00:00Z', extra = {}) => ({ id, beanId, at, actual: { doseG }, deletedAt: null, ...extra });
const tasting = (brewId, stars) => ({ id: `t-${brewId}`, brewId, by: 'me', stage: 'warm', stars, deletedAt: null });

test('1gあたりの値段：量った重さで割る。量っていなければ見積もりの重さ（印つき）。価格がなければ null', () => {
  assert.deepEqual(gramPrice(bean('a')), { yenPerG: 7.5, estimated: false });
  const est = gramPrice(bean('b', { actualWeightG: null }));
  assert.equal(est.estimated, true);
  assert.equal(Math.round(est.yenPerG * 1000) / 1000, Math.round((1200 / 164) * 1000) / 1000, '生豆時200g・シティは目減り18%で164g');
  assert.deepEqual(gramPrice(bean('c', { actualWeightG: null, labelWeightBasis: 'roasted', labelWeightG: 100, priceJpy: 900 })), { yenPerG: 9, estimated: false });
  assert.equal(gramPrice(bean('d', { priceJpy: null })), null);
  assert.equal(gramPrice(bean('e', { actualWeightG: null, labelWeightG: null })), null);
  assert.deepEqual(gramPrice(bean('f', { priceJpy: 0 })), { yenPerG: 0, estimated: false });
  assert.equal(yenPerGText(gramPrice(bean('a'))), '7.5円/g');
  assert.equal(yenPerGText(est), '7.3円/g（見積もりの重さ）');
});

test('1杯の原価：粉量×1gあたり（小数1桁）。豆・粉量・価格のどれかがなければ null', () => {
  assert.equal(brewCostJpy(brew('x', 'a', 15), bean('a')), 112.5);
  assert.equal(brewCostJpy(brew('x', 'a', 15.3), bean('a')), 114.8);
  assert.equal(brewCostJpy(brew('x', 'a', null), bean('a')), null);
  assert.equal(brewCostJpy(brew('x', 'a', 15), null), null);
  assert.equal(brewCostJpy(brew('x', 'a', 15), bean('a', { priceJpy: null })), null);
});

test('買った日：注文日 → 到着日 → 登録日', () => {
  assert.equal(boughtYmd(bean('a')), '2026-11-01');
  assert.equal(boughtYmd(bean('a', { orderDate: null, arrivalDate: '2026-11-05' })), '2026-11-05');
  assert.equal(boughtYmd(bean('a', { orderDate: null, arrivalDate: null, createdAt: '2026-10-20T03:00:00Z' })), '2026-10-20');
});

test('月の足し引き：年をまたぐ', () => {
  assert.equal(addMonths('2026-11', -1), '2026-10');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', -11), '2025-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
});

test('月の支出：買った月（豆の価格＋送料）と飲んだ月（原価の合計）。記録のない月も0で出し、範囲外と削除済みは数えない', () => {
  const beans = [
    bean('a'), // 11月に1,200円
    bean('b', { orderDate: '2026-10-20', priceJpy: 800, actualWeightG: 100 }), // 10月に800円（8円/g）
    bean('c', { orderDate: '2026-11-05', priceJpy: null }), // 価格なし
    bean('old', { orderDate: '2025-01-01' }), // 範囲外
    bean('del', { deletedAt: '2026-11-02T00:00:00Z' }),
  ];
  const orders = [
    { id: 'o1', orderDate: '2026-11-01', shippingJpy: 500, deletedAt: null },
    { id: 'o2', orderDate: '2026-10-20', shippingJpy: 0, deletedAt: null },
    { id: 'o3', orderDate: '2026-11-03', shippingJpy: 300, deletedAt: '2026-11-04T00:00:00Z' },
  ];
  const brews = [
    brew('1', 'a', 15, '2026-11-10T00:00:00Z'), // 112.5円
    brew('2', 'b', 15, '2026-11-11T00:00:00Z'), // 120円
    brew('3', 'c', 15, '2026-11-12T00:00:00Z'), // 価格なし
    brew('4', 'b', 15, '2026-10-25T00:00:00Z'), // 10月 120円
    brew('5', 'a', 15, '2026-11-13T00:00:00Z', { deletedAt: '2026-11-14T00:00:00Z' }),
    brew('6', 'a', null, '2026-11-13T00:00:00Z'), // 粉量なしは数えない
  ];
  const rows = monthlySpending({ beans, orders, brews, today: TODAY });
  assert.equal(rows.length, COST_MONTHS);
  assert.deepEqual(
    rows.map((r) => r.month),
    ['2026-11', '2026-10', '2026-09', '2026-08', '2026-07', '2026-06'],
  );
  assert.deepEqual(rows[0], {
    month: '2026-11',
    beansJpy: 1200,
    shippingJpy: 500,
    boughtJpy: 1700,
    bags: 2,
    unpricedBags: 1,
    drankJpy: 233, // 112.5＋120 を四捨五入
    cups: 3,
    uncostedCups: 1,
  });
  assert.equal(rows[1].boughtJpy, 800);
  assert.equal(rows[1].drankJpy, 120);
  assert.equal(rows[2].boughtJpy, 0);
  assert.equal(rows[2].cups, 0);
});

test('切り口ごと：1杯の平均単価と、★1つあたりの円（平均単価÷平均★）。杯数の多い順', () => {
  const beans = [
    bean('a', { name: 'エチオピア', roastLevel: 'シティ', shop: '珈琲問屋' }), // 7.5円/g
    bean('a2', { name: 'エチオピア ', roastLevel: 'ハイ', shop: 'こーひーどんや' }), // 名前の空白違いは同じ銘柄
    bean('b', { name: 'ケニア', roastLevel: 'シティ', priceJpy: 1600 }), // 10円/g
    bean('c', { name: 'コロンビア', roastLevel: '', priceJpy: null, shop: '' }),
  ];
  const brews = [brew('1', 'a', 20), brew('2', 'a', 20), brew('3', 'a2', 20), brew('4', 'b', 15), brew('5', 'c', 15)];
  const tastings = [tasting('1', 5), tasting('2', 3), tasting('4', 2)];
  const byName = costByGroup({ beans, brews, tastings, by: 'name' });
  assert.deepEqual(byName[0], { key: 'エチオピア', label: 'エチオピア', cups: 3, avgCostJpy: 150, avgStars: 4, rated: 2, yenPerStar: 37.5 });
  const kenya = byName.find((g) => g.label === 'ケニア');
  assert.deepEqual(kenya, { key: 'ケニア', label: 'ケニア', cups: 1, avgCostJpy: 150, avgStars: 2, rated: 1, yenPerStar: 75 });
  const colombia = byName.find((g) => g.label === 'コロンビア');
  assert.equal(colombia.avgCostJpy, null);
  assert.equal(colombia.yenPerStar, null);

  const byRoast = costByGroup({ beans, brews, tastings, by: 'roastLevel' });
  assert.deepEqual(
    byRoast.map((g) => [g.label, g.cups]),
    [
      ['シティ', 3],
      ['ハイ', 1],
      ['（未入力）', 1],
    ],
  );
  const byShop = costByGroup({ beans, brews, tastings, by: 'shop' });
  assert.deepEqual(byShop[0].label, '珈琲問屋');
  assert.equal(byShop[0].cups, 3);
});

test('まとめ：直近30日の杯数と1杯の平均単価、今月の買った額・飲んだ額', () => {
  const beans = [bean('a')];
  const brews = [brew('1', 'a', 15, '2026-11-18T01:00:00Z'), brew('2', 'a', 20, '2026-10-21T01:00:00Z'), brew('3', 'a', 15, '2026-10-10T00:00:00Z')];
  const s = costSummary({ beans, orders: [], brews, today: TODAY });
  assert.equal(s.cups30, 2);
  assert.equal(s.avgCost30, 131.3);
  assert.equal(s.thisMonth.boughtJpy, 1200);
  assert.equal(s.thisMonth.drankJpy, 113);
  const empty = costSummary({ beans: [], brews: [], today: TODAY });
  assert.equal(empty.avgCost30, null);
  assert.equal(empty.cups30, 0);
});

test('表示：円と鍵', () => {
  assert.equal(yen(1234.5), '1,235円');
  assert.equal(yen(null), '');
  assert.equal(groupKey(' Ｃｏｆｆｅｅ  Ｔｏｎｙａ '), 'coffee tonya');
});
