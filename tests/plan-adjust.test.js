import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOODS,
  adjustPlan,
  adjustNotes,
  contextFromPlan,
  isIced,
  normalizeOverrides,
  parseAdjustParams,
  adjustQuery,
  moodForHour,
  cupsLabel,
  hotPlanOf,
  carryIce,
  cupsOf,
  perCupPlan,
  perCupIceG,
} from '../js/core/plan-adjust.js';
import { basePlanForNext } from '../js/core/dialin.js';
import { planFromRecipe, make46, makeBasic } from '../js/core/recipes.js';

const lastToG = (p) => p.pours[p.pours.length - 1].toG;

function plan46(doseG = 20, ratio = 15) {
  const template = { kind: '46', ratio, taste: 'standard', strength: 'standard' };
  const made = make46({ doseG, ratio });
  return planFromRecipe({ id: 'r1', name: '4:6', doseG, waterG: made.waterG, tempC: 92, grind: { grinderId: 'g1', setting: '24' }, pours: made.pours, targetTotalSec: made.targetTotalSec, template });
}

function planHand(doseG = 15, waterG = 240) {
  // 手で作った注湯（雛形なし）
  return planFromRecipe({ id: 'r2', name: '手', doseG, waterG, tempC: 90, pours: [{ atSec: 0, toG: 40 }, { atSec: 40, toG: 140 }, { atSec: 80, toG: 240 }], template: null });
}

test('調整がなければ同じ内容の写しで、adjust を付けない', () => {
  const p = plan46();
  const out = adjustPlan(p, {});
  assert.deepEqual(out, p);
  assert.notEqual(out, p);
  assert.equal(out.adjust, undefined);
  assert.deepEqual(contextFromPlan(out), {});
});

test('気分：目覚めは比率−0.5、4:6は明るめ・濃いめ（注湯は5→6投）', () => {
  const out = adjustPlan(plan46(20, 15), { mood: 'wake' });
  assert.equal(out.waterG, 290);
  assert.equal(out.ratio, 14.5);
  assert.equal(out.template.taste, 'bright');
  assert.equal(out.template.strength, 'strong');
  assert.equal(out.pours.length, 6);
  assert.equal(lastToG(out), 290);
  assert.deepEqual(out, { ...out, doseG: 20 });
  assert.match(adjustNotes(out)[0], /目覚め.*1:15 → 1:14\.5.*明るめ.*濃いめ/);
});

test('気分：くつろぎは比率+0.5・甘め（濃さはそのまま）、食後は比率−0.5・濃いめ', () => {
  const relax = adjustPlan(plan46(20, 15), { mood: 'relax' });
  assert.equal(relax.waterG, 310);
  assert.equal(relax.template.taste, 'sweet');
  assert.equal(relax.template.strength, 'standard');
  const meal = adjustPlan(plan46(20, 15), { mood: 'meal' });
  assert.equal(meal.waterG, 290);
  assert.equal(meal.template.taste, 'standard');
  assert.equal(meal.template.strength, 'strong');
});

test('気分：来客は数字を変えない（杯数は呼ぶ側で2杯にする）', () => {
  const out = adjustPlan(plan46(20, 15), { mood: 'guest' });
  assert.equal(out.waterG, 300);
  assert.equal(out.adjust.mood, 'guest');
  assert.equal(MOODS.guest.cups, 2);
  assert.deepEqual(contextFromPlan(out), { mood: 'guest' });
});

test('気分：4:6でないレシピは比率だけ変わり、注湯は比例で直る', () => {
  const out = adjustPlan(planHand(15, 240), { mood: 'relax' });
  assert.equal(out.waterG, 248); // 15 × 16.5 = 247.5 → 248
  assert.equal(out.pours.length, 3);
  assert.equal(lastToG(out), 248);
  assert.equal(out.template, null);
  assert.ok(out.pours.every((p) => p.pourSec > 0));
});

test('基本形の雛形は比率だけ変えて作り直す', () => {
  const made = makeBasic({ doseG: 15, ratio: 16 });
  const p = planFromRecipe({ id: 'b', doseG: 15, waterG: made.waterG, pours: made.pours, template: { kind: 'basic', ratio: 16, pourCount: 3 } });
  const out = adjustPlan(p, { mood: 'wake' });
  assert.equal(out.waterG, 233); // 15 × 15.5
  assert.equal(out.template.ratio, 15.5);
  assert.equal(out.template.taste, undefined);
});

