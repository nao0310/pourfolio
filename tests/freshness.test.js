import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshness, daysBetween, FRESHNESS_WINDOWS } from '../js/core/freshness.js';
import { ROAST_LEVELS, roastGroup } from '../js/core/roast.js';

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const ROAST = '2026-11-01';
const stageOn = (level, day) => freshness(ROAST, level, addDays(ROAST, day)).stage;

test('日数は日付だけで数え、月や年をまたいでも正しい', () => {
  assert.equal(daysBetween('2026-11-01', '2026-11-01'), 0);
  assert.equal(daysBetween('2026-10-25', '2026-11-03'), 9);
  assert.equal(daysBetween('2026-12-30', '2027-01-02'), 3);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2); // うるう年
  assert.equal(daysBetween('', '2026-11-01'), null);
});

test('8段階すべてで、4段階の境目の当日と翌日が正しい', () => {
  for (const level of ROAST_LEVELS) {
    const w = FRESHNESS_WINDOWS[roastGroup(level)];
    assert.equal(stageOn(level, 0), 'resting', level);
    assert.equal(stageOn(level, w.restUntil), 'resting', level);
    assert.equal(stageOn(level, w.restUntil + 1), 'peak', level);
    assert.equal(stageOn(level, w.peakUntil), 'peak', level);
    assert.equal(stageOn(level, w.peakUntil + 1), 'past', level);
    assert.equal(stageOn(level, w.pastUntil), 'past', level);
    assert.equal(stageOn(level, w.pastUntil + 1), 'useSoon', level);
  }
});

test('飲み頃の目安：浅煎り5〜12日、中煎り3〜10日、中深煎り2〜8日、深煎り1〜5日', () => {
  const peak = (level) => {
    const w = FRESHNESS_WINDOWS[roastGroup(level)];
    return [w.restUntil + 1, w.peakUntil];
  };
  assert.deepEqual(peak('ライト'), [5, 12]);
  assert.deepEqual(peak('ハイ'), [3, 10]);
  assert.deepEqual(peak('フルシティ'), [2, 8]);
  assert.deepEqual(peak('イタリアン'), [1, 5]);
});

test('次の段階までの日数を返す', () => {
  const f = freshness(ROAST, 'シティ', addDays(ROAST, 1));
  assert.equal(f.label, '休ませ中');
  assert.deepEqual(f.next, { label: '飲み頃', inDays: 1 });
  const g = freshness(ROAST, 'シティ', addDays(ROAST, 30));
  assert.equal(g.label, '早めに消費');
  assert.equal(g.next, null);
});

test('焙煎度がわからないときは中煎りの目安を使う', () => {
  assert.equal(freshness(ROAST, '', addDays(ROAST, 3)).group, 'medium');
  assert.equal(freshness(ROAST, '', addDays(ROAST, 3)).stage, 'peak');
});

test('焙煎日がない・不正なときは null。未来の焙煎日は休ませ中', () => {
  assert.equal(freshness(null, 'シティ', '2026-11-18'), null);
  assert.equal(freshness('2026/11/01', 'シティ', '2026-11-18'), null);
  assert.equal(freshness('2026-11-20', 'シティ', '2026-11-18').stage, 'resting');
});
