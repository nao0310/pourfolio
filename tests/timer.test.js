// ガイド付きタイマーの計算（A2）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoAdvance, addLap, timerView, cueSchedule, cuesBetween, speechFor, pourName, pourEndSec, canFinish, LAP_GUARD_SEC } from '../js/core/timer.js';
import { make46 } from '../js/core/recipes.js';

// 4:6の標準（20g・300g）：0・45・90・135・180秒に 60・120・180・240・300g。流速10g/秒で各6秒注ぐ
const p46 = make46({ doseG: 20 });
const plan = { pours: p46.pours, targetTotalSec: p46.targetTotalSec };

test('読み上げの文と呼び名', () => {
  assert.equal(pourName(0), '蒸らし');
  assert.equal(speechFor(plan.pours, 0), '蒸らし、60グラムまで');
  assert.equal(speechFor(plan.pours, 1), '2投目、120グラムまで');
  assert.equal(speechFor(plan.pours, 4), '5投目、300グラムまで');
});

test('合図：各投の3・2・1秒前にカウント、時刻ちょうどに合図。最後に目標時間', () => {
  const cues = cueSchedule(plan);
  const at = (sec) => cues.filter((c) => c.sec === sec).map((c) => c.kind);
  assert.deepEqual(at(0), ['go']);
  assert.deepEqual(at(42), ['count']);
  assert.deepEqual(at(43), ['count']);
  assert.deepEqual(at(44), ['count']);
  assert.deepEqual(at(45), ['go']);
  assert.deepEqual(at(6), ['pourEnd']); // 注ぎ終わりの目安（0秒＋6秒）
  assert.deepEqual(at(51), ['pourEnd']);
  assert.equal(cues.filter((c) => c.kind === 'pourEnd').length, 5);
  assert.equal(cues.filter((c) => c.kind === 'go').length, 5);
  assert.equal(cues.filter((c) => c.kind === 'count').length, 12); // 0秒の蒸らしにはカウントがない
  const last = cues[cues.length - 1];
  assert.equal(last.kind, 'target');
  assert.equal(last.sec, 210);
});

test('合図：細かく時間を進めると、それぞれの合図がちょうど1回ずつ出る', () => {
  const seen = [];
  let prev = -0.001; // スタート直後に0秒の合図を出すため
  for (let t = 0; t <= 215; t += 0.25) {
    seen.push(...cuesBetween(plan, prev, t));
    prev = t;
  }
  assert.deepEqual(
    seen.map((c) => `${c.kind}@${c.sec}`),
    cueSchedule(plan).map((c) => `${c.kind}@${c.sec}`),
  );
  assert.equal(seen[0].speech, '蒸らし、60グラムまで');
});

test('合図：画面の更新が止まって時間が飛んだら、まとめて鳴らさず最新の1つだけ', () => {
  // 10秒から 45.5秒まで止まっていた → 42〜44のカウントは鳴らさず、45秒の合図だけ
  assert.deepEqual(
    cuesBetween(plan, 10, 45.5).map((c) => `${c.kind}@${c.sec}`),
    ['go@45'],
  );
  // 10秒から 60秒まで止まっていた → 直前1秒に合図がないので何も鳴らさない
  assert.deepEqual(cuesBetween(plan, 10, 60), []);
});

test('画面の表示：注ぐ → 待つ → 注ぐ → 落ち切り待ち', () => {
  // 0秒：蒸らしを注ぐ（注ぎ終わりまで6秒、流速10g/秒）
  let v = timerView(plan, [], 0);
  assert.equal(v.phase, 'pour');
  assert.equal(v.name, '蒸らし');
  assert.equal(v.toG, 60);
  assert.equal(v.addG, 60);
  assert.equal(v.pourSec, 6);
  assert.equal(v.flowGps, 10);
  assert.equal(v.secsLeft, 6);
  assert.equal(timerView(plan, [], 2.5).secsLeft, 4); // 切り上げ

  // 6秒：押していなくても「待つ」に変わる。次は2投目（あと39秒）。押せば蒸らしの完了を記録できる
  v = timerView(plan, [], 6);
  assert.equal(v.phase, 'wait');
  assert.equal(v.canTap, true);
  assert.equal(v.index, 0);
  assert.equal(v.next.name, '2投目');
  assert.equal(v.next.toG, 120);
  assert.equal(v.next.addG, 60);
  assert.equal(v.secsLeft, 39);

  // 5秒で蒸らしの注湯完了 → すぐ「待つ」。押しても何も起きない状態
  const laps = addLap(plan.pours, [], 5);
  assert.deepEqual(laps, [5]);
  v = timerView(plan, laps, 5);
  assert.equal(v.phase, 'wait');
  assert.equal(v.canTap, false);
  assert.equal(v.next.name, '2投目');
  assert.equal(v.secsLeft, 40);
  assert.equal(timerView(plan, laps, 33.4).secsLeft, 12);

  // 45秒：2投目を注ぐ
  v = timerView(plan, laps, 45);
  assert.equal(v.phase, 'pour');
  assert.equal(v.toG, 120);

  // 最後の投の注ぐ秒数が過ぎた：次はなく、押すと落ち切り待ちへ
  v = timerView(plan, [5, 50, 95, 140], 190);
  assert.equal(v.phase, 'wait');
  assert.equal(v.next, null);
  assert.equal(v.isLast, true);
  assert.equal(v.canTap, true);

  // 全部押したら落ち切り待ち（目標210秒まで あと20秒）
  const all = [10, 55, 100, 145, 190];
  v = timerView(plan, all, 190);
  assert.equal(v.phase, 'drawdown');
  assert.equal(v.secsToTarget, 20);
  assert.equal(timerView(plan, all, 225).secsToTarget, -15); // 超過はマイナス
});

