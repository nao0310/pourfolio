// 実験プランナーの最適化モード（F7）：ガウス過程と期待改善量
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRanges,
  normalizeOptimizeInput,
  buildOptimizeExperiment,
  optimizePoints,
  gpFit,
  cholesky,
  cdf,
  expectedImprovement,
  candidateGrid,
  nextTrial,
  bestKnown,
  trialHref,
  trialText,
  predictionTable,
  MIN_POINTS,
} from '../js/core/optimize.js';
import { openExperiments } from '../js/core/compare.js';

const recipe = { id: 'r1', doseG: 15, waterG: 225, tempC: 92, grind: { grinderId: 'g1', setting: '24' } };
const beans = [{ id: 'e', name: 'エチオピア', status: 'open' }];
const exp = { id: 'o1', kind: 'optimize', beanId: 'e', recipeId: 'r1', grinderId: 'g1', grindStep: 1, ranges: { grind: [20, 28], ratio: [14, 17], tempC: null } };

const row = (id, grind, ratio, stars, extra = {}) => ({
  brew: { id, beanId: 'e', at: `2026-11-${10 + id.length}`, actual: { grind: { grinderId: 'g1', setting: String(grind) }, tempC: 92, doseG: 15, waterG: 15 * ratio }, ...extra },
  stars,
  metrics: { ratio },
});

test('範囲の初期値はレシピのまわり。入力を確かめる', () => {
  assert.deepEqual(defaultRanges(recipe), { grind: [20, 28], ratio: [13.5, 16.5], tempC: [88, 96] });
  const ok = normalizeOptimizeInput({ beanId: 'e', recipeId: 'r1', ranges: { grind: ['20', '28'], ratio: [14, 17] } }, { beans, recipes: [recipe], grinders: [{ id: 'g1', attrs: { step: '0.5' } }] });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.grindStep, 0.5);
  assert.deepEqual(ok.value.ranges, { grind: [20, 28], ratio: [14, 17], tempC: null });
  const rec = buildOptimizeExperiment(ok);
  assert.equal(rec.title, 'エチオピア の最適化');
  assert.equal(rec.kind, 'optimize');
  assert.equal(openExperiments([{ id: 'x', ...rec }]).length, 0); // 途中の知らせには出さない

  const bad = normalizeOptimizeInput({ beanId: 'e', recipeId: 'r1', useTemp: true, ranges: { grind: [24, 24], ratio: [5, 17], tempC: ['', 95] } }, { beans, recipes: [recipe] });
  assert.match(bad.errors.grind, /狭すぎます/);
  assert.match(bad.errors.ratio, /8〜25/);
  assert.match(bad.errors.tempC, /数字で/);
  assert.match(normalizeOptimizeInput({ beanId: 'e', recipeId: 'r1', ranges: {} }, { beans, recipes: [{ ...recipe, grind: { setting: '中挽き' } }] }).errors.recipeId, /数字ではありません/);
});

test('学びに使う杯：その豆・同じグラインダー・★あり・アイスでない・範囲から1刻みまで', () => {
  const rows = [
    row('a', 24, 15, 4),
    row('b', 24, 15, null),
    row('c', 30, 15, 3), // 範囲の外
    row('d', 29, 15, 3), // 1刻みはみ出しは使う
    row('e', 24, 15, 5, { context: { iceG: 90 } }),
    { ...row('f', 24, 15, 4), brew: { ...row('f', 24, 15, 4).brew, beanId: 'other' } },
    { ...row('g', 24, 15, 4), brew: { ...row('g', 24, 15, 4).brew, actual: { grind: { grinderId: 'g2', setting: '24' }, tempC: 92 } } },
  ];
  assert.deepEqual(optimizePoints(exp, rows).map((p) => p.brewId), ['a', 'd']);
  // 動かさない湯温は持たない（「今のいちばん」に出さない）
  assert.deepEqual(optimizePoints(exp, rows)[0].x, { grind: 24, ratio: 15 });
  assert.deepEqual(optimizePoints({ ...exp, ranges: { ...exp.ranges, tempC: [88, 96] } }, rows)[0].x, { grind: 24, ratio: 15, tempC: 92 });
});

