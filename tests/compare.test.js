// 焙煎度比較モード（X27）の計算とデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  candidateGroups,
  normalizeCompareInput,
  buildExperiment,
  experimentStatus,
  attachBrew,
  setRating,
  ratingOf,
  allRated,
  reveal,
  tastingsToSave,
  compareResults,
  roastPreferences,
  preferenceForBean,
  preferenceText,
  openExperiments,
  sortByRoast,
} from '../js/core/compare.js';
import {
  openDb,
  saveBrew,
  addExperiment,
  getExperiment,
  attachBrewToExperiment,
  updateExperiment,
  finishExperiment,
  getTastingForBrew,
  saveTasting,
  getUnratedBrew,
  readAll,
  exportAll,
  clearAll,
  restoreBackup,
} from '../js/db.js';
import { normalizeTastingInput } from '../js/core/tastings.js';
import { parseBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });

const bean = (id, name, roastLevel, extra = {}) => ({
  id,
  name,
  roastLevel,
  roastDate: '2026-11-10',
  status: 'open',
  origin: { country: 'エチオピア' },
  deletedAt: null,
  ...extra,
});
const beans = [
  bean('m', 'エチオピア イルガチェフェ', 'ミディアム'),
  bean('h', 'エチオピア　イルガチェフェ', 'ハイ'), // 全角の空白でも同じ銘柄
  bean('c', 'エチオピア イルガチェフェ', 'シティ'),
  bean('fc', 'エチオピア イルガチェフェ', 'フルシティ'),
  bean('old', 'エチオピア イルガチェフェ', 'シティ', { roastDate: '2026-10-01' }), // 同じ焙煎度の古い袋
  bean('k', 'ケニア', 'シティ', { origin: { country: 'ケニア' } }),
  bean('gone', 'ケニア', 'ハイ', { status: 'finished', origin: { country: 'ケニア' } }),
];

test('候補：同じ銘柄で焙煎度が2つ以上ある組。浅い順。飲み切り・同じ焙煎度の古い袋は除く', () => {
  const groups = candidateGroups(beans);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].beans.map((b) => b.id),
    ['m', 'h', 'c', 'fc'],
  );
  assert.deepEqual(sortByRoast([beans[3], beans[0]]).map((b) => b.id), ['m', 'fc']);
});

test('始める：2〜4袋とレシピが要る。ブラインドが初期値。袋は浅い順に並べる', () => {
  assert.ok(normalizeCompareInput({ beanIds: ['m'], recipeId: 'r1' }, beans).errors.beanIds);
  assert.ok(normalizeCompareInput({ beanIds: ['m', 'h', 'c', 'fc', 'k'], recipeId: 'r1' }, beans).errors.beanIds);
  assert.ok(normalizeCompareInput({ beanIds: ['m', 'h'] }, beans).errors.recipeId);
  assert.ok(normalizeCompareInput({ beanIds: ['m', 'gone'], recipeId: 'r1' }, beans).errors.beanIds); // 飲み切りは選べない
  const { value, errors } = normalizeCompareInput({ beanIds: ['c', 'm', 'm'], recipeId: 'r1' }, beans);
  assert.deepEqual(errors, {});
  assert.equal(value.blind, true);
  const exp = buildExperiment({ value, beans });
  assert.equal(exp.title, 'エチオピア イルガチェフェ 焙煎度比較');
  assert.deepEqual(exp.entries, [
    { beanId: 'm', brewId: null },
    { beanId: 'c', brewId: null },
  ]);
  assert.equal(experimentStatus(exp), 'brewing');
});

test('淹れた抽出をつなぐ：抽出の豆の袋に。違う豆で記録したら淹れようとした袋に', () => {
  const exp = { entries: [{ beanId: 'm', brewId: null }, { beanId: 'c', brewId: null }] };
  let entries = attachBrew(exp, { brewId: 'b1', beanId: 'm' });
  assert.deepEqual(entries[0], { beanId: 'm', brewId: 'b1' });
  entries = attachBrew({ entries }, { brewId: 'b2', beanId: 'zzz', targetBeanId: 'c' });
  assert.equal(entries[1].brewId, 'b2');
  assert.equal(experimentStatus({ entries }), 'tasting');
  assert.deepEqual(attachBrew({ entries }, { brewId: 'b3', beanId: 'x' }), entries); // 当たらなければ変えない
});

