// ダイヤルイン提案（F1）の提案ログとデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from '../vendor/dexie/dexie.mjs';
import {
  openDb,
  saveBrew,
  saveTasting,
  saveSuggestionForBrew,
  getSuggestionForBrew,
  getSuggestion,
  listSuggestions,
  addEquipment,
  exportAll,
  clearAll,
  restoreBackup,
  readAll,
} from '../js/db.js';
import { normalizeTastingInput } from '../js/core/tastings.js';
import { parseBackup } from '../js/core/backup.js';
import { TABLES } from '../js/core/records.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const input = (x) => {
  const { value, errors } = normalizeTastingInput(x);
  assert.deepEqual(errors, {});
  return value;
};
const brewFields = (p = {}) => ({
  at: (p.at ?? NOW).toISOString(),
  beanId: p.beanId ?? 'bean1',
  recipeId: null,
  suggestionId: p.suggestionId ?? null,
  planned: { name: 'テスト', doseG: 15, waterG: 225, grind: { grinderId: p.grinderId ?? null, setting: '24' }, pours: [{ atSec: 0, toG: 225 }] },
  actual: { doseG: 15, waterG: 225, grind: { grinderId: p.grinderId ?? null, setting: p.grind ?? '24' }, totalSec: 210 },
});

test('移行：版1のデータベースを開き直すと、記録はそのままで提案の表が増える', async () => {
  const indexedDB = new IDBFactory();
  // 1-5までのアプリが作った版1のデータベース
  const v1 = new Dexie('pourfolio-test', { indexedDB, IDBKeyRange });
  v1.version(1).stores({
    beans: 'id, updatedAt, roastDate',
    inventoryTx: 'id, beanId, brewId, at, updatedAt',
    equipment: 'id, kind, updatedAt',
    recipes: 'id, parentId, updatedAt',
    brews: 'id, at, beanId, recipeId, updatedAt',
    tastings: 'id, brewId, updatedAt',
    settings: 'id',
  });
  const bean = { id: 'bean1', name: 'エチオピア', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), deletedAt: null };
  const brew = { id: 'brew1', beanId: 'bean1', at: NOW.toISOString(), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), deletedAt: null };
  await v1.table('beans').put(bean);
  await v1.table('brews').put(brew);
  await v1.table('tastings').put({ id: 't1', brewId: 'brew1', by: 'me', stage: 'warm', jar: { acidity: 1 }, tags: [], updatedAt: NOW.toISOString(), deletedAt: null });
  v1.close();

  const db = openDb('pourfolio-test', { indexedDB, IDBKeyRange });
  await db.open();
  assert.equal(db.verno, 5, '今の版まで上がる');
  const all = await readAll(db);
  assert.deepEqual(all.beans, [bean]);
  assert.deepEqual(all.brews, [brew]);
  assert.equal(all.tastings.length, 1);
  assert.deepEqual(all.suggestions, []);
  // 移行したあと、古い抽出の評価から提案を作れる
  const s = await saveSuggestionForBrew(db, 'brew1', later(1));
  assert.equal(s.action.kind, 'finer');
  db.close();
});

test('評価から提案を作って保存する：グラインダーの1目盛りを使う', async () => {
  const db = freshDb();
  const grinder = await addEquipment(db, { kind: 'grinder', name: 'ミル', attrs: { step: 0.5 } }, NOW);
  const { brew } = await saveBrew(db, brewFields({ grinderId: grinder.id }), NOW);
  await saveTasting(db, brew.id, input({ jar: { strength: 0, acidity: 1, bitterness: 0, astringency: 0 } }), later(1));
  const s = await saveSuggestionForBrew(db, brew.id, later(1));
  assert.equal(s.brewId, brew.id);
  assert.equal(s.beanId, 'bean1');
  assert.equal(s.action.kind, 'finer');
  assert.equal(s.action.to, '23.5');
  assert.equal(s.confidence, 'mid');
  assert.equal(s.adopted, null);
  assert.deepEqual(await getSuggestionForBrew(db, brew.id), s);
  assert.deepEqual(await getSuggestion(db, s.id), s);
});

