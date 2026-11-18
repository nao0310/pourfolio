import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ratioOf,
  waterFromRatio,
  parseSec,
  formatSec,
  make46,
  makeBasic,
  applyTemplate,
  scalePoursToWater,
  newRecipeState,
  recipeToState,
  normalizeRecipeInput,
  recipeSummary,
  templateLabel,
  latestBrew,
  orderRecipesForList,
  planFromRecipe,
  planFromBrew,
} from '../js/core/recipes.js';
import { makeSampleData } from '../js/core/sample-data.js';

const toGs = (r) => r.pours.map((p) => p.toG);
const ats = (r) => r.pours.map((p) => p.atSec);

test('比率と湯量を相互に計算する', () => {
  assert.equal(ratioOf(20, 300), 15);
  assert.equal(ratioOf(18, 250), 13.9);
  assert.equal(waterFromRatio(20, 15), 300);
  assert.equal(waterFromRatio(18.5, 16), 296);
  assert.equal(ratioOf(0, 300), null);
  assert.equal(waterFromRatio(20, null), null);
});

test('秒の入力を読む・表示する', () => {
  assert.equal(parseSec('1:30'), 90);
  assert.equal(parseSec('０:４５'), 45);
  assert.equal(parseSec('90'), 90);
  assert.equal(parseSec('3分30秒'), 210);
  assert.equal(parseSec('45秒'), 45);
  assert.equal(parseSec(''), null);
  assert.ok(Number.isNaN(parseSec('1:75')));
  assert.ok(Number.isNaN(parseSec('すぐ')));
  assert.equal(formatSec(210), '3:30');
  assert.equal(formatSec(45), '0:45');
  assert.equal(formatSec(null), '');
});

test('4:6 標準：20g・1:15で60/120/180/240/300g、45秒ごと', () => {
  const r = make46({ doseG: 20, ratio: 15 });
  assert.equal(r.waterG, 300);
  assert.deepEqual(toGs(r), [60, 120, 180, 240, 300]);
  assert.deepEqual(ats(r), [0, 45, 90, 135, 180]);
  assert.equal(r.targetTotalSec, 210);
});

test('4:6 の味：甘めは1投目が少なく、明るめは多い。前半の合計は40%のまま', () => {
  const sweet = make46({ doseG: 20, taste: 'sweet' });
  const bright = make46({ doseG: 20, taste: 'bright' });
  assert.deepEqual(toGs(sweet).slice(0, 2), [50, 120]);
  assert.deepEqual(toGs(bright).slice(0, 2), [70, 120]);
});

test('4:6 の濃さ：後半60%の投数が 軽め2・標準3・濃いめ4', () => {
  assert.deepEqual(toGs(make46({ doseG: 20, strength: 'light' })), [60, 120, 210, 300]);
  assert.deepEqual(toGs(make46({ doseG: 20, strength: 'strong' })), [60, 120, 165, 210, 255, 300]);
  assert.equal(make46({ doseG: 20, strength: 'strong' }).targetTotalSec, 255);
});

test('4:6 はどの組み合わせでも最後の累計が湯量と一致し、増え続ける', () => {
  for (const doseG of [12, 15, 17.5, 20, 23]) {
    for (const ratio of [14, 15, 16.5]) {
      for (const taste of ['sweet', 'standard', 'bright']) {
        for (const strength of ['light', 'standard', 'strong']) {
          const r = make46({ doseG, ratio, taste, strength });
          const g = toGs(r);
          assert.equal(g.at(-1), r.waterG);
          assert.equal(g[1], Math.round(r.waterG * 0.4));
          for (let i = 1; i < g.length; i++) assert.ok(g[i] > g[i - 1], `${doseG}g 1:${ratio} ${taste} ${strength}`);
        }
      }
    }
  }
});

