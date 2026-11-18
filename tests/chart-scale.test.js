// グラフの目盛り・座標・傾向線
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mean, quantile, niceTicks, linearScale, linearFit, correlationWord, starLevel } from '../js/core/chart-scale.js';

test('平均と分位点', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([]), null);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([4, 1, 3, 2], 0.25), 1.75);
  assert.equal(quantile([5], 0.75), 5);
  assert.equal(quantile([], 0.5), null);
});

test('目盛りは切りのよい値で範囲を含む', () => {
  assert.deepEqual(niceTicks(17.3, 22.6, 6), { min: 17, max: 23, step: 1, ticks: [17, 18, 19, 20, 21, 22, 23] });
  assert.deepEqual(niceTicks(17.3, 22.6, 5).ticks, [16, 18, 20, 22, 24]);
  assert.deepEqual(niceTicks(1.12, 1.48, 4).ticks, [1.1, 1.2, 1.3, 1.4, 1.5]);
  const same = niceTicks(3, 3);
  assert.ok(same.min < 3 && same.max > 3);
  assert.deepEqual(niceTicks(0, 0).ticks.includes(0), true);
});

test('座標の変換（上下逆の範囲も）', () => {
  const sx = linearScale([18, 22], [0, 100]);
  assert.equal(sx(20), 50);
  const sy = linearScale([1, 2], [200, 0]);
  assert.equal(sy(1.5), 100);
  assert.equal(linearScale([1, 1], [0, 10])(5), 0);
});

test('傾向線と相関：答えの分かっている例', () => {
  const fit = linearFit([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]);
  assert.equal(fit.slope, 2);
  assert.equal(fit.intercept, 0);
  assert.equal(fit.r, 1);
  assert.equal(linearFit([{ x: 1, y: 1 }]), null);
  assert.equal(linearFit([{ x: 1, y: 1 }, { x: 1, y: 2 }]), null);
  assert.equal(linearFit([{ x: 1, y: 3 }, { x: 2, y: 3 }]).r, 0);
  const neg = linearFit([{ x: 1, y: 5 }, { x: 2, y: 3 }, { x: 3, y: 2 }, { x: 4, y: 0 }]);
  assert.ok(neg.r < -0.9);
});

test('相関の言葉と★の段階', () => {
  assert.equal(correlationWord(0.1).level, 'none');
  assert.equal(correlationWord(0.3).text, '弱い傾向：大きいほど★が高い');
  assert.equal(correlationWord(-0.6).text, 'はっきりした傾向：小さいほど★が高い');
  assert.equal(correlationWord(null).level, 'none');
  assert.equal(starLevel(4.4), 4);
  assert.equal(starLevel(9), 5);
  assert.equal(starLevel(null), 0);
});