test('杯数：2杯は粉量と湯量が2倍、注湯の最後が湯量と合う', () => {
  const out = adjustPlan(plan46(20, 15), { cups: 2 });
  assert.equal(out.doseG, 40);
  assert.equal(out.waterG, 600);
  assert.equal(lastToG(out), 600);
  assert.equal(out.pours.length, 5);
  assert.deepEqual(contextFromPlan(out), { cups: 2 });
  assert.match(adjustNotes(out)[0], /2杯ぶん/);
});

test('杯数：少なめ（0.7杯）は粉量0.1g・湯量1gに丸める', () => {
  const out = adjustPlan(planHand(15, 240), { cups: 0.7 });
  assert.equal(out.doseG, 10.5);
  assert.equal(out.waterG, 168);
  assert.equal(lastToG(out), 168);
  assert.equal(cupsLabel(0.7), '少なめ');
});

test('杯数：選択肢にない値は1杯として扱う', () => {
  const out = adjustPlan(plan46(), { cups: 5 });
  assert.equal(out.adjust, undefined);
});

test('アイス：お湯6：氷4。お湯＋氷が元の湯量と同じ', () => {
  const out = adjustPlan(plan46(20, 15), { iced: true });
  assert.equal(out.waterG, 180);
  assert.equal(out.adjust.iceG, 120);
  assert.equal(out.waterG + out.adjust.iceG, 300);
  assert.equal(lastToG(out), 180);
  assert.equal(out.ratio, 9);
  assert.deepEqual(contextFromPlan(out), { iceG: 120 });
  assert.ok(isIced({ context: contextFromPlan(out) }));
  assert.ok(!isIced({ context: {} }));
  assert.match(adjustNotes(out).at(-1), /氷 120g.*1目盛り細かく/);
});

test('気分・2杯・アイスを合わせると、気分→杯数→アイスの順に当てはまる', () => {
  const out = adjustPlan(plan46(20, 15), { mood: 'wake', cups: 2, iced: true });
  // 20g・290g → 40g・580g → お湯348g＋氷232g
  assert.equal(out.doseG, 40);
  assert.equal(out.waterG, 348);
  assert.equal(out.adjust.iceG, 232);
  assert.deepEqual(contextFromPlan(out), { mood: 'wake', cups: 2, iceG: 232 });
  assert.equal(adjustNotes(out).length, 3);
});

test('数値の上書き：湯量を変えると注湯が比例で直り、雛形のつながりが外れる', () => {
  const out = adjustPlan(plan46(20, 15), { overrides: { doseG: 18, waterG: 270, tempC: 90, grind: '22' } });
  assert.equal(out.doseG, 18);
  assert.equal(out.waterG, 270);
  assert.equal(out.tempC, 90);
  assert.equal(out.grind.setting, '22');
  assert.equal(out.grind.grinderId, 'g1');
  assert.equal(lastToG(out), 270);
  assert.equal(out.template, null);
});

test('上書きの確かめ：範囲の外・読めない値・長すぎる挽き目は捨て、全角も読む', () => {
  assert.deepEqual(normalizeOverrides({ doseG: '２０．５', waterG: '9999', tempC: 'あつい', grind: ' 24 ' }), { doseG: 20.5, grind: '24' });
  assert.deepEqual(normalizeOverrides({ grind: 'x'.repeat(21) }), {});
  assert.deepEqual(normalizeOverrides({}), {});
});

test('URLの調整を読み書きする（知らない値は無視）', () => {
  const q = adjustQuery({ mood: 'relax', cups: 2, iced: true, overrides: { doseG: 18, grind: '22' } });
  assert.equal(q, 'mood=relax&cups=2&iced=1&dose=18&grind=22');
  const params = new URLSearchParams(q);
  assert.deepEqual(parseAdjustParams((k) => params.get(k)), { mood: 'relax', cups: 2, iced: true, overrides: { doseG: 18, grind: '22' } });
  const bad = new URLSearchParams('mood=sleepy&cups=9&iced=yes&dose=500');
  assert.deepEqual(parseAdjustParams((k) => bad.get(k)), { mood: null, cups: 1, iced: null, overrides: {} });
  assert.equal(parseAdjustParams((k) => (k === 'iced' ? '0' : null)).iced, false);
  assert.equal(adjustQuery({ iced: false }, true), 'iced=0');
  assert.equal(adjustQuery({ iced: false }, false), '');
  assert.equal(adjustQuery({}), '');
});

