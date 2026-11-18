// 実験プランナー（F7）：条件の飲み比べ・トライアングルテスト（B6）・次の実験の提案
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  variableChange,
  deltaText,
  normalizeVariableInput,
  buildVariableExperiment,
  normalizeTriangleInput,
  buildTriangleExperiment,
  pairKey,
  judgeTriangle,
  binomialTail,
  triangleStats,
  triangleKey,
  repeatTriangle,
  variableOutcome,
  variableFindings,
  nextExperimentIdeas,
} from '../js/core/experiment-plan.js';
import { attachBrew, setRating, reveal, tastingsToSave, compareResults, experimentStatus, openExperiments, entryKey } from '../js/core/compare.js';

const recipe = { id: 'r1', name: '基本', doseG: 15, waterG: 225, tempC: 92, grind: { grinderId: 'g1', setting: '24' } };
const beans = [
  { id: 'e', name: 'エチオピア', roastLevel: 'シティ', status: 'open' },
  { id: 'k', name: 'ケニア', roastLevel: 'ハイ', status: 'open' },
  { id: 'x', name: '飲み切り', status: 'finished' },
];

test('条件を1つだけ変えた数字：挽き目は目盛り、湯温は℃、比率は湯量で変える', () => {
  assert.deepEqual(variableChange(recipe, { factor: 'grind', delta: -2 }).overrides, { grind: '22' });
  assert.equal(variableChange(recipe, { factor: 'grind', delta: -2 }).text, '挽き目 24 → 22（2目盛り細かく）');
  assert.deepEqual(variableChange(recipe, { factor: 'grind', delta: 1, grindStep: 0.5 }).overrides, { grind: '24.5' });
  assert.deepEqual(variableChange(recipe, { factor: 'tempC', delta: 3 }).overrides, { tempC: 95 });
  const r = variableChange(recipe, { factor: 'ratio', delta: 1 });
  assert.deepEqual(r.overrides, { waterG: 240 });
  assert.equal(r.to, 16);
  assert.equal(r.text, '比率 1:15 → 1:16（湯量 225g → 240g、1薄く）');
  assert.equal(deltaText('ratio', -0.5), '0.5濃く');
});

test('変えられないときは理由を返す（挽き目が文字、湯温が範囲の外、細かくしすぎ）', () => {
  assert.match(variableChange({ ...recipe, grind: { setting: '中細' } }, { factor: 'grind', delta: 1 }).error, /数字ではない/);
  assert.match(variableChange({ ...recipe, tempC: 98 }, { factor: 'tempC', delta: 5 }).error, /60〜100/);
  assert.match(variableChange({ ...recipe, grind: { setting: '1' } }, { factor: 'grind', delta: -2 }).error, /細かくできません/);
  assert.equal(variableChange(recipe, { factor: 'grind', delta: 0 }).ok, false);
  assert.equal(variableChange(recipe, { factor: 'water', delta: 1 }).ok, false);
});

test('条件の飲み比べ：いつもの（a）と変えた方（b）の2杯。同じ豆でもカップの鍵で区別して答え合わせできる', () => {
  const bad = normalizeVariableInput({ beanId: 'x', recipeId: 'r1', factor: 'grind', delta: -1 }, { beans, recipes: [recipe] });
  assert.ok(bad.errors.beanId); // 飲み切りは選べない
  const r = normalizeVariableInput({ beanId: 'e', recipeId: 'r1', factor: 'grind', delta: -2 }, { beans, recipes: [recipe] });
  assert.deepEqual(r.errors, {});
  const exp = { id: 'v1', ...buildVariableExperiment({ ...r, hypothesis: '細かい方が甘い' }) };
  assert.equal(exp.title, 'エチオピア 挽き目の飲み比べ');
  assert.equal(exp.hypothesis, '細かい方が甘い');
  assert.deepEqual(exp.entries.map((e) => [e.key, e.beanId, e.label]), [
    ['a', 'e', 'いつもの（挽き目 24）'],
    ['b', 'e', '挽き目 22'],
  ]);
  assert.deepEqual(exp.entries[1].overrides, { grind: '22' });

  // 同じ豆の2杯：淹れようとしたカップ（targetKey）につなぐ
  exp.entries = attachBrew(exp, { brewId: 'br-b', beanId: 'e', targetKey: 'b' });
  exp.entries = attachBrew(exp, { brewId: 'br-a', beanId: 'e', targetKey: 'a' });
  assert.deepEqual(exp.entries.map((e) => e.brewId), ['br-a', 'br-b']);
  assert.equal(experimentStatus(exp), 'tasting');

  exp.ratings = setRating(exp, 1, { stars: 4 });
  exp.ratings = setRating(exp, 2, { stars: 3 });
  const bad2 = reveal(exp, { 1: 'b', 2: 'b' });
  assert.equal(bad2.errors.answers, '同じ条件を2つのカップに選んでいます');
  const { ratings } = reveal(exp, { 1: 'b', 2: 'a' });
  exp.ratings = ratings;
  exp.revealedAt = '2026-11-18T08:00:00Z';
  assert.deepEqual(tastingsToSave(exp).map((t) => [t.brewId, t.value.stars]), [['br-b', 4], ['br-a', 3]]);
  const rows = compareResults(exp, beans);
  assert.deepEqual(rows.map((x) => [x.key, x.stars, x.rank]), [['b', 4, 1], ['a', 3, 2]]);
  assert.equal(variableOutcome(exp, beans).text, '挽き目を2目盛り細かく：★1つ良くなった（★3 → ★4）');
});

