// 器具とレシピのデータベースの出し入れ（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  openDb,
  addEquipment,
  updateEquipment,
  deleteEquipment,
  listEquipment,
  getEquipment,
  addRecipe,
  updateRecipe,
  setRecipeFavorite,
  deleteRecipe,
  listRecipes,
  getRecipe,
  getLastBrew,
  putAll,
  exportAll,
  clearAll,
  restoreBackup,
} from '../js/db.js';
import { normalizeEquipmentInput, defaultEquipmentIds } from '../js/core/equipment.js';
import { normalizeRecipeInput, newRecipeState, planFromRecipe, planFromBrew } from '../js/core/recipes.js';
import { parseBackup } from '../js/core/backup.js';
import { makeSampleData } from '../js/core/sample-data.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const eqInput = (raw) => normalizeEquipmentInput(raw).value;
const recipeInput = (extra = {}) => normalizeRecipeInput({ ...newRecipeState(), name: '朝の4:6', ...extra }).value;

test('器具：最初の1つは自動で「いつも使う」。別のを「いつも使う」にすると前のは外れる', async () => {
  const db = freshDb();
  const a = await addEquipment(db, eqInput({ kind: 'dripper', name: 'V60' }), NOW);
  assert.equal(a.isDefault, true);
  const b = await addEquipment(db, eqInput({ kind: 'dripper', name: 'ウェーブ' }), later(1));
  assert.equal(b.isDefault, false);
  await updateEquipment(db, b.id, { isDefault: true }, later(2));
  const list = await listEquipment(db);
  assert.deepEqual(
    list.filter((e) => e.isDefault).map((e) => e.name),
    ['ウェーブ'],
  );
  assert.equal(defaultEquipmentIds(list).dripperId, b.id);

  // 別の種類の「いつも使う」には影響しない
  const g = await addEquipment(db, eqInput({ kind: 'grinder', name: 'C40', isDefault: 'on' }), later(3));
  assert.equal((await getEquipment(db, b.id)).isDefault, true);
  assert.equal(g.isDefault, true);

  await deleteEquipment(db, a.id, later(4));
  assert.equal(await getEquipment(db, a.id), null);
  assert.equal((await listEquipment(db)).length, 2);
});

test('レシピ：作ると版1、直すと版が上がる。お気に入りでは版は変わらない', async () => {
  const db = freshDb();
  const r = await addRecipe(db, recipeInput(), NOW);
  assert.equal(r.version, 1);
  assert.equal(r.parentId, null);
  const planBefore = planFromRecipe(r);

  const edited = await updateRecipe(db, r.id, recipeInput({ doseG: 15, waterG: 225, pours: [{ atSec: 0, toG: 45 }, { atSec: 45, toG: 225 }] }), later(1));
  assert.equal(edited.version, 2);
  assert.equal(edited.createdAt, r.createdAt);
  assert.equal((await getRecipe(db, r.id)).waterG, 225);
  assert.equal(planBefore.waterG, 300, '直す前に写した計画は変わらない');

  const fav = await setRecipeFavorite(db, r.id, true, later(2));
  assert.equal(fav.favorite, true);
  assert.equal(fav.version, 2);

  await deleteRecipe(db, r.id, later(3));
  assert.equal(await getRecipe(db, r.id), null);
  assert.deepEqual(await listRecipes(db), []);
  await assert.rejects(updateRecipe(db, r.id, recipeInput(), later(4)));
});

test('前回の抽出を取り出して、計画を写せる（A1）', async () => {
  const db = freshDb();
  assert.equal(await getLastBrew(db), null);
  const sample = makeSampleData(NOW);
  const older = { ...sample.brews[0], id: 'older', at: '2026-11-01T07:00:00.000Z' };
  await putAll(db, { ...sample, brews: [...sample.brews, older] });
  const last = await getLastBrew(db);
  assert.equal(last.id, sample.brews[0].id);
  const plan = planFromBrew(last, await getRecipe(db, last.recipeId));
  assert.equal(plan.waterG, 300);
  assert.equal(plan.beanId, sample.beans[0].id);
});

test('書き出し→全削除→復元で、器具とレシピが戻る', async () => {
  const db = freshDb();
  const g = await addEquipment(db, eqInput({ kind: 'grinder', name: 'C40', burr: 'conical', step: '1' }), NOW);
  const r = await addRecipe(db, recipeInput({ grinderId: g.id, grindSetting: '24', favorite: true }), NOW);
  await updateRecipe(db, r.id, recipeInput({ grinderId: g.id, grindSetting: '25' }), later(1));
  const backup = parseBackup(JSON.stringify(await exportAll(db, later(2))));
  await clearAll(db);
  assert.deepEqual(await listRecipes(db), []);
  await restoreBackup(db, backup);
  const back = await getRecipe(db, r.id);
  assert.equal(back.version, 2);
  assert.equal(back.grind.setting, '25');
  assert.deepEqual(back.pours, r.pours);
  assert.equal((await getEquipment(db, g.id)).attrs.step, 1);
});
