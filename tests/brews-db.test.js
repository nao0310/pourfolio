// 抽出の保存（A4）とデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  openDb,
  addBean,
  getBeanWithTx,
  addRecipe,
  getRecipe,
  saveBrew,
  getBrew,
  getLastBrew,
  deleteBean,
  deleteInventoryTx,
  exportAll,
  clearAll,
  restoreBackup,
} from '../js/db.js';
import { normalizeBeanInput } from '../js/core/beans.js';
import { remainingG } from '../js/core/inventory.js';
import { normalizeRecipeInput, newRecipeState, planFromRecipe, planFromBrew } from '../js/core/recipes.js';
import { newDraft, finishDraft, initialActualInput, normalizeActualInput, buildBrew } from '../js/core/brews.js';
import { parseBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const beanInput = () => normalizeBeanInput({ name: 'エチオピア', labelWeightG: '200', labelWeightBasis: 'green', roastLevel: 'シティ' }).value;
const recipeInput = () => normalizeRecipeInput({ ...newRecipeState(), name: '朝の4:6', grindSetting: '24' }).value;

/** レシピからタイマーで淹れて、実績の入力を変えて保存する形を作る */
function brewFields(recipe, beanId, changes = {}, at = later(5)) {
  const start = later(1).getTime();
  const draft = finishDraft({ ...newDraft(planFromRecipe(recipe), beanId, start), laps: [9, 50, 94, 139, 183] }, start + 215_000);
  const { value, errors } = normalizeActualInput({ ...initialActualInput(draft), ...changes });
  assert.deepEqual(errors, {});
  return buildBrew({ draft, value, at: at.toISOString() });
}

test('完了の確認：抽出を保存すると、実際の粉量だけ豆の残量が減り、履歴に抽出とのつながりが付く', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  assert.equal(bean.status, 'unopened');
  const recipe = await addRecipe(db, recipeInput(), NOW);

  const { brew, tx } = await saveBrew(db, brewFields(recipe, bean.id, { doseG: '20.4' }), later(5));
  assert.ok(brew.id);
  assert.equal(brew.createdAt, later(5).toISOString());
  assert.equal(tx.brewId, brew.id);
  assert.equal(tx.kind, 'brew');
  assert.equal(tx.deltaG, -20.4);

  const { bean: after, txs } = await getBeanWithTx(db, bean.id);
  assert.equal(remainingG(txs), 164 - 20.4);
  assert.equal(after.status, 'open');
  assert.equal((await getBrew(db, brew.id)).actual.doseG, 20.4);
});

test('豆を選ばずに保存しても抽出は残り、在庫は変わらない', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  const recipe = await addRecipe(db, recipeInput(), NOW);
  const { brew, tx } = await saveBrew(db, brewFields(recipe, null), later(5));
  assert.equal(tx, null);
  assert.equal(brew.beanId, null);
  const { txs } = await getBeanWithTx(db, bean.id);
  assert.equal(remainingG(txs), 164);
});

test('削除した豆を選んでいたら、在庫の履歴は作らない', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  const recipe = await addRecipe(db, recipeInput(), NOW);
  await deleteBean(db, bean.id, later(2));
  const { tx } = await saveBrew(db, brewFields(recipe, bean.id), later(5));
  assert.equal(tx, null);
});

test('「前回と同じで淹れる」は、保存した抽出の計画（実績ではない）と豆を写す', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  const recipe = await addRecipe(db, recipeInput(), NOW);
  await saveBrew(db, brewFields(recipe, bean.id, { doseG: '22', waterG: '320', grindSetting: '26' }, later(5)), later(5));
  const last = await getLastBrew(db);
  const plan = planFromBrew(last, await getRecipe(db, last.recipeId));
  assert.equal(plan.doseG, 20);
  assert.equal(plan.waterG, 300);
  assert.equal(plan.grind.setting, '24');
  assert.equal(plan.beanId, bean.id);
  assert.equal(last.derived.diff.doseG, 2);
});

test('書き出し→全削除→復元で、抽出と在庫の履歴が戻り、残量も同じ', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  const recipe = await addRecipe(db, recipeInput(), NOW);
  const { brew } = await saveBrew(db, brewFields(recipe, bean.id), later(5));
  const before = remainingG((await getBeanWithTx(db, bean.id)).txs);

  const backup = parseBackup(JSON.stringify(await exportAll(db, later(6))));
  await clearAll(db);
  assert.equal(await getBrew(db, brew.id), null);
  await restoreBackup(db, backup);

  assert.deepEqual(await getBrew(db, brew.id), brew);
  assert.equal(remainingG((await getBeanWithTx(db, bean.id)).txs), before);
});

test('抽出の記録とつながった「抽出」の在庫の行は取り消せない（総仕上げの57番）', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  const recipe = await addRecipe(db, recipeInput(), NOW);
  const { tx } = await saveBrew(db, brewFields(recipe, bean.id), later(5));
  const before = remainingG((await getBeanWithTx(db, bean.id)).txs);
  await assert.rejects(deleteInventoryTx(db, tx.id, later(6)), /抽出の記録とつながっているため取り消せません/);
  assert.equal(remainingG((await getBeanWithTx(db, bean.id)).txs), before);
  db.close();
});