test('基本形：粉量の2倍で蒸らし、残りを等分', () => {
  const r3 = makeBasic({ doseG: 15, ratio: 16 });
  assert.equal(r3.waterG, 240);
  assert.deepEqual(toGs(r3), [30, 100, 170, 240]);
  assert.deepEqual(ats(r3), [0, 40, 75, 110]);
  const r2 = makeBasic({ doseG: 15, ratio: 16, pourCount: 2 });
  assert.deepEqual(toGs(r2), [30, 135, 240]);
  assert.equal(applyTemplate({ kind: 'basic', ratio: 16, pourCount: 2 }, 15).waterG, 240);
  assert.equal(applyTemplate(null, 15), null);
});

test('湯量を変えたら注湯を比例で直す（最後はちょうど湯量）', () => {
  const pours = make46({ doseG: 20 }).pours;
  const scaled = scalePoursToWater(pours, 250);
  assert.deepEqual(scaled.map((p) => p.toG), [50, 100, 150, 200, 250]);
  assert.deepEqual(scaled.map((p) => p.atSec), [0, 45, 90, 135, 180]);
});

test('新しいレシピの入力は、そのまま保存できる（名前以外）', () => {
  const state = newRecipeState({ doseG: 15, grinderId: 'g1' });
  const { value, errors } = normalizeRecipeInput({ ...state, name: '朝の4:6', grindSetting: '24' });
  assert.deepEqual(errors, {});
  assert.equal(value.doseG, 15);
  assert.equal(value.waterG, 225);
  assert.equal(value.tempC, 92);
  assert.deepEqual(value.grind, { grinderId: 'g1', setting: '24' });
  assert.equal(value.bloom.waterG, value.pours[0].toG);
  assert.equal(value.bloom.sec, 45);
  assert.deepEqual(value.template, { kind: '46', ratio: 15, taste: 'standard', strength: 'standard' });
  assert.ok(normalizeRecipeInput(state).errors.name);
});

test('文字列の入力（時間「0:45」や全角）も読める', () => {
  const { value, errors } = normalizeRecipeInput({
    name: '手入力',
    doseG: '１８',
    waterG: '270g',
    tempC: '90',
    pours: [
      { atSec: '0', toG: '40', style: 'center' },
      { atSec: '0:40', toG: '150', style: 'noji' },
      { atSec: '1:20', toG: '270', style: 'bogus' },
    ],
    targetTotalSec: '3:00',
    template: null,
  });
  assert.deepEqual(errors, {});
  assert.equal(value.doseG, 18);
  assert.deepEqual(value.pours.map((p) => p.atSec), [0, 40, 80]);
  assert.equal(value.pours[2].style, '');
  assert.equal(value.targetTotalSec, 180);
  assert.equal(value.template, null);
});

test('注湯の累計が減っている・時間が戻っている・湯量と合わないときはエラー', () => {
  const base = { name: 'x', doseG: 20, waterG: 300 };
  assert.match(
    normalizeRecipeInput({ ...base, pours: [{ atSec: 0, toG: 60 }, { atSec: 45, toG: 50 }, { atSec: 90, toG: 300 }] }).errors.pours,
    /2投目の累計湯量/,
  );
  assert.match(
    normalizeRecipeInput({ ...base, pours: [{ atSec: 0, toG: 60 }, { atSec: 0, toG: 300 }] }).errors.pours,
    /2投目の時間/,
  );
  assert.match(
    normalizeRecipeInput({ ...base, pours: [{ atSec: 0, toG: 60 }, { atSec: 45, toG: 280 }] }).errors.pours,
    /湯量（300g）に合わせて/,
  );
  assert.ok(normalizeRecipeInput({ ...base, pours: [] }).errors.pours);
  assert.ok(normalizeRecipeInput({ ...base, doseG: '0', pours: [{ atSec: 0, toG: 300 }] }).errors.doseG);
  assert.ok(normalizeRecipeInput({ ...base, tempC: '120', pours: [{ atSec: 0, toG: 300 }] }).errors.tempC);
});

