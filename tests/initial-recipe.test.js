import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialRecipe,
  initialPlan,
  initialText,
  similarity,
  median,
  tableRow,
  baseRecipe,
  ROAST_TABLE,
} from '../js/core/initial-recipe.js';
import { make46 } from '../js/core/recipes.js';

let seq = 0;
const bean = (o = {}) => ({ id: o.id ?? `b${++seq}`, name: o.name ?? `豆${seq}`, roastLevel: 'シティ', process: 'ウォッシュト', origin: { country: 'エチオピア' }, variety: '', deletedAt: null, ...o });
let bseq = 0;
function brew(beanId, { dose = 20, water = 300, temp = 90, grind = '24', grinderId = 'g1', iced = false, at } = {}) {
  const id = `w${++bseq}`;
  return {
    id,
    beanId,
    at: at ?? `2026-10-${String((bseq % 28) + 1).padStart(2, '0')}T08:00:00Z`,
    deletedAt: null,
    equipment: { grinderId },
    planned: { doseG: dose, waterG: water, tempC: temp, grind: { grinderId, setting: grind } },
    actual: { doseG: dose, waterG: water, tempC: temp, grind: { grinderId, setting: grind } },
    context: iced ? { iceG: 100 } : {},
  };
}
const tasting = (brewId, stars) => ({ id: `t${brewId}`, brewId, stars, by: 'me', stage: 'warm', deletedAt: null, updatedAt: '2026-10-01' });
const grinder = (id, scale, step = 1) => ({ id, kind: 'grinder', name: id, attrs: { scale, step }, deletedAt: null });

test('中央値', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([null, 'x', 5]), 5);
  assert.equal(median([]), null);
});

test('似ている度合い：焙煎度が同じ＝3、1段違い＝2、2段以上は0。精製・産地は各2、品種は1', () => {
  const a = bean({ roastLevel: 'シティ', process: 'ナチュラル', origin: { country: 'ケニア' }, variety: 'SL28' });
  assert.equal(similarity(a, bean({ roastLevel: 'シティ', process: 'ナチュラル', origin: { country: 'ケニア' }, variety: 'SL28' })).score, 8);
  assert.equal(similarity(a, bean({ roastLevel: 'ハイ', process: 'ナチュラル', origin: { country: 'ブラジル' } })).score, 4);
  assert.equal(similarity(a, bean({ roastLevel: 'ミディアム', process: 'ナチュラル', origin: { country: 'ケニア' } })).score, 0);
  assert.equal(similarity(a, bean({ roastLevel: '' })).score, 0);
  // 全角・半角の違いは同じとみなし、空どうしは同じとみなさない
  assert.deepEqual(similarity(bean({ process: '', origin: { country: 'ｹﾆｱ' } }), bean({ process: '', origin: { country: 'ケニア' } })).why, ['焙煎度が同じ', '産地が同じ']);
});

test('似た豆の★4以上が2杯以上あれば、その中央値を使う（★3以下・アイス・別の豆は数えない）', () => {
  const target = bean({ id: 'new', name: '新しい豆' });
  const sim = bean({ id: 's', name: '似た豆' }); // 焙煎度・精製・産地が同じ＝7
  const far = bean({ id: 'f', roastLevel: 'ライト' });
  const brews = [
    brew('s', { dose: 18, water: 270, temp: 88, grind: '22' }),
    brew('s', { dose: 20, water: 300, temp: 90, grind: '24' }),
    brew('s', { dose: 22, water: 352, temp: 92, grind: '26' }),
    brew('s', { dose: 30, water: 300, temp: 80, grind: '40' }), // ★2
    brew('s', { dose: 30, water: 300, temp: 80, grind: '40', iced: true }), // アイス
    brew('f', { dose: 10, water: 100, temp: 99, grind: '1' }),
  ];
  const tastings = [tasting(brews[0].id, 4), tasting(brews[1].id, 5), tasting(brews[2].id, 4), tasting(brews[3].id, 2), tasting(brews[4].id, 5), tasting(brews[5].id, 5)];
  const r = initialRecipe({ bean: target, beans: [target, sim, far], brews, tastings, grinders: [grinder('g1', [])], grinderId: 'g1' });
  assert.equal(r.source, 'similar');
  assert.equal(r.n, 3);
  assert.equal(r.doseG, 20);
  assert.equal(r.ratio, 15); // 15・15・16 の中央値
  assert.equal(r.tempC, 90);
  assert.equal(r.grind.setting, '24');
  assert.match(r.reasons[0], /似た豆 1袋（似た豆）で★4以上だった3杯の中央値/);
  assert.match(r.reasons[1], /焙煎度が同じ・精製が同じ・産地が同じ/);
});

