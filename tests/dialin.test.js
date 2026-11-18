// ダイヤルイン診断（F1）の計算
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnose,
  suggestNext,
  makeAction,
  applyAction,
  basePlanForNext,
  actionHistory,
  confidenceOf,
  buildSuggestion,
  pickPendingSuggestion,
  pickSuggestionForBrew,
  linkSuggestions,
  CELLS,
} from '../js/core/dialin.js';

const jar = (strength, acidity, bitterness, astringency, rest = {}) => ({
  strength,
  acidity,
  bitterness,
  sweetness: null,
  body: null,
  astringency,
  ...rest,
});
const plan = { doseG: 15, waterG: 225, grind: { grinderId: 'g1', setting: '24' }, pours: [{ atSec: 0, toG: 45 }, { atSec: 40, toG: 225 }], flowGps: 10 };

// 9マスそれぞれの代表の評価と、期待する提案
const NINE = [
  ['strong/under', jar(1, 1, 0, 0), 'water', { variable: 'waterG', from: 225, to: 233 }, 'finer'],
  ['strong/ok', jar(2, 0, 0, 0), 'water', { variable: 'waterG', from: 225, to: 233 }, null],
  ['strong/over', jar(1, 0, 1, 0), 'water', { variable: 'waterG', from: 225, to: 233 }, 'coarser'],
  ['ok/under', jar(0, 2, 0, 0), 'finer', { variable: 'grind', from: '24', to: '23' }, null],
  ['ok/ok', jar(0, 0, 0, 0), 'keep', { variable: null, from: null, to: null }, null],
  ['ok/over', jar(0, -1, 0, 1), 'coarser', { variable: 'grind', from: '24', to: '25' }, null],
  ['weak/under', jar(-1, 1, -1, 0), 'dose', { variable: 'doseG', from: 15, to: 15.5 }, 'finer'],
  ['weak/ok', jar(-2, 0, 0, 0), 'dose', { variable: 'doseG', from: 15, to: 15.5 }, null],
  ['weak/over', jar(-1, 0, 2, 2), 'dose', { variable: 'doseG', from: 15, to: 15.5 }, 'coarser'],
];

test('完了の確認：9マスすべての組み合わせで正しい提案が出る', () => {
  assert.equal(Object.keys(CELLS).length, 9);
  for (const [cellKey, j, kind, change, second] of NINE) {
    const s = suggestNext({ tasting: { jar: j, tags: [] }, plan });
    assert.equal(`${s.cell.strength}/${s.cell.extraction}`, cellKey, cellKey);
    assert.equal(s.cellName, CELLS[cellKey].name, cellKey);
    assert.equal(s.action.kind, kind, cellKey);
    assert.equal(s.action.variable, change.variable, cellKey);
    assert.equal(s.action.from, change.from, cellKey);
    assert.equal(s.action.to, change.to, cellKey);
    if (second) assert.match(s.nextStep, /濃さが直ったら/, cellKey);
    else assert.equal(s.nextStep, null, cellKey);
    // 根拠の4点がそろう
    assert.ok(s.reasons.input.length > 0, cellKey);
    assert.match(s.reasons.theory, /マス/, cellKey);
    assert.ok(['high', 'mid', 'low'].includes(s.reasons.confidence.level), cellKey);
    if (kind !== 'keep') assert.match(s.reasons.history, /まだ実績がありません/, cellKey);
  }
});

test('角のマスでは濃さを先に直し、変えるのは1つだけ', () => {
  for (const [cellKey, j] of NINE.filter(([k]) => CELLS[k].steps.length > 1)) {
    const s = suggestNext({ tasting: { jar: j }, plan });
    assert.ok(['water', 'dose'].includes(s.action.kind), cellKey);
    const next = applyAction(plan, s.action);
    const changed = ['doseG', 'waterG'].filter((k) => next[k] !== plan[k]);
    assert.equal(changed.length, 1, cellKey);
    assert.equal(next.grind.setting, plan.grind.setting, cellKey);
  }
});

