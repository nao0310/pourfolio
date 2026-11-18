// 味の評価の保存（B1・B2）とデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openDb, saveBrew, saveTasting, getTastingForBrew, getUnratedBrew, exportAll, clearAll, restoreBackup, readAll } from '../js/db.js';
import { normalizeTastingInput } from '../js/core/tastings.js';
import { parseBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const brewFields = (at = NOW) => ({ at: at.toISOString(), beanId: null, recipeId: null, planned: {}, actual: { doseG: 15, waterG: 225, totalSec: 210 } });
const input = (x) => {
  const { value, errors } = normalizeTastingInput(x);
  assert.deepEqual(errors, {});
  return value;
};

test('完了の確認：抽出を保存してから評価を保存すると、抽出とつながる', async () => {
  const db = freshDb();
  const { brew } = await saveBrew(db, brewFields(), NOW);
  const t = await saveTasting(db, brew.id, input({ stars: 4, tags: ['酸っぱい'], jar: { strength: 0, acidity: 1 } }), later(1));
  assert.equal(t.brewId, brew.id);
  assert.equal(t.createdAt, later(1).toISOString());
  assert.equal(t.deletedAt, null);
  const got = await getTastingForBrew(db, brew.id);
  assert.equal(got.stars, 4);
  assert.equal(got.jar.acidity, 1);
  assert.equal(got.jar.sweetness, null);
});

test('2回保存しても1件のまま直る', async () => {
  const db = freshDb();
  const { brew } = await saveBrew(db, brewFields(), NOW);
  const first = await saveTasting(db, brew.id, input({ stars: 3 }), later(1));
  const second = await saveTasting(db, brew.id, input({ stars: 5, tags: ['好き'] }), later(10));
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.updatedAt, later(10).toISOString());
  const all = (await readAll(db)).tastings;
  assert.equal(all.length, 1);
  assert.equal(all[0].stars, 5);
});

test('ない抽出には評価を保存できない', async () => {
  const db = freshDb();
  await assert.rejects(saveTasting(db, 'nope', input({ stars: 3 }), NOW));
});

test('評価がまだの抽出：評価すると出なくなる', async () => {
  const db = freshDb();
  assert.equal(await getUnratedBrew(db, NOW), null);
  const { brew } = await saveBrew(db, brewFields(), NOW);
  assert.equal((await getUnratedBrew(db, later(5))).id, brew.id);
  assert.equal(await getUnratedBrew(db, later(25 * 60)), null); // 24時間を過ぎたら出さない
  await saveTasting(db, brew.id, input({ stars: 4 }), later(6));
  assert.equal(await getUnratedBrew(db, later(7)), null);
});

test('書き出し→全削除→復元で、評価が戻る', async () => {
  const db = freshDb();
  const { brew } = await saveBrew(db, brewFields(), NOW);
  const t = await saveTasting(db, brew.id, input({ stars: 4, tags: ['甘い'], jar: { sweetness: 0 }, memo: '冷めると甘い' }), later(1));
  const file = JSON.parse(JSON.stringify(await exportAll(db, later(2))));
  await clearAll(db);
  assert.equal(await getTastingForBrew(db, brew.id), null);
  await restoreBackup(db, parseBackup(file));
  assert.deepEqual(await getTastingForBrew(db, brew.id), t);
});
