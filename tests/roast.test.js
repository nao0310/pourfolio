import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROAST_LEVELS, DEFAULT_LOSS_PCT, roastGroup, learnedLossPct, lossPct, initialStockG } from '../js/core/roast.js';

test('焙煎度は珈琲問屋の8段階で、どれも区分と目減り率の初期値を持つ', () => {
  assert.deepEqual(ROAST_LEVELS, ['ライト', 'シナモン', 'ミディアム', 'ハイ', 'シティ', 'フルシティ', 'フレンチ', 'イタリアン']);
  for (const lv of ROAST_LEVELS) {
    assert.ok(roastGroup(lv), lv);
    assert.ok(DEFAULT_LOSS_PCT[lv] > 0, lv);
  }
  assert.equal(roastGroup('シティ'), 'mediumDark');
  assert.equal(roastGroup('不明'), null);
});

test('目減り率の初期値は深い焙煎ほど大きい', () => {
  const pcts = ROAST_LEVELS.map((lv) => DEFAULT_LOSS_PCT[lv]);
  for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] > pcts[i - 1]);
});

test('生豆時200g・シティは、初期値18%で164gと見積もる', () => {
  const r = initialStockG({ labelWeightG: 200, labelWeightBasis: 'green', roastLevel: 'シティ' });
  assert.deepEqual(r, { g: 164, estimated: true, lossPct: 18, learned: false });
});

test('実重量があればそれを使い、焙煎後の表記ならその値を使う', () => {
  assert.deepEqual(
    initialStockG({ labelWeightG: 200, labelWeightBasis: 'green', actualWeightG: 166.5, roastLevel: 'シティ' }),
    { g: 166.5, estimated: false },
  );
  assert.deepEqual(initialStockG({ labelWeightG: 200, labelWeightBasis: 'roasted', roastLevel: 'シティ' }), { g: 200, estimated: false });
  assert.equal(initialStockG({ labelWeightBasis: 'green' }), null);
});

test('焙煎度がわからないときは18%で見積もる', () => {
  assert.equal(initialStockG({ labelWeightG: 100, labelWeightBasis: 'green', roastLevel: '' }).g, 82);
});

const past = (id, level, label, actual, extra = {}) => ({
  id,
  roastLevel: level,
  labelWeightBasis: 'green',
  labelWeightG: label,
  actualWeightG: actual,
  deletedAt: null,
  ...extra,
});

test('同じ焙煎度で実重量を量った豆があれば、その平均の目減り率を使う', () => {
  const beans = [
    past('a', 'シティ', 100, 80), // 20%
    past('b', 'シティ', 200, 168), // 16%
    past('c', 'ハイ', 100, 90), // 焙煎度が違う
    past('d', 'シティ', 100, 50, { deletedAt: '2026-11-01T00:00:00Z' }), // 削除済み
    past('e', 'シティ', 100, 85, { labelWeightBasis: 'roasted' }), // 焙煎後表記
  ];
  assert.deepEqual(learnedLossPct(beans, 'シティ'), { pct: 18, count: 2 });
  assert.deepEqual(lossPct('シティ', beans), { pct: 18, learned: true, count: 2 });
  assert.deepEqual(lossPct('フレンチ', beans), { pct: 21, learned: false, count: 0 });
  const r = initialStockG({ id: 'new', labelWeightG: 100, labelWeightBasis: 'green', roastLevel: 'ハイ' }, beans);
  assert.deepEqual(r, { g: 90, estimated: true, lossPct: 10, learned: true });
});

test('自分自身は学習に使わない', () => {
  assert.equal(learnedLossPct([past('x', 'シティ', 100, 70)], 'シティ', 'x'), null);
  assert.equal(initialStockG(past('x', 'シティ', 100, null), [past('x', 'シティ', 100, 70)]).g, 82);
});