test('濃さの判定：−1以下は薄い、+1以上は濃い、0はちょうど', () => {
  assert.equal(diagnose({ jar: jar(-1, null, null, null) }).strength, 'weak');
  assert.equal(diagnose({ jar: jar(1, null, null, null) }).strength, 'strong');
  assert.equal(diagnose({ jar: jar(0, null, null, null) }).strength, 'ok');
  assert.equal(diagnose({ jar: jar(null, null, null, null) }).strength, null);
});

test('抽出の判定：酸味が強く苦味・渋みが強くなければ足りない、逆は抽出しすぎ、両方なら判断しない', () => {
  assert.equal(diagnose({ jar: jar(null, 1, null, null) }).extraction, 'under');
  assert.equal(diagnose({ jar: jar(null, 1, 0, -1) }).extraction, 'under');
  assert.equal(diagnose({ jar: jar(null, null, null, 1) }).extraction, 'over');
  assert.equal(diagnose({ jar: jar(null, -2, 1, null) }).extraction, 'over');
  assert.equal(diagnose({ jar: jar(null, 1, 1, null) }).extraction, 'mixed');
  assert.equal(diagnose({ jar: jar(null, 1, null, 2) }).extraction, 'mixed');
  assert.equal(diagnose({ jar: jar(null, -1, -1, 0) }).extraction, 'ok');
  assert.equal(diagnose({ jar: jar(1, null, null, null, { sweetness: -2, body: 2 }) }).extraction, null);
});

test('両方強くて濃さがちょうどなら「同じ条件でもう1杯」、濃さがずれていれば濃さだけ直す', () => {
  const repeat = suggestNext({ tasting: { jar: jar(0, 1, 1, 0) }, plan });
  assert.equal(repeat.action.kind, 'repeat');
  assert.equal(repeat.action.to, null);
  assert.equal(repeat.reasons.confidence.level, 'low');
  assert.equal(repeat.reasons.history, '');
  const strong = suggestNext({ tasting: { jar: jar(1, 2, 1, 0) }, plan });
  assert.equal(strong.action.kind, 'water');
  assert.equal(strong.cell.extraction, 'mixed');
  const weak = suggestNext({ tasting: { jar: jar(-1, 1, 0, 1) }, plan });
  assert.equal(weak.action.kind, 'dose');
});

test('ちょうど良さが未回答なら一言タグで代わりに判定する', () => {
  const d = diagnose({ jar: jar(null, null, null, null), tags: ['薄い', '酸っぱい'] });
  assert.equal(d.strength, 'weak');
  assert.equal(d.strengthFrom, 'tag');
  assert.equal(d.extraction, 'under');
  assert.equal(d.extractionFrom, 'tag');
  assert.deepEqual(d.symptoms, ['一言「薄い」', '一言「酸っぱい」']);
  // 答えた項目はJARを優先する（酸味ちょうど＋「酸っぱい」タグ → 酸味はちょうど）
  assert.equal(diagnose({ jar: jar(null, 0, null, null), tags: ['酸っぱい'] }).extraction, 'ok');
  // 項目ごとの代わり：苦味は未回答で「苦い」タグ → 抽出しすぎ
  assert.equal(diagnose({ jar: jar(null, 0, null, 0), tags: ['苦い'] }).extraction, 'over');
  // 「薄い」と「濃い」を両方付けたら濃さは決めない
  assert.equal(diagnose({ tags: ['薄い', '濃い'] }).strength, null);
  const s = suggestNext({ tasting: { tags: ['渋い'] }, plan });
  assert.equal(s.action.kind, 'coarser');
  assert.equal(s.reasons.confidence.level, 'low');
});

