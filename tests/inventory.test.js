import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  remainingG,
  cupsLeft,
  consumptionPace,
  emptyForecast,
  adjustDelta,
  doseFromSettings,
  groupTxByBean,
  sortTxNewestFirst,
  DEFAULT_DOSE_G,
  stockCheckForBrew,
} from '../js/core/inventory.js';

const NOW = new Date('2026-11-18T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const tx = (deltaG, kind, at = daysAgo(0), extra = {}) => ({ beanId: 'b', deltaG, kind, at, createdAt: at, deletedAt: null, ...extra });

test('残量は履歴の合計。削除の印が付いた履歴は数えない', () => {
  const txs = [tx(164, 'in'), tx(-15, 'brew'), tx(-15.2, 'brew'), tx(-30, 'gift', undefined, { deletedAt: daysAgo(0) })];
  assert.equal(remainingG(txs), 133.8);
  assert.equal(remainingG([]), 0);
});

test('小数の足し算の誤差を残さない', () => {
  assert.equal(remainingG([tx(0.1, 'in'), tx(0.2, 'in')]), 0.3);
});

test('残り杯数は端数を切り捨て、マイナスにしない', () => {
  assert.equal(cupsLeft(164, 15), 10);
  assert.equal(cupsLeft(45, 15), 3);
  assert.equal(cupsLeft(14.9, 15), 0);
  assert.equal(cupsLeft(-3, 15), 0);
  assert.equal(cupsLeft(30, 0), 0);
});

test('1杯の粉の量は設定から読み、なければ15g', () => {
  assert.equal(DEFAULT_DOSE_G, 15);
  assert.equal(doseFromSettings(null), 15);
  assert.equal(doseFromSettings({ defaultDoseG: 20 }), 20);
  assert.equal(doseFromSettings({ defaultDoseG: 0 }), 15);
});

test('消費ペースは直近2週間の抽出だけで出し、2回未満なら出さない', () => {
  assert.equal(consumptionPace([tx(164, 'in'), tx(-15, 'brew', daysAgo(1))], NOW), null);
  const txs = [
    tx(164, 'in', daysAgo(20)),
    tx(-15, 'brew', daysAgo(20)), // 期間外
    tx(-15, 'brew', daysAgo(10)),
    tx(-15, 'brew', daysAgo(5)),
    tx(-15, 'brew', daysAgo(0)),
    tx(-50, 'gift', daysAgo(2)), // 抽出ではない
    tx(-15, 'brew', daysAgo(3), { deletedAt: daysAgo(0) }), // 削除済み
  ];
  // 10日前から今日までに45g → 4.5g/日
  assert.deepEqual(consumptionPace(txs, NOW), { gPerDay: 4.5, brews: 3 });
});

test('今日始めたばかりでも、ペースは1日分として計算する', () => {
  const txs = [tx(-15, 'brew', daysAgo(0.1)), tx(-15, 'brew', daysAgo(0))];
  assert.deepEqual(consumptionPace(txs, NOW), { gPerDay: 30, brews: 2 });
});

test('なくなる日は、残量÷ペースの日数後', () => {
  const f = emptyForecast(100, { gPerDay: 30, brews: 3 }, NOW);
  assert.equal(f.days, 3);
  assert.equal(f.date.toISOString(), new Date(NOW.getTime() + 3 * 86400000).toISOString());
  assert.equal(emptyForecast(100, null, NOW), null);
  assert.equal(emptyForecast(-5, { gPerDay: 10 }, NOW).days, 0);
});

test('量り直しの調整量は「量った値 − 計算上の残量」', () => {
  assert.equal(adjustDelta(133.8, 130), -3.8);
  assert.equal(adjustDelta(100, 102.5), 2.5);
});

test('履歴を豆ごとに分け、新しい順に並べる', () => {
  const a = tx(1, 'in', daysAgo(2), { beanId: 'a' });
  const b = tx(1, 'in', daysAgo(1), { beanId: 'b' });
  const c = tx(1, 'in', daysAgo(0), { beanId: 'a' });
  assert.deepEqual(groupTxByBean([a, b, c]), { a: [a, c], b: [b] });
  assert.deepEqual(sortTxNewestFirst([a, b, c]), [c, b, a]);
});

test('2-8の32番：保存の前に、残りが足りないか・0gになるかを確かめる', () => {
  assert.deepEqual(stockCheckForBrew({ txCount: 2, roomG: 30, doseG: 15 }), { short: false, empty: false, afterG: 15 });
  assert.deepEqual(stockCheckForBrew({ txCount: 2, roomG: 15, doseG: 15 }), { short: false, empty: true, afterG: 0 });
  assert.deepEqual(stockCheckForBrew({ txCount: 2, roomG: 15.3, doseG: 15 }), { short: false, empty: true, afterG: 0.3 });
  assert.deepEqual(stockCheckForBrew({ txCount: 2, roomG: 10, doseG: 15 }), { short: true, empty: true, afterG: -5 });
  assert.equal(stockCheckForBrew({ txCount: 2, roomG: 14.6, doseG: 15 }).short, false); // はかりの誤差の内
  // 重さを入れていない豆・冷凍の袋を使うときは確かめない
  assert.equal(stockCheckForBrew({ txCount: 0, roomG: 0, doseG: 15 }).short, false);
  assert.equal(stockCheckForBrew({ txCount: 2, roomG: 0, doseG: 15, usingPortion: true }).empty, false);
});