test('コレスキー分解と正規分布', () => {
  const L = cholesky([[4, 2], [2, 3]]);
  assert.deepEqual(L.map((r) => r.map((v) => Math.round(v * 1e6) / 1e6)), [[2, 0], [1, 1.414214]]);
  assert.equal(cholesky([[0, 0], [0, 1]]), null);
  assert.ok(Math.abs(cdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(cdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(cdf(-1.96) - 0.025) < 1e-3);
});

test('ガウス過程：記録した点の近くでは記録に近く、離れると幅が広い', () => {
  const gp = gpFit([[0.2, 0.2], [0.8, 0.8]], [5, 2]);
  const near = gp.predict([0.2, 0.2]);
  const far = gp.predict([0.2, 0.8]);
  assert.ok(near.mean > 4.2 && near.mean < 5);
  assert.ok(gp.predict([0.8, 0.8]).mean < 2.8);
  assert.ok(far.sd > near.sd);
  // 同じ所に何度も記録しても計算できる（ノイズを足しているため）
  assert.ok(Number.isFinite(gpFit([[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], [3, 4, 5]).predict([0.5, 0.5]).mean));
});

test('期待改善量：良さそうな所と、分からない所が大きい', () => {
  assert.ok(expectedImprovement(4.5, 0.2, 4) > expectedImprovement(3, 0.2, 4));
  assert.ok(expectedImprovement(3.5, 1, 4) > expectedImprovement(3.5, 0.1, 4));
  assert.equal(expectedImprovement(3, 0, 4), 0);
});

test('格子：刻みごとの全部の組み合わせ（湯温は範囲があるときだけ）', () => {
  assert.equal(candidateGrid(exp).length, 9 * 7);
  assert.equal(candidateGrid({ ...exp, ranges: { ...exp.ranges, tempC: [90, 94] } }).length, 9 * 7 * 5);
  assert.deepEqual(candidateGrid({ ...exp, grindStep: 0.5, ranges: { grind: [1, 2], ratio: [15, 16] } }).map((x) => `${x.grind}/${x.ratio}`), [
    '1/15', '1/15.5', '1/16', '1.5/15', '1.5/15.5', '1.5/16', '2/15', '2/15.5', '2/16',
  ]);
});

test('次の条件：記録が少ないうちは散らばった所、たまったら良くなりそうな所', () => {
  const first = nextTrial(exp, []);
  assert.equal(first.phase, 'explore');
  assert.deepEqual(first.x, { grind: 24, ratio: 15.5 });
  assert.equal(first.left, MIN_POINTS);
  // 真ん中を試したら、次は別の所
  const second = nextTrial(exp, [{ x: { grind: 24, ratio: 15.5 }, y: 3 }]);
  assert.deepEqual(second.x, { grind: 22, ratio: 16.5 });
  assert.match(second.reason, /あと2杯/);

  // 細かいほど良い記録：次は細かい側を出す
  const pts = [
    { x: { grind: 27, ratio: 15 }, y: 2 },
    { x: { grind: 24, ratio: 15 }, y: 3 },
    { x: { grind: 22, ratio: 15 }, y: 4 },
  ];
  const next = nextTrial(exp, pts);
  assert.equal(next.phase, 'ei');
  assert.ok(next.x.grind <= 22, `挽き目 ${next.x.grind}`);
  assert.match(next.reason, /^3杯の★から、いちばん良くなりそうな所（予想 ★[0-9.]+ ±[0-9.]+）$/);
  // 同じ記録なら同じ答え
  assert.deepEqual(nextTrial(exp, pts).x, next.x);
  assert.equal(bestKnown(exp, pts).x.grind, 22);
  assert.equal(bestKnown(exp, []), null);
});

test('淹れる画面の URL と言葉、予想の表', () => {
  assert.equal(trialHref(exp, recipe, { grind: 22, ratio: 15.5 }), 'brew.html?recipe=r1&bean=e&grind=22&water=233&via=optimize');
  assert.equal(trialText({ grind: 22, ratio: 15.5, tempC: 93 }), '挽き目 22・比率 1:15.5・湯温 93℃');
  assert.equal(predictionTable(exp, []), null);
  const t = predictionTable(exp, [
    { x: { grind: 27, ratio: 15 }, y: 2 },
    { x: { grind: 24, ratio: 15 }, y: 3 },
    { x: { grind: 22, ratio: 15 }, y: 4 },
  ]);
  assert.deepEqual(t.grinds, [20, 21, 22, 23, 24, 25, 26, 27, 28]);
  assert.deepEqual(t.ratios, [14, 14.5, 15, 15.5, 16, 16.5, 17]);
  assert.equal(t.cells.length, 7);
  assert.ok(t.cells[2][2] > t.cells[2][7]);
});
