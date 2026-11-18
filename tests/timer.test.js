// ガイド付きタイマーの計算（A2）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoAdvance, addLap, timerView, cueSchedule, cuesBetween, speechFor, pourName } from '../js/core/timer.js';
import { make46 } from '../js/core/recipes.js';

// 4:6の標準（20g・300g）：0・45・90・135・180秒に 60・120・180・240・300g
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

test('画面の表示：待ち・注ぐ・落ち切り待ち', () => {
  // 0秒：蒸らしを注ぐ
  let v = timerView(plan, [], 0);
  assert.equal(v.phase, 'pour');
  assert.equal(v.name, '蒸らし');
  assert.equal(v.toG, 60);
  assert.equal(v.addG, 60);
  assert.equal(v.secsToNext, 45);

  // 10秒で蒸らしの注湯完了 → 2投目を待つ（あと35秒）
  const laps = addLap(plan.pours, [], 10);
  assert.deepEqual(laps, [10]);
  v = timerView(plan, laps, 10);
  assert.equal(v.phase, 'wait');
  assert.equal(v.name, '2投目');
  assert.equal(v.toG, 120);
  assert.equal(v.addG, 60);
  assert.equal(v.secsLeft, 35);

  // 33.4秒：あと12秒（切り上げ）
  assert.equal(timerView(plan, laps, 33.4).secsLeft, 12);

  // 45秒：2投目を注ぐ
  v = timerView(plan, laps, 45);
  assert.equal(v.phase, 'pour');
  assert.equal(v.toG, 120);

  // 全部押したら落ち切り待ち（目標210秒まで あと20秒）
  const all = [10, 55, 100, 145, 190];
  v = timerView(plan, all, 190);
  assert.equal(v.phase, 'drawdown');
  assert.equal(v.secsToTarget, 20);
  assert.equal(timerView(plan, all, 225).secsToTarget, -15); // 超過はマイナス
});

test('押し忘れ：次の投の時刻が来たら、前の投は null で埋めて先へ進む', () => {
  assert.deepEqual(autoAdvance(plan.pours, [], 44), []);
  assert.deepEqual(autoAdvance(plan.pours, [], 45), [null]);
  assert.deepEqual(autoAdvance(plan.pours, [8], 100), [8, null]); // 90秒を過ぎたので2投目は終わり、3投目の途中
  // 最後の投は自動では終わらない（落ち切りは押して決める）
  assert.deepEqual(autoAdvance(plan.pours, [], 999), [null, null, null, null]);
  const v = timerView(plan, [8], 100);
  assert.equal(v.phase, 'pour');
  assert.equal(v.name, '3投目');
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