test('判断する材料がなければ提案しない', () => {
  assert.equal(suggestNext({ tasting: { stars: 3, tags: ['好き', '甘い'], jar: jar(null, null, null, null, { sweetness: 1 }) }, plan }), null);
  assert.equal(suggestNext({ tasting: null, plan }), null);
});

test('片方の軸だけ答えたら、もう片方はちょうどとして扱う', () => {
  const s = suggestNext({ tasting: { jar: jar(null, 1, null, null) }, plan });
  assert.equal(s.cell.strength, 'ok');
  assert.equal(s.action.kind, 'finer');
  assert.match(s.reasons.confidence.text, /濃さは答えていない/);
  const t = suggestNext({ tasting: { jar: jar(-1, null, null, null) }, plan });
  assert.equal(t.cell.extraction, 'ok');
  assert.equal(t.action.kind, 'dose');
});

test('入力の症状：答えた項目を呼び方で並べる', () => {
  const d = diagnose({ jar: jar(-1, 2, 0, null) });
  assert.deepEqual(d.symptoms, ['濃さ やや薄い', '酸味 強すぎ', '苦味 ちょうど']);
});

test('変更幅：比率±0.5、挽き目はグラインダーの1目盛り', () => {
  assert.equal(makeAction('water', { doseG: 20, waterG: 300 }).to, 310);
  assert.match(makeAction('water', { doseG: 20, waterG: 300 }).text, /1:15 → 1:15\.5/);
  assert.equal(makeAction('dose', { doseG: 20, waterG: 300 }).to, 20.7);
  assert.match(makeAction('dose', { doseG: 15, waterG: 225 }).text, /1:15 → 1:14\.5/);
  assert.equal(makeAction('finer', { grind: { setting: '24' } }, 0.5).to, '23.5');
  assert.equal(makeAction('coarser', { grind: { setting: '2.3' } }, 0.1).to, '2.4');
  assert.equal(makeAction('finer', { grind: { setting: '２４' } }).to, '23'); // 全角数字
  // 挽き目が数字でなければ目盛りは出さない
  const a = makeAction('finer', { grind: { setting: '中細' } });
  assert.equal(a.to, null);
  assert.match(a.text, /手で合わせて/);
  assert.equal(makeAction('finer', { grind: { setting: '' } }).to, null);
  // 粉量・湯量がなければ数字は出さない
  assert.equal(makeAction('water', { doseG: null, waterG: 225 }).to, null);
});

test('計画に当てはめる：湯量なら注湯の累計も合わせ、レシピの値以外は変えない', () => {
  const water = applyAction(plan, makeAction('water', plan));
  assert.equal(water.waterG, 233);
  assert.equal(water.pours.at(-1).toG, 233);
  assert.equal(water.ratio, 15.5);
  assert.equal(water.doseG, 15);
  const grind = applyAction(plan, makeAction('finer', plan));
  assert.equal(grind.grind.setting, '23');
  assert.equal(grind.grind.grinderId, 'g1');
  assert.equal(plan.grind.setting, '24'); // 元の計画は変わらない
  const keep = applyAction(plan, makeAction('keep', plan));
  assert.deepEqual({ ...keep, ratio: undefined }, { ...plan, ratio: undefined });
});

test('次の計画の土台：前回の計画を写し、挽き目は実際に挽いた目盛り', () => {
  const brew = {
    id: 'b1',
    beanId: 'bean1',
    recipeId: null,
    planned: { name: 'テスト', doseG: 15, waterG: 225, grind: { grinderId: 'g1', setting: '24' }, pours: plan.pours },
    actual: { doseG: 15.2, waterG: 226, grind: { grinderId: 'g1', setting: '22' } },
  };
  const p = basePlanForNext(brew, null);
  assert.equal(p.doseG, 15);
  assert.equal(p.waterG, 225);
  assert.equal(p.grind.setting, '22');
  assert.equal(p.beanId, 'bean1');
  const noActual = basePlanForNext({ ...brew, actual: { grind: { setting: '' } } }, null);
  assert.equal(noActual.grind.setting, '24');
});