test('ブラインド：番号で評価し、答え合わせで袋が決まる。同じ袋を2回選べない', () => {
  let exp = { blind: true, entries: [{ beanId: 'm', brewId: 'b1' }, { beanId: 'h', brewId: 'b2' }, { beanId: 'c', brewId: 'b3' }], ratings: [] };
  exp = { ...exp, ratings: setRating(exp, 2, { stars: 5, tags: ['甘い', '謎'], memo: ' 好き ' }) };
  exp = { ...exp, ratings: setRating(exp, 1, { stars: 3 }) };
  assert.deepEqual(ratingOf(exp, 2), { stars: 5, tags: ['甘い'], memo: '好き' });
  assert.equal(allRated(exp), false);
  assert.ok(reveal(exp, { 1: 'c', 2: 'm', 3: 'h' }).errors.ratings);
  exp = { ...exp, ratings: setRating(exp, 3, { stars: 4 }) };
  assert.equal(allRated(exp), true);
  assert.ok(reveal(exp, { 1: 'c', 2: 'c', 3: 'h' }).errors.answers);
  assert.ok(reveal(exp, { 1: 'c', 2: 'm' }).errors.answers);
  const { ratings, errors } = reveal(exp, { 1: 'c', 2: 'm', 3: 'h' });
  assert.deepEqual(errors, {});
  assert.deepEqual(
    ratings.map((r) => [r.cupNo, r.beanId, r.stars]),
    [
      [1, 'c', 3],
      [2, 'm', 5],
      [3, 'h', 4],
    ],
  );
  const done = { ...exp, ratings, revealedAt: 'x' };
  assert.deepEqual(
    tastingsToSave(done).map((t) => [t.brewId, t.value.stars]),
    [
      ['b3', 3],
      ['b1', 5],
      ['b2', 4],
    ],
  );
  const rows = compareResults(done, beans);
  assert.deepEqual(
    rows.map((r) => [r.roastLevel, r.stars, r.rank, r.cupNo]),
    [
      ['ミディアム', 5, 1, 2],
      ['ハイ', 4, 2, 3],
      ['シティ', 3, 3, 1],
    ],
  );
});

test('ブラインドにしないときは袋ごとに評価する。同じ★は同じ順位', () => {
  let exp = { blind: false, entries: [{ beanId: 'm', brewId: 'b1' }, { beanId: 'c', brewId: 'b2' }], ratings: [] };
  exp = { ...exp, ratings: setRating(exp, 'c', { stars: 4 }) };
  exp = { ...exp, ratings: setRating(exp, 'm', { stars: 4 }) };
  assert.deepEqual(
    exp.ratings.map((r) => [r.cupNo, r.beanId]),
    [
      [1, 'm'],
      [2, 'c'],
    ],
  );
  assert.equal(allRated(exp), true);
  const rows = compareResults({ ...exp, revealedAt: 'x' }, beans);
  assert.deepEqual(
    rows.map((r) => [r.beanId, r.rank, r.cupNo]),
    [
      ['m', 1, null],
      ['c', 1, null],
    ],
  );
});

test('産地ごとの好きな焙煎度：結果の出た飲み比べから、★の平均がいちばん高い焙煎度', () => {
  const done = (id, ratings, extra = {}) => ({
    id,
    kind: 'roast',
    blind: true,
    deletedAt: null,
    revealedAt: 'x',
    entries: ratings.map(([beanId]) => ({ beanId, brewId: `br-${id}-${beanId}` })),
    ratings: ratings.map(([beanId, stars], i) => ({ cupNo: i + 1, beanId, stars, tags: [], memo: '' })),
    ...extra,
  });
  const exps = [
    done('e1', [
      ['m', 3],
      ['h', 5],
      ['c', 4],
    ]),
    done('e2', [
      ['h', 4],
      ['c', 4],
    ]),
    done('e3', [['k', 2]], { revealedAt: null }), // 途中は数えない
    done('e4', [['m', 5]], { deletedAt: 'x' }), // やめた飲み比べは数えない
  ];
  const prefs = roastPreferences(exps, beans);
  assert.equal(prefs.length, 1);
  const p = prefs[0];
  assert.equal(p.label, 'エチオピア');
  assert.equal(p.experiments, 2);
  assert.deepEqual(
    p.levels.map((l) => [l.level, l.n, l.avgStars, l.wins]),
    [
      ['ミディアム', 1, 3, 0],
      ['ハイ', 2, 4.5, 2],
      ['シティ', 2, 4, 1],
    ],
  );
  assert.equal(p.best, 'ハイ');
  assert.equal(preferenceText(p), 'エチオピアはハイが好き（飲み比べ2回）');
  assert.equal(preferenceForBean(prefs, beans[3]).best, 'ハイ');
  assert.equal(preferenceForBean(prefs, beans[5]), null);
  assert.deepEqual(
    openExperiments(exps).map((e) => e.id),
    ['e3'],
  );
});