test('時間帯から気分の初期値', () => {
  assert.equal(moodForHour(7), 'wake');
  assert.equal(moodForHour(13), null);
  assert.equal(moodForHour(20), 'relax');
  assert.equal(moodForHour(1), 'relax');
  assert.equal(moodForHour(4), null);
});

test('アイスの杯の計画を元の湯量に戻すと、もう一度同じ量のアイスに分けられる', () => {
  const iced = adjustPlan(plan46(20, 15), { iced: true });
  const { adjust, ...copied } = iced; // 記録の計画には adjust を残さない
  const hot = hotPlanOf(copied, adjust.iceG);
  assert.equal(hot.waterG, 300);
  assert.equal(lastToG(hot), 300);
  const again = adjustPlan(hot, { iced: true });
  assert.equal(again.waterG, 180);
  assert.equal(again.adjust.iceG, 120);
  assert.equal(hotPlanOf(copied, 0), copied);
});

test('氷の量だけ引き継ぐ（提案を入れた計画用）', () => {
  const p = carryIce(planHand(15, 150), 100);
  assert.equal(p.waterG, 150);
  assert.deepEqual(contextFromPlan(p), { iceG: 100 });
  assert.match(adjustNotes(p)[0], /お湯 150g.*氷 100g/);
  assert.equal(carryIce(planHand(), null).adjust, undefined);
});

test('杯数を変えた杯を1杯分に戻す：2杯（30g・450g）→ 15g・225g、注湯も合わせる（2-8 の7番）', () => {
  const one = planFromRecipe({ id: 'r', name: '朝', doseG: 15, waterG: 225, pours: make46({ doseG: 15, ratio: 15 }).pours });
  const two = adjustPlan(one, { cups: 2 });
  assert.equal(two.doseG, 30);
  assert.equal(two.waterG, 450);
  const back = perCupPlan(two, 2);
  assert.equal(back.doseG, 15);
  assert.equal(back.waterG, 225);
  assert.equal(lastToG(back), 225);
  assert.equal(back.ratio, 15);
  assert.equal(perCupPlan(one, 1), one);
  const small = perCupPlan(adjustPlan(one, { cups: 0.7 }), 0.7);
  assert.equal(small.doseG, 15);
  assert.ok(Math.abs(small.waterG - 225) <= 1, `少なめは丸めの分だけずれてよい（${small.waterG}g）`);
});

test('杯の杯数と1杯分の氷：決めていなければ1杯。2杯のアイスなら氷も半分', () => {
  assert.equal(cupsOf({ context: {} }), 1);
  assert.equal(cupsOf({ context: { cups: 2 } }), 2);
  assert.equal(cupsOf({ context: { cups: 9 } }), 1);
  assert.equal(perCupIceG({ context: { cups: 2, iceG: 180 } }), 90);
  assert.equal(perCupIceG({ context: {} }), null);
});

test('次の1杯の土台：2杯で淹れた杯からでも1杯分の計画になる。アイスの2杯は、お湯も氷も1杯分', () => {
  const one = planFromRecipe({ id: 'r', name: '朝', doseG: 15, waterG: 225, pours: make46({ doseG: 15, ratio: 15 }).pours });
  const hot2 = adjustPlan(one, { cups: 2 });
  const brew = (planned, context) => ({ id: 'b', recipeId: null, planned, actual: { doseG: planned.doseG, waterG: planned.waterG, grind: { setting: '24' } }, context });
  const base = basePlanForNext(brew(hot2, { cups: 2 }));
  assert.equal(base.doseG, 15);
  assert.equal(base.waterG, 225);
  const ice2 = adjustPlan(one, { cups: 2, iced: true });
  const b2 = brew(ice2, { cups: 2, iceG: ice2.adjust.iceG });
  const hot = hotPlanOf(basePlanForNext(b2), perCupIceG(b2));
  assert.equal(hot.doseG, 15);
  assert.equal(hot.waterG, 225);
});