// 実績：提案ログと、その次の杯の評価
const sug = (id, kind, jarBefore, nextBrewId, beanId = 'bean1', adopted = true) => ({
  id,
  beanId,
  action: { kind },
  jarBefore,
  adopted,
  nextBrewId,
  deletedAt: null,
});
const tast = (brewId, j) => ({ id: `t-${brewId}`, brewId, by: 'me', stage: 'warm', jar: j, deletedAt: null, updatedAt: '2026-11-18T00:00:00Z' });

test('実績：提案どおりに淹れた次の杯で、狙った項目がちょうどに近づいた回数', () => {
  const suggestions = [
    sug('s1', 'finer', jar(0, 2, 0, 0), 'n1'),
    sug('s2', 'finer', jar(0, 1, 0, 0), 'n2'),
    sug('s3', 'finer', jar(0, 1, 0, 0), 'n3'),
    sug('s4', 'finer', jar(0, 1, 0, 0), 'n4', 'bean1', false), // 採用していない
    sug('s5', 'finer', jar(0, 1, 0, 0), null), // 次の杯がまだ
    sug('s6', 'coarser', jar(0, 0, 1, 0), 'n6'), // 別の直し方
  ];
  const tastings = [tast('n1', jar(0, 1, 0, 0)), tast('n2', jar(0, 0, 0, 0)), tast('n3', jar(0, 1, 0, 0)), tast('n4', jar(0, 0, 0, 0))];
  const h = actionHistory('finer', 'bean1', suggestions, tastings);
  assert.deepEqual({ scope: h.scope, total: h.total, improved: h.improved }, { scope: 'bean', total: 3, improved: 2 });
  assert.equal(h.text, 'この豆で挽き目を細かくした3回中2回で、次の杯の酸味が下がった');
  // この豆の実績がなければほかの豆も含める
  const other = actionHistory('finer', 'bean2', suggestions, tastings);
  assert.equal(other.scope, 'all');
  assert.match(other.text, /^ほかの豆も含めて/);
  // 次の杯の評価がなければ数えない
  assert.equal(actionHistory('coarser', 'bean1', suggestions, tastings).total, 0);
  assert.equal(actionHistory('keep', 'bean1', suggestions, tastings).text, '');
});

test('確信度：入力の確かさと実績で高い・ふつう・低い', () => {
  const both = { strength: 'ok', extraction: 'under', strengthFrom: 'jar', extractionFrom: 'jar' };
  const tag = { strength: null, extraction: 'under', strengthFrom: null, extractionFrom: 'tag' };
  const none = { total: 0, improved: 0 };
  assert.equal(confidenceOf(both, none, 'finer').level, 'mid');
  assert.equal(confidenceOf(both, { total: 3, improved: 3 }, 'finer').level, 'high');
  assert.equal(confidenceOf(both, { total: 3, improved: 1 }, 'finer').level, 'low');
  assert.equal(confidenceOf(both, { total: 1, improved: 1 }, 'finer').level, 'mid'); // 1回だけでは上げない
  assert.equal(confidenceOf(tag, none, 'finer').level, 'low');
  assert.equal(confidenceOf(tag, { total: 2, improved: 2 }, 'finer').level, 'mid');
  // 提案に実績が入る
  const s = suggestNext({
    tasting: { jar: jar(0, 1, 0, 0) },
    plan,
    beanId: 'bean1',
    suggestions: [sug('s1', 'finer', jar(0, 1, 0, 0), 'n1'), sug('s2', 'finer', jar(0, 2, 0, 0), 'n2')],
    tastings: [tast('n1', jar(0, 0, 0, 0)), tast('n2', jar(0, 1, 0, 0))],
  });
  assert.equal(s.reasons.confidence.level, 'high');
  assert.match(s.reasons.history, /2回中2回/);
});

