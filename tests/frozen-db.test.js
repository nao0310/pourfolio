// 冷凍ストック（C4）とデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from '../vendor/dexie/dexie.mjs';
import {
  openDb,
  addBean,
  getBeanWithTx,
  addRecipe,
  saveBrew,
  measureBean,
  freezeBean,
  takeOutPortion,
  deleteInventoryTx,
  deleteBean,
  listFrozenPortions,
  addOrder,
  readAll,
  exportAll,
  clearAll,
  restoreBackup,
} from '../js/db.js';
import { normalizeBeanInput } from '../js/core/beans.js';
import { remainingG } from '../js/core/inventory.js';
import { normalizeFreezeInput, portionsOf, stockParts } from '../js/core/frozen.js';
import { normalizeRecipeInput, newRecipeState, planFromRecipe } from '../js/core/recipes.js';
import { newDraft, finishDraft, initialActualInput, normalizeActualInput, buildBrew } from '../js/core/brews.js';
import { normalizeOrderItem, orderFields } from '../js/core/orders.js';
import { makeBackup, parseBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const beanInput = () =>
  normalizeBeanInput({ name: 'エチオピア', actualWeightG: '200', roastLevel: 'シティ', roastDate: '2026-11-10' }).value;
const freezeValue = (raw, availableG) => {
  const { value, errors } = normalizeFreezeInput({ frozenDate: '2026-11-18', ...raw }, { availableG });
  assert.deepEqual(errors, {});
  return value;
};

/** 常温・冷凍・合計 */
async function stockOf(db, beanId) {
  const { txs, portions } = await getBeanWithTx(db, beanId);
  return stockParts(remainingG(txs), portionsOf(portions, beanId));
}

/** レシピからタイマーで淹れた抽出の中身（粉量と、使う冷凍の袋） */
function brewFields(recipe, bean, { doseG = '15', portion = null } = {}, at = later(5)) {
  const start = at.getTime() - 240_000;
  const draft = finishDraft({ ...newDraft(planFromRecipe(recipe), bean.id, start), laps: [9, 50, 94, 139, 183] }, start + 215_000);
  const { value, errors } = normalizeActualInput({ ...initialActualInput(draft), doseG });
  assert.deepEqual(errors, {});
  return buildBrew({ draft, value, at: at.toISOString(), bean, portion });
}

test('完了の確認：抽出→冷凍→取り出し→冷凍の袋で抽出→量り直し をしても、常温＋冷凍の残量が合う', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  const recipe = await addRecipe(db, normalizeRecipeInput({ ...newRecipeState(), name: '朝' }).value, NOW);
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 200, frozenG: 0, frozenCount: 0, totalG: 200 });

  // 1杯淹れる：200 → 185
  await saveBrew(db, brewFields(recipe, bean, { doseG: '15' }, later(5)), later(5));
  // 4袋（15g×4）を冷凍：常温 125＋冷凍 60＝185（合計は変わらない）
  const { tx: freezeTx, portions } = await freezeBean(db, bean.id, freezeValue({ gramsPerPortion: '15', count: '4' }, 185), later(10));
  assert.equal(freezeTx.kind, 'freeze');
  assert.equal(freezeTx.deltaG, -60);
  assert.equal(freezeTx.memo, '#1〜#4（15g×4袋）');
  assert.deepEqual(
    portions.map((p) => [p.labelNo, p.grams, p.roastDaysAtFreeze, p.freezeTxId]),
    [1, 2, 3, 4].map((n) => [n, 15, 8, freezeTx.id]),
  );
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 125, frozenG: 60, frozenCount: 4, totalG: 185 });

  // #1を豆の画面で取り出す：常温 140＋冷凍 45＝185
  const thaw = await takeOutPortion(db, portions[0].id, later(20));
  assert.equal(thaw.kind, 'thaw');
  assert.equal(thaw.deltaG, 15);
  assert.equal(thaw.portionId, portions[0].id);
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 140, frozenG: 45, frozenCount: 3, totalG: 185 });

  // 冷凍の#2で淹れる（粉量15.3g）：袋は取り出され、常温から粉量が減る。合計は粉量の分だけ減る
  const fields = brewFields(recipe, bean, { doseG: '15.3', portion: portions[1] }, later(30));
  assert.equal(fields.frozenPortionId, portions[1].id);
  assert.equal(fields.derived.daysOffRoast, 8, '冷凍中の日数を数えない');
  const { brew } = await saveBrew(db, fields, later(30));
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 139.7, frozenG: 30, frozenCount: 2, totalG: 169.7 });
  const used = (await listFrozenPortions(db)).find((p) => p.id === portions[1].id);
  assert.equal(used.takenOutAt, brew.at);
  assert.equal(used.takenOutBrewId, brew.id);

  // 常温を量り直す（138g）：冷凍の袋は変わらない
  await measureBean(db, bean.id, 138, later(40));
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 138, frozenG: 30, frozenCount: 2, totalG: 168 });

  // 次に冷凍するときは、冷凍庫にない番号（取り出した1・2）から使う
  const second = await freezeBean(db, bean.id, freezeValue({ gramsPerPortion: '20', count: '3' }, 138), later(50));
  assert.deepEqual(
    second.portions.map((p) => p.labelNo),
    [1, 2, 5],
  );
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 78, frozenG: 90, frozenCount: 5, totalG: 168 });
});

