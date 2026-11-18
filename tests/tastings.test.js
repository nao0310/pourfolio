// 味の評価の計算（B1・B2）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_TAGS,
  JAR_KEYS,
  emptyJar,
  allJustJar,
  emptyTastingInput,
  tastingInput,
  normalizeTastingInput,
  jarWord,
  jarAnsweredCount,
  buildTasting,
  pickTasting,
  pickUnratedBrew,
  tastingSummary,
  DETAIL_KEYS,
  LIKING_WORDS,
  detailAnsweredCount,
  STAGE_KEYS,
  stageLabel,
  normalizeStage,
  tastingsByStage,
  coolReadyMs,
} from '../js/core/tastings.js';

test('タグは7つ、ちょうど良さは渋みを含む6項目', () => {
  assert.deepEqual(QUICK_TAGS, ['酸っぱい', '苦い', '薄い', '濃い', '渋い', '甘い', '好き']);
  assert.deepEqual(JAR_KEYS, ['strength', 'acidity', 'bitterness', 'sweetness', 'body', 'astringency']);
  assert.deepEqual(Object.values(emptyJar()), [null, null, null, null, null, null]);
  assert.deepEqual(Object.values(allJustJar()), [0, 0, 0, 0, 0, 0]);
});

test('★だけでも保存できる。JARの押していない項目は null（ちょうどの0とは別）', () => {
  const { value, errors } = normalizeTastingInput({ ...emptyTastingInput(), stars: 4 });
  assert.deepEqual(errors, {});
  assert.equal(value.stars, 4);
  assert.equal(value.jar.acidity, null);
  assert.equal(jarAnsweredCount(value.jar), 0);
});

test('★は1〜5の整数、JARは−2〜+2の整数。文字の数字も読める', () => {
  const ok = normalizeTastingInput({ stars: '５', jar: { strength: '-2', acidity: 2, body: 0 } });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.stars, 5);
  assert.equal(ok.value.jar.strength, -2);
  assert.equal(ok.value.jar.acidity, 2);
  assert.equal(ok.value.jar.body, 0);

  for (const stars of [0, 6, 3.5, 'abc']) {
    assert.ok(normalizeTastingInput({ stars }).errors.stars, `★${stars}はエラー`);
  }
  for (const v of [3, -3, 1.5]) {
    assert.ok(normalizeTastingInput({ stars: 3, jar: { acidity: v } }).errors.jar, `JAR ${v}はエラー`);
  }
});

test('知らないタグ・項目は捨て、タグはいつも同じ並びにする', () => {
  const { value } = normalizeTastingInput({ tags: ['好き', '謎', '酸っぱい', '好き'], jar: { foo: 1, sweetness: -1 } });
  assert.deepEqual(value.tags, ['酸っぱい', '好き']);
  assert.equal('foo' in value.jar, false);
  assert.equal(value.jar.sweetness, -1);
});

test('何も入れていないと保存できない（メモだけならよい）', () => {
  assert.ok(normalizeTastingInput(emptyTastingInput()).errors.empty);
  assert.deepEqual(normalizeTastingInput({ ...emptyTastingInput(), memo: ' 冷めると甘い ' }).errors, {});
  assert.deepEqual(normalizeTastingInput(emptyTastingInput(), { allowEmpty: true }).errors, {});
});

test('保存した評価を入力の形に戻せる', () => {
  const saved = { id: 't1', brewId: 'b1', by: 'me', stage: 'warm', stars: 3, tags: ['苦い'], jar: { ...emptyJar(), bitterness: 1 }, memo: 'x' };
  // 2-3までの評価（詳細評価・香味がない）も読める。ない項目は未回答
  assert.deepEqual(tastingInput(saved), { ...emptyTastingInput(), stars: 3, tags: ['苦い'], jar: { ...emptyJar(), bitterness: 1 }, memo: 'x' });
  assert.deepEqual(tastingInput(null), emptyTastingInput());
});