test('保存した形 → 編集の形 → 保存した形 で値が変わらない', () => {
  const { value } = normalizeRecipeInput({ ...newRecipeState(), name: 'a', grindSetting: '3.5', favorite: true, memo: 'メモ' });
  const again = normalizeRecipeInput(recipeToState(value)).value;
  assert.deepEqual(again, value);
});

test('要点と雛形の表示', () => {
  const { value } = normalizeRecipeInput({ ...newRecipeState(), name: 'a', grindSetting: '24' });
  assert.equal(recipeSummary(value), '20g・300g（1:15）・92℃・挽き目 24');
  assert.equal(templateLabel({ kind: '46', taste: 'sweet', strength: 'strong' }), '4:6メソッド・甘め・濃いめ');
  assert.equal(templateLabel({ kind: 'basic', pourCount: 2 }), '基本形・2回注湯');
});

test('一覧の並び：お気に入り → 最後に使った順 → 更新の新しい順。削除済みは出ない', () => {
  const r = (id, extra = {}) => ({ id, updatedAt: '2026-11-01T00:00:00Z', deletedAt: null, ...extra });
  const recipes = [
    r('old'),
    r('newer', { updatedAt: '2026-11-10T00:00:00Z' }),
    r('used'),
    r('fav', { favorite: true }),
    r('gone', { deletedAt: '2026-11-11T00:00:00Z', favorite: true }),
  ];
  const brews = [
    { id: 'b1', recipeId: 'used', at: '2026-11-17T07:00:00Z', deletedAt: null },
    { id: 'b2', recipeId: 'old', at: '2026-11-18T07:00:00Z', deletedAt: '2026-11-18T08:00:00Z' },
  ];
  assert.deepEqual(orderRecipesForList(recipes, brews).map((x) => x.id), ['fav', 'used', 'newer', 'old']);
  assert.equal(latestBrew(brews).id, 'b1');
  assert.equal(latestBrew([]), null);
});

test('レシピから計画を写す（あとでレシピを直しても計画は変わらない）', () => {
  const { recipes } = makeSampleData(new Date('2026-11-18T00:00:00Z'));
  const recipe = { ...recipes[0], version: 2 };
  const plan = planFromRecipe(recipe);
  assert.equal(plan.recipeId, recipe.id);
  assert.equal(plan.recipeVersion, 2);
  assert.equal(plan.ratio, 15);
  recipe.pours[0].toG = 999;
  assert.equal(plan.pours[0].toG, 60);
});

test('前回の抽出から写すときは、実績ではなく計画を使う（A1）', () => {
  const { recipes, brews } = makeSampleData(new Date('2026-11-18T00:00:00Z'));
  const brew = brews[0]; // 計画300g・実績302g
  const plan = planFromBrew(brew, recipes[0]);
  assert.equal(plan.source, 'lastBrew');
  assert.equal(plan.beanId, brew.beanId);
  assert.equal(plan.waterG, 300);
  assert.equal(plan.doseG, 20);
  assert.equal(plan.pours.at(-1).toG, 300);
  assert.deepEqual(plan.grind, { grinderId: recipes[0].grind.grinderId, setting: '24' });
  assert.equal(plan.equipment.dripperId, brew.equipment.dripperId);
});

test('元のレシピが削除されていても、前回の抽出の計画から始められる', () => {
  const brew = {
    id: 'b',
    beanId: 'bean',
    recipeId: 'gone',
    planned: { doseG: 15, waterG: 240, tempC: 90, grind: '20', pours: [{ atSec: 0, toG: 30 }, { atSec: 40, toG: 240 }] },
  };
  const plan = planFromBrew(brew, { id: 'gone', deletedAt: '2026-11-01T00:00:00Z' });
  assert.equal(plan.name, '前回と同じ');
  assert.equal(plan.ratio, 16);
  assert.equal(plan.grind.setting, '20');
  assert.equal(plan.pours.length, 2);
});
