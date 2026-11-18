// 抽出の記録の計算（A4）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDraft,
  isValidDraft,
  elapsedSec,
  finishDraft,
  initialActualInput,
  normalizeActualInput,
  brewDiff,
  diffLines,
  buildBrew,
} from '../js/core/brews.js';
import { planFromRecipe, planFromBrew, normalizeRecipeInput, newRecipeState } from '../js/core/recipes.js';

const recipe = {
  id: 'r1',
  version: 3,
  ...normalizeRecipeInput({ ...newRecipeState(), name: '朝の4:6', grindSetting: '24', grinderId: 'g1' }).value,
};
const plan = planFromRecipe(recipe);
const T0 = Date.parse('2026-11-18T07:42:00+09:00');

test('下書き：経過秒はスタートの時刻との差。止めたら止めた秒のまま', () => {
  const d = newDraft(plan, 'b1', T0);
  assert.equal(d.stage, 'timer');
  assert.ok(isValidDraft(d));
  assert.equal(elapsedSec(d, T0 + 12_345), 12.345);
  assert.equal(elapsedSec(d, T0 - 5000), 0); // 時計が戻ってもマイナスにしない

  const f = finishDraft({ ...d, laps: [10, 50] }, T0 + 215_040);
  assert.equal(f.stage, 'result');
  assert.equal(f.finishedSec, 215);
  assert.equal(f.laps.length, plan.pours.length); // 押さなかった投は null で埋まる
  assert.deepEqual(f.laps.slice(0, 2), [10, 50]);
  assert.equal(elapsedSec(f, T0 + 999_000), 215);
});

test('下書き：タイマーなしで記録するときは実績の確認から', () => {
  const d = newDraft(plan, null, null);
  assert.equal(d.stage, 'result');
  assert.equal(initialActualInput(d).totalSec, '');
});

test('下書き：壊れたもの・古い版は使わない', () => {
  assert.equal(isValidDraft(null), false);
  assert.equal(isValidDraft({ v: 0, plan, laps: [], stage: 'timer' }), false);
  assert.equal(isValidDraft({ v: 1, plan: {}, laps: [], stage: 'timer' }), false);
});

test('実績の初期値は計画の値。総時間はタイマーから', () => {
  const f = finishDraft(newDraft(plan, 'b1', T0), T0 + 215_000);
  assert.deepEqual(initialActualInput(f), {
    beanId: 'b1',
    doseG: 20,
    waterG: 300,
    tempC: 92,
    grindSetting: '24',
    totalSec: '3:35',
    beverageG: '',
    memo: '',
  });
});

test('実績の入力チェック', () => {
  const ok = normalizeActualInput({ doseG: '20.1', waterG: '302', tempC: '', totalSec: '3:35', beverageG: '260', grindSetting: ' 24 ' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.doseG, 20.1);
  assert.equal(ok.value.totalSec, 215);
  assert.equal(ok.value.tempC, null);
  assert.equal(ok.value.grindSetting, '24');

  const bad = normalizeActualInput({ doseG: '', waterG: 'abc', tempC: '120', totalSec: '', beverageG: '' });
  assert.ok(bad.errors.doseG);
  assert.ok(bad.errors.waterG);
  assert.ok(bad.errors.tempC);
  assert.ok(bad.errors.totalSec);
  assert.equal(bad.errors.beverageG, undefined); // 抽出液は量ったときだけ

  const tooMuch = normalizeActualInput({ doseG: 20, waterG: 300, totalSec: 200, beverageG: 310 });
  assert.ok(tooMuch.errors.beverageG);
});

test('計画との差：実績−計画。差がない項目は書かない', () => {
  const actual = { doseG: 20.1, waterG: 302, tempC: 92, grind: { setting: '25' }, totalSec: 225 };
  const diff = brewDiff(plan, actual);
  assert.deepEqual(diff, { doseG: 0.1, waterG: 2, tempC: 0, totalSec: 15, ratio: 0, grindChanged: true });
  assert.deepEqual(diffLines(diff, plan, actual), ['粉量 +0.1g', '湯量 +2g', '挽き目 24→25', '時間 +15秒']);

  const same = brewDiff(plan, { doseG: 20, waterG: 300, tempC: 92, grind: { setting: '24' }, totalSec: 210 });
  assert.deepEqual(diffLines(same, plan, {}), []);
  assert.deepEqual(diffLines(brewDiff(plan, { doseG: 19.5, waterG: 300, totalSec: 190 }), plan, {}), ['粉量 −0.5g', '時間 −20秒']);
  // 湯温を入れなかったら比べない
  assert.equal(brewDiff(plan, { doseG: 20, waterG: 300, tempC: null }).tempC, null);
});

test('抽出の記録：計画の写しと実績を並べ、差と焙煎後日数を残す', () => {
  const draft = finishDraft({ ...newDraft(plan, 'b1', T0), laps: [9, 50, 94, 139, 183] }, T0 + 215_000);
  const { value } = normalizeActualInput({ ...initialActualInput(draft), doseG: '20.1', waterG: '302', beverageG: '258' });
  const brew = buildBrew({ draft, value, at: '2026-11-18T12:45:35+09:00', bean: { roastDate: '2026-11-09' } });

  assert.equal(brew.beanId, 'b1');
  assert.equal(brew.recipeId, 'r1');
  assert.equal(brew.recipeVersion, 3);
  assert.equal(brew.timerUsed, true);
  assert.equal(brew.planned.doseG, 20);
  assert.equal(brew.planned.source, undefined);
  assert.equal(brew.actual.doseG, 20.1);
  assert.equal(brew.actual.totalSec, 215);
  assert.equal(brew.actual.beverageG, 258);
  assert.deepEqual(brew.actual.grind, { grinderId: 'g1', setting: '24' });
  assert.deepEqual(
    brew.actual.pours.map((p) => [p.atSec, p.toG, p.doneSec]),
    [
      [0, 60, 9],
      [45, 120, 50],
      [90, 180, 94],
      [135, 240, 139],
      [180, 300, 183],
    ],
  );
  assert.equal(brew.derived.ratio, 15);
  assert.equal(brew.derived.daysOffRoast, 9);
  assert.equal(brew.derived.diff.waterG, 2);
  assert.equal(brew.derived.diff.totalSec, 5);

  // 計画は後からレシピを直しても変わらない（写しなので）
  recipe.doseG = 99;
  assert.equal(brew.planned.doseG, 20);
  recipe.doseG = 20;
});

test('「前回と同じ」は、保存した抽出の実績ではなく計画を写す', () => {
  const draft = finishDraft(newDraft(plan, 'b1', T0), T0 + 215_000);
  const { value } = normalizeActualInput({ ...initialActualInput(draft), doseG: '21', waterG: '310' });
  const brew = { id: 'brw1', ...buildBrew({ draft, value, at: '2026-11-18T07:45:35+09:00' }) };
  const again = planFromBrew(brew, recipe);
  assert.equal(again.doseG, 20);
  assert.equal(again.waterG, 300);
  assert.equal(again.beanId, 'b1');
  assert.equal(again.grind.setting, '24');
  assert.equal(again.pours.length, plan.pours.length);
  assert.equal(again.source, 'lastBrew');
});