test('取り消し：冷凍を取り消すと袋も消えて常温に戻る。取り出した袋があれば取り消せない。取り出しを取り消すと袋が冷凍庫に戻る', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  const a = await freezeBean(db, bean.id, freezeValue({ gramsPerPortion: '15', count: '2' }, 200), later(1));
  await deleteInventoryTx(db, a.tx.id, later(2));
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 200, frozenG: 0, frozenCount: 0, totalG: 200 });
  assert.equal((await listFrozenPortions(db)).length, 0);

  const b = await freezeBean(db, bean.id, freezeValue({ gramsPerPortion: '15', count: '2' }, 200), later(3));
  const thaw = await takeOutPortion(db, b.portions[0].id, later(4));
  await assert.rejects(deleteInventoryTx(db, b.tx.id, later(5)), /取り出した袋があるため/);
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 185, frozenG: 15, frozenCount: 1, totalG: 200 });

  await deleteInventoryTx(db, thaw.id, later(6));
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 170, frozenG: 30, frozenCount: 2, totalG: 200 });
  // 戻した後なら冷凍そのものも取り消せる
  await deleteInventoryTx(db, b.tx.id, later(7));
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 200, frozenG: 0, frozenCount: 0, totalG: 200 });
});

test('冷凍できないとき：常温より多い・入荷待ちの豆。取り出した袋をもう一度取り出せない', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  await assert.rejects(freezeBean(db, bean.id, { gramsPerPortion: 50, count: 5, frozenDate: '2026-11-18', totalG: 250 }, later(1)), /常温の残り/);
  const item = normalizeOrderItem({ name: 'ケニア', roastLevel: 'シティ', labelWeightG: 100, qty: 1, priceJpy: 700 }).value;
  const { beans } = await addOrder(db, orderFields({ orderDate: '2026-11-18', items: [item] }), [item], NOW);
  await assert.rejects(freezeBean(db, beans[0].id, freezeValue({ gramsPerPortion: '10', count: '1' }, 100), later(1)), /届いていない/);
  const { portions } = await freezeBean(db, bean.id, freezeValue({ gramsPerPortion: '10', count: '1' }, 200), later(2));
  await takeOutPortion(db, portions[0].id, later(3));
  await assert.rejects(takeOutPortion(db, portions[0].id, later(4)), /冷凍庫にない/);
});

test('未開封の豆を冷凍すると開封済みになる。前の日付で冷凍したら、その日の昼の履歴にする', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  assert.equal(bean.status, 'unopened');
  const { tx } = await freezeBean(db, bean.id, freezeValue({ gramsPerPortion: '50', count: '2', frozenDate: '2026-11-15' }, 200), NOW);
  assert.equal((await getBeanWithTx(db, bean.id)).bean.status, 'open');
  assert.equal(tx.at, new Date('2026-11-15T12:00:00').toISOString());
});