test('3-1 より前の飲み比べ（key のない記録）も、袋のIDを鍵として読める', () => {
  const old = {
    kind: 'roast',
    blind: false,
    entries: [{ beanId: 'e', brewId: 'b1' }, { beanId: 'k', brewId: 'b2' }],
    ratings: [{ cupNo: 1, beanId: 'e', stars: 5, tags: [], memo: '' }],
  };
  assert.equal(entryKey(old.entries[0]), 'e');
  const next = setRating(old, 'k', { stars: 2 });
  assert.deepEqual(next.map((r) => [r.cupNo, r.key ?? r.beanId, r.stars]), [[1, 'e', 5], [2, 'k', 2]]);
  assert.deepEqual(tastingsToSave({ ...old, ratings: next }).map((t) => t.brewId), ['b1', 'b2']);
  assert.deepEqual(attachBrew(old, { brewId: 'b3', beanId: 'k' }).map((e) => e.brewId), ['b1', 'b3']);
});

test('トライアングル：豆2つ。1つにする方はアプリが決める。答え合わせで当たりを出す', () => {
  const r = normalizeTriangleInput({ mode: 'beans', beanIds: ['e', 'k'], recipeId: 'r1' }, { beans, recipes: [recipe] });
  assert.deepEqual(r.errors, {});
  assert.ok(normalizeTriangleInput({ mode: 'beans', beanIds: ['e'], recipeId: 'r1' }, { beans, recipes: [recipe] }).errors.beanIds);
  const exp = buildTriangleExperiment(r, () => 0.9);
  assert.equal(exp.kind, 'triangle');
  assert.equal(exp.oddKey, 'b');
  assert.equal(pairKey(exp), 'a');
  assert.equal(exp.title, 'トライアングル：シティ　エチオピア と ハイ　ケニア');
  assert.equal(buildTriangleExperiment(r, () => 0.1).oddKey, 'a');
  assert.deepEqual(judgeTriangle({ picked: 2, odd: 2, liked: 'b' }).answer, { picked: 2, odd: 2, correct: true, liked: 'b' });
  assert.equal(judgeTriangle({ picked: 1, odd: 3 }).answer.correct, false);
  assert.ok(judgeTriangle({ picked: 4, odd: 1 }).errors.picked);
  assert.ok(judgeTriangle({ picked: 1 }).errors.odd);
  // 途中のものに入る
  assert.equal(openExperiments([{ id: 't', ...exp }]).length, 1);
});

test('トライアングル：条件を1つ変えたもの。同じ組は同じ鍵になり、もう1回はカップを空にする', () => {
  const r = normalizeTriangleInput({ mode: 'variable', beanId: 'e', recipeId: 'r1', factor: 'tempC', delta: -5 }, { beans, recipes: [recipe] });
  assert.deepEqual(r.errors, {});
  const exp = { ...buildTriangleExperiment(r, () => 0.2), entries: [] };
  const full = buildTriangleExperiment(r, () => 0.2);
  assert.equal(full.title, 'エチオピア 湯温のトライアングル');
  assert.deepEqual(full.entries[1].overrides, { tempC: 87 });
  const again = repeatTriangle({ ...full, entries: full.entries.map((e) => ({ ...e, brewId: 'x' })), answer: { correct: true } }, () => 0.7);
  assert.deepEqual(again.entries.map((e) => e.brewId), [null, null]);
  assert.equal(again.answer, null);
  assert.equal(again.oddKey, 'b');
  assert.equal(triangleKey(again), triangleKey(full));
  assert.notEqual(triangleKey(full), triangleKey({ ...exp, mode: 'beans', entries: [{ beanId: 'e' }, { beanId: 'k' }] }));
});