test('違うグラインダーの挽き目は目盛り表で換算する。換算できない杯は挽き目だけ数えない', () => {
  const target = bean({ id: 'new2' });
  const sim = bean({ id: 's2' });
  const g1 = grinder('g1', [{ setting: 10, um: 500 }, { setting: 30, um: 900 }]);
  const g2 = grinder('g2', [{ setting: 1, um: 500 }, { setting: 5, um: 900 }], 0.5);
  const brews = [brew('s2', { grind: '20', grinderId: 'g1' }), brew('s2', { grind: '20', grinderId: 'g1' }), brew('s2', { grind: '3', grinderId: 'gX' })];
  const tastings = brews.map((b) => tasting(b.id, 5));
  const r = initialRecipe({ bean: target, beans: [target, sim], brews, tastings, grinders: [g1, g2], grinderId: 'g2' });
  // g1 の20 → 700µm → g2 の3
  assert.equal(r.grind.setting, '3');
  assert.equal(r.grind.grinderId, 'g2');
  assert.equal(r.grind.word, '中細挽き');
});

test('似た豆が足りず、同じ区分に★のある杯が5杯以上・★4以上が2杯以上なら「自分の初期値」', () => {
  const target = bean({ id: 'n3', roastLevel: 'シティ', process: 'ハニー', origin: { country: 'コスタリカ' } });
  const other = bean({ id: 'o3', roastLevel: 'フルシティ', process: 'ナチュラル', origin: { country: 'ブラジル' } }); // 似ていない（2点）が同じ中深煎り
  const brews = Array.from({ length: 5 }, (_, i) => brew('o3', { dose: 15, water: 225 + i * 15, temp: 86 + i, grind: String(20 + i) }));
  const stars = [3, 3, 3, 4, 5];
  const tastings = brews.map((b, i) => tasting(b.id, stars[i]));
  const r = initialRecipe({ bean: target, beans: [target, other], brews, tastings, grinders: [], grinderId: null });
  assert.equal(r.source, 'own');
  assert.equal(r.n, 2);
  assert.equal(r.tempC, 90); // 89 と 90 の中央値 89.5 → 90
  assert.equal(r.grind.setting, '24'); // 23 と 24 の中央値 23.5 を刻み1に丸める
});

test('自分の初期値の境目：★のある杯が4杯なら叩き台のまま', () => {
  const target = bean({ id: 'n4', roastLevel: 'シティ', process: 'ハニー', origin: { country: 'コスタリカ' } });
  const other = bean({ id: 'o4', roastLevel: 'フルシティ', process: 'ナチュラル', origin: { country: 'ブラジル' } });
  const brews = Array.from({ length: 4 }, () => brew('o4'));
  const tastings = brews.map((b) => tasting(b.id, 5));
  assert.equal(initialRecipe({ bean: target, beans: [target, other], brews, tastings }).source, 'table');
});

test('成功例がなければ焙煎度の叩き台。3区分それぞれの値', () => {
  const cases = [
    ['ライト', 93, 15.5, '中細挽き'],
    ['ミディアム', 93, 15.5, '中細挽き'],
    ['ハイ', 90, 15, '中挽き'],
    ['シティ', 90, 15, '中挽き'],
    ['フルシティ', 87, 14.5, '中挽き〜やや粗め'],
    ['イタリアン', 87, 14.5, '中挽き〜やや粗め'],
  ];
  for (const [level, temp, ratio, word] of cases) {
    const r = initialRecipe({ bean: bean({ roastLevel: level }), defaultDoseG: 16 });
    assert.equal(r.source, 'table');
    assert.equal(r.doseG, 16);
    assert.equal(r.tempC, temp, level);
    assert.equal(r.ratio, ratio, level);
    assert.equal(r.grind.word, word, level);
    assert.equal(r.grind.setting, '');
    assert.match(r.reasons.at(-1), /目盛りを手で合わせて/);
  }
  assert.equal(tableRow('').key, 'mid');
  assert.equal(ROAST_TABLE.length, 3);
});

