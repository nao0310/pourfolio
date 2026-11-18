// 冷凍ストック（C4）の計算
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFreezeInput,
  nextLabelNos,
  buildPortions,
  labelRange,
  freezeMemo,
  portionsOf,
  frozenG,
  freezerCount,
  pickPortionForBrew,
  frozenChoice,
  daysOffRoastFromPortion,
  portionText,
  stockParts,
  stockPartsText,
  groupPortionsByBean,
  MAX_PORTIONS,
} from '../js/core/frozen.js';

const p = (fields) => ({ id: `p${fields.labelNo}`, beanId: 'b1', grams: 15, frozenDate: '2026-11-10', takenOutAt: null, deletedAt: null, ...fields });

test('冷凍の入力：1袋の量・袋の数・日付を読み、合計を出す', () => {
  const { value, errors } = normalizeFreezeInput({ gramsPerPortion: '15', count: '4', frozenDate: '2026-11-18' }, { availableG: 100 });
  assert.deepEqual(errors, {});
  assert.deepEqual(value, { gramsPerPortion: 15, count: 4, frozenDate: '2026-11-18', totalG: 60 });
  // 全角や単位付きでもよい
  assert.equal(normalizeFreezeInput({ gramsPerPortion: '１２．５g', count: '２', frozenDate: '2026-11-18' }, { availableG: 100 }).value.totalG, 25);
});

test('冷凍の入力：常温の残りより多くは冷凍できない（0.1g単位の誤差は許す）', () => {
  const over = normalizeFreezeInput({ gramsPerPortion: '15', count: '7', frozenDate: '2026-11-18' }, { availableG: 100 });
  assert.equal(over.value, null);
  assert.match(over.errors.count, /常温の残り（100g）より多くは/);
  assert.ok(normalizeFreezeInput({ gramsPerPortion: '16.7', count: '6', frozenDate: '2026-11-18' }, { availableG: 100.17 }).value);
  // ちょうど全部
  assert.equal(normalizeFreezeInput({ gramsPerPortion: '20', count: '5', frozenDate: '2026-11-18' }, { availableG: 100 }).value.totalG, 100);
  // 常温がマイナスなら何も冷凍できない
  assert.ok(normalizeFreezeInput({ gramsPerPortion: '15', count: '1', frozenDate: '2026-11-18' }, { availableG: -3 }).errors.count);
});

test('冷凍の入力：空・0・上限超え・小数の袋数・日付なしは理由つきで止める', () => {
  const e = normalizeFreezeInput({ gramsPerPortion: '', count: '0', frozenDate: '' }, { availableG: 100 }).errors;
  assert.ok(e.gramsPerPortion);
  assert.ok(e.count);
  assert.ok(e.frozenDate);
  assert.ok(normalizeFreezeInput({ gramsPerPortion: '15', count: '1.5', frozenDate: '2026-11-18' }, { availableG: 100 }).errors.count);
  assert.ok(normalizeFreezeInput({ gramsPerPortion: '1', count: String(MAX_PORTIONS + 1), frozenDate: '2026-11-18' }, { availableG: 1000 }).errors.count);
  assert.ok(normalizeFreezeInput({ gramsPerPortion: '-5', count: '1', frozenDate: '2026-11-18' }, { availableG: 100 }).errors.gramsPerPortion);
});

test('袋の番号：冷凍庫にある袋と重ならない小さい番号から使う（取り出した・削除した袋の番号は使い直す）', () => {
  assert.deepEqual(nextLabelNos([], 3), [1, 2, 3]);
  const portions = [p({ labelNo: 1 }), p({ labelNo: 2, takenOutAt: '2026-11-15T00:00:00Z' }), p({ labelNo: 3 }), p({ labelNo: 4, deletedAt: 'x' })];
  assert.deepEqual(nextLabelNos(portions, 3), [2, 4, 5]);
});

test('袋の中身：冷凍した時点の焙煎後日数を残す。焙煎日がない・焙煎前なら null', () => {
  const value = { gramsPerPortion: 15, count: 2, frozenDate: '2026-11-18', totalG: 30 };
  const out = buildPortions({ bean: { id: 'b1', roastDate: '2026-11-10' }, value, labelNos: [3, 4], freezeTxId: 'tx1' });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    beanId: 'b1',
    labelNo: 3,
    grams: 15,
    frozenDate: '2026-11-18',
    roastDaysAtFreeze: 8,
    freezeTxId: 'tx1',
    takenOutAt: null,
    takenOutBrewId: null,
  });
  assert.equal(buildPortions({ bean: { id: 'b1', roastDate: null }, value, labelNos: [1, 2] })[0].roastDaysAtFreeze, null);
  assert.equal(buildPortions({ bean: { id: 'b1', roastDate: '2026-11-20' }, value, labelNos: [1, 2] })[0].roastDaysAtFreeze, null);
});