test('通し：始める→淹れた抽出をつなぐ→ブラインドで評価→答え合わせで抽出の評価になる', async () => {
  const db = freshDb();
  const { value } = normalizeCompareInput({ beanIds: ['m', 'c'], recipeId: 'r1' }, beans);
  const exp = await addExperiment(db, buildExperiment({ value, beans }), NOW);
  const { brew: b1 } = await saveBrew(db, { at: later(1).toISOString(), beanId: null, experimentId: exp.id, planned: {}, actual: { doseG: 10, waterG: 160, totalSec: 150 } }, later(1));
  const { brew: b2 } = await saveBrew(db, { at: later(5).toISOString(), beanId: null, experimentId: exp.id, planned: {}, actual: { doseG: 10, waterG: 160, totalSec: 150 } }, later(5));
  await attachBrewToExperiment(db, exp.id, { brewId: b1.id, beanId: null, targetBeanId: 'm' }, later(2));
  await attachBrewToExperiment(db, exp.id, { brewId: b2.id, beanId: null, targetBeanId: 'c' }, later(6));
  let cur = await getExperiment(db, exp.id);
  assert.equal(experimentStatus(cur), 'tasting');
  // 飲み比べの杯は「まだ評価していない1杯」に出さない（ブラインドを崩さない）
  assert.equal(await getUnratedBrew(db, later(7)), null);

  // b1 には評価の画面で入れた詳細評価がある（★は飲み比べのほうにする）
  await saveTasting(db, b1.id, normalizeTastingInput({ stars: 2, liking: { acidity: 7 } }).value, later(7));
  cur = await updateExperiment(db, exp.id, { ratings: setRating(cur, 1, { stars: 4, tags: ['甘い'] }) }, later(8));
  cur = await updateExperiment(db, exp.id, { ratings: setRating(cur, 2, { stars: 2 }) }, later(9));
  const { ratings } = reveal(cur, { 1: 'c', 2: 'm' });
  const done = await finishExperiment(db, exp.id, ratings, later(10));
  assert.equal(experimentStatus(done), 'done');
  const t2 = await getTastingForBrew(db, b2.id);
  assert.equal(t2.stars, 4);
  assert.deepEqual(t2.tags, ['甘い']);
  assert.equal(t2.blind, true);
  assert.equal(t2.experimentId, exp.id);
  const t1 = await getTastingForBrew(db, b1.id);
  assert.equal(t1.stars, 2);
  assert.equal(t1.liking.acidity, 7); // 先に入れた詳細評価は残す
  assert.equal((await readAll(db)).tastings.length, 2);
  // 評価の画面で直しても、ブラインドだったことは残る
  await saveTasting(db, b2.id, normalizeTastingInput({ stars: 5 }).value, later(11));
  assert.equal((await getTastingForBrew(db, b2.id)).blind, true);

  // 2-8の50番：結果を出したあとは、古い画面から淹れ直してもつながない（結果の杯を置き換えない）
  const { brew: b3 } = await saveBrew(db, { at: later(13).toISOString(), beanId: null, planned: {}, actual: { doseG: 10, waterG: 160, totalSec: 150 } }, later(13));
  assert.equal(await attachBrewToExperiment(db, exp.id, { brewId: b3.id, beanId: null, targetBeanId: 'm' }, later(14)), null);
  assert.deepEqual((await getExperiment(db, exp.id)).entries.map((e) => e.brewId), [b1.id, b2.id]);

  const backup = parseBackup(JSON.stringify(await exportAll(db, later(12))));
  await clearAll(db);
  await restoreBackup(db, backup);
  assert.equal(experimentStatus(await getExperiment(db, exp.id)), 'done');
});
