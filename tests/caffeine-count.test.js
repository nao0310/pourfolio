// 2-8 総点検の35〜37・40番：カフェインの数え方（控える時刻・カフェインレス・来客の杯・朝5時の区切り）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myCaffeineMg, todayCaffeine, caffeineKeeper } from '../js/core/caffeine.js';
import { cutoffStatus, caffeineState } from '../js/core/today.js';
import { dailyStats } from '../js/core/calendar.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m);

test('35番：控える時刻が0:00〜4:59なら、その時刻から朝5時までだけ控える', () => {
  // 2:00 にした：昼は控えない
  assert.deepEqual(cutoffStatus(at(18, 12), '02:00'), { past: false, minutesLeft: 14 * 60 });
  assert.equal(cutoffStatus(at(18, 1), '02:00').minutesLeft, 60);
  assert.equal(cutoffStatus(at(18, 2), '02:00').past, true);
  assert.equal(cutoffStatus(at(18, 4, 59), '02:00').past, true);
  assert.equal(cutoffStatus(at(18, 5), '02:00').past, false);
  assert.equal(caffeineState({ now: at(18, 12), cutoff: '00:30' }).late, false);
  assert.equal(caffeineKeeper({ now: at(18, 12), cutoff: '00:30', mg: 0 }).late, false);
  // 今までどおり：5時以降の時刻は、その時刻から次の朝5時まで
  assert.equal(cutoffStatus(at(18, 15), '15:00').past, true);
  assert.equal(cutoffStatus(at(18, 3), '15:00').past, true);
  assert.deepEqual(cutoffStatus(at(18, 9), null), { past: false, minutesLeft: null });
});

const row = (o) => ({ ymd: '2026-11-18', brew: { at: at(18, o.h ?? 9).toISOString(), context: o.context ?? {} }, bean: o.bean ?? null, metrics: { caffeineMg: o.mg } });

test('40番：2〜4杯まとめて淹れた杯は杯数で割る。少なめは割らない', () => {
  assert.equal(myCaffeineMg(row({ mg: 200, context: { cups: 2 } })), 100);
  assert.equal(myCaffeineMg(row({ mg: 300, context: { cups: 3 } })), 100);
  assert.equal(myCaffeineMg(row({ mg: 70, context: { cups: 0.7 } })), 70);
  assert.equal(myCaffeineMg(row({ mg: 90 })), 90);
  assert.equal(myCaffeineMg(row({ mg: 90, bean: { decaf: true } })), 0);
  assert.equal(myCaffeineMg(row({ mg: null })), null);
  assert.equal(todayCaffeine([row({ mg: 200, context: { cups: 2 } })], at(18, 12)).mg, 100);
});

test('36番：カレンダーもカフェインレスを数えず、来客の杯は割る', () => {
  const s = dailyStats([row({ mg: 90 }), row({ mg: 120, bean: { decaf: true } }), row({ mg: 200, context: { cups: 4 } })]).get('2026-11-18');
  assert.equal(s.cups, 3);
  assert.equal(s.caffeineMg, 140);
});

test('37番：夜中の杯は前の日（分析の「今日」もこの数え方を使う）', () => {
  const rows = [row({ mg: 80, h: 2 }), row({ mg: 100, h: 7 })];
  assert.deepEqual(todayCaffeine(rows, at(18, 3)), { mg: 80, cups: 1, unknown: 0 });
  assert.deepEqual(todayCaffeine(rows, at(18, 8)), { mg: 100, cups: 1, unknown: 0 });
});