test('評価の記録は自分・温かいうち。spec 9章の形', () => {
  const { value } = normalizeTastingInput({ stars: 4, tags: ['酸っぱい'], jar: { acidity: 1 }, memo: '' });
  const t = buildTasting({ brewId: 'b1', value });
  assert.deepEqual(Object.keys(t), ['brewId', 'by', 'stage', 'stars', 'tags', 'jar', 'intensity', 'liking', 'flavors', 'defects', 'memo']);
  assert.equal(t.by, 'me');
  assert.equal(t.stage, 'warm');
  assert.notEqual(t.jar, value.jar); // 写しを持つ
});

test('JARの呼び方', () => {
  assert.equal(jarWord('strength', -2), '薄すぎ');
  assert.equal(jarWord('strength', 2), '濃すぎ');
  assert.equal(jarWord('acidity', 1), 'やや強い');
  assert.equal(jarWord('body', -1), 'やや軽い');
  assert.equal(jarWord('acidity', 0), 'ちょうど');
  assert.equal(jarWord('acidity', null), '');
});

test('評価のまとめは、ずれた項目だけ書く', () => {
  assert.equal(
    tastingSummary({ stars: 4, tags: ['酸っぱい', '甘い'], jar: { ...allJustJar(), acidity: 1, sweetness: -1 } }),
    '★4　酸っぱい・甘い　酸味 やや強い・甘さ やや弱い',
  );
  assert.equal(tastingSummary({ stars: 5, tags: [], jar: allJustJar() }), '★5　ちょうど良い');
  assert.equal(tastingSummary({ stars: 2, tags: [], jar: emptyJar() }), '★2');
});

test('その抽出の評価を選ぶ：削除済み・別の抽出は除き、2件あれば新しいほう', () => {
  const ts = [
    { id: 'a', brewId: 'b1', by: 'me', stage: 'warm', updatedAt: '2026-11-18T01:00:00Z', deletedAt: null },
    { id: 'b', brewId: 'b1', by: 'me', stage: 'warm', updatedAt: '2026-11-18T02:00:00Z', deletedAt: null },
    { id: 'c', brewId: 'b1', by: 'me', stage: 'warm', updatedAt: '2026-11-18T03:00:00Z', deletedAt: '2026-11-18T03:00:00Z' },
    { id: 'd', brewId: 'b2', by: 'me', stage: 'warm', updatedAt: '2026-11-18T04:00:00Z', deletedAt: null },
  ];
  assert.equal(pickTasting(ts, 'b1').id, 'b');
  assert.equal(pickTasting(ts, 'b9'), null);
});

test('評価がまだの抽出：評価済み・24時間より前・削除済みは除き、いちばん新しいもの', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const brew = (id, at, deletedAt = null) => ({ id, at, deletedAt });
  const brews = [
    brew('old', '2026-11-17T11:00:00Z'), // 25時間前
    brew('rated', '2026-11-18T11:00:00Z'),
    brew('gone', '2026-11-18T11:30:00Z', '2026-11-18T11:40:00Z'),
    brew('a', '2026-11-18T08:00:00Z'),
    brew('b', '2026-11-18T10:00:00Z'),
  ];
  const tastings = [{ id: 't', brewId: 'rated', deletedAt: null }];
  assert.equal(pickUnratedBrew(brews, tastings, now).id, 'b');
  assert.equal(pickUnratedBrew([brews[0], brews[1]], tastings, now), null);
  // 評価を消したら、また評価がまだになる
  assert.equal(pickUnratedBrew([brews[1]], [{ ...tastings[0], deletedAt: '2026-11-18T11:50:00Z' }], now).id, 'rated');
});

