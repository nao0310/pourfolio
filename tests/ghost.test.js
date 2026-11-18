// 前回のベストのペース（ゴースト、D-041）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickGhost, ghostLine } from '../js/core/ghost.js';

const brew = (id, at, extra = {}) => ({
  id,
  at,
  deletedAt: null,
  recipeId: 'r1',
  beanId: 'A',
  timerUsed: true,
  actual: { totalSec: 185, pours: [{ doneSec: 10 }, { doneSec: 52 }, { doneSec: 95 }] },
  ...extra,
});
const t = (brewId, stars) => ({ id: `t${brewId}`, brewId, by: 'me', stage: 'warm', stars, deletedAt: null, updatedAt: '1' });
const name = (i) => `${i + 1}投目`;

test('同じレシピで★が高い杯を選ぶ。同じ★なら同じ豆、それも同じなら新しい杯', () => {
  const brews = [
    brew('a', '2026-11-01T00:00:00Z'),
    brew('b', '2026-11-02T00:00:00Z', { beanId: 'B' }),
    brew('c', '2026-11-03T00:00:00Z', { beanId: 'B' }),
    brew('d', '2026-11-04T00:00:00Z', { recipeId: 'r2' }), // 別のレシピ
    brew('e', '2026-11-05T00:00:00Z', { timerUsed: false }), // タイマーなし
    brew('f', '2026-11-06T00:00:00Z', { actual: { pours: [{ doneSec: null }] } }), // 押していない
  ];
  const tastings = [t('a', 4), t('b', 4), t('c', 3), t('d', 5), t('e', 5), t('f', 5)];
  const g = pickGhost({ brews, tastings, recipeId: 'r1', beanId: 'A' });
  assert.equal(g.brewId, 'a');
  assert.equal(g.sameBean, true);
  assert.deepEqual(g.laps, [10, 52, 95]);
  assert.equal(pickGhost({ brews, tastings, recipeId: 'r1', beanId: 'B' }).brewId, 'b');
  assert.equal(pickGhost({ brews, tastings, recipeId: 'r1', beanId: null }).brewId, 'b'); // 新しい方
  assert.equal(pickGhost({ brews, tastings: [], recipeId: 'r1' }), null);
  assert.equal(pickGhost({ brews, tastings, recipeId: null }), null);
});

test('タイマーの1行：今の投のベストの時刻、押した後のずれ、落ち切り待ちの総時間', () => {
  const g = { stars: 5, ymd: '2026-11-12', laps: [10, 52, 95], totalSec: 185 };
  assert.equal(ghostLine(g, [], { phase: 'pour', index: 0 }, name), 'ベスト（★5・11/12）は 1投目を 0:10 に注ぎ終え');
  assert.equal(ghostLine(g, [12], { phase: 'wait', index: 1 }, name), 'ベスト比 +2秒（1投目）');
  assert.equal(ghostLine(g, [12, 49.6], { phase: 'wait', index: 2 }, name), 'ベスト比 −2秒（2投目）');
  assert.equal(ghostLine(g, [12], { phase: 'pour', index: 1 }, name), 'ベスト（★5・11/12）は 2投目を 0:52 に注ぎ終え');
  assert.equal(ghostLine(g, [12, null], { phase: 'pour', index: 2 }, name), 'ベスト（★5・11/12）は 3投目を 1:35 に注ぎ終え');
  assert.equal(ghostLine(g, [10, 52, 95], { phase: 'drawdown', index: 3 }, name), 'ベスト（★5・11/12）の総時間は 3:05');
  assert.equal(ghostLine({ ...g, laps: [10] }, [11, 50], { phase: 'wait', index: 2 }, name), '');
  assert.equal(ghostLine(null, [], { phase: 'pour', index: 0 }, name), '');
});

test('アイスや杯数を変えた杯はゴーストに選ばない', () => {
  const brews = [
    brew('hot', '2026-11-01T00:00:00Z', { context: {} }),
    brew('ice', '2026-11-02T00:00:00Z', { context: { iceG: 120 } }),
    brew('two', '2026-11-03T00:00:00Z', { context: { cups: 2 } }),
    brew('mood', '2026-11-04T00:00:00Z', { context: { mood: 'wake' } }),
  ];
  const tastings = [t('hot', 3), t('ice', 5), t('two', 5), t('mood', 4)];
  assert.equal(pickGhost({ brews, tastings, recipeId: 'r1', beanId: 'A' }).brewId, 'mood');
});