test('二項検定：偶然（3分の1）で k 回以上当たる確率', () => {
  assert.equal(binomialTail(5, 0, 1 / 3), 1);
  assert.ok(Math.abs(binomialTail(1, 1, 1 / 3) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(binomialTail(3, 3, 1 / 3) - 1 / 27) < 1e-12);
  assert.ok(Math.abs(binomialTail(6, 5, 1 / 3) - (6 * 2 + 1) / 729) < 1e-12);
});

test('トライアングルの成績：回数と当たりから言葉を変える', () => {
  const t = (correct, i) => ({ id: `t${i}`, kind: 'triangle', mode: 'beans', entries: [{ beanId: 'e', brewId: 'a' }, { beanId: 'k', brewId: 'b' }], revealedAt: 'x', answer: { correct } });
  assert.equal(triangleStats([]).text, '');
  const one = triangleStats([t(true, 1)]);
  assert.equal(one.level, 'none');
  assert.match(one.text, /1回中1回当たり。今のところ偶然と見分けられません（5回ほど/);
  const many = triangleStats([1, 2, 3, 4, 5, 6].map((i) => t(i !== 3, i)));
  assert.equal(many.hits, 5);
  assert.equal(many.level, 'clear');
  // 削除したもの・答え合わせ前のものは数えない
  assert.equal(triangleStats([{ ...t(true, 9), deletedAt: 'x' }, { ...t(true, 8), revealedAt: null }]).n, 0);
});

test('わかったこと：条件と向きごとに、良くなった回数をまとめる', () => {
  const v = (id, factor, delta, a, b) => ({
    id,
    kind: 'variable',
    beanId: 'e',
    blind: false,
    variable: { factor, delta },
    revealedAt: 'x',
    entries: [{ key: 'a', beanId: 'e', brewId: 'a' }, { key: 'b', beanId: 'e', brewId: 'b' }],
    ratings: [{ key: 'a', cupNo: 1, beanId: 'e', stars: a }, { key: 'b', cupNo: 2, beanId: 'e', stars: b }],
  });
  const f = variableFindings([v('1', 'grind', -1, 3, 4), v('2', 'grind', -2, 3, 3), v('3', 'tempC', 3, 4, 2)], beans);
  assert.deepEqual(f.map((x) => x.text), ['挽き目を細かく：2回のうち1回良くなった、1回同じ', '湯温を上げる：1回のうち1回下がった']);
  assert.equal(variableFindings([v('1', 'grind', -1, 3, 4)], beans, 'k').length, 0);
});

test('次の実験の提案：ダイヤルイン提案 → 条件と評価 → まだ試していない条件の順。条件は重ならない', () => {
  const suggestions = [{ id: 's1', beanId: 'e', brewId: 'b0', nextBrewId: null, createdAt: '1', action: { kind: 'finer', to: '23', short: '挽き目 24 → 23' } }];
  const factorResult = { factors: [{ key: 'grind', label: '挽き目', fit: { r: -0.6, slope: -0.3 }, word: { text: 'はっきりした傾向' } }, { key: 'tempC', label: '湯温', fit: { r: 0.5, slope: 0.2 }, word: { text: 'はっきりした傾向：大きいほど★が高い' } }] };
  const ideas = nextExperimentIdeas({ beanId: 'e', recipe, suggestions, factorResult });
  assert.deepEqual(ideas.map((i) => [i.factor, i.delta, i.source]), [['grind', -1, 'dialin'], ['tempC', 3, 'factors'], ['ratio', 1, 'untested']]);
  assert.match(ideas[0].reason, /挽き目 24 → 23/);
  assert.match(ideas[0].href, /^compare\.html\?new=variable&factor=grind&delta=-1&recipe=r1&bean=e$/);
  // 提案がなく、もう確かめた条件は出さない
  const done = { id: 'v', kind: 'variable', beanId: 'e', variable: { factor: 'grind', delta: -2 }, revealedAt: 'x', entries: [] };
  assert.deepEqual(nextExperimentIdeas({ beanId: 'e', recipe, experiments: [done] }).map((i) => i.factor), ['tempC', 'ratio']);
  // 挽き目が数字でないレシピでは挽き目を出さない
  assert.deepEqual(nextExperimentIdeas({ beanId: 'e', recipe: { ...recipe, grind: { setting: '中' } } }).map((i) => i.factor), ['tempC', 'ratio']);
  assert.deepEqual(nextExperimentIdeas({ beanId: 'e', recipe: null }), []);
});