test('評価を直したら提案も作り直し、1杯につき1件のまま', async () => {
  const db = freshDb();
  const { brew } = await saveBrew(db, brewFields(), NOW);
  await saveTasting(db, brew.id, input({ jar: { strength: 1 } }), later(1));
  const first = await saveSuggestionForBrew(db, brew.id, later(1));
  assert.equal(first.action.kind, 'water');
  await saveTasting(db, brew.id, input({ jar: { strength: -1 } }), later(5));
  const second = await saveSuggestionForBrew(db, brew.id, later(5));
  assert.equal(second.id, first.id);
  assert.equal(second.action.kind, 'dose');
  assert.equal((await listSuggestions(db)).length, 1);
  // 判断する材料がなくなったら、まだ使っていない提案は消す
  await saveTasting(db, brew.id, input({ stars: 4 }), later(9));
  assert.equal(await saveSuggestionForBrew(db, brew.id, later(9)), null);
  assert.equal(await getSuggestionForBrew(db, brew.id), null);
});

test('提案で淹れて保存すると採用、提案を使わず同じ豆で淹れると不採用として次の抽出がつながる', async () => {
  const db = freshDb();
  const { brew: b1 } = await saveBrew(db, brewFields(), NOW);
  await saveTasting(db, b1.id, input({ jar: { strength: 0, acidity: 2, bitterness: 0 } }), later(1));
  const s1 = await saveSuggestionForBrew(db, b1.id, later(1));

  // 提案を入れた計画で淹れる（挽き目 24 → 23）
  const { brew: b2 } = await saveBrew(db, brewFields({ at: later(60), suggestionId: s1.id, grind: '23' }), later(65));
  const used = await getSuggestion(db, s1.id);
  assert.equal(used.adopted, true);
  assert.equal(used.nextBrewId, b2.id);

  // 次の杯で酸味がちょうどに近づいた → 次の提案に実績が出る
  await saveTasting(db, b2.id, input({ jar: { strength: 0, acidity: 1, bitterness: 0 } }), later(66));
  const s2 = await saveSuggestionForBrew(db, b2.id, later(66));
  assert.equal(s2.action.kind, 'finer');
  assert.equal(s2.action.from, '23'); // 実際に挽いた目盛りから
  assert.equal(s2.action.to, '22');
  assert.equal(s2.reasons.history, 'この豆で挽き目を細かくした1回中1回で、次の杯の酸味が下がった');

  // 使った提案は、元の評価を直しても作り直さない（結果の記録だから）
  await saveTasting(db, b1.id, input({ jar: { strength: 2 } }), later(70));
  assert.equal((await saveSuggestionForBrew(db, b1.id, later(70))).action.kind, 'finer');

  // 提案を使わずに同じ豆で淹れた → 不採用
  const { brew: b3 } = await saveBrew(db, brewFields({ at: later(120) }), later(125));
  const skipped = await getSuggestion(db, s2.id);
  assert.equal(skipped.adopted, false);
  assert.equal(skipped.nextBrewId, b3.id);
});

test('書き出し→全削除→復元で、提案ログが戻る', async () => {
  const db = freshDb();
  const { brew } = await saveBrew(db, brewFields(), NOW);
  await saveTasting(db, brew.id, input({ tags: ['薄い'] }), later(1));
  const s = await saveSuggestionForBrew(db, brew.id, later(1));
  const file = JSON.parse(JSON.stringify(await exportAll(db, later(2))));
  assert.ok(TABLES.includes('suggestions'));
  assert.equal(file.tables.suggestions.length, 1);
  await clearAll(db);
  assert.equal(await getSuggestionForBrew(db, brew.id), null);
  await restoreBackup(db, parseBackup(file));
  assert.deepEqual(await getSuggestionForBrew(db, brew.id), s);
});

test('1-5までに書き出したファイル（提案の表なし）も復元できる', async () => {
  const db = freshDb();
  const { brew } = await saveBrew(db, brewFields(), NOW);
  const file = JSON.parse(JSON.stringify(await exportAll(db, later(1))));
  delete file.tables.suggestions;
  await clearAll(db);
  const result = await restoreBackup(db, parseBackup(file));
  assert.equal(result.brews.added, 1);
  assert.equal(result.suggestions.added, 0);
  assert.equal((await readAll(db)).brews[0].id, brew.id);
});