test('提案ログの中身：採用と次の抽出はまだ空', () => {
  const brew = { id: 'b1', beanId: 'bean1', recipeId: 'r1' };
  const tasting = { id: 't1', jar: jar(0, 1, 0, 0), tags: ['酸っぱい'] };
  const s = suggestNext({ tasting, plan });
  const rec = buildSuggestion({ brew, tasting, suggestion: s });
  assert.equal(rec.kind, 'dialin');
  assert.equal(rec.brewId, 'b1');
  assert.equal(rec.tastingId, 't1');
  assert.equal(rec.beanId, 'bean1');
  assert.equal(rec.action.kind, 'finer');
  assert.equal(rec.confidence, s.reasons.confidence.level);
  assert.deepEqual(rec.jarBefore, tasting.jar);
  assert.notEqual(rec.jarBefore, tasting.jar); // 写し
  assert.equal(rec.adopted, null);
  assert.equal(rec.nextBrewId, null);
});

test('まだ使っていない提案：同じ豆で、計画を変えるもののうち最新', () => {
  const base = { deletedAt: null, nextBrewId: null, beanId: 'bean1' };
  const list = [
    { ...base, id: 'a', createdAt: '2026-11-17T00:00:00Z', action: { kind: 'finer', to: '23' } },
    { ...base, id: 'b', createdAt: '2026-11-18T00:00:00Z', action: { kind: 'water', to: 233 } },
    { ...base, id: 'c', createdAt: '2026-11-19T00:00:00Z', action: { kind: 'keep', to: null } },
    { ...base, id: 'd', createdAt: '2026-11-19T00:00:00Z', action: { kind: 'finer', to: null } }, // 目盛りが出ない
    { ...base, id: 'e', createdAt: '2026-11-20T00:00:00Z', action: { kind: 'finer', to: '22' }, nextBrewId: 'x' },
    { ...base, id: 'f', createdAt: '2026-11-20T00:00:00Z', action: { kind: 'finer', to: '22' }, deletedAt: '2026-11-20T00:00:00Z' },
  ];
  assert.equal(pickPendingSuggestion(list, 'bean1').id, 'b');
  assert.equal(pickPendingSuggestion(list, 'bean2'), null);
  assert.equal(pickPendingSuggestion(list, null), null);
});

test('まだ使っていない提案：同じ豆にもっと新しい杯があれば、古い杯の提案は出さない（2-8 の8番）', () => {
  const base = { deletedAt: null, nextBrewId: null, beanId: 'bean1' };
  const brews = [
    { id: 'A', beanId: 'bean1', at: '2026-11-17T07:00:00Z', deletedAt: null },
    { id: 'B', beanId: 'bean1', at: '2026-11-18T07:00:00Z', deletedAt: null },
  ];
  // B を先に評価し、あとから A を評価した（A の提案のほうが新しく作られた）
  const fromB = { ...base, id: 'sB', brewId: 'B', createdAt: '2026-11-18T08:00:00Z', action: { kind: 'finer', to: '17' } };
  const fromA = { ...base, id: 'sA', brewId: 'A', createdAt: '2026-11-18T09:00:00Z', action: { kind: 'coarser', to: '21' } };
  assert.equal(pickPendingSuggestion([fromB, fromA], 'bean1', brews).id, 'sB');
  assert.equal(pickPendingSuggestion([fromA], 'bean1', brews), null);
  // brews を渡さないときは今までどおり（いちばん新しく作った提案）
  assert.equal(pickPendingSuggestion([fromB, fromA], 'bean1').id, 'sA');
  // 新しい杯が削除済みなら、その前の杯の提案を使う
  const deletedB = brews.map((b) => (b.id === 'B' ? { ...b, deletedAt: '2026-11-18T10:00:00Z' } : b));
  assert.equal(pickPendingSuggestion([fromA], 'bean1', deletedB).id, 'sA');
});