test('叩き台の挽き目は、グラインダーの目盛り表があれば数字にする', () => {
  const g = grinder('g1', [{ setting: 10, um: 450 }, { setting: 20, um: 850 }]);
  const r = initialRecipe({ bean: bean({ roastLevel: 'ライト' }), grinders: [g], grinderId: 'g1' });
  assert.equal(r.grind.setting, '15'); // 650µm
  assert.equal(r.grind.word, '中細挽き');
  assert.equal(initialText(r), '15g・1:15.5・93℃・挽き目 15（中細挽き）');
});

test('土台のレシピ：お気に入り → 使った回数 → 新しい順', () => {
  const r1 = { id: 'r1', updatedAt: '2026-10-01', deletedAt: null };
  const r2 = { id: 'r2', updatedAt: '2026-09-01', deletedAt: null };
  const r3 = { id: 'r3', updatedAt: '2026-11-01', deletedAt: '2026-11-02' };
  assert.equal(baseRecipe([r1, r2, r3], [{ recipeId: 'r2', deletedAt: null }]).id, 'r2');
  assert.equal(baseRecipe([r1, { ...r2, favorite: false }], []).id, 'r1');
  assert.equal(baseRecipe([r1, { ...r2, favorite: true }], []).id, 'r2');
  assert.equal(baseRecipe([], []), null);
});

test('計画にする：4:6の土台は比率を変えて作り直し、湯温と挽き目を入れる', () => {
  const made = make46({ doseG: 20, ratio: 15 });
  const recipe = { id: 'r', name: '4:6', version: 2, doseG: 20, waterG: made.waterG, tempC: 92, grind: { grinderId: 'g1', setting: '30' }, pours: made.pours, template: { kind: '46', ratio: 15, taste: 'sweet', strength: 'standard' }, deletedAt: null };
  const init = { doseG: 16, ratio: 15.5, tempC: 93, grind: { grinderId: 'g1', setting: '24', word: '中細挽き' } };
  const plan = initialPlan(init, recipe, { id: 'nb', name: 'ケニア' });
  assert.equal(plan.source, 'initial');
  assert.equal(plan.beanId, 'nb');
  assert.equal(plan.recipeId, 'r');
  assert.equal(plan.name, 'ケニアの最初のレシピ');
  assert.equal(plan.doseG, 16);
  assert.equal(plan.waterG, 248);
  assert.equal(plan.ratio, 15.5);
  assert.equal(plan.tempC, 93);
  assert.equal(plan.grind.setting, '24');
  assert.equal(plan.template.taste, 'sweet');
  assert.equal(plan.pours.at(-1).toG, 248);
});

test('計画にする：雛形のない土台は注湯を比例で直し、土台がなければ4:6の標準', () => {
  const recipe = { id: 'h', name: '手', doseG: 15, waterG: 240, pours: [{ atSec: 0, toG: 40 }, { atSec: 40, toG: 240 }], template: null, deletedAt: null };
  const init = { doseG: 20, ratio: 15, tempC: 90, grind: { grinderId: null, setting: '', word: '中挽き' } };
  const p1 = initialPlan(init, recipe, { id: 'x', name: 'X' });
  assert.equal(p1.waterG, 300);
  assert.equal(p1.pours.at(-1).toG, 300);
  assert.equal(p1.pours.length, 2);
  const p2 = initialPlan(init, null, { id: 'x', name: 'X' });
  assert.equal(p2.recipeId, null);
  assert.equal(p2.waterG, 300);
  assert.equal(p2.pours.length, 5);
  assert.equal(p2.template.kind, '46');
});