test('注ぎ終わりの目安：注ぐ秒数のない古い計画は流速から計算し、次の注湯の時刻は越えない', () => {
  const old = { pours: [{ atSec: 0, toG: 40 }, { atSec: 30, toG: 300 }] };
  assert.equal(pourEndSec(old, 0), 4); // 40g÷10g/秒
  assert.equal(pourEndSec(old, 1), 30 + 26);
  assert.equal(pourEndSec({ ...old, flowGps: 5 }, 0), 8);
  const tight = { pours: [{ atSec: 0, toG: 200 }, { atSec: 10, toG: 300 }] };
  assert.equal(pourEndSec(tight, 0), 10); // 20秒かかるが次の注湯（10秒）で切る
  const manual = { pours: [{ atSec: 0, toG: 60, pourSec: 15 }, { atSec: 45, toG: 120, pourSec: 8 }] };
  assert.equal(pourEndSec(manual, 0), 15);
  assert.equal(timerView(manual, [], 14).phase, 'pour');
  assert.equal(timerView(manual, [], 15).phase, 'wait');
});

test('注ぎ終わりの音：注湯完了を押した投では鳴らさない', () => {
  assert.deepEqual(cuesBetween(plan, 5.5, 6).map((c) => c.kind), ['pourEnd']);
  assert.deepEqual(cuesBetween(plan, 5.5, 6, [5]), []);
  // 次の注湯のカウントと重なるなら注ぎ終わりの音は出さない
  const close = { pours: [{ atSec: 0, toG: 60, pourSec: 10 }, { atSec: 12, toG: 120 }] };
  assert.equal(cueSchedule(close).filter((c) => c.kind === 'pourEnd' && c.index === 0).length, 0);
});

test('押し忘れ：次の投の時刻が来たら、前の投は null で埋めて先へ進む', () => {
  assert.deepEqual(autoAdvance(plan.pours, [], 44), []);
  assert.deepEqual(autoAdvance(plan.pours, [], 45), [null]);
  assert.deepEqual(autoAdvance(plan.pours, [8], 100), [8, null]); // 90秒を過ぎたので2投目は終わり、3投目の途中
  // 最後の投は自動では終わらない（落ち切りは押して決める）
  assert.deepEqual(autoAdvance(plan.pours, [], 999), [null, null, null, null]);
  const v = timerView(plan, [8], 93);
  assert.equal(v.phase, 'pour');
  assert.equal(v.name, '3投目');
});

test('待っているあいだ（次の注湯の時刻より前）に押しても記録しない', () => {
  assert.deepEqual(addLap(plan.pours, [5], 20), [5]);
  assert.deepEqual(addLap(plan.pours, [5], 46), [5, 46]);
});

test('注湯完了の2度押しは無視する。全部終わったらそれ以上増えない', () => {
  let laps = addLap(plan.pours, [], 10);
  laps = addLap(plan.pours, laps, 10.8); // 0.8秒後の2度押し
  assert.deepEqual(laps, [10]);
  laps = addLap(plan.pours, laps, 50);
  assert.deepEqual(laps, [10, 50]);
  let all = [10, 50, 95, 140];
  all = addLap(plan.pours, all, 185);
  assert.deepEqual(all, [10, 50, 95, 140, 185]);
  assert.deepEqual(addLap(plan.pours, all, 200), all);
});

test('落ち切った：最後の「注ぎ終えた」から1.5秒以内の2度押しでは終わらない（2-8 の5番）', () => {
  assert.equal(canFinish([9, 50, 94, 139, 183], 183.3), false);
  assert.equal(canFinish([9, 50, 94, 139, 183], 183 + LAP_GUARD_SEC), true);
  assert.equal(canFinish([9, 50, null, null, null], 200), true); // 押さずに進んだ投は数えない
  assert.equal(canFinish([], 0), true);
});

test('スタートのダブルタップ：スタートから1.5秒以内の最初のタップは記録しない（2-8 の17番）', () => {
  const pours = [{ atSec: 0, toG: 40 }, { atSec: 40, toG: 120 }];
  assert.deepEqual(addLap(pours, [], 0.3), []);
  assert.deepEqual(addLap(pours, [], LAP_GUARD_SEC), [LAP_GUARD_SEC]);
});