test('その抽出の提案を選ぶ（削除済みは除く）', () => {
  const list = [
    { id: 'a', brewId: 'b1', deletedAt: null, updatedAt: '2026-11-18T00:00:00Z' },
    { id: 'b', brewId: 'b1', deletedAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z' },
    { id: 'c', brewId: 'b2', deletedAt: null, updatedAt: '2026-11-19T00:00:00Z' },
  ];
  assert.equal(pickSuggestionForBrew(list, 'b1').id, 'a');
  assert.equal(pickSuggestionForBrew(list, 'b3'), null);
});

test('抽出を保存したら、使った提案は採用、同じ豆の残りは不採用として次の抽出をつなぐ', () => {
  const base = { deletedAt: null, nextBrewId: null };
  const list = [
    { ...base, id: 's1', brewId: 'b1', beanId: 'bean1' },
    { ...base, id: 's2', brewId: 'b0', beanId: 'bean1' },
    { ...base, id: 's3', brewId: 'b9', beanId: 'bean2' }, // 別の豆の提案（この抽出で使った）
    { ...base, id: 's4', brewId: 'b8', beanId: 'bean3' }, // 関係ない
    { ...base, id: 's5', brewId: 'b7', beanId: 'bean1', nextBrewId: 'old' }, // もう使った
  ];
  assert.deepEqual(linkSuggestions(list, { id: 'b2', beanId: 'bean1', suggestionId: 's1' }), [
    { id: 's1', adopted: true, nextBrewId: 'b2' },
    { id: 's2', adopted: false, nextBrewId: 'b2' },
  ]);
  assert.deepEqual(linkSuggestions(list, { id: 'b2', beanId: 'bean1', suggestionId: 's3' }), [
    { id: 's1', adopted: false, nextBrewId: 'b2' },
    { id: 's2', adopted: false, nextBrewId: 'b2' },
    { id: 's3', adopted: true, nextBrewId: 'b2' },
  ]);
  // 豆を選ばずに提案なしで淹れたら何もつながない
  assert.deepEqual(linkSuggestions(list, { id: 'b2', beanId: null, suggestionId: null }), []);
});

test('代わりの案で淹れる：挽き目が数字でなく「細かく」を入れられないとき、湯温を2℃上げて淹れられる（2-8 の22番）', async () => {
  const { altBrewLink } = await import('../js/core/dialin.js');
  const s = { cell: { strength: 'ok', extraction: 'under' }, action: { kind: 'finer', to: null } };
  const brew = { id: 'b1', actual: { tempC: 92 } };
  assert.deepEqual(altBrewLink(s, brew), { label: '湯温を2℃上げて淹れる（92℃ → 94℃）', href: 'brew.html?brew=b1&temp=94&via=alt' });
  assert.equal(altBrewLink({ ...s, action: { kind: 'finer', to: '23' } }, brew), null); // 目盛りが数字なら提案どおりで淹れられる
  assert.equal(altBrewLink({ ...s, cell: { strength: 'ok', extraction: 'over' } }, brew), null);
  assert.equal(altBrewLink(s, { id: 'b1', actual: {} }), null);
});

test('2-8の39番：挽き目0で「細かく」でも「0 → -1」と出さない（計画も変えない）', () => {
  const a = makeAction('finer', { grind: { setting: '0' } }, 1);
  assert.equal(a.to ?? null, null);
  assert.doesNotMatch(a.text, /-1/);
  assert.match(a.text, /手で合わせて/);
  assert.equal(makeAction('finer', { grind: { setting: '1' } }, 1).to, '0');
  assert.equal(makeAction('coarser', { grind: { setting: '0' } }, 1).to, '1');
  const plan = { grind: { setting: '0' }, doseG: 15, waterG: 225 };
  assert.deepEqual(applyAction(plan, a).grind, plan.grind);
});
