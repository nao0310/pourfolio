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
  EQUIPMENT_PICKS,
  initialEquipmentPick,
  normalizeEquipmentPick,
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
    tdsPct: '',
    waterId: null,
    memo: '',
  });
});

test('実績のTDS（A8）と水（D3）：入れたときだけ記録し、範囲外はエラー', () => {
  const ok = normalizeActualInput({ doseG: '20', waterG: '300', totalSec: '3:30', tdsPct: '１．３５', waterId: 'w1' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.tdsPct, 1.35);
  assert.equal(ok.value.waterId, 'w1');
  const none = normalizeActualInput({ doseG: '20', waterG: '300', totalSec: '3:30', tdsPct: '' });
  assert.equal(none.value.tdsPct, null);
  assert.equal(none.value.waterId, null);
  const bad = normalizeActualInput({ doseG: '20', waterG: '300', totalSec: '3:30', tdsPct: '12' });
  assert.ok(bad.errors.tdsPct);
  const f = finishDraft(newDraft(plan, 'b1', T0), T0 + 215_000);
  const brew = buildBrew({ draft: f, value: ok.value, at: new Date(T0).toISOString() });
  assert.equal(brew.actual.tdsPct, 1.35);
  assert.equal(brew.equipment.waterId, 'w1');
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

test('ダイヤルイン提案を入れた計画で淹れたら、抽出の記録に提案のIDを残す（計画の写しには入れない）', () => {
  const draft = newDraft({ ...plan, suggestionId: 'sug1' }, 'b1', null);
  const { value } = normalizeActualInput({ ...initialActualInput(draft), totalSec: '3:30' });
  const brew = buildBrew({ draft, value, at: '2026-11-18T07:45:35+09:00' });
  assert.equal(brew.suggestionId, 'sug1');
  assert.equal(brew.planned.suggestionId, undefined);
  const plain = buildBrew({ draft: newDraft(plan, 'b1', null), value, at: '2026-11-18T07:45:35+09:00' });
  assert.equal(plain.suggestionId, null);
});

test('抽出前チェック（A5）：確かめた項目を抽出の記録に残す。チェックの欄を使わなければ null', async () => {
  const { normalizePrecheck, precheckText, PRECHECK_KEYS } = await import('../js/core/brews.js');
  assert.deepEqual(PRECHECK_KEYS, ['temp', 'rinse', 'preheat', 'tare']);
  assert.deepEqual(normalizePrecheck({ temp: true, rinse: 'yes', foo: true }), { temp: true, rinse: false, preheat: false, tare: false });
  assert.equal(precheckText({ temp: true, rinse: false, preheat: true, tare: true }), '湯温・予熱・スケールの0点');
  assert.equal(precheckText(null), '');

  const value = normalizeActualInput({ ...initialActualInput(newDraft(plan, 'b1', null)), totalSec: '3:30' }).value;
  const checked = newDraft(plan, 'b1', T0, { temp: true, tare: true });
  assert.ok(isValidDraft(checked));
  const brew = buildBrew({ draft: checked, value, at: new Date(T0).toISOString() });
  assert.deepEqual(brew.precheck, { temp: true, rinse: false, preheat: false, tare: true });
  assert.equal(buildBrew({ draft: newDraft(plan, 'b1', T0), value, at: new Date(T0).toISOString() }).precheck, null);
});

test('放っておいた下書き（1時間を過ぎてタイマーのまま）は実績の確認にし、総時間は空（総仕上げの60番）', async () => {
  const { settleStaleDraft, agoText, STALE_DRAFT_MS } = await import('../js/core/brews.js');
  const plan = { doseG: 15, waterG: 240, pours: [{ atSec: 0, toG: 40 }, { atSec: 40, toG: 120 }] };
  const start = Date.UTC(2026, 10, 18, 14, 58);
  const d = { ...newDraft(plan, null, start), laps: [9] };
  assert.equal(settleStaleDraft(d, start + STALE_DRAFT_MS - 1), d);
  const s = settleStaleDraft(d, start + 10 * 3600_000);
  assert.equal(s.stage, 'result');
  assert.equal(s.finishedSec, null);
  assert.equal(s.stale, true);
  assert.deepEqual(s.laps, [9, null]);
  assert.equal(initialActualInput(s).totalSec, '');
  // 実績の確認の下書きはそのまま
  const r = { ...d, stage: 'result' };
  assert.equal(settleStaleDraft(r, start + 10 * 3600_000), r);
  assert.equal(agoText(start, start + 40 * 60000), '40分前');
  assert.equal(agoText(start, start + 10 * 3600_000), '10時間前');
  assert.equal(agoText(start, start + 50 * 3600_000), '2日前');
});

// ---- 使った器具（タイマーを使わずに記録するときにも選べる） ----

const eqPlan = { ...plan, equipment: { dripperId: 'd1', filterId: null, kettleId: 'k1' } };
const eqList = [
  { id: 'g1', kind: 'grinder', name: 'C40', deletedAt: null },
  { id: 'g2', kind: 'grinder', name: '電動', deletedAt: null },
  { id: 'd1', kind: 'dripper', name: 'V60', deletedAt: null },
  { id: 'd2', kind: 'dripper', name: 'ウェーブ', deletedAt: null },
  { id: 'f1', kind: 'filter', name: '紙', deletedAt: null },
  { id: 'k1', kind: 'kettle', name: '細口', deletedAt: null },
  { id: 'k9', kind: 'kettle', name: '捨てた', deletedAt: '2026-11-01T00:00:00Z' },
];

test('使った器具：選ぶのはグラインダー・ドリッパー・フィルター・ケトルの順', () => {
  assert.deepEqual(EQUIPMENT_PICKS.map((p) => p.kind), ['grinder', 'dripper', 'filter', 'kettle']);
});

test('使った器具の初期値はレシピ（計画）の器具。決めていない種類は空', () => {
  assert.deepEqual(initialEquipmentPick(eqPlan), { grinderId: 'g1', dripperId: 'd1', filterId: '', kettleId: 'k1' });
  assert.deepEqual(initialEquipmentPick({}), { grinderId: '', dripperId: '', filterId: '', kettleId: '' });
});

test('使った器具：登録してある同じ種類の器具だけ残し、ほかは記録しない（null）', () => {
  const v = normalizeEquipmentPick({ grinderId: 'g2', dripperId: 'g1', filterId: '', kettleId: 'k9' }, eqList);
  assert.deepEqual(v, { grinderId: 'g2', dripperId: null, filterId: null, kettleId: null });
  assert.deepEqual(normalizeEquipmentPick(undefined, eqList), { grinderId: null, dripperId: null, filterId: null, kettleId: null });
});

test('タイマーなしで、選んだ器具を抽出の記録に残す（グラインダーは挽き目にも）', () => {
  const draft = newDraft(eqPlan, 'b1', null);
  const { value } = normalizeActualInput({ ...initialActualInput(draft), totalSec: '3:10', waterId: 'w1' });
  const equipment = normalizeEquipmentPick({ grinderId: 'g2', dripperId: 'd2', filterId: 'f1', kettleId: '' }, eqList);
  const brew = buildBrew({ draft, value, at: '2026-11-24T08:00:00+09:00', equipment });
  assert.equal(brew.timerUsed, false);
  assert.equal(brew.recipeId, 'r1');
  assert.deepEqual(brew.equipment, { grinderId: 'g2', dripperId: 'd2', filterId: 'f1', kettleId: null, waterId: 'w1' });
  assert.equal(brew.actual.grind.grinderId, 'g2');
  assert.deepEqual(brew.actual.pours.map((p) => p.doneSec), [null, null, null, null, null]);
  // 計画の写しはレシピの器具のまま（何を変えたか後で分かる）
  assert.equal(brew.planned.equipment.dripperId, 'd1');
});

test('器具を選ばなかった（前の版の下書き）ときは、今までどおり計画の器具を残す', () => {
  const draft = newDraft(eqPlan, 'b1', null);
  const { value } = normalizeActualInput({ ...initialActualInput(draft), totalSec: '3:10' });
  const brew = buildBrew({ draft, value, at: '2026-11-24T08:00:00+09:00' });
  assert.deepEqual(brew.equipment, { dripperId: 'd1', filterId: null, kettleId: 'k1', grinderId: 'g1', waterId: null });
  assert.equal(brew.actual.grind.grinderId, 'g1');
});