test('番号の書き方：続いていれば「#1〜#4」、そうでなければ「#2・#4」', () => {
  assert.equal(labelRange([4, 1, 2, 3]), '#1〜#4');
  assert.equal(labelRange([2, 4]), '#2・#4');
  assert.equal(labelRange([1, 2]), '#1・#2');
  assert.equal(labelRange([]), '');
  assert.equal(freezeMemo({ gramsPerPortion: 15, count: 3 }, [1, 2, 3]), '#1〜#3（15g×3袋）');
});

test('冷凍庫にある袋：その豆の分を古い順（冷凍日→番号）に。取り出した・削除した袋は数えない', () => {
  const portions = [
    p({ labelNo: 5, frozenDate: '2026-11-12' }),
    p({ labelNo: 2, frozenDate: '2026-11-10' }),
    p({ labelNo: 1, frozenDate: '2026-11-10' }),
    p({ labelNo: 3, takenOutAt: '2026-11-15T00:00:00Z' }),
    p({ labelNo: 4, deletedAt: '2026-11-15T00:00:00Z' }),
    p({ labelNo: 6, beanId: 'b2', grams: 20 }),
  ];
  assert.deepEqual(portionsOf(portions, 'b1').map((x) => x.labelNo), [1, 2, 5]);
  assert.equal(frozenG(portionsOf(portions, 'b1')), 45);
  assert.equal(frozenG(portions), 65);
  assert.equal(freezerCount(portions), 4);
  assert.equal(pickPortionForBrew(portions, 'b1').labelNo, 1);
  assert.equal(pickPortionForBrew(portions, 'none'), null);
  assert.deepEqual(Object.keys(groupPortionsByBean(portions)).sort(), ['b1', 'b2']);
});

test('抽出で冷凍の袋を使うか：袋があれば出し、常温が粉量に足りないときだけ初めから印を付ける', () => {
  const portions = [p({ labelNo: 1 })];
  assert.deepEqual(frozenChoice({ portions, beanId: 'b1', roomG: 0, doseG: 15 }), { portion: portions[0], checked: true });
  assert.equal(frozenChoice({ portions, beanId: 'b1', roomG: 14.9, doseG: 15 }).checked, true);
  assert.equal(frozenChoice({ portions, beanId: 'b1', roomG: 15, doseG: 15 }).checked, false);
  assert.deepEqual(frozenChoice({ portions, beanId: 'b2', roomG: 0, doseG: 15 }), { portion: null, checked: false });
  assert.deepEqual(frozenChoice({ portions, beanId: '', roomG: 0, doseG: 15 }), { portion: null, checked: false });
});

test('冷凍した豆の焙煎後日数：冷凍中の日数は数えない', () => {
  const portion = p({ labelNo: 1, roastDaysAtFreeze: 8 });
  // 冷凍して30日後に取り出してすぐ淹れても、焙煎後8日のまま
  assert.equal(daysOffRoastFromPortion(portion, '2026-12-10', '2026-12-10'), 8);
  // 取り出して2日後に淹れたら10日
  assert.equal(daysOffRoastFromPortion(portion, '2026-12-10', '2026-12-12'), 10);
  assert.equal(daysOffRoastFromPortion(p({ labelNo: 1, roastDaysAtFreeze: null }), '2026-12-10', '2026-12-10'), null);
});

test('残量のまとめ：常温（マイナスは0）＋冷凍＝合計', () => {
  const portions = [p({ labelNo: 1 }), p({ labelNo: 2 }), p({ labelNo: 3, takenOutAt: 'x' })];
  const parts = stockParts(40.04, portions);
  assert.deepEqual(parts, { roomG: 40, frozenG: 30, frozenCount: 2, totalG: 70 });
  assert.equal(stockPartsText(parts), '常温 40g＋冷凍 2袋（30g）');
  assert.deepEqual(stockParts(-2, []), { roomG: 0, frozenG: 0, frozenCount: 0, totalG: 0 });
  assert.equal(stockPartsText(stockParts(12.5, [])), '常温 12.5g');
});

test('袋の説明', () => {
  assert.equal(portionText(p({ labelNo: 3, roastDaysAtFreeze: 8 })), '#3　15g・11/10に冷凍（焙煎後8日）');
  assert.equal(portionText(p({ labelNo: 3, roastDaysAtFreeze: null })), '#3　15g・11/10に冷凍');
});

test('2-8の52番：「2026-02-31」のようなない日は冷凍した日として通さない', () => {
  assert.ok(normalizeFreezeInput({ gramsPerPortion: '15', count: '2', frozenDate: '2026-02-31' }, { availableG: 100 }).errors.frozenDate);
  assert.ok(normalizeFreezeInput({ gramsPerPortion: '15', count: '2', frozenDate: '2026-13-01' }, { availableG: 100 }).errors.frozenDate);
  assert.equal(normalizeFreezeInput({ gramsPerPortion: '15', count: '2', frozenDate: '2028-02-29' }, { availableG: 100 }).errors.frozenDate, undefined);
});