test('詳細評価（B3）：強さ0〜15と好み1〜9を項目ごとに別々に持つ（完了の確認）', () => {
  const { value, errors } = normalizeTastingInput({ intensity: { acidity: 12, aroma: '０' }, liking: { acidity: 3, sweetness: 9 } });
  assert.deepEqual(errors, {});
  assert.equal(value.intensity.acidity, 12); // 酸味は強い
  assert.equal(value.liking.acidity, 3); // けれど好みではない
  assert.equal(value.intensity.aroma, 0); // 0（感じない）と未回答（null）は別
  assert.equal(value.intensity.sweetness, null);
  assert.equal(value.liking.sweetness, 9);
  assert.deepEqual(DETAIL_KEYS, ['fragrance', 'aroma', 'flavor', 'aftertaste', 'acidity', 'sweetness', 'mouthfeel']);
  assert.equal(detailAnsweredCount(value), 3);
  assert.equal(LIKING_WORDS[4], 'どちらでもない');

  for (const bad of [{ intensity: { acidity: 16 } }, { intensity: { acidity: -1 } }, { liking: { acidity: 0 } }, { liking: { acidity: 10 } }, { liking: { flavor: 4.5 } }]) {
    assert.ok(normalizeTastingInput({ stars: 3, ...bad }).errors.detail, JSON.stringify(bad));
  }
  const t = buildTasting({ brewId: 'b1', value });
  assert.equal(t.intensity.acidity, 12);
  assert.equal(t.liking.acidity, 3);
  assert.notEqual(t.intensity, value.intensity);
});

test('香味と雑味（B4）：詳細評価・香味・雑味のどれかだけでも保存でき、まとめに出る', () => {
  assert.deepEqual(normalizeTastingInput({ liking: { flavor: 7 } }).errors, {});
  assert.deepEqual(normalizeTastingInput({ flavors: ['fruity/citrus'] }).errors, {});
  assert.deepEqual(normalizeTastingInput({ defects: ['えぐい'] }).errors, {});
  const { value } = normalizeTastingInput({ stars: 4, flavors: ['floral/jasmine', 'nope', 'fruity/citrus'], defects: ['紙っぽい', '謎'] });
  assert.deepEqual(value.flavors, ['floral/jasmine', 'fruity/citrus']);
  assert.deepEqual(value.defects, ['紙っぽい']);
  assert.equal(tastingSummary(value), '★4　ジャスミン・柑橘　雑味 紙っぽい');
});

test('温度帯（B5）：熱いうち・温かいうち・冷めてから。知らない値は温かいうち', () => {
  assert.deepEqual(STAGE_KEYS, ['hot', 'warm', 'cool']);
  assert.equal(stageLabel('cool'), '冷めてから');
  assert.equal(normalizeStage('lukewarm'), 'warm');
  assert.equal(buildTasting({ brewId: 'b1', value: normalizeTastingInput({ stars: 3 }).value, stage: 'cool' }).stage, 'cool');
  assert.equal(buildTasting({ brewId: 'b1', value: normalizeTastingInput({ stars: 3 }).value, stage: '?' }).stage, 'warm');

  const ts = [
    { id: 'w', brewId: 'b1', stage: 'warm', stars: 4, updatedAt: '1' },
    { id: 'c', brewId: 'b1', stage: 'cool', stars: 5, updatedAt: '1' },
    { id: 'old', brewId: 'b1', stars: 2, updatedAt: '0' }, // 2-3までの記録（stage なし）は温かいうち
  ];
  assert.equal(pickTasting(ts, 'b1').id, 'w');
  assert.equal(pickTasting(ts, 'b1', 'cool').id, 'c');
  assert.deepEqual(Object.fromEntries(Object.entries(tastingsByStage(ts, 'b1')).map(([k, v]) => [k, v?.id ?? null])), { hot: null, warm: 'w', cool: 'c' });
  assert.equal(coolReadyMs({ at: '2026-11-18T00:00:00Z', actual: { totalSec: 200 } }), Date.parse('2026-11-18T00:18:20Z'));
  assert.equal(coolReadyMs({ at: 'x' }), null);
});