test('豆を削除すると冷凍の袋にも削除の印が付く', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  await freezeBean(db, bean.id, freezeValue({ gramsPerPortion: '15', count: '3' }, 200), later(1));
  await deleteBean(db, bean.id, later(2));
  assert.equal((await listFrozenPortions(db)).length, 0);
  const all = await readAll(db);
  assert.equal(all.frozenPortions.length, 3);
  assert.ok(all.frozenPortions.every((p) => p.deletedAt));
});

test('移行：版3のデータベースを開き直すと、記録はそのままで冷凍の表が増える', async () => {
  const indexedDB = new IDBFactory();
  const v3 = new Dexie('pourfolio-test', { indexedDB, IDBKeyRange });
  v3.version(1).stores({
    beans: 'id, updatedAt, roastDate',
    inventoryTx: 'id, beanId, brewId, at, updatedAt',
    equipment: 'id, kind, updatedAt',
    recipes: 'id, parentId, updatedAt',
    brews: 'id, at, beanId, recipeId, updatedAt',
    tastings: 'id, brewId, updatedAt',
    settings: 'id',
  });
  v3.version(2).stores({ suggestions: 'id, brewId, beanId, updatedAt' });
  v3.version(3).stores({ orders: 'id, orderDate, updatedAt' });
  const at = NOW.toISOString();
  const bean = { id: 'bean1', name: 'グアテマラ', status: 'open', roastDate: '2026-11-10', createdAt: at, updatedAt: at, deletedAt: null };
  const tx = { id: 'tx1', beanId: 'bean1', brewId: null, at, deltaG: 160, kind: 'in', createdAt: at, updatedAt: at, deletedAt: null };
  const order = { id: 'o1', orderDate: '2026-11-01', items: [], createdAt: at, updatedAt: at, deletedAt: null };
  await v3.table('beans').put(bean);
  await v3.table('inventoryTx').put(tx);
  await v3.table('orders').put(order);
  v3.close();

  const db = openDb('pourfolio-test', { indexedDB, IDBKeyRange });
  await db.open();
  assert.equal(db.verno, 4);
  const all = await readAll(db);
  assert.deepEqual(all.beans, [bean]);
  assert.deepEqual(all.inventoryTx, [tx]);
  assert.deepEqual(all.orders, [order]);
  assert.deepEqual(all.frozenPortions, []);
  // 移行した後もそのまま冷凍できる
  await freezeBean(db, 'bean1', freezeValue({ gramsPerPortion: '20', count: '2' }, 160), later(1));
  assert.deepEqual(await stockOf(db, 'bean1'), { roomG: 120, frozenG: 40, frozenCount: 2, totalG: 160 });
});

test('書き出し→全削除→復元で冷凍の袋が戻る。冷凍の表がない古いファイルも復元できる', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  const { portions } = await freezeBean(db, bean.id, freezeValue({ gramsPerPortion: '15', count: '3' }, 200), later(1));
  await takeOutPortion(db, portions[0].id, later(2));
  const before = await readAll(db);
  const file = JSON.stringify(await exportAll(db, later(3)));
  await clearAll(db);
  await restoreBackup(db, parseBackup(file));
  const after = await readAll(db);
  assert.deepEqual(after.frozenPortions, before.frozenPortions);
  assert.deepEqual(after.inventoryTx, before.inventoryTx);
  assert.deepEqual(await stockOf(db, bean.id), { roomG: 170, frozenG: 30, frozenCount: 2, totalG: 200 });

  // 2-2までのファイル（frozenPortions の表がない）
  const old = makeBackup({ beans: before.beans, inventoryTx: before.inventoryTx.filter((t) => t.kind === 'in') }, NOW);
  delete old.tables.frozenPortions;
  const db2 = freshDb();
  await restoreBackup(db2, parseBackup(JSON.stringify(old)));
  assert.deepEqual(await stockOf(db2, bean.id), { roomG: 200, frozenG: 0, frozenCount: 0, totalG: 200 });
});
