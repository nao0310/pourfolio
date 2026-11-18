import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brewImageContent, pourChart, imageFileName } from '../js/core/report-image.js';

const brew = {
  id: 'w1',
  at: new Date(2026, 10, 18, 7, 42).toISOString(),
  actual: {
    doseG: 15,
    waterG: 225,
    tempC: 92,
    grind: { grinderId: 'g1', setting: '24' },
    totalSec: 200,
    pours: [
      { atSec: 0, toG: 45, doneSec: 8 },
      { atSec: 45, toG: 135, doneSec: 60 },
      { atSec: 90, toG: 225, doneSec: null },
    ],
  },
  derived: { ratio: 15, daysOffRoast: 9 },
  context: {},
  memo: '抽出のメモ',
};
const bean = { name: 'エチオピア イルガチェフェ ゲデオ コチェレ G1 ナチュラル', roastLevel: 'ハイ', origin: { country: 'エチオピア' }, process: 'ナチュラル' };
const tasting = { stars: 4, tags: ['甘い'], jar: { acidity: 1 }, flavors: [], memo: '評価のメモ' };

test('画像の中身：豆・条件・評価。メモは選んだときだけ', () => {
  const c = brewImageContent({ brew, bean, tasting, recipeName: '朝の4:6', grinderName: 'C40', metrics: { ratio: 15, tdsPct: 1.35, eyPct: 20.1 } });
  assert.equal(c.when, '2026/11/18 07:42');
  assert.equal([...c.beanName].length, 22);
  assert.equal(c.beanSub, 'ハイ・エチオピア・ナチュラル');
  assert.equal(c.days, '焙煎から9日');
  assert.deepEqual(
    c.stats.map((s) => `${s.label}=${s.value}`),
    ['粉=15g', '湯=225g', '比率=1:15', '湯温=92℃', '挽き目=C40 24', '時間=3:20', 'TDS=1.35%', '収率=20.1%'],
  );
  assert.equal(c.stars, 4);
  assert.match(c.notes, /^甘い　酸味/);
  assert.equal(c.memo, '');
  assert.equal(brewImageContent({ brew, bean, tasting, withMemo: true }).memo, '評価のメモ');
  assert.equal(brewImageContent({ brew, bean, tasting: { stars: 3 }, withMemo: true }).memo, '抽出のメモ');
});

test('評価も豆もないときは空いた所を出さない', () => {
  const c = brewImageContent({ brew: { at: brew.at, actual: {} } });
  assert.equal(c.beanName, '豆なし');
  assert.equal(c.stars, null);
  assert.equal(c.notes, '');
  assert.ok(c.stats.every((s) => s.value === '—'));
  assert.deepEqual(c.pours, []);
});

test('注湯のグラフは階段、落ち切りまでの幅', () => {
  const ch = pourChart(brewImageContent({ brew }).pours, 200);
  assert.equal(ch.maxSec, 200);
  assert.equal(ch.maxG, 225);
  assert.deepEqual(ch.steps[0], { x: 0, y: 0 });
  assert.deepEqual(ch.steps.at(-1), { x: 1, y: 1 });
  assert.equal(ch.dots.length, 2);
  assert.deepEqual(pourChart([], null), { maxSec: 0, maxG: 0, steps: [], dots: [] });
  // 落ち切りが分からなければ、最後の注湯の30秒あと
  assert.equal(pourChart([{ atSec: 0, toG: 50 }, { atSec: 100, toG: 200 }], null).maxSec, 130);
});

test('画像のファイル名', () => {
  assert.equal(imageFileName(brew.at), 'pourfolio-2026-11-18-0742.png');
});
